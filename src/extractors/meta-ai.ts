/**
 * Meta AI conversation extractor.
 *
 * Meta AI is a client-rendered application and has changed class names more
 * than once. Prefer semantic message attributes, then fall back to the
 * message elements used by the current web client. Do not treat the whole
 * Meta platform as a conversation: this extractor is scoped to meta.ai chat
 * and share routes.
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

type Turn = { role: Role; element: Element; container: Element };

register({
  name: 'Meta AI',
  matches: [
    '*://meta.ai/*',
    '*://www.meta.ai/*',
  ],
  pathnameRegex: /^\/(?:chat|c|conversation|share|search|discover|ask|home|prompt|imagine)(?:\/|$)|^\/$/i,

  async extract() {
    const turns = limitCollection(collectTurns(), MAX_TURNS);
    const heading = Array.from(document.querySelectorAll('h1'))
      .find((element) => !turns.items.some((turn) => turn.element.contains(element)));
    const title = cleanTitle(
      heading?.textContent?.trim()
      || conversationPageTitle(),
    ) || 'Meta AI Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Meta AI',
      title,
      url: conversationUrl(),
      route: conversationRoute(window.location.pathname),
    };

    const model = extractModel();
    if (model) metadata.model = model;

    const parts = [`# ${title}`];
    if (model) parts.push('', `**Model:** ${model}`);

    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;

    const owns = createTurnOwner(turns.items);

    for (const turn of turns.items) {
      const cleaned = clean(turn.element);
      let content = messageToMarkdown(cleaned);
      const images = standaloneImages(turn.container, turn.element, (node) => owns(turn, node));
      if (images.length) content = `${content}\n\n${images.join('\n')}`.trim();
      if (!content) continue;

      const citations = extractCitations(turn.container, (link) => owns(turn, link, turn.role));
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += cleaned.querySelectorAll('img[src]').length + images.length;
      codeBlockCount += cleaned.querySelectorAll('pre').length;

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Meta AI'}`, '', content);
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
      const fallback = document.querySelector('main, [role="main"], [data-testid*="conversation"], #__next');
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
      contentSource: 'Meta AI rendered conversation DOM',
      total: turns.total,
      included: captured,
      truncated,
      complete: captured > 0 && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

function extractModel(): string {
  const direct = document.querySelector('[data-model]')?.getAttribute('data-model')?.trim()
    || document.querySelector('[data-model-name]')?.getAttribute('data-model-name')?.trim()
    || document.querySelector('meta[name="model"]')?.getAttribute('content')?.trim()
    || '';
  if (direct && direct.length <= 100) return direct;
  const isVisible = Utils.createVisibilityChecker();
  for (const el of document.querySelectorAll('[data-testid*="model"]')) {
    if (!isVisible(el)) continue;
    const text = normalize(el.textContent || '');
    if (text && text.length <= 100) return text;
  }
  return '';
}

function collectTurns(): Turn[] {
  const result: Turn[] = [];
  const roots = firstElements([
    '[data-message-id]',
    '[data-role="user"], [data-role="assistant"]',
    '[data-testid="message"]',
    '[data-testid*="user-message"], [data-testid*="assistant-message"], [data-testid*="meta-ai-message"]',
    '[role="article"]',
  ]);

  if (roots.length) {
    for (const root of roots) {
      const explicitRole = roleFor(root);
      if (explicitRole) {
        const element = messageContent(root) || root;
        result.push({ role: explicitRole, element, container: root });
        continue;
      }

      const user = queryFirst(root, [
        '[data-testid="user-message"]',
        '[data-testid*="user-message"]',
        '[data-message-author-role="user"]',
        '[data-role="user"]',
        '[data-author="user"]',
      ]);
      const assistant = queryFirst(root, [
        '[data-testid="assistant-message"]',
        '[data-testid*="assistant-message"]',
        '[data-testid*="meta-ai-message"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '[data-author="assistant"]',
      ]);
      if (user) result.push({ role: 'user', element: messageContent(user) || user, container: root });
      if (assistant && assistant !== user) result.push({ role: 'assistant', element: messageContent(assistant) || assistant, container: root });
    }
    if (result.length) return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-testid="user-message"]',
    '[data-testid*="user-message"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-testid="assistant-message"]',
    '[data-testid*="assistant-message"]',
    '[data-testid*="meta-ai-message"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
  ].join(',')));
  standalone.sort(compareDomOrder);
  for (const element of standalone) {
    const role = roleFor(element);
    if (!role) continue;
    result.push({ role, element: messageContent(element) || element, container: closestTurn(element) });
  }
  return dedupeTurns(result);
}

function roleFor(element: Element): Role | null {
  const value = [
    element.getAttribute('data-role'),
    element.getAttribute('data-message-author-role'),
    element.getAttribute('data-author'),
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    typeof element.className === 'string' ? element.className : '',
  ].filter(Boolean).join(' ').toLowerCase();
  if (/(?:^|[\s_-])(user|human|you|prompt|query)(?:$|[\s_-])/.test(value)) return 'user';
  if (/(?:^|[\s_-])(assistant|meta(?:[\s_-]?ai)?|model|response|answer)(?:$|[\s_-])/.test(value)) return 'assistant';
  return null;
}

function messageContent(element: Element): Element | null {
  return queryFirst(element, [
    '[data-testid="message-content"]',
    '[data-testid*="message-content"]',
    '[data-testid*="markdown"]',
    '[data-message-content]',
    '.markdown',
    '.prose',
  ]);
}

function dedupeTurns(turns: Turn[]): Turn[] {
  const seenElements = new Set<Element>();
  const unique = turns.filter((turn) => {
    if (seenElements.has(turn.element)) return false;
    seenElements.add(turn.element);
    return true;
  });
  return unique.filter((turn) => !unique.some((other) => other.role === turn.role
    && other.element !== turn.element && other.element.contains(turn.element)));
}

function extractCitations(
  container: Element,
  ownsNode: (node: Element) => boolean,
): Array<{ label: string; href: string }> {
  const links = container.querySelectorAll<HTMLAnchorElement>([
    'a[data-citation][href]',
    '[data-testid*="citation"] a[href]',
    '[data-testid*="source"] a[href]',
    '[data-source] a[href]',
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
  content: Element,
  ownsNode: (node: Element) => boolean,
): string[] {
  const inText = (image: Element) => isInText([content], image);
  const existing = new Set(
    Array.from(content.querySelectorAll<HTMLImageElement>('img[src]'))
      .filter(inText)
      .map((image) => safeImageUrl(imageSource(image)))
      .filter(Boolean),
  );
  const result: string[] = [];
  for (const image of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (inText(image) || isAriaHidden(container, image) || !ownsNode(image)) continue;
    const source = safeImageUrl(imageSource(image));
    if (!source || existing.has(source) || isFaviconUrl(source)) continue;
    const alt = image.getAttribute('alt') || '';
    const meaningful = Boolean(image.closest('figure, [data-testid*="image"], [class*="generated"]'))
      || /generated|uploaded|image/i.test(alt)
      || Math.max(image.naturalWidth, image.naturalHeight, image.width, image.height) >= 100;
    if (!meaningful) continue;
    existing.add(source);
    result.push(`![${escapeLinkText(alt)}](${source})`);
  }
  return result;
}

function clean(element: Element): Element {
  return Utils.removeNoise(cloneMessage(element), [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]:not(.code-toolbar)', '[class*="avatar"]', '[class*="profile"]',
    'textarea', '[contenteditable="true"]',
  ]);
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
  return element.closest('[data-message-id], [data-testid*="message"], [role="article"]') || element;
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function hasUnrenderedHistory(): boolean {
  return hasHistoryControl() || Boolean(document.querySelector(
    '[data-testid*="load-more"], [data-virtualized="true"]',
  ));
}

function conversationRoute(path: string): string {
  if (/^\/share\//i.test(path)) return 'shared';
  if (/^\/(?:chat|c|conversation|prompt)\//i.test(path)) return 'authenticated';
  if (/^\/imagine\//i.test(path)) return 'imagine';
  if (/^\/(?:search|discover|ask)\//i.test(path)) return 'search';
  return 'conversation';
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
  return value.replace(/\s*[·|\-]\s*Meta\s*AI\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
