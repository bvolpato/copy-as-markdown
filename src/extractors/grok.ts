/** Grok authenticated and shared conversation extractor. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import {
  cloneMessage, conversationPageTitle, conversationUrl, createTurnOwner, hasHistoryControl,
  isAriaHidden, isFaviconUrl, isInText, isPageAnchor, messageToMarkdown, renderedBlocks, type Role,
} from '../core/ai-conversation';

const MAX_TURNS = 200;

type Turn = { role: Role; element: Element; container: Element; blocks?: Element[] };

register({
  name: 'Grok',
  matches: [
    '*://grok.com/*',
    '*://www.grok.com/*',
    '*://x.com/i/grok*',
    '*://mobile.x.com/i/grok*',
    '*://twitter.com/i/grok*',
    '*://mobile.twitter.com/i/grok*',
  ],
  pathnameRegex: /^\/(?:c|chat|conversation|share|imagine|project)(?:\/|$)|^\/i\/grok(?:\/|$)|^\/$/,

  async extract() {
    const title = cleanTitle(conversationPageTitle()) || 'Grok Conversation';
    const metadata: Record<string, string | number> = {
      source: 'Grok',
      title,
      url: conversationUrl(),
      route: conversationRoute(window.location.pathname),
    };
    const model = document.querySelector('[data-model], [data-model-name], [data-message-model]')
      ?.getAttribute('data-model')
      || document.querySelector('[data-model-name]')?.getAttribute('data-model-name')
      || document.querySelector('[data-message-model]')?.getAttribute('data-message-model')
      || '';
    if (model) metadata.model = model;

    const turns = collectTurns();
    const limitedTurns = limitCollection(turns, MAX_TURNS);
    const parts = [`# ${title}`];
    if (model) parts.push('', `**Model:** ${model}`);
    const citationUrls = new Set<string>();
    let userCount = 0;
    let assistantCount = 0;
    let imageCount = 0;
    let codeBlockCount = 0;

    const owns = createTurnOwner(limitedTurns.items);

    for (const turn of limitedTurns.items) {
      const contentNodes = turn.blocks || [turn.element];
      const cleanedNodes = contentNodes.map((node) => clean(node));
      let content = cleanedNodes.map(messageToMarkdown).filter(Boolean).join('\n\n');
      const standalone = standaloneImages(turn.container, contentNodes, (node) => owns(turn, node));
      if (standalone.length) content = `${content}\n\n${standalone.join('\n')}`.trim();
      if (!content) continue;

      const citations = extractCitations(turn.container, (link) => owns(turn, link, turn.role));
      citations.forEach((citation) => citationUrls.add(citation.href));
      if (turn.role === 'user') userCount += 1;
      else assistantCount += 1;
      imageCount += standalone.length;
      for (const node of cleanedNodes) {
        imageCount += node.querySelectorAll('img[src]').length;
        codeBlockCount += node.querySelectorAll('pre').length;
      }

      parts.push('', `## ${turn.role === 'user' ? '👤 User' : '🤖 Grok'}`, '', content);
      if (turn.role === 'assistant' && citations.length) {
        parts.push('', '### Sources', '', ...citations.map((citation) => `- [${citation.label}](${citation.href})`));
      }
    }

    const captured = userCount + assistantCount;
    const loadMore = hasUnrenderedHistory();
    const structuralIncomplete = limitedTurns.truncated || loadMore;
    if (captured) {
      parts.push('', structuralIncomplete
        ? '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.'
        : '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.');
    } else {
      const fallback = document.querySelector('main, [role="main"], #react-root, #__next');
      if (fallback) parts.push('', messageToMarkdown(clean(fallback)));
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
      contentSource: 'Grok rendered conversation DOM',
      total: limitedTurns.total,
      included: captured,
      truncated,
      complete: captured > 0 && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

function collectTurns(): Turn[] {
  const roots = firstElements([
    '[data-testid="conversation-turn"]',
    '[data-testid="message-row"]',
    '[data-testid="message-bubble"]',
    '.message-bubble',
    '[data-message-id]',
    'article[data-role]',
    '.conversation-turn',
  ]);
  const result: Turn[] = [];
  if (roots.length) {
    for (const root of roots) {
      const explicitRole = roleFor(root);
      if (explicitRole) {
        result.push(buildTurn(explicitRole, root, root));
        continue;
      }
      const user = queryFirst(root, [
        '[data-testid="user-message"]',
        '[data-message-author-role="user"]',
        '[data-role="user"]',
      ]);
      const assistant = queryFirst(root, [
        '[data-testid="assistant-message"]',
        '[data-testid="grok-message"]',
        '[data-message-author-role="assistant"]',
        '[data-role="assistant"]',
        '.response-content-markdown',
      ]);
      if (user) result.push(buildTurn('user', user, root));
      if (assistant && assistant !== user) result.push(buildTurn('assistant', assistant, root));
    }
    if (result.length) return dedupeTurns(result);
  }

  const standalone = Array.from(document.querySelectorAll([
    '[data-testid="user-message"]',
    '[data-message-author-role="user"]',
    '[data-role="user"]',
    '[data-testid="assistant-message"]',
    '[data-testid="grok-message"]',
    '[data-message-author-role="assistant"]',
    '[data-role="assistant"]',
    '.response-content-markdown',
  ].join(',')));
  standalone.sort(compareDomOrder);
  for (const element of standalone) {
    const role = roleFor(element);
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
  if (/(?:^|[\s_-])(assistant|grok|model|response|answer)(?:$|[\s_-])/.test(value)) return 'assistant';
  return null;
}

function buildTurn(role: Role, message: Element, container: Element): Turn {
  const blocks = renderedBlocks(Array.from(message.querySelectorAll('.response-content-markdown'))
    .filter((block) => !block.closest('[data-testid="conversation-trace"]')));
  return {
    role,
    element: blocks[0] || messageContent(message) || message,
    container,
    blocks: blocks.length > 1 ? blocks : undefined,
  };
}

function messageContent(element: Element): Element | null {
  return queryFirst(element, [
    '.response-content-markdown',
    '[data-testid="message-content"]',
    '[data-testid="markdown-content"]',
    '[data-testid="response-content"]',
    '.message-bubble',
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
    && (other.blocks || [other.element]).some((block) => block.contains(turn.element))));
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
  const existing = new Set(
    contentNodes
      .flatMap((node) => Array.from(node.querySelectorAll<HTMLImageElement>('img[src]')))
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
    '[class*="toolbar"]:not(.code-toolbar)', '[class*="avatar"]',
    'textarea', 'input', '[contenteditable="true"]', '[data-no-copy]',
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
  return element.closest('[data-testid="conversation-turn"], [data-testid="message-row"], .message-bubble, [data-message-id], article') || element;
}

function compareDomOrder(left: Element, right: Element): number {
  if (left === right) return 0;
  return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

function hasUnrenderedHistory(): boolean {
  return hasHistoryControl() || Boolean(document.querySelector(
    '[data-testid*="load-more"], [data-virtualized="true"]',
  )) || hasUnmountedRows();
}

/** The virtual transcript also unmounts its empty edge rows, which take 212px. The shortest turn takes 48px. */
function hasUnmountedRows(): boolean {
  const rows = Array.from(document.querySelectorAll('[data-plane-row]'));
  const isMounted = (edge: string) => rows.some((row) => row.matches(`[data-plane-row^="transcript:${edge}"]`));
  if (!rows.length || (isMounted('top') && isMounted('bottom'))) return false;
  const mounted = rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0);
  return rows[0].parentElement!.getBoundingClientRect().height - mounted > 240;
}

function conversationRoute(path: string): string {
  if (/\/(?:share|shared)\//.test(path) || /\/i\/grok\/share\//.test(path)) return 'shared';
  if (/^\/project(?:\/|$)/.test(path)) return 'project';
  if (/^\/(?:c|chat)\//.test(path)) return 'authenticated';
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
  return value.replace(/(?:^|\s*[·|\-])\s*(?:Shared\s+)?Grok(?:\s+Conversation)?\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
