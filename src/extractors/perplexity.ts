/** Perplexity authenticated and shared conversation extractor. */

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
  name: 'Perplexity',
  matches: [
    '*://perplexity.ai/*',
    '*://www.perplexity.ai/*',
  ],
  pathnameRegex: /^\/(?:search|session|page|spaces|collections|discover|thread|chat|s)(?:\/|$)/,

  async extract() {
    const title = publishedTitle() || cleanTitle(conversationPageTitle()) || 'Perplexity Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Perplexity',
      title,
      url: conversationUrl(),
      route: conversationRoute(window.location.pathname),
    };
    const turns = collectTurns();
    const limitedTurns = limitCollection(turns, MAX_TURNS);
    const parts = [`# ${title}`];
    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;

    const owns = createTurnOwner(limitedTurns.items);

    for (const turn of limitedTurns.items) {
      const cleaned = clean(turn.element);
      let content = messageToMarkdown(cleaned);
      const heading = sectionHeading(turn.element);
      if (content && heading) content = `### ${heading}\n\n${content}`;
      const standalone = standaloneImages(turn.container, turn.element, (node) => owns(turn, node));
      if (standalone.length) content = `${content}\n\n${standalone.join('\n')}`.trim();
      if (!content) continue;

      const citations = extractCitations(turn.container, (link) => owns(turn, link, turn.role));
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += cleaned.querySelectorAll('img[src]').length + standalone.length;
      codeBlockCount += cleaned.querySelectorAll('pre').length;

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Perplexity'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const loadMore = hasUnrenderedHistory();
    const structuralIncomplete = limitedTurns.truncated || loadMore;
    parts.push('', structuralIncomplete
      ? '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.'
      : '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.');
    if (!captured) {
      const fallback = document.querySelector('main, [role="main"], #__next');
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
      contentSource: 'Perplexity rendered conversation DOM',
      total: limitedTurns.total,
      included: captured,
      truncated,
      complete: captured > 0 && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

/** Published pages keep the product name in the document title. */
function publishedTitle(): string {
  return /^\/page\//.test(window.location.pathname)
    ? normalize(document.querySelector('main h1, main h2')?.textContent || '')
    : '';
}

/** Published pages put each section heading outside its answer. */
function sectionHeading(element: Element): string {
  const heading = element.closest('[data-last-section]')?.querySelector('h2');
  return heading && !element.contains(heading) ? normalize(heading.textContent || '') : '';
}

function collectTurns(): Turn[] {
  const result: Turn[] = [];
  const conversationUnits = firstElements([
    '[data-testid="conversation-turn"]',
    '[data-testid="thread-item"]',
    '[data-testid^="conversation-item-"]',
    '[data-testid^="thread-block"]',
    '.conversation-turn',
  ]);

  if (conversationUnits.length) {
    for (const unit of conversationUnits) {
      const user = queryFirst(unit, [
        '[data-testid="user-query"]',
        '[data-testid="query"]',
        '[data-message-author-role="user"]',
        '[data-role="user"]',
        '.query-text',
        'h1.group\\/query',
      ]);
      const assistant = queryFirst(unit, [
        '[data-testid="answer"]',
        '[data-testid="assistant-response"]',
        '[data-testid="copilot-answer"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '.answer-content',
        '[id^="markdown-content-"]',
        '.prose',
      ]);
      if (user) result.push({ role: 'user', element: user, container: unit });
      if (assistant && assistant !== user) result.push({ role: 'assistant', element: assistant, container: unit });
    }
    if (result.length) return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-testid="user-query"]',
    '[data-testid="query"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '.query-text',
    'h1.group\\/query',
    '[data-message-bubble="right"]',
    '[data-testid="answer"]',
    '[data-testid="assistant-response"]',
    '[data-testid="copilot-answer"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.answer-content',
    '[id^="markdown-content-"]',
    '[data-workflow-final-text] [data-renderer]',
  ].join(',')));
  standalone.sort(compareDomOrder);
  for (const element of standalone) {
    const role = roleFor(element) || (isUserElement(element) ? 'user' : 'assistant');
    result.push({ role, element, container: closestTurn(element) });
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
  if (/(?:^|[\s_-])(assistant|perplexity|copilot|model|response|answer)(?:$|[\s_-])/.test(value)) return 'assistant';
  return null;
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
    const label = normalize(link.textContent || '').replace(/\s*\+\d+$/, '')
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
  return Utils.removeNoise(linkCitations(cloneMessage(element)), [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]:not(.code-toolbar)', '[class*="follow-up"]',
    '[class*="avatar"]', 'textarea', 'input', '[contenteditable="true"]',
  ]);
}

/** Citation pills keep their URL in an attribute and a "+1" counter in their text. */
function linkCitations(root: Element): Element {
  for (const pill of root.querySelectorAll('[data-pplx-citation-url]')) {
    const href = safeHttpUrl(pill.getAttribute('data-pplx-citation-url') || '');
    const label = normalize(pill.textContent || '').replace(/\s*\+\d+$/, '');
    if (!href) continue;
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label || hostname(href);
    pill.replaceWith(link);
  }
  return root;
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

function isUserElement(element: Element): boolean {
  return element.matches([
    '[data-testid="user-query"]',
    '[data-testid="query"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '.query-text',
    'h1.group\\/query',
    '[data-message-bubble="right"]',
  ].join(', '));
}

function closestTurn(element: Element): Element {
  return element.closest('[data-testid="conversation-turn"], [data-testid="thread-item"], [data-testid^="thread-block"], .conversation-turn') || element;
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function hasUnrenderedHistory(): boolean {
  return hasHistoryControl() || Boolean(document.querySelector(
    '[data-testid*="load-more"], [data-virtualized="true"]',
  )) || Number(document.querySelector('[data-workflow-entry]')?.getAttribute('data-workflow-entry')) > 0;
}

function conversationRoute(path: string): string {
  if (/^\/(?:page|s)\//.test(path)) return 'shared';
  if (/^\/(?:search|session)\//.test(path)) return 'search';
  if (/^\/(?:spaces|collections)\//.test(path)) return 'space';
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
  return value.replace(/\s*[·|\-]\s*Perplexity\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
