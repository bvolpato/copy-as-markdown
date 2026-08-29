/** Linear issue, project, and document extraction from the rendered application DOM. */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import type { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type RouteKind = 'issue' | 'project' | 'document';

type LinearRoute = {
  kind: RouteKind;
  workspace: string;
  identifier: string;
};

type Field = {
  name: string;
  key: string;
  value: string;
};

type Comment = {
  author: string;
  date: string;
  body: string;
};

type PageLink = {
  label: string;
  url: string;
};

const LINEAR_ROUTE = /\/(?:issue|project|document)\/[^/?#]+/i;
const ISSUE_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/i;

export const linearExtractor = register({
  name: 'Linear',
  matches: ['*://linear.app/*'],
  pathnameRegex: LINEAR_ROUTE,

  async extract() {
    const route = parseRoute(window.location.pathname);
    const root = findPageRoot(route.kind);
    const title = getTitle(route, root);
    const fields = extractFields(route.kind, root);
    const comments = limitCollection(extractComments(root));
    const descriptionElement = findDescription(route.kind, root);
    const description = descriptionElement ? contentToMarkdown(descriptionElement, title) : '';
    const links = limitCollection(extractLinks(root));
    const virtualized = hasVirtualizedContent(root);

    const metadata: PageMetadata = {
      source: 'Linear',
      type: `Linear ${capitalize(route.kind)}`,
      title,
      url: Utils.getCanonicalUrl(),
      comments_scope: 'visible rendered comments only; older or virtualized comments may be omitted',
      virtualization_detected: String(virtualized),
    };
    if (route.workspace) metadata.workspace = route.workspace;
    if (route.kind === 'issue' && route.identifier) metadata.issue_key = route.identifier;
    fields.forEach(({ key, value }) => {
      if (metadata[key] === undefined) metadata[key] = value;
    });
    metadata.comments_included = comments.items.length;
    metadata.links_included = links.items.length;

    const heading = route.kind === 'issue' && route.identifier
      ? `# ${route.identifier}: ${title}`
      : `# ${title}`;
    const parts = [heading];

    if (fields.length > 0) {
      parts.push('## Fields');
      parts.push(fields.map(({ name, value }) => `- **${escapeInline(name)}:** ${value}`).join('\n'));
    }

    const contentHeading = route.kind === 'document' ? 'Document' : 'Description';
    if (description) parts.push(`## ${contentHeading}`, description);
    else parts.push(`## ${contentHeading}`, `*No ${contentHeading.toLowerCase()} was visible.*`);

    if (links.items.length > 0) {
      parts.push('## Links');
      parts.push(links.items
        .map((link) => `- [${Markdown.escapeMarkdownLinkText(link.label)}](${link.url})`)
        .join('\n'));
    }

    if (comments.items.length > 0) {
      parts.push('## Comments');
      comments.items.forEach((comment, index) => {
        parts.push(`### ${comment.author || `Comment ${index + 1}`}`);
        if (comment.date) parts.push(`*${comment.date}*`);
        parts.push(comment.body);
      });
    }

    if (comments.items.length > 0 || virtualized || hasCommentSurface(root)) {
      parts.push('*Comments include visible rendered items only; older or virtualized comments may be omitted.*');
    }

    const itemCount = (description ? 1 : 0) + fields.length + comments.total + links.total;
    const bounded = limitMarkdown(parts.join('\n\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'Linear rendered DOM',
      total: itemCount,
      included: itemCount,
      truncated: virtualized || comments.truncated || links.truncated || bounded.truncated,
      complete: false,
    });

    return Markdown.buildPageMarkdown(metadata, bounded.markdown);
  },
});

function parseRoute(pathname: string): LinearRoute {
  const segments = decodeURIComponentSafe(pathname).split('/').filter(Boolean);
  const routeIndex = segments.findIndex((segment) => /^(?:issue|project|document)$/i.test(segment));
  const kind = (segments[routeIndex]?.toLowerCase() || 'issue') as RouteKind;
  const identifier = segments[routeIndex + 1] || '';
  const workspace = routeIndex > 0 ? segments[routeIndex - 1] : '';
  return {
    kind,
    workspace,
    identifier: kind === 'issue' && ISSUE_IDENTIFIER.test(identifier)
      ? identifier.toUpperCase()
      : identifier,
  };
}

function getTitle(route: LinearRoute, root: Element): string {
  const selectors = route.kind === 'issue'
    ? [
      '[data-testid="issue-title"]',
      '[data-testid*="issue-title"]',
      '[aria-label="Issue title"]',
      'textarea[placeholder*="issue title" i]',
      '[contenteditable="true"][data-placeholder*="issue title" i]',
      '[role="main"] h1',
      'main h1',
    ]
    : route.kind === 'project'
      ? [
        '[data-testid="project-title"]',
        '[data-testid*="project-title"]',
        '[aria-label="Project title"]',
        '[contenteditable="true"][data-placeholder*="project name" i]',
        '[role="main"] h1',
        'main h1',
      ]
      : [
        '[data-testid="document-title"]',
        '[data-testid*="document-title"]',
        '[aria-label="Document title"]',
        '[contenteditable="true"][data-placeholder*="document title" i]',
        '[role="main"] h1',
        'main h1',
      ];

  const selected = firstValue(root, selectors);
  const fallback = Utils.getMeta('title') || Utils.getPageTitle();
  const value = selected || fallback;
  const withoutLinear = value
    .replace(/\s*(?:[-|·]|–)\s*Linear\s*$/i, '')
    .replace(/^Linear\s*(?:[-|·]|–)\s*/i, '')
    .trim();
  const withoutIdentifier = route.kind === 'issue' && route.identifier
    ? withoutLinear.replace(new RegExp(`^${escapeRegExp(route.identifier)}\\s*(?:[-:|·]|–)?\\s*`, 'i'), '')
    : withoutLinear;
  return withoutIdentifier || `${capitalize(route.kind)} ${route.identifier}`.trim();
}

function findPageRoot(kind: RouteKind): Element {
  const kindSelectors = kind === 'issue'
    ? [
      '[data-testid="issue-view"]',
      '[data-testid="issue-page"]',
      '[data-testid*="issue-detail"]',
      '[aria-label="Issue details"]',
    ]
    : kind === 'project'
      ? [
        '[data-testid="project-view"]',
        '[data-testid="project-page"]',
        '[data-testid*="project-overview"]',
      ]
      : [
        '[data-testid="document-view"]',
        '[data-testid="document-page"]',
        '[data-testid*="document-content"]',
      ];
  return firstElement(document, [...kindSelectors, '[role="main"]', 'main']) || document.body;
}

function extractFields(kind: RouteKind, root: Element): Field[] {
  const specs = kind === 'issue'
    ? [
      fieldSpec('Status', 'status'),
      fieldSpec('Priority', 'priority'),
      fieldSpec('Assignee', 'assignee'),
      fieldSpec('Team', 'team'),
      fieldSpec('Project', 'project'),
      fieldSpec('Cycle', 'cycle'),
    ]
    : kind === 'project'
      ? [
        fieldSpec('Status', 'status'),
        fieldSpec('Priority', 'priority'),
        fieldSpec('Lead', 'lead'),
        fieldSpec('Teams', 'teams'),
        fieldSpec('Members', 'members'),
      ]
      : [];

  const fields = specs
    .map(({ name, key }) => ({ name, key, value: findPropertyValue(name, kind, root) }))
    .filter((field): field is Field => Boolean(field.value));

  const labels = extractLabels(kind, root);
  if (labels.length > 0) fields.push({ name: 'Labels', key: 'labels', value: labels.join(', ') });

  const dates = kind === 'project'
    ? [
      dateSpec('Start date', 'start_date', ['start-date', 'start_date', 'startdate']),
      dateSpec('Target date', 'target_date', ['target-date', 'target_date', 'targetdate']),
      dateSpec('Created', 'created', ['created-at', 'created_at', 'created']),
      dateSpec('Updated', 'updated', ['updated-at', 'updated_at', 'updated']),
    ]
    : kind === 'issue'
      ? [
        dateSpec('Due date', 'due_date', ['due-date', 'due_date', 'duedate']),
        dateSpec('Created', 'created', ['created-at', 'created_at', 'created']),
        dateSpec('Updated', 'updated', ['updated-at', 'updated_at', 'updated']),
      ]
      : [
        dateSpec('Created', 'created', ['created-at', 'created_at', 'created']),
        dateSpec('Updated', 'updated', ['updated-at', 'updated_at', 'updated']),
      ];
  dates.forEach(({ name, key, fragments }) => {
    const value = findDateValue(name, fragments, kind, root);
    if (value) fields.push({ name, key, value });
  });
  const anonymousDates = anonymousDateButtons(kind, root);
  if (anonymousDates.length > 0 && anonymousDates.length !== dateFieldOrder(kind).length) {
    const values = anonymousDates.map(readDateButtonValue).filter(Boolean);
    if (values.length > 0) fields.push({ name: 'Dates', key: 'dates', value: values.join(', ') });
  }

  return uniqueFields(fields);
}

function fieldSpec(name: string, key: string): { name: string; key: string } {
  return { name, key };
}

function dateSpec(
  name: string,
  key: string,
  fragments: string[],
): { name: string; key: string; fragments: string[] } {
  return { name, key, fragments };
}

function findPropertyValue(name: string, kind: RouteKind, root: Element): string {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  const compact = slug.replace(/-/g, '');
  const prefixes = kind === 'issue' ? ['issue', 'property'] : ['project', 'property'];
  const selectors = [
    ...prefixes.flatMap((prefix) => [
      `[data-testid="${prefix}-${slug}"]`,
      `[data-testid*="${prefix}-${slug}"]`,
      `[data-testid*="${prefix}_${slug.replace(/-/g, '_')}"]`,
    ]),
    `[data-testid="${slug}"]`,
    `[data-testid="${compact}"]`,
    `[aria-label^="${name}:" i]`,
    `[aria-label^="Change ${name}" i]`,
    `[aria-label^="Set ${name}" i]`,
    `[aria-label="${name}" i]`,
  ];

  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (!isVisible(element) || isInsideComment(element)) continue;
      const value = propertyValue(element, name);
      if (value) return value;
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>('[data-detail-button]')) {
    if (!isVisible(element) || isInsideComment(element) || !detailButtonMatches(element, name)) continue;
    const value = propertyValue(element, name);
    if (value) return value;
  }

  for (const term of root.querySelectorAll('dt')) {
    if (normalize(term.textContent || '').toLowerCase() !== name.toLowerCase()) continue;
    const definition = term.nextElementSibling;
    const value = definition ? propertyValue(definition, name) : '';
    if (value) return value;
  }

  return '';
}

function findAnonymousDateButton(
  name: string,
  kind: RouteKind,
  root: Element,
): HTMLElement | null {
  const dateOrder = dateFieldOrder(kind);
  const targetIndex = dateOrder.indexOf(name.toLowerCase());
  if (targetIndex < 0) return null;
  const candidates = anonymousDateButtons(kind, root);
  if (candidates.length !== dateOrder.length) return null;
  return candidates[targetIndex] || null;
}

function dateFieldOrder(kind: RouteKind): string[] {
  if (kind === 'issue') return ['due date', 'created', 'updated'];
  if (kind === 'project') return ['start date', 'target date', 'created', 'updated'];
  return [];
}

function anonymousDateButtons(kind: RouteKind, root: Element): HTMLElement[] {
  const dateNames = dateFieldOrder(kind);
  return Array.from(root.querySelectorAll<HTMLElement>('[data-detail-button]'))
    .filter((element) => isVisible(element) && !isInsideComment(element))
    .filter((element) => !dateNames.some((name) => detailButtonMatches(element, name)))
    .filter((element) => {
      const text = normalize(element.textContent || '');
      return Boolean(element.querySelector('time')) || /\bdate\b/i.test(text);
    });
}

function readDateButtonValue(element: HTMLElement): string {
  const time = element.querySelector('time');
  return normalize(
    time?.getAttribute('datetime')
    || time?.getAttribute('title')
    || element.getAttribute('datetime')
    || element.textContent
    || '',
  );
}

function propertyValue(element: Element, name: string): string {
  const candidates = [
    inputValue(element),
    normalize(element.textContent || ''),
    normalize(element instanceof HTMLElement ? element.dataset.value || '' : ''),
    normalize(element.getAttribute('aria-label') || ''),
    normalize(element.getAttribute('title') || ''),
  ];
  for (const candidate of candidates) {
    const value = cleanPropertyValue(candidate, name);
    if (value) return value;
  }
  return '';
}

function cleanPropertyValue(value: string, name: string): string {
  if (!value || value.length > 300) return '';
  const escaped = escapeRegExp(name);
  const cleaned = value
    .replace(new RegExp(`^(?:change|set|edit|select|add)\\s+(?:issue\\s+|project\\s+)?${escaped}(?:\\s+from)?\\s*:?\\s*`, 'i'), '')
    .replace(new RegExp(`^${escaped}\\s*:?\\s*`, 'i'), '')
    .replace(/^to\s+/i, '')
    .trim();
  if (
    !cleaned
    || cleaned.toLowerCase() === name.toLowerCase()
    || /^(?:change|set|edit|select|add|none)$/i.test(cleaned)
    || /^(?:change|set|edit|select|add)\b/i.test(cleaned)
  ) return '';
  return cleaned;
}

function extractLabels(kind: RouteKind, root: Element): string[] {
  if (kind === 'document') return [];
  const labels = new Set<string>();
  const selector = [
    '[data-testid="issue-label"]',
    '[data-testid="project-label"]',
    '[data-testid*="label-chip"]',
    '[data-testid*="label-item"]',
    '[aria-label^="Label:" i]',
    'a[href*="/label/"]',
  ].join(', ');
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    if (!isVisible(element) || isInsideComment(element)) return;
    const value = normalize(
      element.getAttribute('aria-label')?.replace(/^Label:\s*/i, '')
      || element.textContent
      || '',
    );
    if (!value || value.length > 80 || /^(?:add|remove|edit|labels?)\b/i.test(value)) return;
    labels.add(value);
  });

  root.querySelectorAll<HTMLElement>('[data-detail-button]').forEach((button) => {
    if (!isVisible(button) || isInsideComment(button) || !detailButtonMatches(button, 'Labels')) return;
    const items = Array.from(button.querySelectorAll<HTMLElement>([
      '[data-label-name]',
      '[data-testid*="label-chip"]',
      '[data-testid*="label-item"]',
      '[aria-label^="Label:" i]',
    ].join(', ')));
    items.forEach((item) => {
      const value = normalize(
        item.dataset.labelName
        || item.getAttribute('aria-label')?.replace(/^Label:\s*/i, '')
        || item.textContent
        || '',
      );
      if (value && value.length <= 80 && !/^(?:add|remove|edit|labels?)\b/i.test(value)) {
        labels.add(value);
      }
    });
    if (items.length === 0) {
      const value = propertyValue(button, 'Labels');
      if (value) value.split(/\s*[,;]\s*/).filter(Boolean).forEach((label) => labels.add(label));
    }
  });
  return Array.from(labels);
}

function findDateValue(name: string, fragments: string[], kind: RouteKind, root: Element): string {
  const selectors = fragments.flatMap((fragment) => [
    `[data-testid*="${kind}-${fragment}"]`,
    `[data-testid*="${fragment}"]`,
    `[aria-label^="${name}:" i]`,
  ]);
  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (!isVisible(element) || isInsideComment(element)) continue;
      const time = element.matches('time') ? element : element.querySelector('time');
      const value = normalize(
        time?.getAttribute('datetime')
        || time?.getAttribute('title')
        || element.getAttribute('datetime')
        || element.getAttribute('title')
        || element.getAttribute('aria-label')?.replace(new RegExp(`^${escapeRegExp(name)}:\\s*`, 'i'), '')
        || element.textContent
        || '',
      );
      const cleaned = cleanPropertyValue(value, name);
      if (cleaned) return cleaned;
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>('[data-detail-button]')) {
    if (!isVisible(element) || isInsideComment(element) || !detailButtonMatches(element, name)) continue;
    const time = element.matches('time') ? element : element.querySelector('time');
    const value = normalize(
      time?.getAttribute('datetime')
      || time?.getAttribute('title')
      || element.getAttribute('datetime')
      || propertyValue(element, name),
    );
    if (value) return value;
  }

  const anonymousDateButton = findAnonymousDateButton(name, kind, root);
  if (anonymousDateButton) {
    const time = anonymousDateButton.querySelector('time');
    return normalize(
      time?.getAttribute('datetime')
      || time?.getAttribute('title')
      || anonymousDateButton.getAttribute('datetime')
      || anonymousDateButton.textContent
      || '',
    );
  }
  return '';
}

function detailButtonMatches(element: HTMLElement, name: string): boolean {
  const aliases: Record<string, string[]> = {
    assignee: ['assignee', 'assign'],
    labels: ['labels', 'label', 'tags', 'tag'],
    members: ['members', 'member'],
    teams: ['teams', 'team'],
    'due date': ['due date', 'due-date', 'deadline'],
    'start date': ['start date', 'start-date'],
    'target date': ['target date', 'target-date'],
  };
  const terms = aliases[name.toLowerCase()] || [name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-')];
  const descriptor = [
    element.getAttribute('data-detail-button') || '',
    element.getAttribute('data-testid') || '',
    element.getAttribute('aria-label') || '',
    element.getAttribute('title') || '',
    ...Array.from(element.querySelectorAll<HTMLElement>('[aria-label], [data-testid], [title]'))
      .flatMap((child) => [
        child.getAttribute('aria-label') || '',
        child.getAttribute('data-testid') || '',
        child.getAttribute('title') || '',
      ]),
  ].join(' ').toLowerCase();
  if (terms.some((term) => new RegExp(`(?:^|[^a-z])${escapeRegExp(term)}(?:[^a-z]|$)`, 'i').test(descriptor))) {
    return true;
  }

  const value = normalize(element.textContent || '').toLowerCase();
  if (name.toLowerCase() === 'status') {
    return /^(?:backlog|canceled|cancelled|completed|done|in progress|in review|planned|started|todo|triage)$/.test(value);
  }
  if (name.toLowerCase() === 'priority') {
    return /^(?:no priority|urgent|high|medium|low)$/.test(value);
  }
  if (name.toLowerCase() === 'labels') {
    return Boolean(element.querySelector('[data-label-name], [data-testid*="label-chip"], [data-testid*="label-item"]'));
  }
  return false;
}

function findDescription(kind: RouteKind, root: Element): Element | null {
  const selectors = kind === 'issue'
    ? [
      '[data-testid="issue-description"]',
      '[data-testid="issue-description-content"]',
      '[data-testid*="issue-description"] [data-testid*="editor"]',
      '[data-testid*="issue-description"] .ProseMirror',
      '[aria-label="Issue description"]',
      '[data-placeholder*="description" i]',
    ]
    : kind === 'project'
      ? [
        '[data-testid="project-description"]',
        '[data-testid="project-overview-description"]',
        '[data-testid*="project-description"] [data-testid*="editor"]',
        '[data-testid*="project-description"] .ProseMirror',
        '[aria-label="Project description"]',
      ]
      : [
        '[data-testid="document-content"]',
        '[data-testid="document-editor"]',
        '[data-testid*="document-content"] .ProseMirror',
        '[aria-label="Document content"]',
        'article',
        '.ProseMirror',
      ];
  if (root instanceof HTMLElement && selectors.some((selector) => root.matches(selector)) && isVisible(root)) {
    return root;
  }
  return firstElement(root, selectors);
}

function contentToMarkdown(element: Element, title: string): string {
  const cleaned = Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    'button',
    '[role="toolbar"]',
    '[data-testid*="toolbar"]',
    '[data-testid*="placeholder"]',
    '[data-testid*="action"]',
    '[contenteditable="true"]:empty',
  ]);
  const markdown = Markdown.elementToMarkdown(cleaned).trim();
  return markdown
    .replace(new RegExp(`^#\\s+${escapeRegExp(title)}\\s*`, 'i'), '')
    .trim();
}

function extractComments(root: Element): Comment[] {
  const bodySelectors = [
    '.ProseMirror[aria-label="Comment" i]',
    '[contenteditable="true"][aria-label="Comment" i]',
    '[data-testid="comment-body"]',
    '[data-testid="comment-content"]',
    '[data-testid*="comment-body"]',
    '[data-testid*="comment-content"]',
    '[data-content-type="comment"]',
  ];
  const containerSelectors = [
    '[data-comment-container]',
    '[data-comment-reply-container]',
    '[data-comment-thread-item-container]',
    '[data-comment-thread-reply-container]',
    '[data-comment-thread-container]',
    '[data-testid="comment"]',
    '[data-testid^="comment-"]',
    '[data-testid*="activity-comment"]',
    '[aria-label^="Comment by" i]',
  ];

  const candidates: Array<{ body: Element; container: Element }> = [];
  const seenBodies = new Set<Element>();
  const addCandidate = (body: Element, container: Element) => {
    if (seenBodies.has(body) || !isVisible(body) || isCommentComposer(body)) return;
    seenBodies.add(body);
    candidates.push({ body, container });
  };

  const bodyElements = matchingElements(root, bodySelectors);
  const bodyContexts = new Map(
    bodyElements.map((body) => [body, nearestCommentContainer(body, root)]),
  );
  bodyElements.forEach((body) => {
    const container = bodyContexts.get(body) || body;
    const hasMoreSpecificBody = bodyElements.some((candidate) =>
      candidate !== body && body.contains(candidate) && bodyContexts.get(candidate) === container,
    );
    if (!hasMoreSpecificBody) addCandidate(body, container);
  });

  const legacyContainers = new Set<Element>();
  matchingElements(root, containerSelectors).forEach((element) => {
    const container = canonicalCommentElement(element, root);
    if (container && isVisible(container)) legacyContainers.add(container);
  });
  legacyContainers.forEach((container) => {
    const body = firstElement(container, bodySelectors);
    if (body) {
      addCandidate(body, nearestCommentContainer(body, root));
      return;
    }
    if (container.querySelector(containerSelectors.join(', '))) return;
    addCandidate(container, container);
  });

  const comments: Comment[] = [];
  candidates.forEach(({ body: bodyElement, container }) => {
    const body = commentToMarkdown(bodyElement, bodyElement === container);
    if (!body) return;
    const authorElement = firstElement(container, [
      '[data-comment-author]',
      '[data-comment-user-name]',
      '[data-testid="comment-author"]',
      '[data-testid*="comment-author"]',
      '[data-testid*="author-name"]',
      '[data-testid="user-name"]',
      '[rel="author"]',
    ]);
    const avatar = commentHeaderAvatar(container, bodyElement);
    const ariaAuthor = container.getAttribute('aria-label')?.match(/^Comment by\s+(.+?)(?:\s+at\s+|$)/i)?.[1] || '';
    const author = firstValue(container, [
      '[data-comment-author]',
      '[data-comment-user-name]',
      '[data-testid="comment-author"]',
      '[data-testid*="comment-author"]',
      '[data-testid*="author-name"]',
      '[data-testid="user-name"]',
      '[rel="author"]',
    ]) || normalize(authorElement?.getAttribute('aria-label') || avatar?.alt || ariaAuthor);
    comments.push({ author, date: commentTimestamp(container), body });
  });
  return comments;
}

function isCommentComposer(element: Element): boolean {
  return Boolean(element.closest([
    'form',
    '[data-comment-editor]',
    '[data-comment-composer]',
    '[data-testid*="comment-composer"]',
    '[data-testid*="new-comment"]',
    '[data-testid*="comment-input"]',
  ].join(', ')));
}

function canonicalCommentElement(element: Element, root: Element): Element | null {
  const exact = element.closest('[data-testid="comment"]');
  if (exact && root.contains(exact)) return exact;
  const labelled = element.closest('[aria-label^="Comment by" i]');
  if (labelled && root.contains(labelled)) return labelled;

  const semantic = nearestCommentContainer(element, root);
  return semantic === element && !hasCommentContainerAttribute(element) ? null : semantic;
}

function nearestCommentContainer(element: Element, root: Element): Element {
  let current: Element | null = element;
  let threadContainer: Element | null = null;
  while (current) {
    if (current.matches('[data-testid="comment"], [aria-label^="Comment by" i]')) return current;
    if (looksLikeGeneratedCommentContainer(current)) return current;
    const containerAttribute = commentContainerAttribute(current);
    if (containerAttribute && containerAttribute !== 'data-comment-thread-container') return current;
    if (containerAttribute === 'data-comment-thread-container' && !threadContainer) {
      threadContainer = current;
    }
    const testId = current.getAttribute('data-testid') || '';
    if (/^(?:comment-|activity-comment)/i.test(testId)
      && !/(?:author|avatar|body|content|date|timestamp|action|editor|thread)/i.test(testId)) {
      return current;
    }
    if (current === root) break;
    current = current.parentElement;
  }
  return threadContainer || element;
}

function looksLikeGeneratedCommentContainer(element: Element): boolean {
  if (!/-container$/i.test(element.id)) return false;
  const body = element.querySelector([
    '[data-testid="comment-body"]',
    '[data-testid="comment-content"]',
    '[data-comment-body]',
    '.ProseMirror[aria-label*="comment" i]',
  ].join(', '));
  if (!body) return false;

  const hasAuthorMarker = Boolean(element.querySelector([
    '[data-comment-author]',
    '[data-comment-user-name]',
    '[data-testid*="comment-author"]',
    '[data-testid*="author-name"]',
    '[rel="author"]',
  ].join(', ')));
  return hasAuthorMarker || Boolean(commentHeaderAvatar(element, body));
}

function commentHeaderAvatar(container: Element, body: Element): HTMLImageElement | null {
  return Array.from(container.querySelectorAll<HTMLImageElement>('img[alt]'))
    .find((avatar) => isVisible(avatar)
      && normalize(avatar.alt)
      && !body.contains(avatar)
      && compareDomOrder(avatar, body) < 0) || null;
}

function commentTimestamp(container: Element): string {
  const candidates = matchingElements(container, [
    'time',
    '[data-testid*="comment-date"]',
    '[data-testid*="timestamp"]',
    'a[aria-label]',
  ]);
  for (const candidate of candidates) {
    if (!isVisible(candidate) || nearestCommentContainer(candidate, container) !== container) continue;
    const value = normalize(
      candidate.getAttribute('datetime')
      || candidate.getAttribute('title')
      || candidate.getAttribute('aria-label')
      || candidate.textContent
      || '',
    );
    if (!candidate.matches('a[aria-label]') || looksLikeCommentTimestamp(value)) return value;
  }
  return '';
}

function looksLikeCommentTimestamp(value: string): boolean {
  const timestamp = value.replace(/\s+\(edited\)$/i, '');
  return /^(?:today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(timestamp)
    || /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/i.test(timestamp)
    || /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/.test(timestamp)
    || /^\d+\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i.test(timestamp);
}

function commentContainerAttribute(element: Element): string {
  return Array.from(element.attributes)
    .map((attribute) => attribute.name.toLowerCase())
    .find((name) => /^data-comment(?:-[a-z0-9]+)*-container$/.test(name)) || '';
}

function hasCommentContainerAttribute(element: Element): boolean {
  return Boolean(commentContainerAttribute(element));
}

function commentToMarkdown(element: Element, removeNestedComments: boolean): string {
  const selectors = [
    ...Utils.NOISE_SELECTORS,
    'button',
    'form',
    'input',
    'textarea',
    'select',
    'svg',
    'time',
    '[role="toolbar"]',
    '[role="menu"]',
    '[data-comment-actions]',
    '[data-comment-controls]',
    '[data-comment-editor]',
    '[data-testid*="author"]',
    '[data-testid*="timestamp"]',
    '[data-testid*="comment-date"]',
    '[data-testid*="action"]',
    '[data-testid*="composer"]',
    '[data-testid*="reaction"]',
  ];
  if (removeNestedComments) {
    selectors.push(
      '[data-comment-container]',
      '[data-comment-reply-container]',
      '[data-comment-thread-item-container]',
      '[data-comment-thread-reply-container]',
      '[data-comment-thread-container]',
      '[data-testid="comment"]',
      '[data-testid^="comment-"]',
    );
  }
  return Markdown.elementToMarkdown(Utils.removeNoise(element, selectors)).trim();
}

function extractLinks(root: Element): PageLink[] {
  const current = normalizedUrl(Utils.getCanonicalUrl());
  const links = new Map<string, PageLink>();
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    if (!isVisible(anchor) || isLinkControl(anchor)) return;
    const url = safeHttpUrl(anchor.getAttribute('href') || '');
    if (!url || normalizedUrl(url) === current) return;
    if (!isRelevantLink(anchor, url, root)) return;
    const label = normalize(anchor.textContent || anchor.getAttribute('aria-label') || '')
      || new URL(url).hostname;
    if (!links.has(url)) links.set(url, { label: Utils.truncate(label, 200), url });
  });
  return Array.from(links.values());
}

function findDescriptionFromAnyRoute(root: Element): Element | null {
  return firstElement(root, [
    '[data-testid="issue-description"]',
    '[data-testid="issue-description-content"]',
    '[data-testid="project-description"]',
    '[data-testid="project-overview-description"]',
    '[data-testid="document-content"]',
    '[data-testid="document-editor"]',
    '[aria-label="Issue description"]',
    '[aria-label="Project description"]',
    '[aria-label="Document content"]',
  ]);
}

function isRelevantLink(anchor: HTMLAnchorElement, value: string, root: Element): boolean {
  const url = new URL(value);
  if (url.hostname.toLowerCase() === 'linear.app') return LINEAR_ROUTE.test(url.pathname);

  const description = findDescriptionFromAnyRoute(root);
  if (description?.contains(anchor)) return true;
  if (anchor.closest([
    '.ProseMirror[aria-label="Comment" i]',
    '[data-testid="comment-body"]',
    '[data-testid="comment-content"]',
    '[data-testid*="comment-body"]',
    '[data-testid*="comment-content"]',
  ].join(', '))) return true;
  if (hasLinkContainerSignal(anchor, root)) return true;
  return anchor.target === '_blank' || /\bnoopener\b/i.test(anchor.rel);
}

function hasLinkContainerSignal(element: Element, root: Element): boolean {
  let current: Element | null = element;
  while (current) {
    const attributes = Array.from(current.attributes);
    if (attributes.some((attribute) =>
      /(?:attachment|resource|relation|link)/i.test(attribute.name)
      && !/(?:unlink|blink)/i.test(attribute.name),
    )) return true;
    const testId = current.getAttribute('data-testid') || '';
    const ariaLabel = current.getAttribute('aria-label') || '';
    if (/(?:attachment|resource|relation|link)/i.test(`${testId} ${ariaLabel}`)) return true;
    if (current === root) break;
    current = current.parentElement;
  }
  return false;
}

function isLinkControl(anchor: HTMLAnchorElement): boolean {
  if (anchor.closest([
    'nav',
    'header',
    'footer',
    '[role="navigation"]',
    '[role="menu"]',
    '[data-detail-button]',
    '[data-comment-actions]',
    '[data-comment-controls]',
    '[data-testid*="action"]',
    '[data-testid*="toolbar"]',
  ].join(', '))) return true;
  const label = normalize(anchor.getAttribute('aria-label') || '');
  return /^(?:edit|delete|remove|copy|open menu|more actions?)\b/i.test(label);
}

function hasCommentSurface(root: Element): boolean {
  return matchingElements(root, [
    '[data-comment-thread-container]',
    '[data-comment-container]',
    '.ProseMirror[aria-label="Comment" i]',
    '[data-testid*="comment"]',
    '[data-testid*="activity"]',
    '[aria-label*="comment" i]',
  ]).some(isVisible);
}

function hasVirtualizedContent(root: Element): boolean {
  const structuralMarkers = matchingElements(root, [
    '[data-virtualized="true"]',
    '[data-is-virtualized="true"]',
    '[data-virtualizer-scroll-element]',
    '[data-virtualizer-content]',
    '[data-virtuoso-scroller="true"]',
    '[data-testid*="virtual-list"]',
    '[data-testid*="virtualized"]',
    '[data-testid*="virtual-scroll"]',
    '[data-testid*="load-more"]',
    '[data-index][style*="transform"]',
    '[aria-rowcount]',
  ]);
  if (structuralMarkers.some(isVisible)) return true;
  return Array.from(root.querySelectorAll('button, [role="button"], a')).some((control) =>
    isVisible(control) && /(?:load|show|view)\s+(?:\d+\s+)?(?:more|older|earlier)|(?:older|earlier)\s+(?:comments?|activity|replies)|more\s+(?:comments?|replies)/i.test(
      normalize(control.textContent || control.getAttribute('aria-label') || ''),
    ),
  );
}

function uniqueFields(fields: Field[]): Field[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.key)) return false;
    seen.add(field.key);
    return true;
  });
}

function firstElement(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = matchingElements(root, [selector]).find(isVisible);
    if (element) return element;
  }
  return null;
}

function firstValue(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    for (const element of matchingElements(root, [selector])) {
      if (!isVisible(element)) continue;
      const value = inputValue(element)
        || normalize(element.textContent || '')
        || normalize(element.getAttribute('aria-label') || '')
        || normalize(element.getAttribute('title') || '');
      if (value) return value;
    }
  }
  return '';
}

function matchingElements(root: ParentNode, selectors: string[]): Element[] {
  const matches: Element[] = [];
  const seen = new Set<Element>();
  selectors.forEach((selector) => {
    if (root instanceof Element && root.matches(selector) && !seen.has(root)) {
      seen.add(root);
      matches.push(root);
    }
    root.querySelectorAll(selector).forEach((element) => {
      if (seen.has(element)) return;
      seen.add(element);
      matches.push(element);
    });
  });
  return matches.sort(compareDomOrder);
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function isInsideComment(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      hasCommentContainerAttribute(current)
      || current.matches('.ProseMirror[aria-label="Comment" i], [aria-label^="Comment by" i]')
      || /comment/i.test(current.getAttribute('data-testid') || '')
    ) return true;
    current = current.parentElement;
  }
  return false;
}

function inputValue(element: Element): string {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? normalize(element.value)
    : '';
}

function isVisible(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (
      current.hasAttribute('hidden')
      || current.getAttribute('aria-hidden') === 'true'
      || (current instanceof HTMLElement && isHiddenByStyle(current))
    ) return false;
    current = current.parentElement;
  }
  return true;
}

function isHiddenByStyle(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value;
  }
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
