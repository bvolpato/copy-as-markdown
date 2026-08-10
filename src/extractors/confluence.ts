/**
 * Confluence page extractor.
 * Covers Atlassian Cloud pages plus recognizable Confluence Server/Data Center hosts.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import { fetchAtlassianJson, htmlToMarkdown } from '../core/atlassian';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

const CUSTOM_CONFLUENCE_URL = /^https?:\/\/(?:(?:[^/?#]*\.)?confluence[^/?#]*(?::\d+)?\/(?:display\/[^/]+\/|pages\/viewpage\.action)|[^/?#]+(?::\d+)?\/confluence\/(?:display\/[^/]+\/|pages\/viewpage\.action))(?:[^#]*)$/i;

type ConfluenceComment = { author: string; date: string; body: string };
type JsonObject = Record<string, unknown>;
type ConfluenceApiExtraction = {
  pageId: string;
  title: string;
  body: string;
  labels: string[];
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  version: string;
  author: string;
  updated: string;
  tables: number;
  codeBlocks: number;
  contentSource: string;
};

register({
  name: 'Confluence',
  matches: ['*://*.atlassian.net/wiki/*'],
  regex: CUSTOM_CONFLUENCE_URL,
  pathnameRegex: /^(?:\/wiki\/(?:spaces\/[^/]+\/pages\/\d+|pages\/viewpage\.action|x\/[^/]+)|\/(?:display\/[^/]+\/|pages\/viewpage\.action)|\/confluence\/(?:display\/[^/]+\/|pages\/viewpage\.action))/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="object-header-actions-container"]',
      '[data-testid="page-header-actions"]',
      '[data-testid="content-actions"]',
      '#page-toolbar .aui-toolbar2-secondary',
      '#navigation .aui-toolbar2-secondary',
    ].join(', '),
    position: 'append',
    style: 'pill',
    css: { marginInlineEnd: '8px' },
    label: 'Copy as Markdown',
  },

  async extract() {
    const domPageId = metaContent('ajs-page-id') || getPageId();
    const api = domPageId ? await fetchConfluencePage(domPageId) : null;
    const title = api?.title || getPageTitle();
    const bodyElement = findPageBody();
    const body = api?.body || (bodyElement ? markdownFromPageBody(bodyElement) : '');
    const commentsResult = limitCollection(extractComments(bodyElement), 100);
    const labelsResult = limitCollection(api ? api.labels : extractLabels(), 100);
    const metadata: PageMetadata = {
      source: 'Confluence',
      type: 'Confluence Page',
      title,
      url: Utils.getCanonicalUrl(),
    };
    addMeta(metadata, 'page_id', api?.pageId || domPageId);
    addMeta(metadata, 'space_id', api?.spaceId || '');
    addMeta(metadata, 'space_key', api?.spaceKey || metaContent('ajs-space-key') || getSpaceKey());
    addMeta(metadata, 'space', api?.spaceName || metaContent('ajs-space-name'));
    addMeta(metadata, 'version', api?.version || metaContent('ajs-page-version'));
    addMeta(metadata, 'author', api?.author || getAuthor());
    addMeta(metadata, 'updated', api?.updated || getUpdated());
    metadata.comments_total = commentsResult.total;
    metadata.labels_total = labelsResult.total;
    if (api) {
      metadata.tables = api.tables;
      metadata.code_blocks = api.codeBlocks;
    } else if (bodyElement) {
      metadata.tables = bodyElement.querySelectorAll('table').length;
      metadata.code_blocks = bodyElement.querySelectorAll('pre, [data-node-type="codeBlock"]').length;
    }

    const parts = [`# ${title || 'Confluence Page'}`];
    if (labelsResult.items.length > 0) {
      parts.push(`**Labels:** ${labelsResult.items.map(escapeInline).join(', ')}`);
    }
    if (body) parts.push(body);
    else parts.push('*Could not find visible Confluence page content. Wait for page to finish loading and try again.*');

    if (commentsResult.items.length > 0) {
      parts.push('## Comments');
      commentsResult.items.forEach((comment, index) => {
        parts.push(`### ${comment.author || `Comment ${index + 1}`}`);
        if (comment.date) parts.push(`*${comment.date}*`);
        parts.push(comment.body);
      });
    }

    const collectionTruncated = commentsResult.truncated || labelsResult.truncated;
    const limited = limitMarkdown(parts.join('\n\n'));
    const truncated = collectionTruncated || limited.truncated;
    const totalItems = 1 + commentsResult.total + labelsResult.total;
    const includedItems = (body ? 1 : 0) + commentsResult.items.length + labelsResult.items.length;
    addExtractionMetadata(metadata, {
      contentSource: api?.contentSource
        || (bodyElement ? 'Confluence semantic page DOM' : 'Confluence document metadata'),
      total: totalItems,
      included: includedItems,
      truncated,
      complete: Boolean(body) && !truncated,
    });

    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

async function fetchConfluencePage(pageId: string): Promise<ConfluenceApiExtraction | null> {
  const cloud = window.location.hostname.toLowerCase().endsWith('.atlassian.net');
  const url = cloud
    ? buildConfluenceCloudApiUrl(pageId)
    : buildConfluenceServerApiUrl(pageId);

  try {
    const payload = await fetchAtlassianJson(url);
    return cloud
      ? parseConfluenceCloudPage(payload, pageId)
      : parseConfluenceServerPage(payload, pageId);
  } catch (error) {
    console.warn('[Copy as Markdown] Confluence REST fetch failed; using rendered DOM', error);
    return null;
  }
}

function buildConfluenceCloudApiUrl(pageId: string): string {
  const url = new URL(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, window.location.origin);
  url.searchParams.set('body-format', 'view');
  url.searchParams.set('include-labels', 'true');
  return url.toString();
}

function buildConfluenceServerApiUrl(pageId: string): string {
  const contextPath = window.location.pathname.toLowerCase().startsWith('/confluence/')
    ? '/confluence'
    : '';
  const url = new URL(
    `${contextPath}/rest/api/content/${encodeURIComponent(pageId)}`,
    window.location.origin,
  );
  url.searchParams.set('expand', 'body.view,version,space,metadata.labels,history');
  return url.toString();
}

function parseConfluenceCloudPage(
  payload: JsonObject,
  requestedPageId: string,
): ConfluenceApiExtraction {
  const body = asObject(payload.body) || {};
  const view = asObject(body.view) || asObject(body.storage) || {};
  const html = stringValue(view.value);
  const title = stringValue(payload.title).trim();
  if (!html) throw new Error('Confluence REST response omitted page body');

  const version = asObject(payload.version) || {};
  const labels = extractApiLabels(payload.labels);
  const counts = countRenderedContent(html);
  return {
    pageId: stringValue(payload.id) || requestedPageId,
    title,
    body: htmlToMarkdown(html),
    labels,
    spaceId: stringValue(payload.spaceId),
    spaceKey: '',
    spaceName: '',
    version: stringNumber(version.number),
    author: '',
    updated: stringValue(version.createdAt) || stringValue(payload.createdAt),
    tables: counts.tables,
    codeBlocks: counts.codeBlocks,
    contentSource: 'Confluence Cloud REST API v2',
  };
}

function parseConfluenceServerPage(
  payload: JsonObject,
  requestedPageId: string,
): ConfluenceApiExtraction {
  const body = asObject(payload.body) || {};
  const view = asObject(body.view) || {};
  const html = stringValue(view.value);
  const title = stringValue(payload.title).trim();
  if (!html) throw new Error('Confluence REST response omitted page body');

  const version = asObject(payload.version) || {};
  const space = asObject(payload.space) || {};
  const metadata = asObject(payload.metadata) || {};
  const history = asObject(payload.history) || {};
  const createdBy = asObject(history.createdBy) || asObject(version.by) || {};
  const counts = countRenderedContent(html);
  return {
    pageId: stringValue(payload.id) || requestedPageId,
    title,
    body: htmlToMarkdown(html),
    labels: extractApiLabels(metadata.labels),
    spaceId: stringValue(space.id),
    spaceKey: stringValue(space.key),
    spaceName: stringValue(space.name),
    version: stringNumber(version.number),
    author: stringValue(createdBy.displayName) || stringValue(createdBy.username),
    updated: stringValue(version.when) || stringValue(history.lastUpdated),
    tables: counts.tables,
    codeBlocks: counts.codeBlocks,
    contentSource: 'Confluence REST API',
  };
}

function extractApiLabels(value: unknown): string[] {
  const container = asObject(value) || {};
  const labels = Array.isArray(value) ? value : container.results;
  return objectArray(labels)
    .map((label) => stringValue(label.name) || stringValue(label.label))
    .filter(Boolean);
}

function countRenderedContent(html: string): { tables: number; codeBlocks: number } {
  if (!html) return { tables: 0, codeBlocks: 0 };
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return {
    tables: parsed.querySelectorAll('table').length,
    codeBlocks: parsed.querySelectorAll('pre, [data-node-type="codeBlock"]').length,
  };
}

const CONFLUENCE_BODY_SELECTORS = [
  '#main-content [data-testid="renderer-container"] .ak-renderer-document',
  '[data-testid="renderer-container"] .ak-renderer-document',
  '#main-content .wiki-content',
  '#content .wiki-content',
  '.wiki-content',
  'article [data-testid="renderer-container"]',
  'main .ak-renderer-document',
];

const CONFLUENCE_BODY_NOISE = [
  ...Utils.NOISE_SELECTORS,
  'button',
  '[role="toolbar"]',
  '[data-testid*="toolbar"]',
  '[data-testid*="breadcrumb"]',
  '[data-testid*="byline"]',
  '[data-testid*="comment"]',
  '.comment',
  '.comments',
  '.comment-thread',
  '.inline-comment',
  '#comments-section',
  '#page-comments',
  '.page-metadata',
  '.page-tools',
];

function getPageTitle(): string {
  const title = textOf(document.querySelector(
    '[data-testid="title"], [data-testid="page-title"], #title-text, #content-title, main h1',
  )) || metaContent('ajs-page-title') || metaContent('og:title') || Utils.getPageTitle();
  return title.replace(/\s*[-|]\s*Confluence\s*$/i, '').trim();
}

function findPageBody(): Element | null {
  const candidates = CONFLUENCE_BODY_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)),
  ).filter((element) => isVisible(element) && !isInsideComment(element));
  return candidates.sort((left, right) => contentLength(right) - contentLength(left))[0] || null;
}

function contentLength(element: Element): number {
  return Markdown.normalizeWhitespace(element.textContent || '').length;
}

function markdownFromPageBody(element: Element): string {
  return Markdown.elementToMarkdown(Utils.removeNoise(element, CONFLUENCE_BODY_NOISE)).trim();
}

function extractComments(pageBody: Element | null): ConfluenceComment[] {
  const selector = [
    '#comments-section .comment',
    '#page-comments .comment',
    '.comment-thread .comment',
    '[data-testid="comment"]',
    '[data-testid="page-comment"]',
    '[data-testid="inline-comment"]',
    '[data-testid*="comment-item"]',
  ].join(', ');
  const comments: ConfluenceComment[] = [];
  const seen = new Set<string>();

  document.querySelectorAll<HTMLElement>(selector).forEach((container) => {
    if (!isVisible(container) || container === pageBody) return;
    const bodyElement = container.querySelector(
      '[data-testid*="comment-body"] .ak-renderer-document, '
      + '[data-testid*="comment-content"] .ak-renderer-document, '
      + '.comment-body, .wiki-content, .ak-renderer-document',
    );
    if (!bodyElement) return;
    const body = Markdown.elementToMarkdown(Utils.removeNoise(bodyElement, [
      ...Utils.NOISE_SELECTORS,
      'button',
      '[role="toolbar"]',
      '[data-testid*="action"]',
    ])).trim();
    if (!body) return;
    const author = textOf(container.querySelector(
      '[data-testid*="comment-author"], [data-testid*="user-avatar"], '
      + '.comment-user-logo + a, .author, [rel="author"]',
    ));
    const dateElement = container.querySelector('time, [data-testid*="comment-date"], .date');
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

function extractLabels(): string[] {
  const labels = new Set<string>();
  document.querySelectorAll(
    '#labels-section a, .labels-section a, [data-testid="labels"] a, [data-testid*="label-list"] a',
  ).forEach((element) => {
    const value = textOf(element);
    if (value && value.length <= 100) labels.add(value);
  });
  return Array.from(labels);
}

function getPageId(): string {
  const url = new URL(window.location.href);
  return url.searchParams.get('pageId')
    || window.location.pathname.match(/\/pages\/(\d+)/)?.[1]
    || '';
}

function getSpaceKey(): string {
  const path = window.location.pathname;
  return decodePathSegment(
    path.match(/\/spaces\/([^/]+)/i)?.[1]
    || path.match(/\/display\/([^/]+)/i)?.[1]
    || '',
  );
}

function getAuthor(): string {
  return textOf(document.querySelector(
    '[data-testid*="byline"] [data-testid*="user"], '
    + '[data-testid*="page-author"], #content-byline .url.fn, .page-metadata .author',
  ));
}

function getUpdated(): string {
  const element = document.querySelector(
    '[data-testid*="byline"] time, [data-testid*="last-updated"] time, '
    + '#content-byline time, .page-metadata time',
  );
  return element?.getAttribute('datetime')
    || element?.getAttribute('title')
    || textOf(element);
}

function isInsideComment(element: Element): boolean {
  return Boolean(element.closest(
    '#comments-section, #page-comments, .comment, .comments, .comment-thread, '
    + '[data-testid="comment"], [data-testid="page-comment"], [data-testid="inline-comment"]',
  ));
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

function addMeta(metadata: PageMetadata, key: string, value: string): void {
  if (value) metadata[key] = value;
}

function textOf(element: Element | null): string {
  return Markdown.normalizeWhitespace(element?.textContent || '').trim();
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
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

function stringNumber(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}
