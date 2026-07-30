/**
 * Microsoft 365 web extractor for Word, Excel, and PowerPoint.
 *
 * Prefers semantic/accessibility DOM. Canvas-only editors receive an explicit
 * visible live-DOM fallback and are marked incomplete rather than scraping the
 * ribbon, menus, or unrelated SharePoint chrome.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { type PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type OfficeApp = 'Word' | 'Excel' | 'PowerPoint' | 'Microsoft 365';
type ExtractionResult = {
  markdown: string;
  contentSource: string;
  complete: boolean;
  truncated: boolean;
  total?: number;
  included?: number;
};

const MAX_ROWS = 200;
const MAX_COLUMNS = 50;
const MAX_SLIDES = 200;

register({
  name: 'Microsoft 365',
  matches: [
    '*://www.office.com/launch/word*',
    '*://www.office.com/launch/excel*',
    '*://www.office.com/launch/powerpoint*',
    '*://office.com/launch/word*',
    '*://office.com/launch/excel*',
    '*://office.com/launch/powerpoint*',
    '*://word-edit.officeapps.live.com/we/*',
    '*://word-view.officeapps.live.com/we/*',
    '*://excel.officeapps.live.com/x/*',
    '*://powerpoint.officeapps.live.com/p/*',
    '*://view.officeapps.live.com/op/view.aspx*',
    '*://onedrive.live.com/edit.aspx*',
    '*://onedrive.live.com/view.aspx*',
    '*://*.sharepoint.com/*/_layouts/15/Doc.aspx*',
    '*://*.sharepoint.com/*/_layouts/15/WopiFrame.aspx*',
    '*://*.sharepoint.com/_layouts/15/Doc.aspx*',
    '*://*.sharepoint.com/_layouts/15/WopiFrame.aspx*',
    '*://*.sharepoint.com/*:w:/*',
    '*://*.sharepoint.com/*:x:/*',
    '*://*.sharepoint.com/*:p:/*',
    '*://*.sharepoint.com/*.docx*',
    '*://*.sharepoint.com/*.xlsx*',
    '*://*.sharepoint.com/*.pptx*',
  ],

  async extract() {
    const app = detectApp();
    const title = getDocumentTitle(app);
    const metadata: PageMetadata = {
      source: 'Microsoft 365',
      app,
      title: metadataValue(title),
      url: metadataValue(window.location.href),
    };
    const fileName = getFileName();
    if (fileName) metadata.file_name = metadataValue(fileName);

    const result = extractOfficeDocument(app, title);
    addExtractionMetadata(metadata, {
      contentSource: result.contentSource,
      total: result.total,
      included: result.included,
      truncated: result.truncated,
      complete: result.complete,
    });

    return Markdown.buildPageMarkdown(metadata, result.markdown);
  },
});

function extractOfficeDocument(app: OfficeApp, title: string): ExtractionResult {
  if (app === 'Excel') {
    const grid = extractExcelGrid(title);
    if (grid) return grid;
  }
  if (app === 'PowerPoint') {
    const slides = extractPowerPointSlides(title);
    if (slides) return slides;
  }

  const semantic = extractSemanticDocument(app, title);
  if (semantic) return semantic;

  const fallback = extractVisibleLiveContent(app, title);
  if (fallback) return fallback;

  return {
    markdown: `# ${title}\n\n*Could not find document content. Switch to a reading/accessibility view, wait for document to load, and try again.*`,
    contentSource: `${app} live DOM (content unavailable)`,
    complete: false,
    truncated: false,
  };
}

function extractSemanticDocument(app: OfficeApp, title: string): ExtractionResult | null {
  const selectors = [
    '[role="document"]',
    '[aria-label*="document canvas" i]',
    '[aria-label*="document content" i]',
    '[data-automation-id="documentCanvas"]',
    '.WACViewPanel',
    '#WACViewPanel_EditingElement',
  ];
  const candidate = bestContentCandidate(selectors, false);
  if (!candidate) return null;

  const clone = candidate.cloneNode(true) as HTMLElement;
  removeOfficeNoise(clone);
  const body = Markdown.elementToMarkdown(clone);
  if (!isMeaningful(body, title)) return null;

  const bounded = limitMarkdown(`# ${title}\n\n${stripDuplicateTitle(body, title)}`);
  return {
    markdown: bounded.markdown,
    contentSource: `${app} semantic/accessibility DOM`,
    // Office editors commonly virtualize pages without exposing a total count.
    complete: false,
    truncated: bounded.truncated,
  };
}

function extractExcelGrid(title: string): ExtractionResult | null {
  const grids = Array.from(document.querySelectorAll<HTMLElement>('[role="grid"], [role="table"], table'))
    .filter(isContentCandidate)
    .sort((a, b) => gridScore(b) - gridScore(a));
  const grid = grids[0];
  if (!grid || gridScore(grid) < 2) return null;

  if (grid.tagName === 'TABLE') {
    const rows = Array.from(grid.querySelectorAll('tr'));
    const limited = limitCollection(rows, MAX_ROWS);
    const clone = grid.cloneNode(true) as HTMLTableElement;
    Array.from(clone.querySelectorAll('tr')).slice(MAX_ROWS).forEach((row) => row.remove());
    const table = Markdown.tableToMarkdown(clone);
    if (!table) return null;
    const bounded = limitMarkdown(`# ${title}\n\n## Visible worksheet\n\n${table}`);
    return {
      markdown: bounded.markdown,
      contentSource: 'Microsoft Excel semantic HTML table',
      total: limited.total,
      included: limited.items.length,
      truncated: limited.truncated || bounded.truncated,
      complete: false,
    };
  }

  const rows = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'))
    .filter((row) => row.closest('[role="grid"], [role="table"]') === grid);
  if (rows.length === 0) return null;
  const declaredRows = positiveInteger(grid.getAttribute('aria-rowcount'));
  const limited = limitCollection(rows, MAX_ROWS);
  const table = excelRowsToMarkdown(limited.items);
  if (!table) return null;
  const bounded = limitMarkdown(`# ${title}\n\n## Visible worksheet\n\n${table}`);
  const total = Math.max(declaredRows, rows.length);
  return {
    markdown: bounded.markdown,
    contentSource: 'Microsoft Excel accessibility grid (rendered cells)',
    total,
    included: limited.items.length,
    truncated: limited.truncated || bounded.truncated,
    complete: total <= limited.items.length && !bounded.truncated && !isVirtualized(grid),
  };
}

function excelRowsToMarkdown(rows: HTMLElement[]): string {
  const cellsByRow = rows.map((row, rowIndex) => {
    const cells = Array.from(row.querySelectorAll<HTMLElement>(
      ':scope > [role="columnheader"], :scope > [role="rowheader"], :scope > [role="gridcell"], :scope > [role="cell"]',
    ));
    const indexed = new Map<number, string>();
    cells.forEach((cell, cellIndex) => {
      const column = positiveInteger(cell.getAttribute('aria-colindex')) || cellIndex + 1;
      if (column <= MAX_COLUMNS) indexed.set(column, escapeTableCell(accessibleText(cell)));
    });
    return {
      row: positiveInteger(row.getAttribute('aria-rowindex')) || rowIndex + 1,
      cells: indexed,
    };
  }).filter(({ cells }) => cells.size > 0);
  if (cellsByRow.length === 0) return '';

  const width = Math.min(
    MAX_COLUMNS,
    Math.max(...cellsByRow.flatMap(({ cells }) => Array.from(cells.keys()))),
  );
  const header = ['Row', ...Array.from({ length: width }, (_, index) => columnName(index + 1))];
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
  ];
  cellsByRow.forEach(({ row, cells }) => {
    const values = Array.from({ length: width }, (_, index) => cells.get(index + 1) || '');
    if (values.some(Boolean)) lines.push(`| ${row} | ${values.join(' | ')} |`);
  });
  return lines.join('\n');
}

function extractPowerPointSlides(title: string): ExtractionResult | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '[role="group"][aria-label*="slide" i]',
    '[role="region"][aria-label*="slide" i]',
    'section[aria-label*="slide" i]',
    '[data-automation-id*="slide" i][aria-label]',
  ].join(', '))).filter((element) =>
    isContentCandidate(element)
    && /\bslide\s+\d+\b/i.test(element.getAttribute('aria-label') || ''),
  );

  const slides = deduplicateSlides(candidates);
  if (slides.length === 0) return null;
  const limited = limitCollection(slides, MAX_SLIDES);
  const parts = [`# ${title}`];
  limited.items.forEach((slide, index) => {
    const label = normalize(slide.getAttribute('aria-label') || '');
    const number = slideNumber(label) || index + 1;
    const clone = slide.cloneNode(true) as HTMLElement;
    removeOfficeNoise(clone);
    const markdown = Markdown.elementToMarkdown(clone);
    const heading = firstHeading(clone);
    const content = stripDuplicateTitle(markdown, heading || label);
    parts.push(`## Slide ${number}${heading ? `: ${heading}` : ''}`);
    if (content) parts.push(content);
  });
  const bounded = limitMarkdown(parts.join('\n\n'));
  const declared = Math.max(
    slides.length,
    ...slides.map((slide) => declaredSlideCount(slide.getAttribute('aria-label') || '')),
  );
  const truncated = limited.truncated || bounded.truncated;
  return {
    markdown: bounded.markdown,
    contentSource: 'Microsoft PowerPoint semantic/accessibility slide DOM',
    total: declared,
    included: limited.items.length,
    truncated,
    complete: declared <= limited.items.length && !truncated && !slides.some(isVirtualized),
  };
}

function extractVisibleLiveContent(app: OfficeApp, title: string): ExtractionResult | null {
  const candidate = bestContentCandidate([
    'main',
    '[role="main"]',
    '[data-automation-id="content"]',
    '.WACViewPanel',
    '[contenteditable="true"][role="textbox"]',
  ], true);
  if (!candidate) return null;
  const clone = candidate.cloneNode(true) as HTMLElement;
  removeOfficeNoise(clone);
  const body = Markdown.elementToMarkdown(clone);
  if (!isMeaningful(body, title)) return null;
  const bounded = limitMarkdown(`# ${title}\n\n${stripDuplicateTitle(body, title)}`);
  return {
    markdown: bounded.markdown,
    contentSource: `${app} visible live DOM fallback`,
    complete: false,
    truncated: bounded.truncated,
  };
}

function bestContentCandidate(selectors: string[], requireVisible: boolean): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(', ')))
    .filter((element) => isContentCandidate(element) && (!requireVisible || isVisible(element)));
  candidates.sort((a, b) => contentScore(b) - contentScore(a));
  return candidates.find((element) => contentScore(element) > 20) || null;
}

function isContentCandidate(element: HTMLElement): boolean {
  if (element.closest([
    'nav',
    '[role="navigation"]',
    '[role="toolbar"]',
    '[role="menubar"]',
    '[role="banner"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
  ].join(', '))) return false;
  return element !== document.body && element !== document.documentElement;
}

function contentScore(element: HTMLElement): number {
  const text = normalize(element.innerText || element.textContent || '');
  const controls = element.querySelectorAll('button, input, select, [role="button"], [role="menuitem"]').length;
  return text.length - controls * 20;
}

function gridScore(grid: HTMLElement): number {
  return grid.querySelectorAll('[role="row"], tr').length
    * Math.max(1, grid.querySelectorAll('[role="gridcell"], [role="cell"], td, th').length);
}

function removeOfficeNoise(root: Element): void {
  root.querySelectorAll([
    ...Utils.NOISE_SELECTORS,
    'button',
    'input',
    'select',
    'textarea',
    '[role="toolbar"]',
    '[role="menubar"]',
    '[role="menu"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-automation-id*="ribbon" i]',
    '[data-automation-id*="command" i]',
    '[data-automation-id*="formula" i]',
    '[data-automation-id*="comment" i]',
    '[aria-label*="status bar" i]',
    '[aria-label*="navigation pane" i]',
  ].join(', ')).forEach((element) => element.remove());
}

function detectApp(): OfficeApp {
  const signal = `${window.location.hostname} ${window.location.pathname} ${window.location.search} ${document.title}`;
  if (/word|\.docx?\b|\/:w:\//i.test(signal)) return 'Word';
  if (/excel|\.xlsx?\b|\/:x:\//i.test(signal)) return 'Excel';
  if (/powerpoint|\.pptx?\b|\/:p:\//i.test(signal)) return 'PowerPoint';
  if (document.querySelector('[aria-label*="worksheet" i], [role="grid"][aria-rowcount]')) return 'Excel';
  if (document.querySelector('[aria-label*="slide" i]')) return 'PowerPoint';
  if (document.querySelector('[role="document"], [aria-label*="document canvas" i]')) return 'Word';
  return 'Microsoft 365';
}

function getDocumentTitle(app: OfficeApp): string {
  const value = getFileName()
    || Utils.getMeta('title')
    || document.title;
  return normalize(value)
    .replace(/\s*[|–-]\s*(?:Microsoft\s+365|Microsoft\s+Office|Word|Excel|PowerPoint)(?:\s+Online)?\s*$/i, '')
    .replace(/\.(?:docx?|xlsx?|pptx?)$/i, '')
    .trim()
    || `Untitled ${app}`;
}

function getFileName(): string {
  const input = document.querySelector<HTMLInputElement>([
    'input[aria-label*="file name" i]',
    'input[aria-label*="document name" i]',
    'input[data-automation-id*="filename" i]',
  ].join(', '));
  const label = document.querySelector<HTMLElement>([
    '[data-automation-id*="filename" i]',
    '[aria-label*="file name" i]:not(input)',
    '[aria-label*="document name" i]:not(input)',
  ].join(', '));
  return normalize(input?.value || label?.textContent || '');
}

function isMeaningful(markdown: string, title: string): boolean {
  const text = normalize(markdown.replace(/[#*_`>\[\]()|-]/g, ' '));
  return text.length >= 20 && text.toLowerCase() !== normalize(title).toLowerCase();
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isVirtualized(element: Element): boolean {
  if (element.matches('[aria-rowcount], [aria-setsize]')) {
    const total = positiveInteger(element.getAttribute('aria-rowcount') || element.getAttribute('aria-setsize'));
    const rendered = element.querySelectorAll('[role="row"], [role="listitem"]').length;
    if (total > rendered) return true;
  }
  return Boolean(element.querySelector('[data-virtualized], [data-is-virtualized="true"]'));
}

function deduplicateSlides(candidates: HTMLElement[]): HTMLElement[] {
  const byNumber = new Map<number, HTMLElement>();
  candidates.forEach((slide, index) => {
    const number = slideNumber(slide.getAttribute('aria-label') || '') || index + 1;
    const existing = byNumber.get(number);
    if (!existing || contentScore(slide) > contentScore(existing)) byNumber.set(number, slide);
  });
  return Array.from(byNumber.entries()).sort(([a], [b]) => a - b).map(([, slide]) => slide);
}

function firstHeading(element: Element): string {
  return normalize(element.querySelector('h1, h2, h3, [role="heading"]')?.textContent || '');
}

function slideNumber(label: string): number {
  return positiveInteger(label.match(/\bslide\s+(\d+)\b/i)?.[1] || null);
}

function declaredSlideCount(label: string): number {
  return positiveInteger(label.match(/\bof\s+(\d+)\b/i)?.[1] || null);
}

function positiveInteger(value: string | null): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function columnName(column: number): string {
  let value = column;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function accessibleText(element: HTMLElement): string {
  return normalize(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
}

function stripDuplicateTitle(markdown: string, title: string): string {
  if (!title) return markdown.trim();
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.replace(new RegExp(`^#{0,6}\\s*${escaped}\\s*`, 'i'), '').trim();
}

function normalize(value: string): string {
  return Markdown.normalizeWhitespace(value);
}

function metadataValue(value: string): string {
  return JSON.stringify(normalize(value));
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}
