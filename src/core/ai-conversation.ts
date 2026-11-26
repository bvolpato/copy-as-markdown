/** Shared rendered-DOM extraction for AI conversation products. */

import { addExtractionMetadata, limitCollection, limitMarkdown } from './context';
import * as Markdown from './markdown';
import { register } from './registry';
import type { Extractor, ExtractorConfig, PageMetadata } from './types';
import * as Utils from './utils';

export type Role = 'user' | 'assistant';
export type Turn = { role: Role; element: Element; container: Element };

export interface VisibleValueSelector {
  selector: string;
  attributes?: string[];
}

export interface AiConversationConfig {
  name: string;
  source: string;
  assistantLabel: string;
  matches: string[];
  pathnameRegex: RegExp;
  route: (pathname: string) => string;
  titleFallback: string;
  titleSuffix: RegExp;
  contentSource: string;
  turnRootSelectors: string[];
  userSelectors: string[];
  assistantSelectors: string[];
  contentSelectors: string[];
  fallbackSelectors: string[];
  titleSelectors?: string[];
  modelSelectors?: VisibleValueSelector[];
  workspaceSelectors?: VisibleValueSelector[];
  citationSelectors?: string[];
  attachmentSelectors?: string[];
  sourceCardSelectors?: string[];
  artifactSelectors?: string[];
  systemInstructionSelectors?: string[];
  unrenderedHistorySelectors?: string[];
  resolveRole?: (element: Element) => Role | null;
  resolveContent?: (element: Element, role: Role) => Element | null;
  regex?: RegExp;
  detect?: ExtractorConfig['detect'];
  extensionPageButton?: boolean;
  buttonPlacement?: ExtractorConfig['buttonPlacement'];
  anchor?: ExtractorConfig['anchor'];
}

const DEFAULT_CITATION_SELECTORS = [
  'a[data-citation][href]',
  '[data-testid*="citation"] a[href]',
  '[data-testid*="source"] a[href]',
  '[data-source] a[href]',
  '[class*="citation"] a[href]',
  'sup a[href]',
];

const DEFAULT_ATTACHMENT_SELECTORS = [
  'a[download][href]',
  '[data-testid*="attachment"] a[href]',
  '[data-testid*="file"] a[href]',
  '[class*="attachment"] a[href]',
  '[class*="file-card"] a[href]',
];

const DEFAULT_UNRENDERED_SELECTORS = [
  '[data-testid*="load-more"]',
  '[data-virtualized="true"]',
  '[class*="virtual-scroll"]',
  'cdk-virtual-scroll-viewport',
];

// Branch, draft, and carousel arrows also say "previous", and "folder" contains "older".
const HISTORY_CONTROL_LABEL = /\bolder\b|^load\b.*\bprevious\b|\bprevious (?:\w+ )?(?:messages|turns|history|replies)\b|\b(?:show|view|see) previous$/i;
const FAVICON_URL = /^https?:\/\/(?:www\.google\.[a-z.]+\/s2\/favicons|t\d+\.gstatic\.com\/faviconV2|icons\.duckduckgo\.com\/)|\/favicon\.(?:ico|png|svg)(?:[?#]|$)/i;
const MATH_SELECTOR = '.math-inline[data-math], .math-block[data-math], [data-math-source], .katex, math';
const CODE_HEADER_SELECTOR = '.code-block-decoration, .md-code-block-banner-wrap, .md-code-block-banner';

export function registerAiConversationExtractor(config: AiConversationConfig): Extractor {
  return register({
    name: config.name,
    matches: config.matches,
    regex: config.regex,
    pathnameRegex: config.pathnameRegex,
    detect: config.detect,
    extensionPageButton: config.extensionPageButton,
    buttonPlacement: config.buttonPlacement,
    anchor: config.anchor,

    async extract() {
      const prevCache = activeExtractionCache;
      activeExtractionCache = createExtractionCache();
      try {
        return await extractConversation(config);
      } finally {
        activeExtractionCache = prevCache;
      }
    },
  });
}

async function extractConversation(config: AiConversationConfig): Promise<string> {
      const title = conversationTitle(config);
      const metadata: PageMetadata = {
        source: config.source,
        title,
        url: conversationUrl(),
        route: config.route(window.location.pathname),
      };
      const model = readVisibleValue(config.modelSelectors || []);
      const workspace = readVisibleValue(config.workspaceSelectors || []);
      if (model) metadata.model = model;
      if (workspace) metadata.workspace = workspace;

      const turns = limitCollection(collectTurns(config));
      const parts = [`# ${title}`];
      if (model) parts.push('', `**Model:** ${model}`);
      if (workspace) parts.push('', `**Workspace:** ${workspace}`);

      const systemInstructions = collectSectionMarkdown(
        config.systemInstructionSelectors || [],
        true,
      );
      if (systemInstructions.length) {
        parts.push('', '## System instructions', '', ...systemInstructions);
      }

      const citationUrls = new Set<string>();
      let userCount = 0;
      let assistantCount = 0;
      let imageCount = 0;
      let codeBlockCount = 0;
      const capturedTurnContent: Element[] = [];
      const owns = createTurnOwner(turns.items);

      for (const turn of turns.items) {
        const cleaned = clean(turn.element, true);
        let content = messageToMarkdown(cleaned);
        const ownsNode = (node: Element) => owns(turn, node);
        const images = standaloneImages(turn.container, turn.element, ownsNode);
        const citations = extractCitations(
          turn.container,
          config.citationSelectors || [],
          (link) => owns(turn, link, turn.role),
        );
        const attachments = standaloneAttachments(
          turn.container,
          turn.element,
          citations.map(({ href }) => href),
          config.attachmentSelectors || [],
          ownsNode,
        );
        if (images.length) content = `${content}\n\n${images.join('\n')}`.trim();
        if (attachments.length) {
          content = `${content}\n\n### Files\n\n${attachments.join('\n')}`.trim();
        }
        if (!content) continue;
        capturedTurnContent.push(turn.element);

        citations.forEach(({ href }) => citationUrls.add(href));
        if (turn.role === 'user') userCount += 1;
        else assistantCount += 1;
        imageCount += cleaned.querySelectorAll('img[src]').length + images.length;
        codeBlockCount += cleaned.querySelectorAll('pre').length;

        parts.push(
          '',
          `## ${turn.role === 'user' ? '👤 User' : `🤖 ${config.assistantLabel}`}`,
          '',
          content,
        );
        if (turn.role === 'assistant' && citations.length) {
          parts.push(
            '',
            '### Sources',
            '',
            ...citations.map(({ label, href }) => `- [${label}](${href})`),
          );
        }
      }

      const sourceCards = collectSourceCards(
        config.sourceCardSelectors || [],
        capturedTurnContent,
      );
      if (sourceCards.length) parts.push('', '## Sources', '', ...sourceCards);

      const artifacts = collectSectionMarkdown(
        config.artifactSelectors || [],
        true,
        capturedTurnContent,
      );
      if (artifacts.length) parts.push('', '## Artifacts', '', ...artifacts);

      const captured = userCount + assistantCount;
      const structuralIncomplete = turns.truncated || hasUnrenderedHistory(config, turns.items);
      parts.push(
        '',
        structuralIncomplete
          ? '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.'
          : '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.',
      );
      if (!captured) {
        const fallback = queryFirst(document, config.fallbackSelectors);
        if (fallback) {
          const fallbackMarkdown = messageToMarkdown(clean(fallback));
          if (fallbackMarkdown) parts.push('', fallbackMarkdown);
        }
      }

      metadata.turn_count = captured;
      metadata.user_turn_count = userCount;
      metadata.assistant_turn_count = assistantCount;
      metadata.citation_count = citationUrls.size;
      metadata.image_count = imageCount;
      metadata.code_block_count = codeBlockCount;
      metadata.source_card_count = sourceCards.length;
      metadata.artifact_count = artifacts.length;
      metadata.completeness = 'visible_only';

      const output = limitMarkdown(parts.join('\n'));
      const truncated = structuralIncomplete || output.truncated;
      if (output.truncated) metadata.completeness = 'truncated_by_limit';
      addExtractionMetadata(metadata, {
        contentSource: config.contentSource,
        total: turns.total,
        included: captured,
        truncated,
        complete: false,
      });
      return Markdown.buildPageMarkdown(metadata, output.markdown);
}

/** App shells can keep a site-wide canonical link after a client-side navigation. */
export function conversationUrl(): string {
  const canonical = Utils.getCanonicalUrl();
  const trimmed = (pathname: string) => pathname.replace(/\/+$/, '');
  try {
    if (trimmed(new URL(canonical).pathname) === trimmed(window.location.pathname)) return canonical;
  } catch {
    // Fall back to the address bar.
  }
  return window.location.href;
}

/** App shells update the document title, but can keep a site-wide Open Graph title. */
export function conversationPageTitle(): string {
  return document.title.trim() || Utils.getPageTitle();
}

export function hasHistoryControl(): boolean {
  return historyControls().length > 0;
}

function historyControls(): Element[] {
  return queryAll(document, ['button[aria-label]'])
    .filter((button) => HISTORY_CONTROL_LABEL.test((button.getAttribute('aria-label') || '').trim()));
}

/** Footnote references only point at another part of the same page. */
export function isPageAnchor(link: Element): boolean {
  return (link.getAttribute('href') || '').trim().startsWith('#');
}

export function isFaviconUrl(value: string): boolean {
  return FAVICON_URL.test(value);
}

export function isAriaHidden(container: Element, node: Element): boolean {
  const hidden = node.closest('[aria-hidden="true"]');
  return hidden !== null && composedContains(container, hidden);
}

/** Cleaning removes controls, so an image inside a button is not part of the message text. */
export function isInText(contentNodes: Element[], node: Element): boolean {
  const control = node.closest('button');
  return contentNodes.some((content) => (
    composedContains(content, node)
    && !isAriaHidden(content, node)
    && (!control || control === content || !composedContains(content, control))
  ));
}

/**
 * Content beside the messages of a shared container belongs to one turn: the
 * nearest message in the tree, or the closest one before it.
 */
export function createTurnOwner<T extends Turn>(
  turns: T[],
): (turn: T, node: Element, role?: Role) => boolean {
  type Group = { candidates: T[]; owners: Map<Element, T | null> };
  const groups = new Map<Element, Record<Role | 'any', Group>>();
  const groupOf = (candidates: T[]): Group => ({ candidates, owners: new Map() });
  return (turn, node, role) => {
    let group = groups.get(turn.container);
    if (!group) {
      const inside = turns.filter((candidate) => composedContains(turn.container, candidate.element));
      group = {
        any: groupOf(inside),
        user: groupOf(inside.filter((candidate) => candidate.role === 'user')),
        assistant: groupOf(inside.filter((candidate) => candidate.role === 'assistant')),
      };
      groups.set(turn.container, group);
    }
    const { candidates, owners } = group[role || 'any'];
    if (candidates.length < 2) return true;
    let owner = owners.get(node);
    if (owner === undefined) {
      owner = nearestTurn(candidates, node);
      owners.set(node, owner);
    }
    return owner === turn;
  };
}

function nearestTurn<T extends Turn>(candidates: T[], node: Element): T | null {
  const distances = new Map<Element, number>();
  for (let current: Element | null = node; current; current = composedParent(current)) {
    distances.set(current, distances.size);
  }
  let owner: T | null = null;
  let nearest = Infinity;
  for (const candidate of candidates) {
    let shared: Element | null = candidate.element;
    while (shared && !distances.has(shared)) shared = composedParent(shared);
    const distance = shared ? distances.get(shared)! : Infinity;
    const precedes = candidate.element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (distance < nearest || (distance === nearest && precedes)) {
      owner = candidate;
      nearest = distance;
    }
  }
  return owner;
}

/** Keep the outermost rendered blocks. Behind a dialog the whole page is hidden, so keep them all. */
export function renderedBlocks(blocks: Element[]): Element[] {
  const outer = blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
  const isVisible = Utils.createVisibilityChecker();
  const visible = outer.filter((block) => isVisible(block));
  return visible.length ? visible : outer;
}

/** Clone a message with literal line breaks, TeX math, and labeled code fences. */
export function cloneMessage(element: Element): Element {
  const clone = element.cloneNode(true) as Element;
  const sourceText = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const cloneText = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const literal = new Map<Element, boolean>();
  while (sourceText.nextNode() && cloneText.nextNode()) {
    cloneText.currentNode.textContent = renderedText(sourceText.currentNode, literal);
  }
  replaceMath(clone);
  absorbCodeHeaders(clone);
  removeFavicons(clone);
  return clone;
}

/** Convert a cloned message whose text nodes already have their rendered whitespace. */
export function messageToMarkdown(clone: Element): string {
  const markdown = Markdown.cleanMarkdown(
    Markdown.nodeToMarkdown(clone, { preserveWhitespace: true }),
  );
  return clone.querySelector('pre') ? markdown : closeFence(markdown);
}

/** Collapse whitespace like the browser does, but keep it where the page renders it. */
function renderedText(node: Node, literal: Map<Element, boolean>): string {
  const value = node.textContent || '';
  const root = node.parentElement ? null : node.getRootNode();
  const parent = node.parentElement || (root instanceof ShadowRoot ? root.host : null);
  if (!parent) return value;
  let keep = literal.get(parent);
  if (keep === undefined) {
    const whiteSpace = parent.ownerDocument.defaultView?.getComputedStyle(parent).whiteSpace || '';
    keep = /^(?:pre|break-spaces)/.test(whiteSpace) || parent.closest('pre') !== null;
    literal.set(parent, keep);
  }
  return keep ? value : value.replace(/\s+/g, ' ');
}

/** Close an unfinished fence in literal text, which would swallow the next turns. */
function closeFence(markdown: string): string {
  let open = '';
  for (const line of markdown.split('\n')) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence) continue;
    if (!open) {
      if (fence[1][0] === '~' || !fence[2].includes('`')) open = fence[1];
    } else if (fence[1].startsWith(open) && !fence[2].trim()) {
      open = '';
    }
  }
  return open ? `${markdown.trimEnd()}\n${open}` : markdown;
}

/** Replace rendered math with its TeX source. The conversion repeats or drops it otherwise. */
export function replaceMath(root: Element): void {
  for (const element of root.querySelectorAll(MATH_SELECTOR)) {
    if (!root.contains(element)) continue;
    const replacement = mathReplacement(element);
    if (replacement) element.replaceWith(replacement);
  }
}

function mathReplacement(element: Element): Element | null {
  if (!element.matches(MATH_SELECTOR)) return null;
  const tex = (element.getAttribute('data-math')
    || element.getAttribute('data-math-source')
    || element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    || '').replace(/\s+/g, ' ').trim();
  if (!tex) return null;
  const display = element.matches('.math-block, .katex-display .katex, math[display="block"]')
    || element.querySelector('.katex-display, math[display="block"]') !== null;
  if (element.closest('td, th')) {
    // Table cells escape the backslashes of prose, but not those of code.
    const code = element.ownerDocument.createElement('code');
    const cell = element.ownerDocument.createElement('span');
    code.textContent = tex;
    cell.append('$', code, '$');
    return cell;
  }
  const replacement = element.ownerDocument.createElement(display ? 'div' : 'span');
  replacement.textContent = display ? `$$${tex}$$` : `$${tex}$`;
  return replacement;
}

/** Move a visible language label into its code fence, so that it does not read as prose. */
function absorbCodeHeaders(root: Element): void {
  for (const pre of root.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    const declared = code?.getAttribute('data-code-language') || '';
    const language = declared
      || [code, pre].map((element) => (
        element?.getAttribute('data-language')
        || element?.className.match(/\blanguage-([\w.+#-]+)/)?.[1]
        || ''
      )).find(Boolean)
      || '';
    if (declared) pre.setAttribute('data-language', declared);

    let current: Element = pre;
    for (let depth = 0; depth < 3 && current !== root; depth += 1) {
      let header = current.previousElementSibling;
      while (header && !header.matches(CODE_HEADER_SELECTOR) && !headerLabel(header)) {
        header = header.previousElementSibling;
      }
      if (header) {
        const label = headerLabel(header);
        const isHeader = header.matches(CODE_HEADER_SELECTOR) || (
          /^(?:DIV|SPAN)$/.test(header.tagName) && label.toLowerCase() === language.toLowerCase()
        );
        if (isHeader) {
          if (!language && /^[\w.+#-]+$/.test(label)) pre.setAttribute('data-language', label.toLowerCase());
          header.remove();
        }
        break;
      }
      if (!current.parentElement) break;
      current = current.parentElement;
    }
  }
}

function headerLabel(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('button, svg, [role="button"]').forEach((control) => control.remove());
  return normalize(clone.textContent || '');
}

function removeFavicons(root: Element): void {
  root.querySelectorAll('img[src]').forEach((image) => {
    if (isFaviconUrl(image.getAttribute('src') || '')) image.remove();
  });
}

type ExtractionCache = {
  elementOrder: Map<Element, number> | null;
  visibility: (element: Element) => boolean;
  scopes: WeakMap<ParentNode, ParentNode[]>;
};

let activeExtractionCache: ExtractionCache | null = null;

function createExtractionCache(): ExtractionCache {
  const checkVisibility = Utils.createVisibilityChecker();
  return {
    elementOrder: null,
    visibility: (element: Element) => checkVisibility(element),
    scopes: new WeakMap<ParentNode, ParentNode[]>(),
  };
}

function collectTurns(config: AiConversationConfig): Turn[] {
  const roots = sortElements(queryAll(document, config.turnRootSelectors))
    .filter(isComputedVisible);
  const result: Turn[] = [];

  if (roots.length) {
    for (const root of roots) {
      const explicitRole = config.resolveRole?.(root) || roleFor(root);
      if (explicitRole) {
        result.push({
          role: explicitRole,
          element: config.resolveContent?.(root, explicitRole)
            || messageContent(root, config.contentSelectors)
            || root,
          container: root,
        });
        continue;
      }

      const user = queryFirst(root, config.userSelectors);
      const assistant = queryFirst(root, config.assistantSelectors);
      if (user) {
        result.push({
          role: 'user',
          element: config.resolveContent?.(user, 'user')
            || messageContent(user, config.contentSelectors)
            || user,
          container: root,
        });
      }
      if (assistant) {
        result.push({
          role: 'assistant',
          element: config.resolveContent?.(assistant, 'assistant')
            || messageContent(assistant, config.contentSelectors)
            || assistant,
          container: root,
        });
      }
    }
  }

  const standalone = sortElements(queryAll(document, [
    ...config.userSelectors,
    ...config.assistantSelectors,
  ])).filter(isComputedVisible);
  for (const element of standalone) {
    const role = matchesAny(element, config.userSelectors)
      ? 'user'
      : matchesAny(element, config.assistantSelectors)
        ? 'assistant'
        : config.resolveRole?.(element) || roleFor(element);
    if (!role) continue;
    result.push({
      role,
      element: config.resolveContent?.(element, role)
        || messageContent(element, config.contentSelectors)
        || element,
      container: closestTurn(element, config.turnRootSelectors),
    });
  }
  return dedupeTurns(sortTurns(result.filter((turn) => isComputedVisible(turn.element))));
}

function roleFor(element: Element): Role | null {
  const value = [
    element.getAttribute('data-role'),
    element.getAttribute('data-author'),
    element.getAttribute('data-message-author-role'),
    element.getAttribute('data-message-role'),
    element.getAttribute('data-turn-role'),
    element.getAttribute('source'),
    element.getAttribute('type'),
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    element.tagName,
    typeof element.className === 'string' ? element.className : '',
  ].filter(Boolean).join(' ').toLowerCase();
  const isExplicitUser = /(?:^|[\s_-])(user|human|you)(?:$|[\s_-])/.test(value);
  const isAssistant = /(?:^|[\s_-])(assistant|bot|copilot|model|response|answer|output)(?:$|[\s_-])/.test(value);
  if (isExplicitUser && !isAssistant) return 'user';
  if (isAssistant && !isExplicitUser) return 'assistant';
  if (isExplicitUser) return 'user';
  if (/(?:^|[\s_-])(prompt|query)(?:$|[\s_-])/.test(value)) return 'user';
  return null;
}

function messageContent(element: Element, selectors: string[]): Element | null {
  if (matchesAny(element, selectors)) return element;
  return queryFirst(element, selectors);
}

function dedupeTurns(turns: Turn[]): Turn[] {
  const seenElements = new Set<Element>();
  const selected: Turn[] = [];
  const containerRoles = new Map<Element, Map<Role, number>>();
  for (const turn of turns) {
    if (seenElements.has(turn.element)) continue;
    seenElements.add(turn.element);

    const roles = containerRoles.get(turn.container) || new Map<Role, number>();
    const existingIndex = roles.get(turn.role);
    if (existingIndex !== undefined) {
      if (turnContentScore(turn) > turnContentScore(selected[existingIndex])) {
        selected[existingIndex] = turn;
      }
      continue;
    }
    roles.set(turn.role, selected.length);
    containerRoles.set(turn.container, roles);
    selected.push(turn);
  }
  return sortTurns(selected);
}

function turnContentScore(turn: Turn): number {
  return normalize(turn.element.textContent || '').length
    + queryAll(turn.element, ['img[src]', 'pre', 'code']).length * 100;
}

function extractCitations(
  container: Element,
  siteSelectors: string[],
  ownsNode: (node: Element) => boolean,
): Array<{ label: string; href: string }> {
  const links = sortElements(queryAll<HTMLAnchorElement>(container, [
    ...siteSelectors,
    ...DEFAULT_CITATION_SELECTORS,
  ]));
  const seen = new Set<string>();
  const citations: Array<{ label: string; href: string }> = [];
  for (const link of links) {
    if (!isComputedVisible(link) || isPageAnchor(link) || !ownsNode(link)) continue;
    const href = safeHttpUrl(link.href);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = normalize(link.textContent || '')
      || normalize(link.getAttribute('aria-label') || '')
      || hostname(href);
    citations.push({ label: Markdown.escapeMarkdownLinkText(label), href });
  }
  return citations;
}

function standaloneAttachments(
  container: Element,
  content: Element,
  citationUrls: string[],
  siteSelectors: string[],
  ownsNode: (node: Element) => boolean,
): string[] {
  const citations = new Set(citationUrls);
  const seen = new Set<string>();
  const attachments: string[] = [];
  for (const link of sortElements(queryAll<HTMLAnchorElement>(container, [
    ...siteSelectors,
    ...DEFAULT_ATTACHMENT_SELECTORS,
  ]))) {
    if (!isComputedVisible(link) || composedContains(content, link) || !ownsNode(link)) continue;
    const href = safeHttpUrl(link.href);
    if (!href || citations.has(href) || seen.has(href)) continue;
    seen.add(href);
    const label = normalize(link.textContent || '')
      || link.getAttribute('download')?.trim()
      || filename(href)
      || 'Attached file';
    attachments.push(`- [${Markdown.escapeMarkdownLinkText(label)}](${href})`);
  }
  return attachments;
}

function standaloneImages(
  container: Element,
  content: Element,
  ownsNode: (node: Element) => boolean,
): string[] {
  const inText = (image: Element) => isComputedVisible(image) && isInText([content], image);
  const existing = new Set(
    queryAll<HTMLImageElement>(content, ['img[src]'])
      .filter(inText)
      .map(imageSource)
      .map(safeImageUrl)
      .filter(Boolean),
  );
  const images: string[] = [];
  for (const image of sortElements(queryAll<HTMLImageElement>(container, ['img[src]']))) {
    if (!isComputedVisible(image) || inText(image) || !ownsNode(image)) continue;
    const source = safeImageUrl(imageSource(image));
    if (!source || existing.has(source) || isFaviconUrl(source)) continue;
    const alt = image.getAttribute('alt') || '';
    const rect = image.getBoundingClientRect();
    const size = Math.max(
      image.naturalWidth,
      image.naturalHeight,
      image.width,
      image.height,
      rect.width,
      rect.height,
    );
    const meaningful = Boolean(image.closest(
      'figure, [data-testid*="image"], [data-testid*="media"], [class*="generated"], [class*="attachment"]',
    )) || /generated|uploaded|attachment|image/i.test(alt) || size >= 100;
    if (!meaningful) continue;
    existing.add(source);
    images.push(`![${Markdown.escapeMarkdownLinkText(alt)}](${source})`);
  }
  return images;
}

function collectSectionMarkdown(
  selectors: string[],
  keepEditable: boolean,
  excludedRoots: Element[] = [],
): string[] {
  const sections: string[] = [];
  const seen = new Set<string>();
  const elements = sortElements(queryAll(document, selectors))
    .filter((element, _index, candidates) => !candidates.some(
      (candidate) => candidate !== element && composedContains(candidate, element),
    ));
  for (const element of elements) {
    if (!isComputedVisible(element)) continue;
    if (excludedRoots.some((root) => composedContains(root, element))) continue;
    const value = editableValue(element)
      || Markdown.elementToMarkdown(clean(element, keepEditable));
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sections.push(value.trim());
  }
  return sections;
}

function collectSourceCards(selectors: string[], excludedRoots: Element[]): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const element of sortElements(queryAll(document, selectors))) {
    if (!isComputedVisible(element)) continue;
    if (excludedRoots.some((root) => composedContains(root, element))) continue;
    const cleaned = clean(element, true);
    const text = normalize(cleaned.textContent || '');
    const link = queryAll<HTMLAnchorElement>(element, ['a[href]'])
      .find((candidate) => isComputedVisible(candidate));
    const href = link ? safeHttpUrl(link.href) : '';
    const identity = sourceIdentity(element);
    const label = text || identity;
    if (!label) continue;
    const suffix = identity && !normalize(label).includes(identity)
      ? ` (source: ${Markdown.escapeMarkdownLinkText(identity)})`
      : '';
    const value = href
      ? `- [${Markdown.escapeMarkdownLinkText(label)}](${href})${suffix}`
      : `- ${Markdown.escapeMarkdownLinkText(label)}${suffix}`;
    const key = normalize(value);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(value);
  }
  return sources;
}

function sourceIdentity(element: Element): string {
  for (const attribute of ['data-source-id', 'data-file-id', 'data-drive-id', 'data-id']) {
    const value = normalize(element.getAttribute(attribute) || '');
    if (value && value.length <= 160) return value;
  }
  return '';
}

function editableValue(element: Element): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value.trim();
  }
  return '';
}

function clean(element: Element, keepEditable = false): Element {
  const clone = cloneVisibleRenderedElement(element, new Map());
  absorbCodeHeaders(clone);
  removeFavicons(clone);
  const noiseSelectors = [
    ...Utils.NOISE_SELECTORS,
    'button',
    '[data-testid*="actions"]',
    '[data-testid*="feedback"]',
    '[class*="toolbar"]:not(.code-toolbar)',
    '[class*="avatar"]',
    '[class*="profile"]',
    ...(keepEditable ? [] : ['textarea', 'input', '[contenteditable="true"]']),
  ];
  for (const selector of noiseSelectors) {
    clone.querySelectorAll(selector).forEach((el) => el.remove());
  }
  matchingElements<HTMLAnchorElement>(clone, 'a[href]').forEach((link) => {
    const href = safeLinkUrl(link.getAttribute('href') || '');
    if (href) link.setAttribute('href', href);
    else link.removeAttribute('href');
  });
  matchingElements<HTMLImageElement>(clone, 'img[src]').forEach((image) => {
    const source = safeImageUrl(image.getAttribute('src') || '');
    if (!source) {
      image.remove();
      return;
    }
    image.setAttribute('src', source);
  });
  return clone;
}

function matchingElements<T extends Element>(element: Element, selector: string): T[] {
  return [
    ...(element.matches(selector) ? [element as T] : []),
    ...element.querySelectorAll<T>(selector),
  ];
}

function cloneVisibleRenderedElement(element: Element, literal: Map<Element, boolean>): Element {
  const clone = element.cloneNode(false) as Element;
  appendVisibleRenderedChildren(element, clone, literal);
  return clone;
}

function appendVisibleRenderedChildren(
  source: Element,
  target: Element,
  literal: Map<Element, boolean>,
): void {
  const nodes = source.shadowRoot
    ? Array.from(source.shadowRoot.childNodes)
    : Array.from(source.childNodes);
  for (const node of nodes) {
    if (node instanceof HTMLSlotElement) {
      if (!isComputedVisible(node)) continue;
      const assigned = node.assignedNodes({ flatten: true });
      for (const assignedNode of assigned.length ? assigned : Array.from(node.childNodes)) {
        appendVisibleRenderedNode(assignedNode, target, literal);
      }
      continue;
    }
    appendVisibleRenderedNode(node, target, literal);
  }
}

function appendVisibleRenderedNode(
  source: Node,
  target: Element,
  literal: Map<Element, boolean>,
): void {
  if (source instanceof Element) {
    if (!isComputedVisible(source)) return;
    target.append(mathReplacement(source) || cloneVisibleRenderedElement(source, literal));
    return;
  }
  const clone = source.cloneNode(true);
  if (source.nodeType === Node.TEXT_NODE) clone.textContent = renderedText(source, literal);
  target.append(clone);
}

function readVisibleValue(selectors: VisibleValueSelector[]): string {
  for (const descriptor of selectors) {
    for (const element of queryAll(document, [descriptor.selector])) {
      if (!isComputedVisible(element)) continue;
      for (const attribute of descriptor.attributes || []) {
        const value = normalize(element.getAttribute(attribute) || '');
        if (value && value.length <= 160) return value;
      }
      const text = normalize(element.textContent || '');
      if (text && text.length <= 160) return text;
    }
  }
  return '';
}

function conversationTitle(config: AiConversationConfig): string {
  const messages = [...config.turnRootSelectors, ...config.userSelectors, ...config.assistantSelectors];
  const visible = queryAll(document, config.titleSelectors || [])
    .find((element) => isComputedVisible(element) && !closestMatch(element, messages))
    ?.textContent?.trim() || '';
  const title = (visible || conversationPageTitle()).replace(config.titleSuffix, '').trim();
  return title || config.titleFallback;
}

function hasUnrenderedHistory(config: AiConversationConfig, turns: Turn[]): boolean {
  const signals = [
    ...queryAll(document, [
      ...(config.unrenderedHistorySelectors || []),
      ...DEFAULT_UNRENDERED_SELECTORS,
    ]),
    ...historyControls(),
  ].filter(isComputedVisible);
  if (!signals.length || !turns.length) return false;

  const turnContainers = Array.from(new Set(turns.map(({ container }) => container)));
  const scopes = conversationScopes(config, turnContainers);
  return signals.some((signal) => (
    turnContainers.some((container) => (
      composedContains(signal, container) || composedContains(container, signal)
    ))
    || scopes.some((scope) => (
      composedContains(scope, signal) || composedContains(signal, scope)
    ))
  ));
}

function conversationScopes(config: AiConversationConfig, turns: Element[]): Element[] {
  const candidates = queryAll(document, config.fallbackSelectors)
    .filter((element) => (
      isComputedVisible(element)
      && element.tagName !== 'MAIN'
      && element.tagName !== 'BODY'
      && element.tagName !== 'HTML'
      && element.getAttribute('role') !== 'main'
      && turns.every((turn) => composedContains(element, turn))
    ));
  return candidates.filter((candidate) => !candidates.some((nested) => (
    nested !== candidate && composedContains(candidate, nested)
  )));
}

function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = sortElements(queryAll(root, [selector])).find(isComputedVisible);
    if (element) return element;
  }
  return null;
}

function collectScopes(root: ParentNode): ParentNode[] {
  const cached = activeExtractionCache?.scopes.get(root);
  if (cached) return cached;

  const scopes: ParentNode[] = [root];
  const seenScopes = new Set<ParentNode>(scopes);
  for (let index = 0; index < scopes.length; index += 1) {
    const scope = scopes[index];
    const hosts = scope instanceof Element
      ? [scope, ...scope.querySelectorAll('*')]
      : Array.from(scope.querySelectorAll('*'));
    for (const host of hosts) {
      if (!host.shadowRoot || seenScopes.has(host.shadowRoot)) continue;
      seenScopes.add(host.shadowRoot);
      scopes.push(host.shadowRoot);
    }
  }
  activeExtractionCache?.scopes.set(root, scopes);
  return scopes;
}

function queryAll<T extends Element = Element>(root: ParentNode, selectors: string[]): T[] {
  if (selectors.length === 0) return [];
  const result: T[] = [];
  const seen = new Set<Element>();
  const scopes = collectScopes(root);
  for (const scope of scopes) {
    for (const selector of selectors) {
      for (const element of scope.querySelectorAll<T>(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        result.push(element);
      }
    }
  }
  return result;
}

function matchesAny(element: Element, selectors: string[]): boolean {
  return selectors.some((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
}

function closestTurn(element: Element, selectors: string[]): Element {
  return closestMatch(element, selectors) || element;
}

function closestMatch(element: Element, selectors: string[]): Element | null {
  let current: Element | null = element;
  while (current) {
    if (matchesAny(current, selectors)) return current;
    current = composedParent(current);
  }
  return null;
}

function sortElements<T extends Element>(elements: T[]): T[] {
  const order = composedElementOrder();
  return [...elements].sort((left, right) => (
    (order.get(left) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function sortTurns(turns: Turn[]): Turn[] {
  const order = composedElementOrder();
  return [...turns].sort((left, right) => (
    (order.get(left.element) ?? order.get(left.container) ?? Number.MAX_SAFE_INTEGER)
    - (order.get(right.element) ?? order.get(right.container) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function composedElementOrder(): Map<Element, number> {
  if (activeExtractionCache?.elementOrder) return activeExtractionCache.elementOrder;
  const order = new Map<Element, number>();
  const seen = new Set<Element>();
  let position = 0;
  const visitElement = (element: Element) => {
    if (seen.has(element)) return;
    seen.add(element);
    order.set(element, position);
    position += 1;
    if (element instanceof HTMLSlotElement) {
      if (!isComputedVisible(element)) return;
      const assigned = element.assignedNodes({ flatten: true });
      const children = assigned.length
        ? assigned.filter((node): node is Element => node instanceof Element)
        : Array.from(element.children);
      children.forEach(visitElement);
      return;
    }
    const children = element.shadowRoot
      ? Array.from(element.shadowRoot.children)
      : Array.from(element.children);
    children.forEach(visitElement);
  };
  Array.from(document.children).forEach(visitElement);
  if (activeExtractionCache) activeExtractionCache.elementOrder = order;
  return order;
}

function composedParent(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function composedContains(container: Element, element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current === container) return true;
    current = composedParent(current);
  }
  return false;
}

function isComputedVisible(element: Element): boolean {
  if (activeExtractionCache) return activeExtractionCache.visibility(element);
  let current: Element | null = element;
  while (current) {
    if (current.getAttribute('aria-hidden') === 'true' || current.hasAttribute('hidden')) {
      return false;
    }
    const view = current.ownerDocument.defaultView;
    const style = view?.getComputedStyle(current);
    if (style && (
      style.display === 'none'
      || style.visibility === 'hidden'
      || style.visibility === 'collapse'
      || style.opacity === '0'
      || style.contentVisibility === 'hidden'
    )) return false;
    const parent = current.parentElement;
    if (parent instanceof HTMLSlotElement && parent.assignedNodes({ flatten: true }).length > 0) {
      return false;
    }
    if (parent?.shadowRoot && !current.assignedSlot) return false;
    current = composedParent(current);
  }
  return true;
}

function safeHttpUrl(value: string): string {
  return safeMarkdownDestination(value, /^https?:$/);
}

function safeLinkUrl(value: string): string {
  if (value.startsWith('#')) return value;
  return safeMarkdownDestination(value, /^(?:https?|mailto):$/);
}

function safeMarkdownDestination(value: string, allowedProtocols: RegExp): string {
  try {
    const url = new URL(value, document.baseURI);
    return allowedProtocols.test(url.protocol)
      ? escapeMarkdownDestination(url.href)
      : '';
  } catch {
    return '';
  }
}

function escapeMarkdownDestination(value: string): string {
  return value.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

function safeImageUrl(value: string): string {
  if (/^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(value)) {
    return escapeMarkdownDestination(value);
  }
  return safeMarkdownDestination(value, /^(?:https?|blob):$/);
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return 'Source';
  }
}

function filename(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.src || image.getAttribute('src') || '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
