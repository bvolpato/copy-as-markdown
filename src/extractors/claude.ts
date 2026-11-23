/**
 * Claude.ai conversation extractor.
 * Captures rendered user and assistant turns, citations, images, and code.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_TURNS = 200;

type Role = 'user' | 'assistant';
type Turn = { role: Role; element: Element; container: Element; blocks?: Element[] };

register({
  name: 'Claude',
  matches: [
    '*://claude.ai/chat/*',
    '*://claude.ai/share/*',
    '*://claude.ai/project/*',
    '*://claude.ai/new*',
    '*://claude.ai/public/artifacts/*',
    '*://claude.ai/artifacts/*',
  ],
  pathnameRegex: /^\/(?:chat|share|project|artifacts)\/|^\/public\/artifacts\/|^\/new(?:\/|$)/,

  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="wiggle-controls-actions"], [data-testid="chat-header-actions"], header [data-testid*="share"], main header',
    position: 'overlay',
    style: 'icon',
    css: {
      borderRadius: '8px',
      padding: '8px',
    },
  },

  async extract() {
    const title = cleanTitle(Utils.getPageTitle()) || 'Claude Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Claude',
      title,
      url: Utils.getCanonicalUrl(),
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

    for (const turn of turns.items) {
      const contentNodes = turn.blocks && turn.blocks.length > 0 ? turn.blocks : [turn.element];
      const cleanedNodes = contentNodes.map((node) => clean(node));
      let content = cleanedNodes
        .map((node) => Markdown.elementToMarkdown(node))
        .filter(Boolean)
        .join('\n\n')
        .trim();
      const images = standaloneImages(turn.container, contentNodes);
      if (images.length) content = `${content}\n\n${images.join('\n')}`.trim();
      if (!content) continue;

      const citations = extractCitations(turn.container);
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += cleanedNodes.reduce((sum, node) => sum + node.querySelectorAll('img[src]').length, 0) + images.length;
      codeBlockCount += cleanedNodes.reduce((sum, node) => sum + node.querySelectorAll('pre').length, 0);

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Claude'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const structuralIncomplete = turns.truncated || hasUnrenderedHistory();
    if (!captured) {
      const fallback = document.querySelector('[data-autoscroll-container], main, [role="main"], #__next');
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
      contentSource: 'Claude rendered conversation DOM',
      total: turns.total,
      included: captured,
      truncated,
      complete: captured > 0 && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

const MARKDOWN_BLOCK_SELECTOR = '.standard-markdown, .progressive-markdown, .markdown, .prose';

function extractModel(): string {
  const dataModel = document.querySelector('[data-model]')?.getAttribute('data-model')?.trim();
  if (dataModel) return dataModel;
  const dataModelName = document.querySelector('[data-model-name]')?.getAttribute('data-model-name')?.trim();
  if (dataModelName) return dataModelName;
  const isVisible = Utils.createVisibilityChecker();
  for (const el of document.querySelectorAll('[data-testid*="model"]')) {
    if (!isVisible(el)) continue;
    const text = normalize(el.textContent || '');
    if (text && text.length <= 100) return text;
  }
  return '';
}

function topLevelBlocks(root: Element, selector: string): Element[] {
  const matches = Array.from(root.querySelectorAll(selector));
  return matches.filter((node) => !matches.some((other) => other !== node && other.contains(node)));
}

function buildTurn(role: Role, target: Element, container: Element): Turn {
  if (role === 'assistant') {
    const contentContainer = queryFirst(target, [
      '[data-testid="message-content"]',
      '[data-testid*="message-content"]',
    ]);
    const scope = contentContainer || target;
    const blocks = topLevelBlocks(scope, MARKDOWN_BLOCK_SELECTOR);
    if (blocks.length > 1) {
      return { role, element: scope, container, blocks };
    }
    if (blocks.length === 1) {
      return { role, element: blocks[0], container };
    }
    return { role, element: scope, container };
  }
  return { role, element: messageContent(target) || target, container };
}

function collectTurns(): Turn[] {
  const result: Turn[] = [];
  const roots = firstElements([
    '[data-message-id]',
    '[role="article"]',
    '[data-testid="message"]',
    '[data-role="user"], [data-role="assistant"]',
  ]);

  if (roots.length) {
    for (const root of roots) {
      const explicitRole = roleFor(root);
      if (explicitRole) {
        result.push(buildTurn(explicitRole, root, root));
        continue;
      }
      const user = queryFirst(root, [
        '[data-testid="user-message"]',
        '[data-user-message]',
        '[data-message-author-role="user"]',
        '[data-role="user"]',
      ]);
      if (user) {
        result.push(buildTurn('user', user, root));
      }
      const assistant = queryFirst(root, [
        '[data-testid="assistant-message"]',
        '[data-testid*="assistant-message"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
      ]);
      if (assistant && assistant !== user) {
        result.push(buildTurn('assistant', assistant, root));
      } else if (!assistant) {
        const markdownBlocks = topLevelBlocks(root, '.standard-markdown, .progressive-markdown')
          .filter((block) => !user || !user.contains(block));
        if (markdownBlocks.length > 1) {
          result.push({ role: 'assistant', element: markdownBlocks[0], container: root, blocks: markdownBlocks });
        } else if (markdownBlocks.length === 1) {
          result.push({ role: 'assistant', element: markdownBlocks[0], container: root });
        }
      }
    }
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-testid="user-message"]',
    '[data-user-message]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-testid="assistant-message"]',
    '[data-testid*="assistant-message"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.standard-markdown',
    '.progressive-markdown',
  ].join(',')));
  standalone.sort(compareDomOrder);
  for (const element of standalone) {
    const className = typeof element.className === 'string' ? element.className : '';
    const role = roleFor(element) || (/standard-markdown|progressive-markdown/i.test(className) ? 'assistant' : null);
    if (!role) continue;
    result.push(buildTurn(role, element, closestTurn(element)));
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
  if (/(?:^|[\s_-])(assistant|claude|model|response|answer|standard-markdown|progressive-markdown)(?:$|[\s_-])/.test(value)) return 'assistant';
  return null;
}

function messageContent(element: Element): Element | null {
  return queryFirst(element, [
    '[data-testid="user-message"]',
    '[data-testid="message-content"]',
    '[data-testid*="message-content"]',
    '.standard-markdown',
    '.progressive-markdown',
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
    && other.element !== turn.element
    && (other.element.contains(turn.element)
      || Boolean(other.blocks?.some((block) => block === turn.element || block.contains(turn.element))))));
}

function extractCitations(container: Element): Array<{ label: string; href: string }> {
  const links = container.querySelectorAll<HTMLAnchorElement>([
    'a[data-citation][href]',
    '[data-testid*="citation"] a[href]',
    '[data-testid*="source"] a[href]',
    '[data-find-omitted] a[href]',
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

function standaloneImages(container: Element, contentNodes: Element[]): string[] {
  const existing = new Set(
    contentNodes
      .flatMap((node) => Array.from(node.querySelectorAll<HTMLImageElement>('img[src]')))
      .map((image) => safeImageUrl(imageSource(image)))
      .filter(Boolean),
  );
  const result: string[] = [];
  for (const image of container.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (contentNodes.some((node) => node.contains(image)) || image.getAttribute('aria-hidden') === 'true') continue;
    const source = safeImageUrl(imageSource(image));
    if (!source || existing.has(source)) continue;
    const alt = image.getAttribute('alt') || '';
    const meaningful = Boolean(image.closest('figure, [data-find-omitted] .grid, [data-testid*="image"], [class*="image"]'))
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
    'button', 'h2.sr-only[data-find-omitted]', '[data-message-action-bar]',
    '[data-testid*="actions"]', '[data-testid*="feedback"]',
    '[class*="toolbar"]:not(.code-toolbar)', '[class*="avatar"]', 'textarea',
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
  return element.closest('[role="article"], [data-message-id], [data-testid*="message"]') || element;
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
  if (/^\/share\//.test(path)) return 'shared';
  if (/^\/project\//.test(path)) return 'project';
  if (/^\/(?:public\/)?artifacts\//.test(path)) return 'artifact';
  if (/^\/new(?:\/|$)/.test(path)) return 'new';
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
  return value.replace(/\s*[·|\-]\s*Claude(?:\.ai)?\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
