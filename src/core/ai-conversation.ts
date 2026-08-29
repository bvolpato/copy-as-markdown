/** Shared rendered-DOM extraction for AI conversation products. */

import { addExtractionMetadata, limitCollection, limitMarkdown } from './context';
import * as Markdown from './markdown';
import { register } from './registry';
import type { Extractor, ExtractorConfig, PageMetadata } from './types';
import * as Utils from './utils';

type Role = 'user' | 'assistant';
type Turn = { role: Role; element: Element; container: Element };

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
  'button[aria-label*="older" i]',
  'button[aria-label*="previous" i]',
  '[data-virtualized="true"]',
  '[class*="virtual-scroll"]',
  'cdk-virtual-scroll-viewport',
];

export function registerAiConversationExtractor(config: AiConversationConfig): Extractor {
  return register({
    name: config.name,
    matches: config.matches,
    pathnameRegex: config.pathnameRegex,
    buttonPlacement: config.buttonPlacement,
    anchor: config.anchor,

    async extract() {
      const title = conversationTitle(config);
      const metadata: PageMetadata = {
        source: config.source,
        title,
        url: Utils.getCanonicalUrl(),
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

      for (const turn of turns.items) {
        const cleaned = clean(turn.element, true);
        let content = Markdown.elementToMarkdown(cleaned);
        const images = standaloneImages(turn.container, turn.element);
        const citations = extractCitations(turn.container, config.citationSelectors || []);
        const attachments = standaloneAttachments(
          turn.container,
          turn.element,
          citations.map(({ href }) => href),
          config.attachmentSelectors || [],
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
      const structuralIncomplete = turns.truncated || hasUnrenderedHistory(config);
      parts.push(
        '',
        structuralIncomplete
          ? '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.'
          : '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.',
      );
      if (!captured) {
        const fallback = queryFirst(document, config.fallbackSelectors);
        if (fallback) {
          const fallbackMarkdown = Markdown.elementToMarkdown(clean(fallback));
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
    },
  });
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
  if (/(?:^|[\s_-])(user|human|you|prompt|query)(?:$|[\s_-])/.test(value)) return 'user';
  if (/(?:^|[\s_-])(assistant|bot|copilot|model|response|answer|output)(?:$|[\s_-])/.test(value)) {
    return 'assistant';
  }
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
): Array<{ label: string; href: string }> {
  const links = sortElements(queryAll<HTMLAnchorElement>(container, [
    ...siteSelectors,
    ...DEFAULT_CITATION_SELECTORS,
  ]));
  const seen = new Set<string>();
  const citations: Array<{ label: string; href: string }> = [];
  for (const link of links) {
    if (!isComputedVisible(link)) continue;
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
): string[] {
  const citations = new Set(citationUrls);
  const seen = new Set<string>();
  const attachments: string[] = [];
  for (const link of sortElements(queryAll<HTMLAnchorElement>(container, [
    ...siteSelectors,
    ...DEFAULT_ATTACHMENT_SELECTORS,
  ]))) {
    if (!isComputedVisible(link) || composedContains(content, link)) continue;
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

function standaloneImages(container: Element, content: Element): string[] {
  const existing = new Set(
    queryAll<HTMLImageElement>(content, ['img[src]'])
      .map(imageSource)
      .filter(Boolean),
  );
  const images: string[] = [];
  for (const image of sortElements(queryAll<HTMLImageElement>(container, ['img[src]']))) {
    if (!isComputedVisible(image) || composedContains(content, image)) continue;
    const source = safeImageUrl(imageSource(image));
    if (!source || existing.has(source)) continue;
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
  const visibleClone = cloneVisibleRenderedElement(element);
  const clone = Utils.removeNoise(visibleClone, [
    ...Utils.NOISE_SELECTORS,
    'button',
    '[data-testid*="actions"]',
    '[data-testid*="feedback"]',
    '[class*="toolbar"]',
    '[class*="avatar"]',
    '[class*="profile"]',
    'textarea',
    'input',
    ...(keepEditable ? [] : ['[contenteditable="true"]']),
  ]);
  clone.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
    if (!safeImageUrl(image.getAttribute('src') || '')) {
      image.remove();
      return;
    }
    image.setAttribute(
      'alt',
      Markdown.escapeMarkdownLinkText(image.getAttribute('alt') || ''),
    );
  });
  return clone;
}

function cloneVisibleRenderedElement(element: Element): Element {
  const clone = element.cloneNode(false) as Element;
  appendVisibleRenderedChildren(element, clone);
  return clone;
}

function appendVisibleRenderedChildren(source: Element, target: Element): void {
  const nodes = source.shadowRoot
    ? Array.from(source.shadowRoot.childNodes)
    : Array.from(source.childNodes);
  for (const node of nodes) {
    if (node instanceof HTMLSlotElement) {
      if (!isComputedVisible(node)) continue;
      const assigned = node.assignedNodes({ flatten: true });
      for (const assignedNode of assigned.length ? assigned : Array.from(node.childNodes)) {
        appendVisibleRenderedNode(assignedNode, target);
      }
      continue;
    }
    appendVisibleRenderedNode(node, target);
  }
}

function appendVisibleRenderedNode(source: Node, target: Element): void {
  if (source instanceof Element) {
    if (!isComputedVisible(source)) return;
    target.append(cloneVisibleRenderedElement(source));
    return;
  }
  target.append(source.cloneNode(true));
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
  const visible = queryAll(document, config.titleSelectors || [])
    .find(isComputedVisible)?.textContent?.trim() || '';
  const title = (visible || Utils.getPageTitle()).replace(config.titleSuffix, '').trim();
  return title || config.titleFallback;
}

function hasUnrenderedHistory(config: AiConversationConfig): boolean {
  return Boolean(queryFirst(document, [
    ...(config.unrenderedHistorySelectors || []),
    ...DEFAULT_UNRENDERED_SELECTORS,
  ]));
}

function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    const element = sortElements(queryAll(root, [selector])).find(isComputedVisible);
    if (element) return element;
  }
  return null;
}

function queryAll<T extends Element = Element>(root: ParentNode, selectors: string[]): T[] {
  const result: T[] = [];
  const seen = new Set<Element>();
  const scopes: ParentNode[] = [root];
  const seenScopes = new Set<ParentNode>(scopes);
  for (let index = 0; index < scopes.length; index += 1) {
    const scope = scopes[index];
    for (const selector of selectors) {
      for (const element of scope.querySelectorAll<T>(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        result.push(element);
      }
    }
    const hosts = scope instanceof Element
      ? [scope, ...scope.querySelectorAll('*')]
      : Array.from(scope.querySelectorAll('*'));
    for (const host of hosts) {
      if (!host.shadowRoot || seenScopes.has(host.shadowRoot)) continue;
      seenScopes.add(host.shadowRoot);
      scopes.push(host.shadowRoot);
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
  let current: Element | null = element;
  while (current) {
    if (matchesAny(current, selectors)) return current;
    current = composedParent(current);
  }
  return element;
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
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function safeImageUrl(value: string): string {
  if (/^data:image\/(?:avif|gif|jpe?g|png|webp);base64,/i.test(value)) return value;
  try {
    const url = new URL(value, document.baseURI);
    return /^(?:https?|blob):$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
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
