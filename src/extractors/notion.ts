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
type DatabaseResult = { markdown: string; total: number; included: number; truncated: boolean };

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
    const title = getTitle();
    const url = Utils.getCanonicalUrl();
    const metadata: PageMetadata = {
      source: 'Notion',
      title: metadataValue(title),
      url: metadataValue(url),
    };

    const pageId = getPageId();
    if (pageId) metadata.page_id = pageId;

    const root = findContentRoot();
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
    const isDatabase = database.total > 0 || isDatabasePage();
    removeDatabaseGrids(clone);
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

    const pageBody = stripDuplicateTitle(Markdown.elementToMarkdown(clone), title)
      .replace(/\[([ x])\]\s+/g, '[$1] ');
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

function detectRenderedNotionPage(): boolean {
  if (document.querySelector('.notion-page-content [data-block-id]')) return true;
  const siteName = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content || '';
  return /^Notion$/i.test(siteName)
    && Boolean(document.querySelector('[data-testid="page-content"] [data-block-id]'));
}

function getTitle(): string {
  const candidates = [
    document.querySelector('[data-testid="page-title"]'),
    document.querySelector('[data-testid="page-title-text"]'),
    document.querySelector('.notion-page-content h1'),
    document.querySelector('[role="main"] h1'),
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
  const selectors = [
    '.notion-page-content',
    '[data-testid="page-content"]',
    '[data-content-editable-root="true"]',
    'main [data-block-id]',
    '[role="main"] [data-block-id]',
  ];
  for (const selector of selectors) {
    const candidate = document.querySelector<HTMLElement>(selector);
    if (!candidate) continue;
    if (candidate.matches('[data-block-id]')) {
      return candidate.closest<HTMLElement>('main, [role="main"], .notion-page-content') || candidate.parentElement;
    }
    return candidate;
  }
  return null;
}

function collectProperties(root: Element): PropertyResult {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>([
    '[data-testid="property-row"]',
    '[data-testid^="property-row-"]',
    '[data-testid*="page-property"]',
    '[data-property-id]',
  ].join(', '))).filter((element) =>
    !element.closest('[role="grid"], [role="table"], table, [data-block-id]')
    && !element.parentElement?.closest('[data-property-id]'),
  );

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
  return { name, value: Utils.truncate(value, 2_000), element };
}

function addPropertiesToMetadata(metadata: PageMetadata, properties: Property[]): void {
  if (properties.length === 0) return;
  metadata.properties = properties.length;
  const used = new Set<string>();
  properties.forEach(({ name, value }) => {
    let key = `property_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
    if (key === 'property_' || used.has(key)) return;
    used.add(key);
    metadata[key] = metadataValue(Utils.truncate(value, 500));
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

function extractDatabase(root: Element): DatabaseResult {
  const grids = Array.from(root.querySelectorAll<HTMLElement>(
    '[role="grid"], [role="table"], table, .notion-table-view',
  ))
    .filter((element) => !element.closest('[role="dialog"], [role="navigation"], nav'));
  if (grids.length === 0) return { markdown: '', total: 0, included: 0, truncated: false };

  const sections: string[] = [];
  let total = 0;
  let included = 0;
  let truncated = false;
  grids.forEach((grid, index) => {
    if (grid.tagName === 'TABLE') {
      const rows = Array.from(grid.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'));
      if (rows.length < 1) return;
      total += rows.length;
      const limited = limitCollection(rows, MAX_DATABASE_ROWS);
      included += limited.items.length;
      truncated ||= limited.truncated;
      const table = grid.cloneNode(true) as HTMLTableElement;
      Array.from(table.querySelectorAll('tr')).slice(MAX_DATABASE_ROWS).forEach((row) => row.remove());
      const markdown = Markdown.tableToMarkdown(table);
      if (markdown) sections.push(`${grids.length > 1 ? `### Database view ${index + 1}\n\n` : ''}${markdown}`);
      return;
    }

    const rows = Array.from(grid.querySelectorAll<HTMLElement>(
      '[role="row"], .notion-table-view-header-row, .notion-table-view-row',
    )).filter((row) =>
      row.closest('[role="grid"], [role="table"], .notion-table-view') === grid,
    );
    if (rows.length === 0) return;
    total += rows.length;
    const limited = limitCollection(rows, MAX_DATABASE_ROWS);
    included += limited.items.length;
    truncated ||= limited.truncated;
    const table = roleRowsToMarkdown(limited.items);
    if (table) sections.push(`${grids.length > 1 ? `### Database view ${index + 1}\n\n` : ''}${table}`);
  });

  return {
    markdown: sections.length ? `## Database\n\n${sections.join('\n\n')}` : '',
    total,
    included,
    truncated,
  };
}

function roleRowsToMarkdown(rows: HTMLElement[]): string {
  const values = rows.map((row) => Array.from(row.querySelectorAll<HTMLElement>(
    ':scope > [role="columnheader"], :scope > [role="rowheader"], :scope > [role="cell"], :scope > [role="gridcell"], :scope > .notion-table-view-header-cell, :scope > .notion-table-view-cell',
  )).map((cell) => escapeTableCell(cellText(cell))));
  const width = Math.min(50, Math.max(0, ...values.map((row) => row.length)));
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

function removeDatabaseGrids(root: Element): void {
  root.querySelectorAll('[role="grid"], [role="table"], table, .notion-table-view')
    .forEach((element) => element.remove());
}

function prepareNotionBlocks(root: Element): void {
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((input) => {
    input.replaceWith(input.ownerDocument.createTextNode(input.checked ? '[x] ' : '[ ] '));
  });
  root.querySelectorAll<HTMLElement>('[data-placeholder]:empty').forEach((element) => element.remove());
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
  root.querySelectorAll<HTMLElement>('button').forEach((button) => {
    const label = normalize(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`);
    if (
      !button.textContent?.trim()
      || /(?:menu|comment|share|more actions|close|delete|duplicate)/i.test(label)
      || /^(?:load|show) more$/i.test(label)
    ) {
      button.remove();
    }
  });
}

function isDatabasePage(): boolean {
  return Boolean(document.querySelector(
    '.notion-table-view, .notion-board-view, .notion-calendar-view, [data-view-type], [role="grid"]',
  ));
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
