/**
 * Slack channel and thread extractor.
 * Captures messages currently represented in Slack's virtualized live DOM.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type SlackMessage = {
  key: string;
  author: string;
  timestamp: string;
  body: string;
  links: string[];
  attachments: string[];
  reactions: string[];
  replySummary: string;
  depth: number;
};

const MESSAGE_SELECTOR = [
  '[data-qa="message_container"]',
  '[data-qa="virtual-list-item"][data-item-key*="message"]',
  '.c-virtual_list__item[data-item-key^="message"]',
  '.c-message_kit__background',
].join(', ');

register({
  name: 'Slack',
  matches: ['https://app.slack.com/client/*'],

  async extract() {
    const threadRoot = findThreadRoot();
    const scope = threadRoot || findChannelRoot() || document;
    const context = threadRoot ? 'thread' : 'channel';
    const workspace = getWorkspaceName();
    const channel = getChannelName();
    const messages = extractMessages(scope, context === 'thread');
    const limited = limitCollection(messages);

    const metadata: PageMetadata = {
      source: 'Slack',
      type: context === 'thread' ? 'Slack Thread' : 'Slack Channel',
      url: Utils.getCanonicalUrl(),
      workspace,
      channel,
      messages: limited.items.length,
      scope: 'loaded semantic DOM; older history may be virtualized or unloaded',
    };

    const heading = ['Slack', workspace, channel ? formatChannel(channel) : '']
      .filter(Boolean)
      .join(' · ');
    const body = buildMarkdown(heading, limited.items);
    const bounded = limitMarkdown(body);
    addExtractionMetadata(metadata, {
      contentSource: 'Slack live DOM',
      total: limited.total,
      included: limited.items.length,
      truncated: limited.truncated || bounded.truncated,
      complete: false,
    });

    return Markdown.buildPageMarkdown(metadata, bounded.markdown);
  },
});

function extractMessages(root: ParentNode, isThread: boolean): SlackMessage[] {
  const candidates = canonicalMessageElements(root);
  const seen = new Set<string>();
  const messages: SlackMessage[] = [];
  let previousAuthor = '';

  candidates.forEach((element) => {
    if (isExcluded(element) || !hasMessageContent(element)) return;

    const bodyElement = findBodyElement(element);
    const body = bodyElement ? messageBodyToMarkdown(bodyElement) : '';
    const explicitAuthor = textFrom(element, [
      '[data-qa="message_sender_name"]',
      '[data-qa="message_sender"]',
      '.c-message__sender_button',
      '.c-message_kit__sender',
    ]);
    const author = explicitAuthor || previousAuthor;
    if (author) previousAuthor = author;

    const timestamp = getTimestamp(element);
    const attachments = getAttachments(element);
    const links = getLinks(bodyElement || element, attachments);
    const reactions = getReactions(element);
    const replySummary = textFrom(element, [
      '[data-qa="reply_count"]',
      '[data-qa="message_replies_count"]',
      '.c-message__reply_count',
      '.c-message__reply_bar_description',
    ]);
    if (!body && attachments.length === 0) return;

    const key = getMessageKey(element, author, timestamp, body, attachments);
    if (seen.has(key)) return;
    seen.add(key);

    messages.push({
      key,
      author,
      timestamp,
      body,
      links,
      attachments,
      reactions,
      replySummary,
      depth: isThread && messages.length > 0 ? 1 : 0,
    });
  });

  return messages;
}

function canonicalMessageElements(root: ParentNode): HTMLElement[] {
  const elements = new Set<HTMLElement>();
  root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR).forEach((candidate) => {
    const canonical = candidate.closest<HTMLElement>('[data-qa="message_container"]')
      || candidate.closest<HTMLElement>('[data-qa="virtual-list-item"][data-item-key*="message"]')
      || candidate.closest<HTMLElement>('.c-virtual_list__item[data-item-key^="message"]')
      || candidate.closest<HTMLElement>('.c-message_kit__background')
      || candidate;
    elements.add(canonical);
  });
  return Array.from(elements);
}

function hasMessageContent(element: Element): boolean {
  return Boolean(findBodyElement(element) || element.querySelector(
    '[data-qa="message_file"], [data-qa="file_attachment"], .c-message_kit__file, .c-file',
  ));
}

function findBodyElement(element: ParentNode): HTMLElement | null {
  return element.querySelector<HTMLElement>([
    '[data-qa="message-text"]',
    '[data-qa="message_text"]',
    '.c-message_kit__text',
    '.c-message__message_blocks',
    '[data-qa="blocks_container"]',
  ].join(', '));
}

function messageBodyToMarkdown(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll([
    'button',
    'script',
    'style',
    'svg',
    '[aria-hidden="true"]',
    '[data-qa="reaction_bar"]',
    '[data-qa="message_actions"]',
    '[data-qa="message_file"]',
    '[data-qa="file_attachment"]',
  ].join(', ')).forEach((node) => node.remove());
  return Markdown.elementToMarkdown(clone).trim();
}

function getTimestamp(element: Element): string {
  const time = element.querySelector<HTMLElement>('time, [data-qa="message_timestamp"], .c-timestamp');
  return normalize(
    time?.getAttribute('datetime')
    || time?.getAttribute('title')
    || time?.getAttribute('aria-label')
    || time?.textContent
    || '',
  );
}

function getAttachments(element: Element): string[] {
  const values = new Set<string>();
  element.querySelectorAll<HTMLElement>([
    '[data-qa="message_file"]',
    '[data-qa="file_attachment"]',
    '.c-message_kit__file',
    '.c-file',
  ].join(', ')).forEach((attachment) => {
    const link = attachment.querySelector<HTMLAnchorElement>('a[href]');
    const name = normalize(
      link?.getAttribute('download')
      || attachment.querySelector<HTMLElement>('[data-qa="file_name"]')?.textContent
      || link?.textContent
      || attachment.getAttribute('aria-label')
      || attachment.querySelector<HTMLImageElement>('img[alt]')?.alt
      || 'Attachment',
    );
    const href = safeHttpUrl(link?.href || '');
    values.add(href ? `[${escapeLabel(name)}](${href})` : name);
  });
  return Array.from(values).filter(Boolean);
}

function getLinks(root: ParentNode, attachments: string[]): string[] {
  const attachmentUrls = new Set(
    attachments.map((value) => value.match(/\((https?:\/\/[^)]+)\)$/)?.[1]).filter(Boolean),
  );
  const links = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (link.closest('[data-qa="message_file"], [data-qa="file_attachment"], .c-message_kit__file, .c-file')) return;
    const href = safeHttpUrl(link.href);
    if (!href || attachmentUrls.has(href) || isSlackUiLink(link, href)) return;
    links.add(href);
  });
  return Array.from(links);
}

function isSlackUiLink(link: HTMLAnchorElement, href: string): boolean {
  if (link.closest('[data-qa="message_sender_name"], .c-message__sender_button, .c-timestamp')) return true;
  try {
    const url = new URL(href);
    return url.hostname === 'app.slack.com' && /^\/client\/[^/]+\/[^/]+(?:\/thread\/)?/.test(url.pathname);
  } catch {
    return true;
  }
}

function getReactions(element: Element): string[] {
  const reactions = new Set<string>();
  element.querySelectorAll<HTMLElement>([
    'button[data-qa="reaction"]',
    '[data-qa="reaction_bar"] button',
    'button[aria-label*="reaction" i]',
  ].join(', ')).forEach((reaction) => {
    const value = normalize(
      reaction.getAttribute('aria-label')
      || reaction.getAttribute('data-title')
      || reaction.textContent
      || '',
    );
    if (value) reactions.add(value);
  });
  return Array.from(reactions);
}

function getMessageKey(
  element: HTMLElement,
  author: string,
  timestamp: string,
  body: string,
  attachments: string[],
): string {
  const stable = element.getAttribute('data-ts')
    || element.querySelector<HTMLElement>('[data-ts]')?.getAttribute('data-ts')
    || element.getAttribute('data-item-key')
    || element.id;
  return stable || `${author}\u0000${timestamp}\u0000${body}\u0000${attachments.join('|')}`;
}

function buildMarkdown(title: string, messages: SlackMessage[]): string {
  const parts = [`# ${title || 'Slack'}`];
  if (messages.length === 0) {
    parts.push('', '*No loaded messages found. Open a channel or thread, wait for messages to load, and try again.*');
    return parts.join('\n');
  }

  messages.forEach((message) => {
    const author = message.author || 'Unknown author';
    parts.push('', `${message.depth > 0 ? '### ↳' : '##'} ${author}`);
    if (message.timestamp) parts.push('', `**Time:** ${message.timestamp}`);
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
    '[data-qa="thread_view"]',
    '[data-qa="thread_flexpane"]',
    '[data-qa="thread_view_pane"]',
    '[role="dialog"][aria-label*="thread" i]',
    '[role="region"][aria-label*="thread" i]',
  ];
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .find((element) => isVisible(element) && element.querySelector(MESSAGE_SELECTOR)) || null;
}

function findChannelRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-qa="message_pane"], [data-qa="message_pane_scroller"], main[role="main"], main',
  );
}

function getWorkspaceName(): string {
  const direct = textFrom(document, [
    '[data-qa="team_name"]',
    '[data-qa="workspace_name"]',
    '[data-qa="workspace-menu-trigger"]',
  ]);
  if (direct) return direct.replace(/\s+(workspace menu|menu)$/i, '').trim();
  const titleParts = document.title
    .split(/\s+[|·]\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !/^Slack$/i.test(part));
  return titleParts[titleParts.length - 1] || '';
}

function getChannelName(): string {
  const direct = textFrom(document, [
    '[data-qa="channel_name"]',
    '[data-qa="channel_header_name"]',
    '[data-qa="channel-title"]',
    '[data-qa="channel_header"] h1',
  ]);
  return direct.replace(/^#\s*/, '').replace(/\s+(channel menu|menu)$/i, '').trim();
}

function formatChannel(channel: string): string {
  return channel.startsWith('#') ? channel : `#${channel}`;
}

function textFrom(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    const value = normalize(
      element?.textContent
      || element?.getAttribute('data-title')
      || element?.getAttribute('aria-label')
      || '',
    );
    if (value) return value;
  }
  return '';
}

function isExcluded(element: Element): boolean {
  return Boolean(element.closest([
    'nav',
    '[role="navigation"]',
    '[data-qa="message_input"]',
    '[data-qa="message_composer"]',
    '[data-qa="channel_sidebar"]',
    '[aria-hidden="true"]',
  ].join(', ')));
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
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

function escapeLabel(value: string): string {
  return value.replace(/([\\\]])/g, '\\$1');
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}
