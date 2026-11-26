/**
 * Notion page and database extractor.
 *
 * Notion renders private and public pages client-side. This extractor reads the
 * rendered block tree, records page properties, and marks database/virtualized
 * results incomplete instead of implying that unloaded rows were captured.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { type PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

const NOTION_PAGE_PATH = /(?:^|[-/])(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i;
const MAX_PROPERTIES = 100;
const MAX_DATABASE_ROWS = 200;

type Property = { name: string; value: string; element: Element };
type PropertyResult = { items: Property[]; total: number; truncated: boolean };
type DatabaseResult = {
  markdown: string;
  total: number;
  included: number;
  truncated: boolean;
  elements: HTMLElement[];
};

register({
  name: 'Notion',
  matches: [
    '*://notion.so/*',
    '*://www.notion.so/*',
    '*://*.notion.so/*',
  ],
  pathnameRegex: NOTION_PAGE_PATH,
  detect: detectRenderedNotionPage,
  extract: extractNotion,
});

register({
  name: 'Notion',
  matches: ['*://*.notion.site/*'],
  pathnameRegex: /^\/(?!$|(?:login|settings|signup|search|api|_next)(?:\/|$)).+/i,
  extract: extractNotion,
});

async function extractNotion(): Promise<string> {
    const root = findContentRoot();
    const title = getTitle(root);
    const url = Utils.getCanonicalUrl();
    const metadata: PageMetadata = {
      source: 'Notion',
      title: metadataValue(title),
      url: metadataValue(url),
    };

    const pageId = getPageId();
    if (pageId) metadata.page_id = pageId;

    if (!root) {
      addExtractionMetadata(metadata, {
        contentSource: 'Notion live DOM (unavailable)',
        complete: false,
      });
      return Markdown.buildPageMarkdown(
        metadata,
        `# ${title}\n\n*Could not find rendered Notion content. Wait for page to finish loading and try again.*`,
      );
    }

    const propertyResult = collectProperties(root);
    const properties = propertyResult.items;
    addPropertiesToMetadata(metadata, properties);

    const clone = root.cloneNode(true) as HTMLElement;
    removeNotionNoise(clone);
    removeMatchingProperties(clone, properties);

    const database = extractDatabase(clone);
    const isDatabase = database.total > 0 || isDatabasePage(root);
    database.elements.forEach((element) => element.remove());
    prepareNotionBlocks(clone);

    const blockCount = new Set(
      Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'))
        .map((element) => element.dataset.blockId)
        .filter(Boolean),
    ).size;
    const incompleteSignal = hasIncompleteSignal(root);

    const parts = [`# ${title}`];
    const propertyMarkdown = propertiesToMarkdown(properties);
    if (propertyMarkdown) parts.push(propertyMarkdown);

    const pageBody = normalizeCheckboxesOutsideCode(
      stripDuplicateTitle(Markdown.elementToMarkdown(clone), title),
    );
    if (pageBody) parts.push(pageBody);
    if (database.markdown) parts.push(database.markdown);

    if (parts.length === 1) {
      parts.push('*No rendered Notion blocks found. Wait for page to finish loading and try again.*');
    }

    const bounded = limitMarkdown(parts.join('\n\n'));
    const truncated = bounded.truncated || database.truncated || propertyResult.truncated;
    const complete = !truncated && !incompleteSignal && !isDatabase;
    metadata.type = isDatabase ? 'Database' : 'Page';
    if (blockCount > 0) metadata.rendered_blocks = blockCount;
    if (propertyResult.total > 0) {
      metadata.properties_total = propertyResult.total;
      metadata.properties_included = properties.length;
    }
    if (database.total > 0) {
      metadata.rendered_database_rows = database.total;
      metadata.included_database_rows = database.included;
    }
    addExtractionMetadata(metadata, {
      contentSource: isDatabase
        ? 'Notion rendered page and database view'
        : 'Notion rendered page DOM',
      truncated,
      complete,
    });

    if (!complete && !truncated && isDatabase) {
      parts.push('*Database export includes rendered rows only; rows outside loaded view may be omitted.*');
      return Markdown.buildPageMarkdown(metadata, limitMarkdown(parts.join('\n\n')).markdown);
    }
    return Markdown.buildPageMarkdown(metadata, bounded.markdown);
}

function detectRenderedNotionPage(contextDocument: Document = document): boolean {
  if (contextDocument.querySelector('.notion-page-content [data-block-id]')) return true;
  if (contextDocument.querySelector(
    '.notion-collection_view-block, .notion-collection_view_page-block, .notion-table_view',
  )) return true;
  const siteName = contextDocument.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content || '';
  return /^Notion$/i.test(siteName)
    && Boolean(contextDocument.querySelector('[data-testid="page-content"] [data-block-id]'));
}

function getTitle(root: HTMLElement | null = null): string {
  const peek = root?.closest<HTMLElement>('.notion-peek-renderer');
  const scope: ParentNode = peek || document;
  const candidates = [
    scope.querySelector('[data-testid="page-title"]'),
    scope.querySelector('[data-testid="page-title-text"]'),
    scope.querySelector('.notion-page-block h1'),
    root?.querySelector('h1') || null,
    scope.querySelector('.notion-page-content h1'),
    scope.querySelector('[role="main"] h1'),
  ];
  const title = candidates
    .map((element) => normalize(element?.textContent || ''))
    .find(Boolean)
    || Utils.getPageTitle();
  return title
    .replace(/\s*[|–-]\s*Notion\s*$/i, '')
    .trim()
    || 'Untitled Notion Page';
}

function getPageId(): string {
  const match = window.location.pathname.match(
    /(?:^|[-/])([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i,
  );
  if (!match) return '';
  const compact = match[1].replace(/-/g, '').toLowerCase();
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function findContentRoot(): HTMLElement | null {
  const isVisible = Utils.createVisibilityChecker();
  const peek = Array.from(document.querySelectorAll<HTMLElement>('.notion-peek-renderer'))
    .find((element) => isVisible(element));
  const searchScope: ParentNode = peek || document;
  const selectors = [
    '.notion-page-content',
    '[data-testid="page-content"]',
    '.notion-collection_view_page-block',
    '.notion-collection_view-block',
    '.notion-table_view',
    '.notion-table-view',
    '[data-content-editable-root="true"]',
    'main [data-block-id]',
    '[role="main"] [data-block-id]',
  ];
  for (const selector of selectors) {
    const candidate = searchScope.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    if (candidate.matches('[data-block-id]') && !candidate.matches('.notion-collection_view_page-block, .notion-collection_view-block')) {
      return candidate.closest<HTMLElement>('.notion-peek-renderer, main, [role="main"], .notion-page-content') || candidate.parentElement;
    }
    return candidate;
  }
  return peek || null;
}

function collectProperties(root: Element): PropertyResult {
  const scopes: Element[] = [root];
  const frameScope = root.closest('.notion-peek-renderer, .notion-frame, main, [role="main"]')
    || root.parentElement;
  if (frameScope && frameScope !== root) scopes.unshift(frameScope);

  const propertySelector = [
    '[data-testid="property-row"]',
    '[data-testid^="property-row-"]',
    '[data-testid*="page-property"]',
    '[data-property-id]',
  ].join(', ');

  const seenElements = new Set<HTMLElement>();
  const candidates: HTMLElement[] = [];
  for (const scope of scopes) {
    scope.querySelectorAll<HTMLElement>(propertySelector).forEach((element) => {
      if (seenElements.has(element)) return;
      seenElements.add(element);
      if (
        element.closest('[role="grid"], [role="table"], table, .notion-collection_view-block, .notion-table_view, .notion-table-view, [data-block-id]')
        || element.parentElement?.closest('[data-property-id]')
      ) return;
      candidates.push(element);
    });
  }

  const properties: Property[] = [];
  const names = new Set<string>();
  for (const element of candidates) {
    const property = parseProperty(element);
    if (!property || names.has(property.name.toLowerCase())) continue;
    names.add(property.name.toLowerCase());
    properties.push(property);
  }
  return limitCollection(properties, MAX_PROPERTIES);
}

function parseProperty(element: HTMLElement): Property | null {
  const labelElement = element.querySelector<HTMLElement>([
    '[data-testid="property-name"]',
    '[data-testid*="property-name"]',
    '[aria-label^="Property name"]',
  ].join(', '));
  let name = normalize(labelElement?.textContent || '');
  let value = '';

  if (labelElement) {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll([
      '[data-testid="property-name"]',
      '[data-testid*="property-name"]',
      '[aria-label^="Property name"]',
      'button[aria-label*="property menu" i]',
    ].join(', ')).forEach((node) => node.remove());
    value = normalize(clone.textContent || '');
  } else {
    const directTexts = Array.from(element.children)
      .map((child) => normalize(child.textContent || ''))
      .filter(Boolean);
    if (directTexts.length >= 2 && directTexts[0].length <= 100) {
      [name] = directTexts;
      value = normalize(directTexts.slice(1).join(' '));
    }
  }

  if (!name || !value || name === value || name.length > 100) return null;
  return { name, value, element };
}

function addPropertiesToMetadata(metadata: PageMetadata, properties: Property[]): void {
  if (properties.length === 0) return;
  metadata.properties = properties.length;
  const used = new Set<string>();
  properties.forEach(({ name, value }) => {
    let key = `property_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    if (key === 'property_' || used.has(key)) return;
    used.add(key);
    metadata[key] = metadataValue(value);
  });
}

function propertiesToMarkdown(properties: Property[]): string {
  if (properties.length === 0) return '';
  return `## Properties\n\n${properties
    .map(({ name, value }) => `- **${escapeInline(name)}:** ${escapeInline(value)}`)
    .join('\n')}`;
}

function removeMatchingProperties(clone: HTMLElement, properties: Property[]): void {
  if (properties.length === 0) return;
  const names = new Set(properties.map(({ name }) => name.toLowerCase()));
  clone.querySelectorAll<HTMLElement>([
    '[data-testid="property-row"]',
    '[data-testid^="property-row-"]',
    '[data-testid*="page-property"]',
    '[data-property-id]',
  ].join(', ')).forEach((element) => {
    const property = parseProperty(element);
    if (property && names.has(property.name.toLowerCase())) element.remove();
  });
}

const DATABASE_ROW_SELECTOR = '[role="row"], .notion-table-view-header-row, .notion-table-view-row';
const DATABASE_CELL_SELECTOR = '[role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"], .notion-table-view-header-cell, .notion-table-view-cell';
const DATABASE_COLLECTION_SELECTOR = '.notion-collection_view-block, .notion-collection_view_page-block, .notion-table_view, .notion-table-view, [data-view-type]';

function isDatabaseTableElement(table: HTMLElement): boolean {
  if (table.closest('.notion-simple_table-block')) return false;
  if (table.closest(DATABASE_COLLECTION_SELECTOR)) return true;
  if (table.closest('[data-block-id]')) return false;
  const rows = table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
  return rows.length > MAX_DATABASE_ROWS;
}

function extractDatabase(root: Element): DatabaseResult {
  const gridSelector = '[role="grid"], [role="table"], table, .notion-table-view, .notion-table_view';
  const rawGrids = Array.from(root.querySelectorAll<HTMLElement>(gridSelector))
    .filter((element) => {
      if (element.closest('[role="dialog"], [role="navigation"], nav')) return false;
      if (element.tagName === 'TABLE') return isDatabaseTableElement(element);
      return !element.closest('.notion-simple_table-block');
    });
  if (root instanceof HTMLElement && root.matches(gridSelector)) {
    rawGrids.unshift(root);
  }
  const grids = rawGrids.filter((element, index, all) =>
    !all.some((other, otherIndex) =>
      other !== element && (other.contains(element) || (otherIndex < index && other === element)),
    ),
  );
  if (grids.length === 0) return { markdown: '', total: 0, included: 0, truncated: false, elements: [] };

  const sections: string[] = [];
  const extractedElements: HTMLElement[] = [];
  let total = 0;
  let included = 0;
  let truncated = false;
  grids.forEach((grid, index) => {
    const innerTable = grid.tagName === 'TABLE'
      ? grid
      : grid.querySelector<HTMLTableElement>('table');
    if (grid.tagName === 'TABLE' || (innerTable && !grid.querySelector('[role="row"], .notion-table-view-row'))) {
      const tableEl = (innerTable || grid) as HTMLTableElement;
      const rows = Array.from(tableEl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'));
      if (rows.length < 1) return;
      total += rows.length;
      const limited = limitCollection(rows, MAX_DATABASE_ROWS);
      included += limited.items.length;
      truncated ||= limited.truncated;
      const table = tableEl.cloneNode(true) as HTMLTableElement;
      const markdown = Markdown.tableToMarkdown(table);
      if (markdown) {
        sections.push(`${grids.length > 1 ? `### Database view ${index + 1}\n\n` : ''}${markdown}`);
        extractedElements.push(grid);
      }
      return;
    }

    const rows = Array.from(grid.querySelectorAll<HTMLElement>(DATABASE_ROW_SELECTOR)).filter((row) => {
      const owner = row.closest('[role="grid"], [role="table"], .notion-table-view, .notion-table_view');
      return owner === grid || (owner !== null && grid.contains(owner));
    });
    if (rows.length === 0) return;
    total += rows.length;
    const limited = limitCollection(rows, MAX_DATABASE_ROWS);
    included += limited.items.length;
    truncated ||= limited.truncated;
    const table = roleRowsToMarkdown(limited.items);
    if (table) {
      sections.push(`${grids.length > 1 ? `### Database view ${index + 1}\n\n` : ''}${table}`);
      extractedElements.push(grid);
    }
  });

  return {
    markdown: sections.length ? `## Database\n\n${sections.join('\n\n')}` : '',
    total,
    included,
    truncated,
    elements: extractedElements,
  };
}

function roleRowsToMarkdown(rows: HTMLElement[]): string {
  // Rendered rows wrap their cells in layout elements.
  const values = rows.map((row) => Array.from(row.querySelectorAll<HTMLElement>(DATABASE_CELL_SELECTOR))
    .filter((cell) => cell.closest(DATABASE_ROW_SELECTOR) === row
      && cell.parentElement?.closest(DATABASE_CELL_SELECTOR)?.closest(DATABASE_ROW_SELECTOR) !== row)
    .map((cell) => escapeTableCell(cellText(cell))));
  const width = Math.max(0, ...values.map((row) => row.length));
  if (width === 0) return '';
  values.forEach((row) => {
    row.splice(width);
    while (row.length < width) row.push('');
  });
  const header = values.shift() || Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...values.filter((row) => row.some(Boolean)).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

const LIST_BLOCK_SELECTOR = '.notion-bulleted_list-block, .notion-numbered_list-block, .notion-to_do-block';

/** Notion draws list markers outside the text, so rebuild real lists from the blocks. */
function rebuildLists(root: Element): void {
  const lists = new Set<Element>();
  // Convert nested blocks first so that an outer item can adopt them.
  Array.from(root.querySelectorAll<HTMLElement>(LIST_BLOCK_SELECTOR)).reverse().forEach((block) => {
    const markerBox = block.querySelector('.notion-list-item-box-left');
    const leaf = block.querySelector('[data-content-editable-leaf]');
    if (!markerBox || !leaf) return;
    const doc = block.ownerDocument;
    const ordered = block.matches('.notion-numbered_list-block');
    const list = doc.createElement(ordered ? 'ol' : 'ul');
    const item = doc.createElement('li');
    if (ordered) {
      const marker = markerBox.querySelector<HTMLElement>('.pseudoBefore')?.style.getPropertyValue('--pseudoBefore--content') || '';
      const start = Number.parseInt(marker.replace(/["']/g, ''), 10);
      if (Number.isFinite(start)) list.setAttribute('start', String(start));
    }
    if (block.matches('.notion-to_do-block')) {
      const checkbox = markerBox.querySelector('input[type="checkbox"], [role="checkbox"]');
      const checked = checkbox instanceof HTMLInputElement
        ? checkbox.checked
        : checkbox?.getAttribute('aria-checked') === 'true';
      item.append(checked ? '[x] ' : '[ ] ');
    }
    item.append(...leaf.childNodes);
    const descendants = Array.from(block.querySelectorAll('ul, ol, [data-block-id]'));
    const children = descendants.filter((child) =>
      !descendants.some((other) => other !== child && other.contains(child)),
    );
    if (children.some((child) => !lists.has(child))) {
      // List conversion keeps the paragraphs of an item apart only when the item has block content.
      const text = doc.createElement('p');
      text.append(...item.childNodes);
      item.append(text, doc.createElement('blockquote'));
    }
    item.append(...children);
    list.append(item);
    lists.add(list);
    block.replaceWith(list);
  });
  Array.from(root.querySelectorAll('ul, ol')).filter((list) => lists.has(list)).forEach((list) => {
    for (
      let next = list.nextElementSibling;
      next && lists.has(next) && next.tagName === list.tagName;
      next = list.nextElementSibling
    ) {
      list.append(...next.childNodes);
      next.remove();
    }
  });
}

function prepareNotionText(root: Element): void {
  root.querySelectorAll('.notion-inline-code-container').forEach((container) => {
    if (container.querySelector('a[href]')) return;
    const code = container.ownerDocument.createElement('code');
    code.textContent = container.textContent;
    container.replaceWith(code);
  });
  // KaTeX repeats the formula as MathML and as TeX source.
  root.querySelectorAll('.katex').forEach((formula) => {
    const source = formula.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    const delimiter = formula.closest('.notion-equation-block') ? '$$' : '$';
    if (source) formula.replaceWith(`${delimiter}${source}${delimiter}`);
  });
  root.querySelectorAll<HTMLElement>('[data-content-editable-leaf]').forEach((leaf) => {
    if (leaf.closest('.notion-code-block, pre')) return;
    leaf.querySelectorAll<HTMLElement>('span[style]').forEach((span) => {
      const tags = [
        Number.parseInt(span.style.fontWeight, 10) >= 600 ? 'strong' : '',
        span.style.fontStyle === 'italic' ? 'em' : '',
        span.style.textDecoration.includes('line-through') ? 'del' : '',
      ].filter(Boolean);
      tags.forEach((tag) => {
        const wrapper = span.ownerDocument.createElement(tag);
        wrapper.append(...span.childNodes);
        span.append(wrapper);
      });
    });
    if (!/^(?:pre|break-spaces)/.test(leaf.style.whiteSpace)) return;
    // Soft line breaks are literal newlines in preformatted text.
    const walker = leaf.ownerDocument.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    const breaks: Text[] = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.includes('\n')) breaks.push(walker.currentNode as Text);
    }
    breaks.forEach((text) => {
      text.replaceWith(...text.data.split('\n').flatMap((line, index) =>
        index ? [text.ownerDocument.createElement('br'), line] : [line],
      ));
    });
  });
}

function prepareNotionBlocks(root: Element): void {
  prepareNotionText(root);
  rebuildLists(root);
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.replaceWith(input.ownerDocument.createTextNode(input.checked ? '[x] ' : '[ ] '));
  });
  root.querySelectorAll<HTMLElement>('[role="checkbox"]').forEach((box) => {
    if (box.matches('input')) return;
    const checked = box.getAttribute('aria-checked') === 'true';
    box.replaceWith(box.ownerDocument.createTextNode(checked ? '[x] ' : '[ ] '));
  });
  root.querySelectorAll<HTMLElement>('[data-placeholder]:empty').forEach((element) => element.remove());
}

function normalizeCheckboxesOutsideCode(markdown: string): string {
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;
  return markdown
    .split('\n')
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!inFence) {
          inFence = true;
          fenceChar = marker[0];
          fenceLength = marker.length;
        } else if (marker[0] === fenceChar && marker.length >= fenceLength && /^\s*$/.test(line.slice(fenceMatch[0].length))) {
          inFence = false;
        }
        return line;
      }
      if (inFence) return line;
      return line.replace(/\[([ x])\]\s+/g, '[$1] ');
    })
    .join('\n');
}

function removeNotionNoise(root: Element): void {
  root.querySelectorAll([
    ...Utils.NOISE_SELECTORS,
    '[role="toolbar"]',
    '[role="menubar"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-testid*="comment"]',
    '[data-testid*="breadcrumb"]',
    '[data-testid*="sidebar"]',
    '[data-testid*="topbar"]',
    '[data-testid*="page-controls"]',
    '.notion-selectable-halo',
  ].join(', ')).forEach((element) => element.remove());
  root.querySelectorAll<HTMLElement>('.notion-code-block').forEach((block) => {
    let codeEl = block.querySelector('code');
    let preEl = block.querySelector('pre');
    const leaf = block.querySelector('[data-content-editable-leaf]');
    if (!codeEl && !preEl && leaf) {
      preEl = block.ownerDocument.createElement('pre');
      codeEl = block.ownerDocument.createElement('code');
      codeEl.textContent = leaf.textContent;
      preEl.append(codeEl);
      leaf.replaceWith(preEl);
    }
    if (codeEl && !/\b(?:language|lang)-/i.test(codeEl.className)) {
      const langButton = Array.from(block.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .map((btn) => normalize(btn.textContent || ''))
        .find((label) => label && !/^(?:copy|copy code|copied|wrap|unwrap|caption|mermaid|code|preview|split|more)$/i.test(label) && /^[a-z0-9.+# -]{1,24}$/i.test(label));
      if (langButton) {
        const slug = langButton.toLowerCase().replace(/\s+/g, '-');
        codeEl.setAttribute('data-language', slug);
        if (preEl) preEl.setAttribute('data-language', slug);
      }
    }
  });
  root.querySelectorAll<HTMLElement>('.notion-code-block button, .notion-code-block [role="button"], pre button').forEach((button) => {
    button.remove();
  });
  root.querySelectorAll<HTMLElement>('button').forEach((button) => {
    const label = normalize(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`);
    if (
      !button.textContent?.trim()
      || /(?:menu|comment|share|more actions|close|delete|duplicate)/i.test(label)
      || /^(?:load|show) more$/i.test(label)
      || /^(?:copy|copy code|copied|wrap|unwrap|caption)$/i.test(label)
    ) {
      button.remove();
    }
  });
}

function isDatabasePage(root: Element = document.documentElement): boolean {
  return Boolean(
    root.matches('.notion-table-view, .notion-table_view, .notion-board-view, .notion-calendar-view, .notion-collection_view_page-block, .notion-collection_view-block, [data-view-type], [role="grid"]')
    || root.querySelector('.notion-table-view, .notion-table_view, .notion-board-view, .notion-calendar-view, .notion-collection_view_page-block, .notion-collection_view-block, [data-view-type], [role="grid"]'),
  );
}

function hasIncompleteSignal(root: Element): boolean {
  if (root.querySelector('[aria-busy="true"], [role="progressbar"]')) return true;
  return Array.from(root.querySelectorAll('button, [role="button"]')).some((element) =>
    /^(?:load|show) more$/i.test(normalize(element.textContent || '')),
  );
}

function stripDuplicateTitle(markdown: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.replace(new RegExp(`^#\\s+${escaped}\\s*`, 'i'), '').trim();
}

function cellText(cell: HTMLElement): string {
  return normalize(cell.textContent || cell.getAttribute('aria-label') || '');
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value);
}

function metadataValue(value: string): string {
  return normalize(value);
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/\n/g, ' ');
}

function escapeTableCell(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/g, '\\$1').replace(/\n/g, ' ');
}
