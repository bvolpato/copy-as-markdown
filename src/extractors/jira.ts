/**
 * Jira issue extractor.
 * Covers Atlassian Cloud issue routes plus recognizable Jira Server/Data Center hosts.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import { adfToMarkdown, fetchAtlassianJson, htmlToMarkdown } from '../core/atlassian';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

const ISSUE_KEY_PATTERN = '[A-Z][A-Z0-9_]*-\\d+';
const CUSTOM_JIRA_URL = new RegExp(
  `^https?://(?:[A-Z0-9.-]*jira[A-Z0-9.-]*(?::\\d+)?/(?:browse|issues)/${ISSUE_KEY_PATTERN}`
  + `|[A-Z0-9.-]+(?::\\d+)?/jira/(?:[^?#]*/)?(?:browse|issues)/${ISSUE_KEY_PATTERN}`
  + `|[A-Z0-9.-]*jira[A-Z0-9.-]*(?::\\d+)?/secure/ViewIssue\\.jsp\\?[^#]*(?:key|selectedIssue)=${ISSUE_KEY_PATTERN}`
  + `|(?:[A-Z0-9-]+\\.)?atlassian\\.net(?::\\d+)?/jira/[^?#]*(?:/(?:browse|issues)/${ISSUE_KEY_PATTERN}|[?&]selectedIssue=${ISSUE_KEY_PATTERN}))(?:[/?#&].*)?$`,
  'i',
);

type NamedValue = { name: string; value: string };
type JiraComment = { author: string; date: string; body: string };
type JiraIssueLink = { key: string; title: string; url: string };
type JsonObject = Record<string, unknown>;
type JiraApiExtraction = {
  issueKey: string;
  summary: string;
  description: string;
  fields: NamedValue[];
  comments: JiraComment[];
  commentsTotal: number;
  links: JiraIssueLink[];
  contentSource: string;
};

register({
  name: 'Jira',
  matches: [
    '*://*.atlassian.net/browse/*',
    '*://*.atlassian.net/secure/ViewIssue.jsp*',
  ],
  regex: CUSTOM_JIRA_URL,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="issue.views.issue-base.foundation.actions.more-actions"]',
      '[data-testid="issue.views.issue-base.foundation.actions"] > :last-child',
      '[data-testid="issue.views.issue-base.foundation.quick-add.quick-add-items-compact"] > :last-child',
      '#opsbar-opsbar-transitions + .aui-toolbar2-secondary > :first-child',
    ].join(', '),
    position: 'before',
    style: 'pill',
    css: { marginInlineEnd: '8px' },
    label: 'Copy as Markdown',
  },

  async extract() {
    const domIssueKey = getIssueKey();
    const api = domIssueKey ? await fetchJiraIssue(domIssueKey) : null;
    const issueKey = api?.issueKey || domIssueKey;
    const summary = api?.summary || getSummary(issueKey);
    const fieldsResult = limitCollection(api?.fields || extractFields(), 80);
    const commentsResult = limitCollection(api?.comments || extractComments(), 100);
    const linksResult = limitCollection(api?.links || extractIssueLinks(issueKey), 100);
    const descriptionElement = findDescriptionElement();
    const description = api?.description || (descriptionElement
      ? markdownFromContent(descriptionElement, JIRA_DESCRIPTION_NOISE)
      : '');
    const hasIssueContent = Boolean(
      api || (summary && (descriptionElement || fieldsResult.total > 0 || document.querySelector('#issue-content'))),
    );

    const metadata: PageMetadata = {
      source: 'Jira',
      type: 'Jira Issue',
      title: summary,
      url: Utils.getCanonicalUrl(),
    };
    if (issueKey) metadata.issue_key = issueKey;
    addKnownFieldMetadata(metadata, fieldsResult.items);
    metadata.fields_total = fieldsResult.total;
    metadata.comments_total = api?.commentsTotal ?? commentsResult.total;
    metadata.links_total = linksResult.total;

    const parts = [`# ${issueKey ? `${issueKey}: ` : ''}${summary || 'Jira Issue'}`];
    if (!issueKey) {
      parts.push('*Could not identify a Jira issue on this page. Open an issue and try again.*');
    }
    if (description) parts.push('## Description', description);
    else if (issueKey) parts.push('## Description', '*No description was visible.*');

    if (fieldsResult.items.length > 0) {
      parts.push('## Fields');
      parts.push(fieldsResult.items
        .map(({ name, value }) => `- **${escapeInline(name)}:** ${value.replace(/\n/g, '\n  ')}`)
        .join('\n'));
    }

    if (linksResult.items.length > 0) {
      parts.push('## Linked issues');
      parts.push(linksResult.items.map((link) => {
        const label = link.title && link.title !== link.key
          ? `${link.key}: ${link.title}`
          : link.key;
        return `- [${escapeLinkLabel(label)}](${link.url})`;
      }).join('\n'));
    }

    if (commentsResult.items.length > 0) {
      parts.push('## Comments');
      commentsResult.items.forEach((comment, index) => {
        const heading = comment.author || `Comment ${index + 1}`;
        parts.push(`### ${heading}`);
        if (comment.date) parts.push(`*${comment.date}*`);
        parts.push(comment.body);
      });
    }

    const apiCommentsTruncated = Boolean(api && api.commentsTotal > api.comments.length);
    const collectionTruncated = fieldsResult.truncated
      || commentsResult.truncated
      || linksResult.truncated
      || apiCommentsTruncated;
    const commentsTotal = api?.commentsTotal ?? commentsResult.total;
    const totalItems = (description ? 1 : 0)
      + fieldsResult.total + commentsTotal + linksResult.total;
    const includedItems = (description ? 1 : 0) + fieldsResult.items.length
      + commentsResult.items.length
      + linksResult.items.length;
    const limited = limitMarkdown(parts.join('\n\n'));
    const truncated = collectionTruncated || limited.truncated;
    addExtractionMetadata(metadata, {
      contentSource: api?.contentSource
        || (hasIssueContent ? 'Jira semantic issue DOM' : 'Jira document metadata'),
      total: totalItems,
      included: includedItems,
      truncated,
      complete: hasIssueContent && !truncated,
    });

    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

const JIRA_DESCRIPTION_NOISE = [
  ...Utils.NOISE_SELECTORS,
  'button',
  '[role="toolbar"]',
  '[data-testid*="edit"]',
  '[data-testid*="placeholder"]',
  '[data-testid*="action"]',
];

async function fetchJiraIssue(issueKey: string): Promise<JiraApiExtraction | null> {
  const apiUrl = buildJiraApiUrl(issueKey);
  if (!apiUrl) return null;

  try {
    const payload = await fetchAtlassianJson(apiUrl);
    return parseJiraApiIssue(payload, issueKey);
  } catch (error) {
    console.warn('[Copy as Markdown] Jira REST fetch failed; using rendered DOM', error);
    return null;
  }
}

function buildJiraApiUrl(issueKey: string): string {
  const cloud = window.location.hostname.toLowerCase().endsWith('.atlassian.net');
  const contextPath = cloud ? '' : getJiraContextPath();
  const version = cloud ? '3' : 'latest';
  const url = new URL(
    `${contextPath}/rest/api/${version}/issue/${encodeURIComponent(issueKey)}`,
    window.location.origin,
  );
  url.searchParams.set('expand', 'names,renderedFields');
  url.searchParams.set('fields', '*all');
  return url.toString();
}

function getJiraContextPath(): string {
  const path = window.location.pathname;
  const marker = path.search(/\/(?:browse|issues|secure)\//i);
  if (marker > 0) return path.slice(0, marker).replace(/\/$/, '');
  const jiraMarker = path.toLowerCase().indexOf('/jira/');
  return jiraMarker >= 0 ? path.slice(0, jiraMarker + '/jira'.length) : '';
}

function parseJiraApiIssue(payload: JsonObject, requestedKey: string): JiraApiExtraction {
  const fields = asObject(payload.fields);
  if (!fields) throw new Error('Jira REST response omitted issue fields');
  const renderedFields = asObject(payload.renderedFields) || {};
  const names = asObject(payload.names) || {};
  const issueKey = stringValue(payload.key).toUpperCase() || requestedKey;
  const summary = normalizeText(stringValue(fields.summary));
  const renderedDescription = stringValue(renderedFields.description);
  const description = renderedDescription
    ? htmlToMarkdown(renderedDescription)
    : adfToMarkdown(fields.description) || normalizeText(stringValue(fields.description));
  const comments = extractApiComments(fields.comment, renderedFields.comment);

  return {
    issueKey,
    summary,
    description,
    fields: extractApiFields(fields, renderedFields, names),
    comments: comments.items,
    commentsTotal: comments.total,
    links: extractApiIssueLinks(fields.issuelinks, issueKey),
    contentSource: window.location.hostname.toLowerCase().endsWith('.atlassian.net')
      ? 'Jira Cloud REST API v3'
      : 'Jira REST API',
  };
}

function extractApiFields(
  fields: JsonObject,
  renderedFields: JsonObject,
  names: JsonObject,
): NamedValue[] {
  const excluded = new Set([
    'summary', 'description', 'comment', 'issuelinks', 'attachment', 'subtasks', 'project',
  ]);
  const values = new Map<string, NamedValue>();

  Object.entries(fields).forEach(([fieldId, rawValue]) => {
    if (excluded.has(fieldId) || rawValue === null || rawValue === undefined) return;
    const rawName = stringValue(names[fieldId]) || jiraFieldName(fieldId);
    if (!rawName) return;
    const renderedValue = renderedFields[fieldId];
    const value = formatJiraField(renderedValue) || formatJiraField(rawValue);
    addField(values, rawName, value);
  });

  return Array.from(values.values());
}

function jiraFieldName(fieldId: string): string {
  const known: Record<string, string> = {
    issuetype: 'Issue Type',
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    reporter: 'Reporter',
    resolution: 'Resolution',
    created: 'Created',
    updated: 'Updated',
    resolutiondate: 'Resolved',
    labels: 'Labels',
    components: 'Components',
    fixVersions: 'Fix Versions',
    affectsVersions: 'Affects Versions',
    environment: 'Environment',
    parent: 'Parent',
  };
  return known[fieldId] || '';
}

function formatJiraField(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const markdown = /<\/?[a-z][\s\S]*>/i.test(value) ? htmlToMarkdown(value) : normalizeText(value);
    return markdown.slice(0, 4_000);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(formatJiraField).filter(Boolean).join(', ').slice(0, 4_000);
  }

  const object = asObject(value);
  if (!object) return '';
  if (object.type === 'doc') return adfToMarkdown(object).slice(0, 4_000);
  return [object.displayName, object.name, object.value, object.key]
    .map(stringValue)
    .find(Boolean)
    ?.slice(0, 4_000) || '';
}

function extractApiComments(
  rawCommentField: unknown,
  renderedCommentField: unknown,
): { items: JiraComment[]; total: number } {
  const rawContainer = asObject(rawCommentField) || {};
  const renderedContainer = asObject(renderedCommentField) || {};
  const rawComments = objectArray(rawContainer.comments);
  const renderedComments = objectArray(renderedContainer.comments);
  const renderedById = new Map(renderedComments.map((comment) => [stringValue(comment.id), comment]));

  const items = rawComments.map((comment, index) => {
    const rendered = renderedById.get(stringValue(comment.id)) || renderedComments[index] || {};
    const renderedBody = stringValue(rendered.body);
    const author = asObject(comment.author) || asObject(rendered.author) || {};
    return {
      author: stringValue(author.displayName) || stringValue(author.name),
      date: stringValue(comment.updated) || stringValue(comment.created),
      body: renderedBody
        ? htmlToMarkdown(renderedBody)
        : adfToMarkdown(comment.body) || normalizeText(stringValue(comment.body)),
    };
  }).filter((comment) => comment.body);

  return {
    items,
    total: numberValue(rawContainer.total) || rawComments.length,
  };
}

function extractApiIssueLinks(value: unknown, currentIssueKey: string): JiraIssueLink[] {
  return objectArray(value).flatMap((link) => {
    const outward = asObject(link.outwardIssue);
    const inward = asObject(link.inwardIssue);
    const issue = outward || inward;
    if (!issue) return [];
    const key = stringValue(issue.key).toUpperCase();
    if (!key || key === currentIssueKey) return [];
    const linkType = asObject(link.type) || {};
    const relation = stringValue(outward ? linkType.outward : linkType.inward);
    const linkedFields = asObject(issue.fields) || {};
    const linkedSummary = normalizeText(stringValue(linkedFields.summary));
    const title = [relation, linkedSummary].filter(Boolean).join(': ') || key;
    return [{ key, title, url: buildJiraIssueUrl(key) }];
  });
}

function buildJiraIssueUrl(issueKey: string): string {
  const contextPath = window.location.hostname.toLowerCase().endsWith('.atlassian.net')
    ? ''
    : getJiraContextPath();
  return new URL(`${contextPath}/browse/${encodeURIComponent(issueKey)}`, window.location.origin).toString();
}

function getIssueKey(): string {
  const pathMatches = [
    window.location.pathname.match(/\/(?:browse|issues)\/([A-Z][A-Z0-9_]*-\d+)/i)?.[1],
    window.location.pathname.match(/\/([A-Z][A-Z0-9_]*-\d+)(?:\/|$)/i)?.[1],
  ];
  const url = new URL(window.location.href);
  const queryKey = url.searchParams.get('selectedIssue') || url.searchParams.get('key');
  const domKey = textOf(document.querySelector(
    '[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"], '
    + '[data-testid*="issue-key"], #key-val, #issuekey',
  )).match(new RegExp(ISSUE_KEY_PATTERN, 'i'))?.[0];
  return [...pathMatches, queryKey, domKey]
    .find((value) => value && new RegExp(`^${ISSUE_KEY_PATTERN}$`, 'i').test(value))
    ?.toUpperCase() || '';
}

function getSummary(issueKey: string): string {
  const value = textOf(document.querySelector(
    '[data-testid="issue.views.issue-base.foundation.summary.heading"], '
    + '[data-test-id="issue.views.issue-base.foundation.summary.heading"], '
    + 'h1[data-testid*="summary"], #summary-val, #issue-header h1, main h1',
  )) || metaContent('og:title') || Utils.getPageTitle();
  return value
    .replace(new RegExp(`^${escapeRegExp(issueKey)}\\s*[-:|]\\s*`, 'i'), '')
    .replace(/\s*[-|]\s*Jira\s*$/i, '')
    .trim();
}

function findDescriptionElement(): Element | null {
  return firstVisible([
    '[data-testid="issue.views.field.rich-text.description"] [data-testid="renderer-container"]',
    '[data-testid="issue.views.field.rich-text.description"] .ak-renderer-document',
    '[data-testid="issue.views.field.rich-text.description"]',
    '[data-test-id="issue.views.field.rich-text.description"]',
    '#description-val .user-content-block',
    '#description-val',
    '#descriptionmodule .user-content-block',
  ]);
}

function extractFields(): NamedValue[] {
  const values = new Map<string, NamedValue>();

  document.querySelectorAll('main dt, #issue-content dt, #content dt').forEach((term) => {
    const definition = term.nextElementSibling;
    if (!definition || definition.tagName !== 'DD') return;
    addField(values, textOf(term), textOf(definition));
  });

  const fieldSelector = [
    '[data-testid^="issue.views.field."]',
    '[data-test-id^="issue.views.field."]',
    '#details-module .item',
    '#peoplemodule .item',
    '#datesmodule .item',
  ].join(', ');
  document.querySelectorAll<HTMLElement>(fieldSelector).forEach((field) => {
    if (!isVisible(field) || field.closest('[data-testid*="description"]')) return;
    const testId = field.dataset.testid || field.getAttribute('data-test-id') || '';
    const testIdParts = testId.split('.');
    const fallbackName = testIdParts[testIdParts.length - 1]?.replace(/[-_]+/g, ' ') || '';
    const label = textOf(field.querySelector(
      'label, dt, [data-testid$=".label"], [data-test-id$=".label"], .wrap > strong, .name',
    )) || field.getAttribute('aria-label') || fallbackName;
    const valueElement = field.querySelector(
      'dd, [data-testid$=".value"], [data-test-id$=".value"], [role="combobox"], .value',
    );
    const value = textOf(valueElement || field);
    addField(values, label, removeLeadingLabel(value, label));
  });

  return Array.from(values.values());
}

function addField(fields: Map<string, NamedValue>, rawName: string, rawValue: string): void {
  const name = normalizeFieldName(rawName);
  const value = normalizeText(rawValue).slice(0, 4_000);
  if (!name || !value || value === '-' || /^(description|summary|comments?|activity)$/i.test(name)) return;
  const key = name.toLowerCase();
  const existing = fields.get(key);
  if (!existing || value.length < existing.value.length) fields.set(key, { name, value });
}

function normalizeFieldName(value: string): string {
  const normalized = normalizeText(value).replace(/:$/, '').trim();
  if (!normalized || normalized.length > 80) return '';
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function removeLeadingLabel(value: string, label: string): string {
  if (!label) return value;
  return value.replace(new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*`, 'i'), '').trim();
}

function extractComments(): JiraComment[] {
  const selector = [
    '[data-testid="issue.activity.comment"]',
    '[data-test-id="issue.activity.comment"]',
    '[data-testid^="issue.activity.comments-list.comment-"]',
    '#activitymodule .issue-data-block.activity-comment',
    '.actionContainer .action-body',
  ].join(', ');
  const comments: JiraComment[] = [];
  const seen = new Set<string>();

  document.querySelectorAll<HTMLElement>(selector).forEach((container) => {
    if (!isVisible(container)) return;
    const bodyElement = container.matches('.action-body')
      ? container
      : container.querySelector(
        '[data-testid*="comment-body"] .ak-renderer-document, '
        + '[data-testid*="comment-body"], .action-body, .comment-body, .user-content-block, '
        + '.ak-renderer-document',
      );
    if (!bodyElement) return;
    const body = markdownFromContent(bodyElement, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[role="toolbar"]',
      '[data-testid*="action"]',
    ]);
    if (!body) return;
    const author = textOf(container.querySelector(
      '[data-testid*="comment-author"], [data-testid*="user-avatar"], '
      + '[rel="author"], .user-hover, .action-details a:first-child',
    ));
    const dateElement = container.querySelector('time, [data-testid*="comment-date"], .livestamp');
    const date = dateElement?.getAttribute('datetime')
      || dateElement?.getAttribute('title')
      || textOf(dateElement);
    const signature = `${author}\n${date}\n${body}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      comments.push({ author, date, body });
    }
  });
  return comments;
}

function extractIssueLinks(currentIssueKey: string): JiraIssueLink[] {
  const links = new Map<string, JiraIssueLink>();
  const roots = Array.from(document.querySelectorAll(
    '[data-testid*="issue-link"], [data-test-id*="issue-link"], #linkingmodule, .issue-links',
  ));
  const candidates = roots.length > 0
    ? roots.flatMap((root) => Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')))
    : Array.from(document.querySelectorAll<HTMLAnchorElement>(
      'main a[href*="/browse/"], #issue-content a[href*="/browse/"]',
    ));

  candidates.forEach((anchor) => {
    if (!isVisible(anchor)) return;
    const href = anchor.href;
    const key = (anchor.textContent || href).match(new RegExp(ISSUE_KEY_PATTERN, 'i'))?.[0]?.toUpperCase();
    if (!key || key === currentIssueKey) return;
    const title = normalizeText(anchor.textContent || anchor.getAttribute('aria-label') || key);
    if (!links.has(key)) links.set(key, { key, title, url: href });
  });
  return Array.from(links.values());
}

function addKnownFieldMetadata(metadata: PageMetadata, fields: NamedValue[]): void {
  const wanted = new Map([
    ['status', 'status'],
    ['issue type', 'issue_type'],
    ['type', 'issue_type'],
    ['priority', 'priority'],
    ['assignee', 'assignee'],
    ['reporter', 'reporter'],
    ['resolution', 'resolution'],
    ['created', 'created'],
    ['updated', 'updated'],
  ]);
  fields.forEach(({ name, value }) => {
    const key = wanted.get(name.toLowerCase());
    if (key && metadata[key] === undefined) metadata[key] = value;
  });
}

function markdownFromContent(element: Element, noise: string[]): string {
  return Markdown.elementToMarkdown(Utils.removeNoise(element, noise)).trim();
}

function firstVisible(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (element) return element;
  }
  return null;
}

function isVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.hasAttribute('hidden')
      || current.getAttribute('aria-hidden') === 'true'
      || (current instanceof HTMLElement
        && (current.style.display === 'none' || current.style.visibility === 'hidden'))
    ) return false;
    current = current.parentElement;
  }
  return true;
}

function metaContent(name: string): string {
  return document.querySelector<HTMLMetaElement>(
    `meta[name="${name}"], meta[property="${name}"]`,
  )?.content?.trim() || '';
}

function textOf(element: Element | null): string {
  return normalizeText(element?.textContent || '');
}

function normalizeText(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

function escapeLinkLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => item !== null)
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
