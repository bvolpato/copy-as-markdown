/**
 * Discord channel and thread extractor.
 * Captures messages currently represented in Discord's virtualized live DOM.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type DiscordMessage = {
  key: string;
  author: string;
  timestamp: string;
  body: string;
  links: string[];
  attachments: string[];
  reactions: string[];
  replyTo: string;
};

const MESSAGE_SELECTOR = [
  'li[id^="chat-messages-"]',
  '[data-list-item-id^="chat-messages___"]',
  '[id^="message-content-"]',
].join(', ');

register({
  name: 'Discord',
  matches: [
    'https://discord.com/channels/*',
    'https://ptb.discord.com/channels/*',
    'https://canary.discord.com/channels/*',
  ],

  async extract() {
    const server = getServerName();
    const channel = getChannelName();
    const threadRoot = findThreadRoot();
    const context = threadRoot ? 'thread' : 'channel';
    const messages = extractMessages(threadRoot || findChannelRoot() || document);
    const limited = limitCollection(messages);
    const metadata: PageMetadata = {
      source: 'Discord',
      type: context === 'thread' ? 'Discord Thread' : 'Discord Channel',
      url: Utils.getCanonicalUrl(),
      server,
      channel,
      messages: limited.items.length,
      scope: 'loaded semantic DOM; older history may be virtualized or unloaded',
    };

    const heading = ['Discord', server, channel ? formatChannel(channel) : '']
      .filter(Boolean)
      .join(' · ');
    const body = buildMarkdown(heading, limited.items);
    const bounded = limitMarkdown(body);
    addExtractionMetadata(metadata, {
      contentSource: 'Discord live DOM',
      total: limited.total,
      included: limited.items.length,
      truncated: limited.truncated || bounded.truncated,
      complete: false,
    });

    return Markdown.buildPageMarkdown(metadata, bounded.markdown);
  },
});

function extractMessages(scope: ParentNode): DiscordMessage[] {
  const roots = canonicalMessageElements(scope);
  const messages: DiscordMessage[] = [];
  const seen = new Set<string>();
  let previousAuthor = '';

  roots.forEach((root) => {
    if (isExcluded(root)) return;
    const bodyElement = findBodyElement(root);
    const body = bodyElement ? messageBodyToMarkdown(bodyElement) : '';
    const attachments = getAttachments(root);
    if (!body && attachments.length === 0) return;

    const explicitAuthor = findMessageValue(root, [
      '[id^="message-username-"]',
      'h3 [class*="username"]',
      '[class*="headerText"] [class*="username"]',
    ]);
    const author = explicitAuthor || previousAuthor;
    if (author) previousAuthor = author;
    const timestamp = getTimestamp(root);
    const replyTo = getReplyContext(root);
    const key = getMessageKey(root, author, timestamp, body, attachments);
    if (seen.has(key)) return;
    seen.add(key);

    messages.push({
      key,
      author,
      timestamp,
      body,
      links: getLinks(bodyElement || root, attachments),
      attachments,
      reactions: getReactions(root),
      replyTo,
    });
  });

  return messages;
}

function canonicalMessageElements(scope: ParentNode): HTMLElement[] {
  const roots = new Set<HTMLElement>();
  scope.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR).forEach((candidate) => {
    const root = candidate.closest<HTMLElement>('li[id^="chat-messages-"]')
      || candidate.closest<HTMLElement>('[data-list-item-id^="chat-messages___"]')
      || candidate;
    roots.add(root);
  });
  return Array.from(roots);
}

function findBodyElement(root: ParentNode): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    '[id^="message-content-"], [class*="messageContent"]',
  ));
  return candidates.find((element) => !element.closest('[class*="repliedMessage"]')) || null;
}

function messageBodyToMarkdown(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, script, style, svg, [aria-hidden="true"]')
    .forEach((node) => node.remove());
  return Markdown.elementToMarkdown(clone).trim();
}

function getTimestamp(root: Element): string {
  const values = Array.from(root.querySelectorAll<HTMLElement>('time, [class*="timestamp"]'))
    .filter((element) => !element.closest('[class*="repliedMessage"]'));
  const time = values[0];
  return normalize(
    time?.getAttribute('datetime')
    || time?.getAttribute('title')
    || time?.getAttribute('aria-label')
    || time?.textContent
    || '',
  );
}

function getReplyContext(root: Element): string {
  const reply = root.querySelector<HTMLElement>('[class*="repliedMessage"], [data-role="reply"]');
  if (!reply) return '';
  const author = findMessageValue(reply, [
    '[class*="username"]',
    '[id^="message-username-"]',
  ]);
  const excerptElement = reply.querySelector<HTMLElement>(
    '[id^="message-content-"], [class*="repliedTextContent"], [class*="messageContent"]',
  );
  const excerpt = normalize(excerptElement?.textContent || '');
  const summary = [author, excerpt ? `“${Utils.truncate(excerpt, 240)}”` : ''].filter(Boolean).join(': ');
  return summary || normalize(reply.getAttribute('aria-label') || reply.textContent || '');
}

function getAttachments(root: Element): string[] {
  const attachments = new Map<string, string>();
  root.querySelectorAll<HTMLElement>([
    '[class*="attachment"]',
    '[class*="fileWrapper"]',
    '[class*="embedWrapper"]',
  ].join(', ')).forEach((candidate) => {
    if (candidate.closest('[class*="repliedMessage"]')) return;
    const link = candidate.querySelector<HTMLAnchorElement>('a[href]');
    const name = normalize(
      link?.getAttribute('download')
      || candidate.querySelector<HTMLElement>('[class*="filename"]')?.textContent
      || candidate.querySelector<HTMLElement>('[class*="embedTitle"]')?.textContent
      || link?.textContent
      || candidate.querySelector<HTMLImageElement>('img[alt]')?.alt
      || candidate.getAttribute('aria-label')
      || 'Attachment',
    );
    const href = safeHttpUrl(link?.href || candidate.querySelector<HTMLImageElement>('img[src]')?.src || '');
    const key = href || name;
    const value = href ? `[${escapeLabel(name)}](${href})` : name;
    if (key && (!attachments.has(key) || name !== 'Attachment')) attachments.set(key, value);
  });
  return Array.from(attachments.values()).filter(Boolean);
}

function getLinks(root: ParentNode, attachments: string[]): string[] {
  const attachmentUrls = new Set(
    attachments.map((value) => value.match(/\((https?:\/\/[^)]+)\)$/)?.[1]).filter(Boolean),
  );
  const links = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (link.closest('[class*="repliedMessage"], [class*="attachment"], [class*="fileWrapper"], [class*="embedWrapper"]')) return;
    const href = safeHttpUrl(link.href);
    if (!href || attachmentUrls.has(href) || isDiscordUiLink(href)) return;
    links.add(href);
  });
  return Array.from(links);
}

function isDiscordUiLink(value: string): boolean {
  try {
    const url = new URL(value);
    return /^(?:ptb\.|canary\.)?discord\.com$/.test(url.hostname)
      && (/^\/channels\//.test(url.pathname) || /^\/users\//.test(url.pathname));
  } catch {
    return true;
  }
}

function getReactions(root: Element): string[] {
  const reactions = new Set<string>();
  root.querySelectorAll<HTMLElement>('button[aria-label]').forEach((button) => {
    if (
      !button.closest('[class*="reaction"]')
      && !/reaction|reacted/i.test(button.getAttribute('aria-label') || '')
    ) return;
    const value = normalize(button.getAttribute('aria-label') || button.textContent || '');
    if (value) reactions.add(value);
  });
  return Array.from(reactions);
}

function getMessageKey(
  root: HTMLElement,
  author: string,
  timestamp: string,
  body: string,
  attachments: string[],
): string {
  const stable = root.id
    || root.getAttribute('data-list-item-id')
    || findBodyElement(root)?.id;
  return stable || `${author}\u0000${timestamp}\u0000${body}\u0000${attachments.join('|')}`;
}

function buildMarkdown(title: string, messages: DiscordMessage[]): string {
  const parts = [`# ${title || 'Discord'}`];
  if (messages.length === 0) {
    parts.push('', '*No loaded messages found. Open a channel or thread, wait for messages to load, and try again.*');
    return parts.join('\n');
  }

  messages.forEach((message) => {
    const author = message.author || 'Unknown author';
    parts.push('', `${message.replyTo ? '### ↳' : '##'} ${author}`);
    if (message.timestamp) parts.push('', `**Time:** ${message.timestamp}`);
    if (message.replyTo) parts.push('', `**Reply to:** ${message.replyTo}`);
    if (message.body) parts.push('', message.body);
    if (message.links.length > 0) parts.push('', `**Links:** ${message.links.join(', ')}`);
    if (message.attachments.length > 0) parts.push('', `**Attachments:** ${message.attachments.join(', ')}`);
    if (message.reactions.length > 0) parts.push('', `**Reactions:** ${message.reactions.join('; ')}`);
  });
  return parts.join('\n');
}

function getServerName(): string {
  const selectors = [
    'nav[aria-label="Servers"] [aria-current="page"]',
    'nav[aria-label="Servers"] [aria-selected="true"]',
    '[data-list-item-id^="guildsnav___"][aria-selected="true"]',
  ];
  return firstValue(document, selectors)
    .replace(/\s+(server|menu)$/i, '')
    .trim();
}

function getChannelName(): string {
  const selectors = [
    '[data-list-item-id^="channels___"][aria-selected="true"]',
    '[class*="titleWrapper"] h1',
    'main [aria-label^="Channel header" i] h1',
    'main h1',
  ];
  return firstValue(document, selectors)
    .replace(/^#\s*/, '')
    .replace(/\s*\((?:text )?channel\)$/i, '')
    .replace(/\s+(?:text )?channel$/i, '')
    .trim();
}

function findMessageValue(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const element = candidates.find((candidate) => !candidate.closest('[class*="repliedMessage"]'));
    if (!element) continue;
    const value = normalize(element.textContent || element.getAttribute('aria-label') || '');
    if (value) return value;
  }
  return '';
}

function firstValue(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    const value = normalize(
      element?.getAttribute('data-dnd-name')
      || element?.getAttribute('aria-label')
      || element?.textContent
      || '',
    );
    if (value) return value;
  }
  return '';
}

function isExcluded(root: Element): boolean {
  return Boolean(root.closest([
    'nav',
    '[role="navigation"]',
    'form',
    '[class*="channelTextArea"]',
    '[class*="sidebar"]',
    '[aria-hidden="true"]',
  ].join(', ')));
}

function findThreadRoot(): HTMLElement | null {
  const selectors = [
    '[class*="threadSidebar"]',
    '[class*="threadContainer"]',
    '[aria-label*="Thread header" i]',
  ];
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll<HTMLElement>(selector)))
    .map((element) => element.closest<HTMLElement>('[class*="threadSidebar"], [class*="threadContainer"]') || element)
    .find((element) => isVisible(element) && element.querySelector(MESSAGE_SELECTOR)) || null;
}

function findChannelRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[data-list-id="chat-messages"], main[role="main"], main',
  );
}

function isVisible(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function formatChannel(channel: string): string {
  return channel.startsWith('#') ? channel : `#${channel}`;
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
