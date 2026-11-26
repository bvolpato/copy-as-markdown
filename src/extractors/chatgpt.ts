/**
 * ChatGPT conversation extractor.
 * Extracts rendered user and assistant turns from shared and live ChatGPT
 * routes, including citations, code, and generated images.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import {
  cloneMessage, conversationPageTitle, conversationUrl, createTurnOwner, hasHistoryControl,
  isAriaHidden, isFaviconUrl, isInText, isPageAnchor, messageToMarkdown, type Role,
} from '../core/ai-conversation';

const MAX_TURNS = 200;
const CURRENT_USER = '[data-user-message-bubble]';
const CURRENT_ASSISTANT = '[data-markdown-text-style="assistant-message"], [data-assistant-markdown-root]';

type Turn = { role: Role; element: Element; container: Element; blocks?: Element[] };

register({
  name: 'ChatGPT',
  matches: [
    '*://chatgpt.com/*',
    '*://www.chatgpt.com/*',
    '*://chat.openai.com/*',
  ],
  pathnameRegex: /^(?:\/$|\/(?:share|c)\/|\/g\/[^/]+\/c\/)/,

  buttonPlacement: 'anchor',
  anchor: {
    selector: '#conversation-header-actions, [data-testid="conversation-header-actions"], header[data-app-shell-titlebar], main header',
    position: 'overlay',
    style: 'icon',
    css: {
      borderRadius: '8px',
      padding: '8px',
      color: 'var(--text-primary, inherit)',
      opacity: '0.85',
    },
  },

  async extract() {
    const url = conversationUrl();
    const title = conversationTitle();
    const metadata: Record<string, string | number> = {
      source: 'ChatGPT',
      title,
      url,
      route: conversationRoute(window.location.pathname),
    };

    const model = extractModel();
    if (model) metadata.model = model;

    const turns = limitCollection(collectTurns(), MAX_TURNS);
    const parts: string[] = [`# ${title}`];
    if (model) parts.push('', `**Model:** ${model}`);
    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;
    const owns = createTurnOwner(turns.items);

    for (const turn of turns.items) {
      const contentNodes = turn.blocks || [turn.element];
      const cleanedNodes = contentNodes.map((node) => clean(node));
      let content = cleanedNodes.map(messageToMarkdown).filter(Boolean).join('\n\n');
      const images = standaloneImages(turn.container, contentNodes, (node) => owns(turn, node));
      if (images.length) content = `${content}\n\n${images.join('\n')}`.trim();
      if (!content) continue;

      const citations = extractCitations(turn.container, (link) => owns(turn, link, turn.role));
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += images.length;
      for (const node of cleanedNodes) {
        imageCount += node.querySelectorAll('img[src]').length;
        codeBlockCount += node.querySelectorAll('pre').length;
      }

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Assistant'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const structuralIncomplete = turns.truncated || hasUnrenderedHistory();
    parts.push('', structuralIncomplete
      ? '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.'
      : '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.');
    if (!captured) {
      const fallback = document.querySelector('[data-chatgpt-conversation-selection-target], [data-thread-find-target="conversation"]')
        || document.querySelector('main, [role="main"], [class*="thread"], #__next');
      if (fallback) parts.push('', Markdown.elementToMarkdown(clean(fallback)));
    }

    metadata.turn_count = captured;
    metadata.user_turn_count = userCount;
    metadata.assistant_turn_count = assistantCount;
    metadata.citation_count = citationUrls.size;
    metadata.image_count = imageCount;
    metadata.code_block_count = codeBlockCount;
    metadata.completeness = !captured || structuralIncomplete
      ? 'visible_only'
      : 'complete_rendered_conversation';

    const output = limitMarkdown(parts.join('\n'));
    const truncated = structuralIncomplete || output.truncated;
    if (output.truncated) metadata.completeness = 'truncated_by_limit';
    addExtractionMetadata(metadata, {
      contentSource: 'ChatGPT rendered conversation DOM',
      total: turns.total,
      included: captured,
      truncated,
      complete: captured > 0 && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

function collectTurns(): Turn[] {
  const result: Turn[] = [];
  const roots = firstElements([
    'section[data-testid^="conversation-turn-"]',
    '[data-message-author-role="user"], [data-message-author-role="assistant"]',
    '[data-testid="conversation-turn"]',
    '[data-message-id]',
    'article[data-role]',
  ]);

  if (roots.length) {
    for (const root of roots) {
      const explicitRole = roleFor(root);
      if (explicitRole) {
        // One turn can hold several messages, such as a preamble before a tool call.
        const messages = Array.from(root.querySelectorAll(`[data-message-author-role="${explicitRole}"]`));
        const blocks = messages.length > 1
          ? messages.map((message) => messageContent(message) || message)
          : undefined;
        result.push({
          role: explicitRole,
          element: blocks?.[0] || messageContent(root) || root,
          container: root,
          blocks,
        });
        continue;
      }
      const user = queryFirst(root, [
        CURRENT_USER,
        '[data-message-author-role="user"]',
        '[data-testid="user-message"]',
        '[data-role="user"]',
      ]);
      const assistant = queryFirst(root, [
        CURRENT_ASSISTANT,
        '[data-message-author-role="assistant"]',
        '[data-testid="assistant-message"]',
        '[data-role="assistant"]',
      ]);
      if (user) result.push({ role: 'user', element: messageContent(user) || user, container: root });
      if (assistant) result.push({ role: 'assistant', element: messageContent(assistant) || assistant, container: root });
    }
  }

  const standalone = Array.from(document.querySelectorAll([
    CURRENT_USER,
    CURRENT_ASSISTANT,
    ...(!roots.length ? [
      '[data-message-author-role="user"]',
      '[data-message-author-role="assistant"]',
      '[data-testid="user-message"]',
      '[data-testid="assistant-message"]',
    ] : []),
  ].join(',')));
  for (const element of standalone) {
    const role = roleFor(element);
    if (!role) continue;
    result.push({ role, element: messageContent(element) || element, container: closestTurn(element) });
  }
  return dedupeTurns(result.sort((left, right) => compareDomOrder(left.element, right.element)));
}

function extractModel(): string {
  const slug = document.querySelector('[data-message-model-slug]')?.getAttribute('data-message-model-slug')?.trim();
  if (slug) return slug;
  const dataModel = document.querySelector('[data-model]')?.getAttribute('data-model')?.trim();
  if (dataModel) return dataModel;
  const dataModelName = document.querySelector('[data-model-name]')?.getAttribute('data-model-name')?.trim();
  if (dataModelName) return dataModelName;
  const isVisible = Utils.createVisibilityChecker();
  for (const button of document.querySelectorAll('[data-testid="model-switcher-dropdown-button"]')) {
    if (!isVisible(button)) continue;
    const text = normalize(button.textContent || '');
    if (text && text.length <= 100) return text;
  }
  return '';
}

function roleFor(element: Element): Role | null {
  if (element.matches(CURRENT_USER)) return 'user';
  if (element.matches(CURRENT_ASSISTANT)) return 'assistant';
  const value = [
    element.getAttribute('data-turn'),
    element.getAttribute('data-message-author-role'),
    element.getAttribute('data-role'),
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    typeof element.className === 'string' ? element.className : '',
  ].filter(Boolean).join(' ').toLowerCase();
  if (/(?:^|[\s_-])(user|human|you|prompt|query)(?:$|[\s_-])/.test(value)) return 'user';
  if (/(?:^|[\s_-])(assistant|chatgpt|model|response|answer)(?:$|[\s_-])/.test(value)) return 'assistant';
  return null;
}

function messageContent(element: Element): Element | null {
  if (element.matches(`${CURRENT_USER}, ${CURRENT_ASSISTANT}`)) return element;
  return queryFirst(element, [
    CURRENT_USER,
    CURRENT_ASSISTANT,
    '.markdown',
    '[data-testid="message-content"]',
    '[data-testid="conversation-turn-content"]',
    '[data-testid*="markdown"]',
    '.whitespace-pre-wrap',
    '[class*="markdown"]',
  ]);
}

function dedupeTurns(turns: Turn[]): Turn[] {
  const seenElements = new Set<Element>();
  const unique = turns.filter((turn) => {
    if (seenElements.has(turn.element)) return false;
    seenElements.add(turn.element);
    return true;
  });
  return unique.filter((turn) => !unique.some((other) => (
    other.role === turn.role
    && other.element !== turn.element
    && (other.blocks || [other.element]).some((block) => block === turn.element || block.contains(turn.element))
  )));
}

function extractCitations(
  container: Element,
  ownsNode: (node: Element) => boolean,
): Array<{ label: string; href: string }> {
  const links = container.querySelectorAll<HTMLAnchorElement>([
    'a[data-citation][href]',
    '[data-testid*="citation"] a[href]',
    '[data-testid*="source"] a[href]',
    '.citation a[href]',
    'sup a[href]',
  ].join(','));
  const seen = new Set<string>();
  const result: Array<{ label: string; href: string }> = [];
  for (const link of links) {
    if (isPageAnchor(link) || !ownsNode(link)) continue;
    const href = safeHttpUrl(link.href);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = normalize(link.textContent || '')
      || link.getAttribute('aria-label')?.trim()
      || hostname(href);
    result.push({ label: escapeLinkText(label), href });
  }
  return result;
}

function standaloneImages(
  container: Element,
  contentNodes: Element[],
  ownsNode: (node: Element) => boolean,
): string[] {
  const inText = (image: Element) => isInText(contentNodes, image);
  const seenSources = new Set(
    contentNodes
      .flatMap((node) => Array.from(node.querySelectorAll<HTMLImageElement>('img[src]')))
      .filter(inText)
      .map((image) => safeImageUrl(imageSource(image)))
      .filter(Boolean),
  );
  const images: string[] = [];
  container.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    if (inText(image) || isAriaHidden(container, image) || !ownsNode(image)) return;
    const source = safeImageUrl(imageSource(image));
    if (!source || seenSources.has(source) || isFaviconUrl(source)) return;
    const rect = image.getBoundingClientRect();
    const width = Math.max(image.naturalWidth, image.width, rect.width);
    const height = Math.max(image.naturalHeight, image.height, rect.height);
    const alt = image.getAttribute('alt') || '';
    const imageContainer = image.closest('figure, [data-testid*="image"], [class*="image"]');
    const meaningful = Boolean(imageContainer)
      || /generated image|uploaded image|image generated/i.test(alt)
      || Math.max(width, height) >= 100;
    if (!meaningful) return;
    seenSources.add(source);
    images.push(`![${escapeLinkText(alt)}](${source})`);
  });
  return images;
}

function clean(element: Element): Element {
  const clone = Utils.removeNoise(cloneMessage(element), [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]:not(.code-toolbar)', 'textarea',
    '[data-testid="writing-block-header-sticky-container"]',
    '[class*="avatar"]', '[class*="profile"]',
    '[data-markdown-copy="exclude"]', '[data-d-component="favicon"]',
    '[data-assistant-reasoning-summary]', 'h4.sr-only, h5.sr-only, h6.sr-only',
  ]);

  clone.querySelectorAll('[contenteditable="true"]').forEach((editable) => {
    if (!isWritingBlockEditor(editable)) editable.remove();
  });

  clone.querySelectorAll('span[data-d-default-strong]').forEach((span) => {
    const strong = document.createElement('strong');
    strong.append(...span.childNodes);
    span.append(strong);
  });

  return clone;
}

function isWritingBlockEditor(element: Element): boolean {
  return Boolean(element.closest([
    '[data-writing-block="true"]',
    '[data-testid="writing-block-container"]',
    '[data-oai-writing-block-surface]',
  ].join(',')));
}

function firstElements(selectors: string[]): Element[] {
  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length) return elements;
  }
  return [];
}

function queryFirst(root: Element, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) return element;
  }
  return null;
}

function closestTurn(element: Element): Element {
  return element.closest('[data-chatgpt-search-unit-key], section[data-testid^="conversation-turn-"], [data-message-role], [data-message-id], article') || element;
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function hasUnrenderedHistory(): boolean {
  return hasHistoryControl() || Boolean(document.querySelector(
    '[data-testid*="load-more"], [data-virtualized="true"], [data-transcript-spacer]',
  )) || Array.from(document.querySelectorAll('[role="status"]')).some((status) => (
    /loading (?:older|previous) messages/i.test(status.textContent || '')
  ));
}

function conversationTitle(): string {
  const heading = Array.from(document.querySelectorAll('h1')).find((element) => !element.closest([
    CURRENT_USER, CURRENT_ASSISTANT, '[data-message-author-role]', '[data-message-id]',
    '[data-testid^="conversation-turn-"]', '.markdown',
  ].join(',')));
  return cleanTitle(heading?.textContent?.trim() || conversationPageTitle()) || 'ChatGPT Conversation';
}

function conversationRoute(path: string): string {
  if (/^\/share\//.test(path)) return 'shared';
  if (/^\/g\/[^/]+\/c\//.test(path)) return 'project';
  if (path === '/') return 'temporary';
  return 'authenticated';
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute('src') || '';
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? escapeMarkdownDestination(url.href) : '';
  } catch {
    return '';
  }
}

function safeImageUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(trimmed)) {
    return escapeMarkdownDestination(trimmed);
  }
  try {
    const url = new URL(trimmed, document.baseURI);
    return /^(?:https?|blob):$/.test(url.protocol) ? escapeMarkdownDestination(url.href) : '';
  } catch {
    return '';
  }
}

function hostname(value: string): string {
  try { return new URL(value).hostname; } catch { return 'Source'; }
}

function cleanTitle(value: string): string {
  return value.replace(/\s*[·|\-]\s*ChatGPT\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
