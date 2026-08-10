/**
 * Google Gemini conversation extractor.
 * Supports rendered app, chat, gem, and spark routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_TURNS = 200;

type Role = 'user' | 'assistant';
type Turn = { role: Role; element: Element; container: Element };

register({
  name: 'Gemini',
  matches: [
    '*://gemini.google.com/app/*',
    '*://gemini.google.com/chat/*',
    '*://gemini.google.com/gem/*',
    '*://gemini.google.com/spark/*',
  ],
  pathnameRegex: /^\/(?:app|chat|gem|spark)(?:\/|$)/,

  async extract() {
    const title = cleanTitle(Utils.getPageTitle()) || 'Gemini Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Gemini',
      title,
      url: Utils.getCanonicalUrl(),
      route: conversationRoute(window.location.pathname),
    };
    const model = document.querySelector('[data-model], [data-model-name], [data-testid*="model"]')
      ?.getAttribute('data-model')
      || document.querySelector('[data-model-name]')?.getAttribute('data-model-name')
      || '';
    if (model) metadata.model = model;

    const turns = limitCollection(collectTurns(), MAX_TURNS);
    const parts: string[] = [`# ${title}`];
    if (model) parts.push('', `**Model:** ${model}`);
    const seen = new Set<string>();
    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;

    for (const turn of turns.items) {
      const cleaned = clean(turn.element);
      let content = Markdown.elementToMarkdown(cleaned);
      const images = standaloneImages(turn.container, turn.element);
      if (images.length) content = `${content}\n\n${images.join('\n')}`.trim();
      const key = `${turn.role}:${normalize(content)}`;
      if (!content || seen.has(key)) continue;
      seen.add(key);

      const citations = extractCitations(turn.container);
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += cleaned.querySelectorAll('img[src]').length + images.length;
      codeBlockCount += cleaned.querySelectorAll('pre').length;

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Gemini'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const structuralIncomplete = turns.truncated || hasUnrenderedHistory();
    if (!captured) {
      const fallback = document.querySelector('#chat-history, main, [role="main"], [data-testid*="conversation"]');
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
      contentSource: 'Gemini rendered conversation DOM',
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
    'conversation-turn',
    '.conversation-turn',
    '[data-message-id]',
    '[data-testid="message"]',
  ]);

  if (roots.length) {
    for (const root of roots) {
      const explicitRole = roleFor(root);
      if (explicitRole) {
        result.push({ role: explicitRole, element: messageContent(root) || root, container: root });
        continue;
      }
      const user = queryFirst(root, [
        'user-query',
        '[data-testid="user-query"]',
        '[data-testid="query"]',
        '[data-message-author-role="user"]',
        '[data-role="user"]',
        '.query-text',
      ]);
      const assistant = queryFirst(root, [
        'model-response',
        '[data-testid="model-response"]',
        '[data-testid="answer"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '.model-response',
      ]);
      if (user) result.push({ role: 'user', element: messageContent(user) || user, container: root });
      if (assistant) result.push({ role: 'assistant', element: messageContent(assistant) || assistant, container: root });
    }
    return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    'user-query',
    '[data-testid="user-query"]',
    '[data-testid="query"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    'model-response',
    '[data-testid="model-response"]',
    '[data-testid="answer"]',
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
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    element.tagName,
    element.className,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/user|human|you|prompt|query/.test(value)) return 'user';
  if (/assistant|gemini|model|response|answer/.test(value)) return 'assistant';
  return null;
}

function messageContent(element: Element): Element | null {
  return queryFirst(element, [
    '.markdown.markdown-main-panel',
    '[data-testid="model-response-content"]',
    '[data-testid="message-content"]',
    '[data-testid*="markdown"]',
    '.query-text-line',
    '.query-text',
    '.markdown',
  ]);
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
    '[data-source] a[href]',
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
    if (content.contains(image) || image.getAttribute('aria-hidden') === 'true') continue;
    const source = imageSource(image);
    if (!source || existing.has(source)) continue;
    const alt = image.getAttribute('alt') || '';
    const meaningful = Boolean(image.closest('figure, [data-testid*="image"], [class*="generated"], [class*="image"]'))
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
    '[class*="toolbar"]', '[class*="avatar"]', 'textarea',
    '[contenteditable="true"]',
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
  return element.closest('.conversation-container, conversation-turn, .conversation-turn, [data-message-id]') || element;
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
  if (/^\/spark\//.test(path)) return 'spark';
  if (/^\/gem\//.test(path)) return 'gem';
  if (/^\/chat\//.test(path)) return 'chat';
  return 'app';
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
  return value.replace(/\s*[·|\-]\s*Gemini\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return value.replace(/]/g, '\\]');
}
