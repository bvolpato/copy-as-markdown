/**
 * ChatGPT conversation extractor.
 * Extracts rendered user and assistant turns from shared and live ChatGPT
 * routes, including citations, code, and generated images.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_TURNS = 200;

type Role = 'user' | 'assistant';
type Turn = { role: Role; element: Element; container: Element };

register({
  name: 'ChatGPT',
  matches: [
    '*://chatgpt.com/share/*',
    '*://chatgpt.com/c/*',
    '*://chat.openai.com/share/*',
    '*://chat.openai.com/c/*',
  ],
  pathnameRegex: /^\/(?:share|c)\//,

  buttonPlacement: 'anchor',
  anchor: {
    selector: '#conversation-header-actions',
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
    const url = Utils.getCanonicalUrl();
    const title = cleanTitle(
      document.querySelector('h1')?.textContent?.trim()
      || Utils.getPageTitle(),
    ) || 'ChatGPT Conversation';
    const metadata: Record<string, string | number> = {
      source: 'ChatGPT',
      title,
      url,
      route: conversationRoute(window.location.pathname),
    };

    const model = document.querySelector('[data-message-model-slug], [data-model], [data-model-name]')
      ?.getAttribute('data-message-model-slug')
      || document.querySelector('[data-model]')?.getAttribute('data-model')
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

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Assistant'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const structuralIncomplete = turns.truncated || hasUnrenderedHistory();
    if (!captured) {
      const fallback = document.querySelector('main, [role="main"], [class*="thread"], #__next');
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
        result.push({ role: explicitRole, element: messageContent(root) || root, container: root });
        continue;
      }
      const user = queryFirst(root, [
        '[data-message-author-role="user"]',
        '[data-testid="user-message"]',
        '[data-role="user"]',
      ]);
      const assistant = queryFirst(root, [
        '[data-message-author-role="assistant"]',
        '[data-testid="assistant-message"]',
        '[data-role="assistant"]',
      ]);
      if (user) result.push({ role: 'user', element: messageContent(user) || user, container: root });
      if (assistant) result.push({ role: 'assistant', element: messageContent(assistant) || assistant, container: root });
    }
    return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-message-author-role="user"]',
    '[data-message-author-role="assistant"]',
    '[data-testid="user-message"]',
    '[data-testid="assistant-message"]',
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
    element.getAttribute('data-turn'),
    element.getAttribute('data-message-author-role'),
    element.getAttribute('data-role'),
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    element.className,
  ].filter(Boolean).join(' ').toLowerCase();
  if (/user|human|you|prompt/.test(value)) return 'user';
  if (/assistant|chatgpt|model|response|answer/.test(value)) return 'assistant';
  return null;
}

function messageContent(element: Element): Element | null {
  return queryFirst(element, [
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
  const seenSources = new Set(
    Array.from(content.querySelectorAll<HTMLImageElement>('img[src]'))
      .map(imageSource)
      .filter(Boolean),
  );
  const images: string[] = [];
  container.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    if (content.contains(image) || image.getAttribute('aria-hidden') === 'true') return;
    const source = imageSource(image);
    if (!source || seenSources.has(source)) return;
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
  const clone = Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]', 'textarea',
    '[data-testid="writing-block-header-sticky-container"]',
    '[class*="avatar"]', '[class*="profile"]',
  ]);

  clone.querySelectorAll('[contenteditable="true"]').forEach((editable) => {
    if (!isWritingBlockEditor(editable)) editable.remove();
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
  return element.closest('section[data-testid^="conversation-turn-"], [data-message-id], article') || element;
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
  return /^\/share\//.test(path) ? 'shared' : 'authenticated';
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
  return value.replace(/\s*[·|\-]\s*ChatGPT\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return value.replace(/]/g, '\\]');
}
