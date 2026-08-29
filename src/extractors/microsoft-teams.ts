/**
 * Microsoft Teams chat, channel, and thread extractor.
 * Captures messages currently represented in Teams' live, virtualized DOM.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { type PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type TeamsContext = 'chat' | 'channel' | 'thread';

type TeamsMessage = {
  author: string;
  timestamp: string;
  body: string;
  links: string[];
  attachments: string[];
  reactions: string[];
  replyTo: string;
  replySummary: string;
  depth: number;
};

const OUTER_MESSAGE_ROOT_SELECTORS = [
  '[data-tid="chat-pane-message"]',
  '[data-tid="channel-pane-message"]',
  '[data-tid="thread-pane-message"]',
  '[data-tid="message-pane-item"]',
  '[data-tid="message-list-item"]',
  '[data-tid="reply-message"]',
  '[data-tid="channel-replies-pane-message"]',
  '[role="listitem"][id*="message"]',
];

const LABELLED_BODY_ROOT_SELECTOR = '[id^="message-body-"][aria-labelledby]';
const NESTED_MESSAGE_ROOT_SELECTORS = [
  '[data-tid="message-wrapper"]',
  '[data-tid="message-group-container"]',
];
const STABLE_MESSAGE_ROOT_SELECTORS = [
  ...OUTER_MESSAGE_ROOT_SELECTORS,
  LABELLED_BODY_ROOT_SELECTOR,
  ...NESTED_MESSAGE_ROOT_SELECTORS,
];
const GENERIC_MESSAGE_ROOT_SELECTOR = '[role="listitem"]';
const MESSAGE_ROOT_SELECTORS = [
  ...STABLE_MESSAGE_ROOT_SELECTORS,
  GENERIC_MESSAGE_ROOT_SELECTOR,
];

const MESSAGE_SELECTOR = [
  ...MESSAGE_ROOT_SELECTORS,
  '[data-tid="messageBodyContent"]',
  '[data-tid="message-body"]',
  '[data-tid="chat-message-text"]',
  '[data-tid="message-content"]',
  '[id^="message-body-"]',
  '[id^="content-"]',
].join(', ');

const BODY_SELECTOR = [
  '[data-tid="messageBodyContent"]',
  '[data-tid="message-body"]',
  '[data-tid="chat-message-text"]',
  '[data-tid="message-content"]',
  '[id^="message-body-"]',
  '[id^="content-"]',
  '[class*="messageBody"]',
].join(', ');

const ATTACHMENT_SELECTOR = [
  '[data-tid="message-attachment"]',
  '[data-tid="chat-message-attachment"]',
  '[data-tid="file-attachment"]',
  '[data-tid="file-card"]',
  '[data-tid="attachment"]',
  '[data-tid="media-thumbnail"]',
  '[data-tid="atp-safefile"]',
  '[data-tid*="attachment-card"]',
  '[data-testid="file-attachment"]',
  '[data-tid^="file-chiclet-"]',
  '[data-tid="file-preview-root"]',
  '[data-testid="file-preview-root"]',
].join(', ');

const REPLY_CONTEXT_SELECTOR = [
  '[data-tid="reply-reference"]',
  '[data-tid="message-reply-reference"]',
  '[data-tid="replied-to-message"]',
  '[data-tid="quoted-message"]',
  '[data-tid="reply-preview"]',
  '[data-tid="quoted-reply-card"]',
  '[data-tid="messageQuotedReply"]',
  '[data-track-module-name="messageQuotedReply"]',
  '[aria-label^="Begin Reference" i]',
].join(', ');

const MESSAGE_LIST_CONTAINER_SELECTOR = [
  '[data-tid="chat-pane-list"]',
  '[data-tid="chat-pane-message-list"]',
  '[data-tid="message-pane-list"]',
  '[data-tid="channel-pane"]',
  '[data-tid="channel-posts"]',
  '[data-tid="posts-list"]',
  '[data-tid="thread-body-scrollable-content"]',
  '[data-tid="channel-replies-runway"]',
  '#channel-pane-l2',
  '[role="log"][aria-label*="messages" i]',
  '[role="list"][aria-label*="messages" i]',
].join(', ');

export const microsoftTeamsExtractor = register({
  name: 'Microsoft Teams',
  matches: [
    '*://teams.microsoft.com/v2/*',
    '*://teams.microsoft.com/l/chat/*',
    '*://teams.microsoft.com/l/channel/*',
    '*://teams.microsoft.com/l/message/*',
    '*://teams.microsoft.com/l/team/*',
    '*://teams.microsoft.com/_#/conversations/*',
    '*://teams.cloud.microsoft/v2/*',
    '*://teams.live.com/v2/*',
  ],
  pathnameRegex: /^\/(?:v2(?:\/|$)|l\/(?:chat|channel|message|team)(?:\/|$)|_)/,

  async extract() {
    const threadRoot = findThreadRoot();
    const context = detectContext(threadRoot);
    const scope = threadRoot || findConversationRoot(context) || document;
    const messages = extractMessages(scope, context);
    const limited = limitCollection(messages);
    const team = getTeamName();
    const channel = getChannelName();
    const conversation = getConversationName();
    const thread = threadRoot ? getThreadName(threadRoot) : '';

    const metadata: PageMetadata = {
      source: 'Microsoft Teams',
      type: `Microsoft Teams ${capitalize(context)}`,
      url: Utils.getCanonicalUrl(),
      team: team || undefined,
      channel: context !== 'chat' ? channel || undefined : undefined,
      conversation: context === 'chat' ? conversation || undefined : undefined,
      thread: context === 'thread' ? thread || undefined : undefined,
      messages: limited.items.length,
      scope: 'loaded visible live DOM; older history and collapsed replies may be virtualized or unloaded',
    };

    const heading = buildHeading(context, { team, channel, conversation, thread });
    const body = buildMarkdown(heading, limited.items);
    const bounded = limitMarkdown(body);
    addExtractionMetadata(metadata, {
      contentSource: 'Microsoft Teams live DOM',
      total: limited.total,
      included: limited.items.length,
      truncated: limited.truncated || bounded.truncated,
      complete: false,
    });

    return Markdown.buildPageMarkdown(metadata, bounded.markdown);
  },
});

function extractMessages(scope: ParentNode, context: TeamsContext): TeamsMessage[] {
  const roots = canonicalMessageElements(scope);
  const messages: TeamsMessage[] = [];
  const seen = new Set<string>();
  let previousAuthor = '';

  roots.forEach((root) => {
    if (isExcluded(root) || !isVisible(root)) return;

    const bodyElement = findBodyElement(root);
    const body = bodyElement ? messageBodyToMarkdown(bodyElement) : '';
    const attachments = getAttachments(root);
    if (!body && attachments.length === 0) return;

    const explicitAuthor = getAuthor(root);
    const author = explicitAuthor || previousAuthor;
    if (author) previousAuthor = author;

    const timestamp = getTimestamp(root);
    const replyTo = getReplyContext(root);
    const stableKey = root.getAttribute('data-message-id')
      || root.getAttribute('data-mid')
      || root.id;
    if (stableKey && seen.has(stableKey)) return;
    if (stableKey) seen.add(stableKey);

    messages.push({
      author,
      timestamp,
      body,
      links: getLinks(bodyElement || root, attachments),
      attachments,
      reactions: getReactions(root),
      replyTo,
      replySummary: getReplySummary(root),
      depth: isReply(root, context, replyTo) ? 1 : 0,
    });
  });

  return messages;
}

function canonicalMessageElements(scope: ParentNode): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  scope.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR).forEach((candidate) => {
    const root = closestMessageRoot(candidate);
    if (!root) return;
    if (root === scope || !scopeContains(scope, root)) return;
    if (
      isGenericMessageRoot(root)
      && (!root.closest(MESSAGE_LIST_CONTAINER_SELECTOR) || !findBodyElement(root))
    ) return;
    roots.add(root);
  });
  return Array.from(roots);
}

function closestMessageRoot(element: Element): HTMLElement | null {
  return element.closest<HTMLElement>(OUTER_MESSAGE_ROOT_SELECTORS.join(', '))
    || element.closest<HTMLElement>(LABELLED_BODY_ROOT_SELECTOR)
    || element.closest<HTMLElement>(GENERIC_MESSAGE_ROOT_SELECTOR)
    || element.closest<HTMLElement>(NESTED_MESSAGE_ROOT_SELECTORS.join(', '));
}

function scopeContains(scope: ParentNode, element: Element): boolean {
  return scope.nodeType === Node.DOCUMENT_NODE
    || scope === element
    || (scope instanceof Element && scope.contains(element));
}

function findBodyElement(root: HTMLElement): HTMLElement | null {
  if (root.matches(BODY_SELECTOR) && !root.closest(REPLY_CONTEXT_SELECTOR)) return root;
  return ownedContentElements(root, BODY_SELECTOR)[0] || null;
}

function isGenericMessageRoot(root: HTMLElement): boolean {
  return root.matches(GENERIC_MESSAGE_ROOT_SELECTOR)
    && !root.matches(STABLE_MESSAGE_ROOT_SELECTORS.join(', '));
}

function messageBodyToMarkdown(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    'button',
    'script',
    'style',
    'svg',
    '[aria-hidden="true"]',
    ATTACHMENT_SELECTOR,
    REPLY_CONTEXT_SELECTOR,
    '[data-tid*="reaction"]',
    '[data-tid="message-actions"]',
  ].join(', ')).forEach((node) => node.remove());
  return Markdown.elementToMarkdown(clone).trim();
}

function getTimestamp(root: HTMLElement): string {
  const time = ownedContentElements(root, [
    'time',
    '[data-tid="message-timestamp"]',
    '[data-tid="timestamp"]',
    '[data-tid="message-time"]',
    '[data-tid="message-group-time"]',
    '[id^="timestamp-"]',
    '[class*="timestamp"]',
  ].join(', '))[0];
  const direct = normalize(
    time?.getAttribute('datetime')
    || time?.getAttribute('title')
    || time?.getAttribute('aria-label')
    || time?.textContent
    || '',
  );
  if (direct) return direct;

  const labelled = getLabelledElements(root)
    .find((element) => /^timestamp-/i.test(element.id) || element.matches([
      'time',
      '[data-tid="message-time"]',
      '[data-tid="message-group-time"]',
    ].join(', ')));
  const labelledValue = timestampValue(labelled);
  if (labelledValue) return labelledValue;

  const group = root.closest<HTMLElement>('[data-tid="message-group-container"]');
  const groupTime = (group || root).querySelector<HTMLElement>([
    '[data-tid="message-group-time"]',
    '[id^="timestamp-"]',
  ].join(', '));
  return timestampValue(groupTime);
}

function getAuthor(root: HTMLElement): string {
  const direct = textFromOwned(root, [
    '[data-tid="message-author-name"]',
    '[data-tid="message-author"]',
    '[data-tid="author-name"]',
    '[data-tid="persona-name"]',
    '[data-tid="message-group-author"]',
    '[data-tid="message-group-author-name"]',
    '[id^="author-"]',
    '[class*="authorName"]',
  ]);
  if (direct) return direct;

  const labelled = getLabelledElements(root)
    .find((element) => /^author-/i.test(element.id) || element.matches([
      '[data-tid="message-author-name"]',
      '[data-tid="message-author"]',
      '[data-tid="message-group-author"]',
      '[data-tid="message-group-author-name"]',
    ].join(', ')));
  const labelledValue = normalize(labelled?.textContent || labelled?.getAttribute('aria-label') || '');
  if (labelledValue) return labelledValue;

  const group = root.closest<HTMLElement>('[data-tid="message-group-container"]');
  return group ? firstValue(group, [
    '[data-tid="message-group-author"]',
    '[data-tid="message-group-author-name"]',
    '[data-tid="message-group-header"]',
    '[id^="author-"]',
  ]) : '';
}

function getLabelledElements(root: HTMLElement): HTMLElement[] {
  const labelledRoot = root.hasAttribute('aria-labelledby') ? root : findBodyElement(root);
  const ids = labelledRoot?.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) || [];
  return ids
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function timestampValue(element: HTMLElement | null | undefined): string {
  return normalize(
    element?.getAttribute('datetime')
    || element?.getAttribute('title')
    || element?.getAttribute('aria-label')
    || element?.textContent
    || '',
  );
}

function getReplyContext(root: HTMLElement): string {
  const reply = ownedElements(root, REPLY_CONTEXT_SELECTOR)[0];
  if (!reply) return '';

  const author = firstValue(reply, [
    '[data-tid="message-author-name"]',
    '[data-tid="message-author"]',
    '[data-tid="author-name"]',
    '[data-tid="message-group-author"]',
    '[data-tid="message-group-author-name"]',
    '[id^="author-"]',
    '[class*="authorName"]',
  ]);
  const excerptElement = reply.querySelector<HTMLElement>(BODY_SELECTOR);
  const excerpt = normalize(excerptElement?.textContent || '');
  const summary = [author, excerpt ? `“${Utils.truncate(excerpt, 240)}”` : '']
    .filter(Boolean)
    .join(': ');
  return summary || normalize(reply.getAttribute('aria-label') || reply.textContent || '');
}

function getReplySummary(root: HTMLElement): string {
  return textFromOwned(root, [
    '[data-tid="reply-count"]',
    '[data-tid="replies-count"]',
    '[data-tid="view-replies"]',
    '[data-tid="view-thread"]',
    '[data-tid="response-summary-button"]',
    '[aria-label*="replies" i]',
  ]);
}

function getAttachments(root: HTMLElement): string[] {
  const attachments = new Map<string, string>();
  ownedElements(root, ATTACHMENT_SELECTOR).forEach((attachment) => {
    if (attachment.closest(REPLY_CONTEXT_SELECTOR)) return;
    const link = attachment.matches('a[href]')
      ? attachment as HTMLAnchorElement
      : attachment.querySelector<HTMLAnchorElement>('a[href]');
    const rawTitle = attachment.getAttribute('title')
      || attachment.querySelector<HTMLElement>('[title]')?.getAttribute('title')
      || '';
    const titleLines = rawTitle.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const titleUrlLine = titleLines.find((line) => /^https?:\/\//i.test(line) && safeHttpUrl(line));
    const titleUrl = safeHttpUrl(titleUrlLine || '');
    const titleName = titleUrl
      ? titleLines.filter((line) => line !== titleUrlLine).join(' ')
      : titleLines[0] || '';
    const name = normalize(
      link?.getAttribute('download')
      || attachment.querySelector<HTMLElement>('[data-tid="file-name"]')?.textContent
      || attachment.querySelector<HTMLElement>('[data-tid="attachment-name"]')?.textContent
      || attachment.querySelector<HTMLElement>('[class*="fileName"]')?.textContent
      || attachment.getAttribute('aria-label')
      || titleName
      || attachment.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label')
      || link?.textContent
      || attachment.querySelector<HTMLImageElement>('img[alt]')?.alt
      || 'Attachment',
    );
    const media = attachment.querySelector<HTMLImageElement>('img[src], video[src], audio[src]');
    const preview = attachment.getAttribute('amspreviewurl')
      || attachment.querySelector<HTMLElement>('[amspreviewurl]')?.getAttribute('amspreviewurl')
      || '';
    const href = safeHttpUrl(link?.href || preview || titleUrl || media?.getAttribute('src') || '');
    const key = href || name;
    if (!key) return;
    const value = href ? `[${escapeLabel(name)}](${href})` : name;
    if (!attachments.has(key) || name !== 'Attachment') attachments.set(key, value);
  });
  return Array.from(attachments.values()).filter(Boolean);
}

function getLinks(root: ParentNode, attachments: string[]): string[] {
  const attachmentUrls = new Set(
    attachments.map((value) => value.match(/\((https?:\/\/[^)]+)\)$/)?.[1]).filter(Boolean),
  );
  const links = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (link.closest(`${ATTACHMENT_SELECTOR}, ${REPLY_CONTEXT_SELECTOR}`)) return;
    const href = safeHttpUrl(link.href);
    if (href && !attachmentUrls.has(href)) links.add(href);
  });
  return Array.from(links);
}

function getReactions(root: HTMLElement): string[] {
  const reactions = new Set<string>();
  ownedElements(root, [
    '[data-tid*="reaction"] button',
    'button[data-tid*="reaction"]',
    'button[aria-label*="reacted" i]',
    'button[aria-label*="reaction" i]',
  ].join(', ')).forEach((reaction) => {
    if (reaction.closest('[data-tid="message-actions"]')) return;
    const value = normalize(
      reaction.getAttribute('aria-label')
      || reaction.getAttribute('title')
      || reaction.textContent
      || '',
    );
    if (/^(?:add|choose|open)\s+(?:a\s+)?reaction\b/i.test(value)) return;
    if (value) reactions.add(value);
  });
  return Array.from(reactions);
}

function ownedElements(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .filter((element) => {
      if (!isVisible(element)) return false;
      const owner = closestMessageRoot(element);
      return !owner || owner === root;
    });
}

function ownedContentElements(root: HTMLElement, selector: string): HTMLElement[] {
  return ownedElements(root, selector)
    .filter((element) => !element.closest(REPLY_CONTEXT_SELECTOR));
}

function buildMarkdown(title: string, messages: TeamsMessage[]): string {
  const parts = [`# ${title}`];
  if (messages.length === 0) {
    parts.push('', '*No loaded messages found. Open a chat, channel, or thread, wait for messages to load, and try again.*');
    return parts.join('\n');
  }

  messages.forEach((message) => {
    const author = message.author || 'Unknown author';
    parts.push('', `${message.depth > 0 ? '### ↳' : '##'} ${author}`);
    if (message.timestamp) parts.push('', `**Time:** ${message.timestamp}`);
    if (message.replyTo) parts.push('', `**Reply to:** ${message.replyTo}`);
    if (message.body) parts.push('', message.body);
    if (message.links.length > 0) parts.push('', `**Links:** ${message.links.join(', ')}`);
    if (message.attachments.length > 0) parts.push('', `**Attachments:** ${message.attachments.join(', ')}`);
    if (message.reactions.length > 0) parts.push('', `**Reactions:** ${message.reactions.join('; ')}`);
    if (message.replySummary) parts.push('', `**Replies:** ${message.replySummary}`);
  });
  return parts.join('\n');
}

function findThreadRoot(): HTMLElement | null {
  const selectors = [
    '[data-tid="thread-pane"]',
    '[data-tid="channel-thread-pane"]',
    '[data-tid="thread-view"]',
    '[data-tid="channel-thread"]',
    '#channel-pane-l2',
    '[data-tid="thread-body-scrollable-content"]',
    '[data-tid="channel-replies-runway"]',
    '[role="dialog"][aria-label*="thread" i]',
    '[role="region"][aria-label*="thread" i]',
  ];
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .find((element) => isVisible(element) && element.querySelector(BODY_SELECTOR)) || null;
}

function detectContext(threadRoot: HTMLElement | null): TeamsContext {
  if (threadRoot) return 'thread';
  if (
    document.querySelector('[data-tid="channel-header-title"], [data-tid="channel-pane"], [data-tid="channel-pane-message"]')
    || /\/l\/(?:channel|message|team)\//i.test(window.location.pathname)
  ) return 'channel';
  return 'chat';
}

function findConversationRoot(context: TeamsContext): HTMLElement | null {
  const selectors = context === 'channel'
    ? [
      '[data-tid="channel-pane"]',
      '[data-tid="channel-posts"]',
      '[data-tid="posts-list"]',
      '[role="log"][aria-label*="messages" i]',
      '[role="list"][aria-label*="messages" i]',
      '[role="main"]',
      'main',
    ]
    : [
      '[data-tid="chat-pane-list"]',
      '[data-tid="chat-pane-message-list"]',
      '[data-tid="message-pane-list"]',
      '[data-tid="chat-pane"]',
      '[role="log"][aria-label*="messages" i]',
      '[role="list"][aria-label*="messages" i]',
      '[role="main"]',
      'main',
    ];
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .find((element) => isVisible(element) && Boolean(element.querySelector(BODY_SELECTOR))) || null;
}

function getConversationName(): string {
  return firstValue(document, [
    '[data-tid="header-chat-title"]',
    '[data-tid="chat-header-title"]',
    '[data-tid="chat-title"]',
    '[data-tid="chat-header"] h1',
    'header h1',
  ]).replace(/\s+(?:chat )?(?:menu|options)$/i, '').trim();
}

function getChannelName(): string {
  return firstValue(document, [
    '[data-tid="channel-header-title"]',
    '[data-tid="channel-name"]',
    '[data-tid="channel-title"]',
    '[aria-current="page"][data-tid*="channel"]',
    '[data-tid="channel-header"] h1',
  ]).replace(/^#\s*/, '').replace(/\s+(?:channel )?(?:menu|options)$/i, '').trim();
}

function getTeamName(): string {
  return firstValue(document, [
    '[data-tid="team-name"]',
    '[data-tid="team-header-title"]',
    '[data-tid="channel-header-team-name"]',
    '[aria-current="page"][data-tid*="team"]',
  ]).replace(/\s+(?:team )?(?:menu|options)$/i, '').trim();
}

function getThreadName(root: ParentNode): string {
  return firstValue(root, [
    '[data-tid="thread-header-title"]',
    '[data-tid="thread-title"]',
    'header h2',
    'header h1',
  ]).replace(/\s+(?:thread )?(?:menu|options)$/i, '').trim();
}

function buildHeading(
  context: TeamsContext,
  names: { team: string; channel: string; conversation: string; thread: string },
): string {
  if (context === 'chat') {
    return ['Microsoft Teams', names.conversation].filter(Boolean).join(' · ');
  }
  const channel = names.channel ? formatChannel(names.channel) : '';
  return [
    'Microsoft Teams',
    names.team,
    channel,
    context === 'thread' ? names.thread || 'Thread' : '',
  ].filter(Boolean).join(' · ');
}

function isReply(root: HTMLElement, context: TeamsContext, replyTo: string): boolean {
  if (replyTo) return true;
  if (root.matches([
    '[data-tid="reply-message"]',
    '[data-tid="channel-replies-pane-message"]',
  ].join(', '))) return true;
  if (context === 'chat') return false;
  return Boolean(root.parentElement?.closest([
    '[data-tid="channel-replies"]',
    '[data-tid="replies-list"]',
    '[data-tid="thread-replies"]',
    '[data-tid="channel-replies-pane-message"]',
    '[data-tid="channel-replies-runway"]',
  ].join(', ')));
}

function textFromOwned(root: HTMLElement, selectors: string[]): string {
  for (const selector of selectors) {
    const element = ownedContentElements(root, selector)[0];
    const value = normalize(
      element?.textContent
      || element?.getAttribute('title')
      || element?.getAttribute('aria-label')
      || '',
    );
    if (value) return value;
  }
  return '';
}

function firstValue(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      if (!isVisible(element)) continue;
      const value = normalize(
        element.textContent
        || element.getAttribute('title')
        || element.getAttribute('aria-label')
        || '',
      );
      if (value) return value;
    }
  }
  return '';
}

function isExcluded(root: Element): boolean {
  return Boolean(root.closest([
    'nav',
    '[role="navigation"]',
    'form',
    '[data-tid="message-composer"]',
    '[data-tid="chat-pane-compose"]',
    '[data-tid="replied-to-message"]',
    '[data-tid="quoted-message"]',
    '[aria-hidden="true"]',
  ].join(', ')));
}

function isVisible(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function safeHttpUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function formatChannel(channel: string): string {
  return channel.startsWith('#') ? channel : `#${channel}`;
}

function escapeLabel(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}
