/** Perplexity authenticated and shared conversation extractor. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_TURNS = 200;

type Role = 'user' | 'assistant';
type Turn = { role: Role; element: Element; container: Element };

register({
  name: 'Perplexity',
  matches: [
    '*://perplexity.ai/*',
    '*://www.perplexity.ai/*',
  ],
  pathnameRegex: /^\/(?:search|page|spaces|collections|discover)(?:\/|$)/,

  async extract() {
    const title = cleanTitle(Utils.getPageTitle()) || 'Perplexity Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Perplexity',
      title,
      url: Utils.getCanonicalUrl(),
      route: conversationRoute(window.location.pathname),
    };
    const turns = collectTurns();
    const limitedTurns = limitCollection(turns, MAX_TURNS);
    const parts = [`# ${title}`];
    const seen = new Set<string>();
    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;

    for (const turn of limitedTurns.items) {
      const cleaned = clean(turn.element);
      let content = Markdown.elementToMarkdown(cleaned);
      const standalone = standaloneImages(turn.container, turn.element);
      if (standalone.length) content = `${content}\n\n${standalone.join('\n')}`.trim();
      const key = `${turn.role}:${normalize(content)}`;
      if (!content || seen.has(key)) continue;
      seen.add(key);

      const citations = extractCitations(turn.container);
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

function collectTurns(): Turn[] {
  const result: Turn[] = [];
  const conversationUnits = firstElements([
    '[data-testid="conversation-turn"]',
    '[data-testid="thread-item"]',
    '[data-testid^="conversation-item-"]',
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
      ]);
      const assistant = queryFirst(unit, [
        '[data-testid="answer"]',
        '[data-testid="assistant-response"]',
        '[data-testid="copilot-answer"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '.answer-content',
      ]);
      if (user) result.push({ role: 'user', element: user, container: unit });
      if (assistant) result.push({ role: 'assistant', element: assistant, container: unit });
    }
    return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-testid="user-query"]',
    '[data-testid="query"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-testid="answer"]',
    '[data-testid="assistant-response"]',
    '[data-testid="copilot-answer"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
  ].join(',')));
  standalone.sort(compareDomOrder);
  for (const element of standalone) {
    const role = isUserElement(element) ? 'user' : 'assistant';
    result.push({ role, element, container: closestTurn(element) });
  }
  return dedupeTurns(result);
}

function dedupeTurns(turns: Turn[]): Turn[] {
  const seenElements = new Set<Element>();
  const seenContent = new Set<string>();
  return turns.filter((turn) => {
    if (seenElements.has(turn.element)) return false;
    seenElements.add(turn.element);
    const key = `${turn.role}:${normalize(turn.element.textContent || '')}`;
    if (!key.endsWith(':') && seenContent.has(key)) return false;
    if (!key.endsWith(':')) seenContent.add(key);
    return true;
  });
}

function extractCitations(container: Element): Array<{ label: string; href: string }> {
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

function standaloneImages(container: Element, content: Element): string[] {
  const existing = new Set(Array.from(content.querySelectorAll<HTMLImageElement>('img[src]')).map(imageSource));
  const result: string[] = [];
  for (const image of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    const source = imageSource(image);
    if (!source || existing.has(source) || image.getAttribute('aria-hidden') === 'true') continue;
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
  return Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]', '[class*="follow-up"]', 'textarea',
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

function isUserElement(element: Element): boolean {
  return element.matches('[data-testid="user-query"], [data-testid="query"], [data-message-author-role="user"], [data-role="user"]');
}

function closestTurn(element: Element): Element {
  return element.closest('[data-testid="conversation-turn"], [data-testid="thread-item"], .conversation-turn') || element;
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function hasUnrenderedHistory(): boolean {
  return Boolean(document.querySelector(
    '[data-testid*="load-more"], button[aria-label*="older" i], button[aria-label*="previous" i], [data-virtualized="true"]',
  ));
}

function conversationRoute(path: string): string {
  if (/^\/page\//.test(path)) return 'shared';
  if (/^\/search\//.test(path)) return 'search';
  if (/^\/(?:spaces|collections)\//.test(path)) return 'space';
  return 'authenticated';
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute('src') || '';
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
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
  return value.replace(/]/g, '\\]');
}
