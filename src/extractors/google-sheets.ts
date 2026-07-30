/**
 * Google Sheets extractor.
 *
 * Prefers authenticated exports for the active sheet or selected range. The
 * live grid is virtualized, so its DOM is only a bounded fallback.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const MAX_ROWS = 500;
const MAX_COLUMNS = 50;
const BODY_LIMIT = 110_000;

type GridExtraction = {
  rows: string[][];
  contentSource: string;
  complete: boolean;
  scope: string;
};

register({
  name: 'Google Sheets',
  matches: ['*://docs.google.com/spreadsheets/d/*'],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#docs-titlebar-share-client-button',
      '#docs-sidekick-button-container',
      '#workspace-onegoogle-pep-container',
      '.docs-titlebar-buttons > :last-child',
    ].join(', '),
    position: 'before',
    style: 'link',
    label: 'Copy as Markdown',
  },

  async extract() {
    const spreadsheetId = getSpreadsheetId();
    const title = getSpreadsheetTitle();
    const gid = getActiveGridId();
    const range = getActiveRange();
    const sheet = getActiveSheetName();
    const metadata: Record<string, string | number | undefined> = {
      source: 'Google Sheets',
      title,
      url: window.location.href,
      spreadsheet_id: spreadsheetId,
      sheet: sheet || undefined,
      sheet_gid: gid,
      range: range || undefined,
    };

    if (!spreadsheetId) {
      addExtractionMetadata(metadata, {
        contentSource: 'Google Sheets live page',
        total: 0,
        included: 0,
        truncated: false,
        complete: false,
      });
      return Markdown.buildPageMarkdown(
        metadata,
        `# ${title}\n\n*Could not determine the current spreadsheet ID.*`,
      );
    }

    let extraction: GridExtraction | null = null;
    try {
      const csv = await fetchSheetResource(buildCsvExportUrl(spreadsheetId, gid, range), 'csv');
      extraction = {
        rows: trimGrid(parseCsv(csv)),
        contentSource: 'Google Sheets authenticated CSV export',
        complete: true,
        scope: range ? 'active range' : 'active sheet used range',
      };
    } catch (error) {
      console.warn('[Copy as Markdown] Google Sheets CSV export failed', error);
    }

    if (!extraction) {
      try {
        const html = await fetchSheetResource(buildHtmlExportUrl(spreadsheetId, gid, range), 'html');
        const rows = parseExportedHtmlGrid(html);
        if (rows.length > 0) {
          extraction = {
            rows: trimGrid(rows),
            contentSource: 'Google Sheets authenticated HTML query',
            complete: true,
            scope: range ? 'active range' : 'active sheet used range',
          };
        }
      } catch (error) {
        console.warn('[Copy as Markdown] Google Sheets HTML query failed', error);
      }
    }

    if (!extraction) {
      const rows = extractVisibleGrid();
      extraction = {
        rows: trimGrid(rows),
        contentSource: 'Google Sheets visible grid DOM',
        complete: false,
        scope: 'visible viewport only',
      };
    }

    return buildSheetMarkdown(metadata, title, extraction);
  },
});

function getSpreadsheetId(): string {
  return window.location.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || '';
}

function getSpreadsheetTitle(): string {
  const title =
    document.querySelector('.docs-title-input-label-inner')?.textContent?.trim()
    || document.querySelector('#docs-title-input-label-inner')?.textContent?.trim()
    || document.querySelector<HTMLInputElement>('.docs-title-input')?.value?.trim()
    || Utils.getPageTitle()
    || 'Google Sheet';
  return title.replace(/\s*-\s*Google Sheets$/, '').trim();
}

function getActiveGridId(): string {
  const fromUrl = getLocationParameter('gid');
  if (fromUrl) return fromUrl;

  const activeTab = document.querySelector<HTMLElement>(
    '.docs-sheet-active-tab, .docs-sheet-tab[aria-selected="true"], [role="tab"][aria-selected="true"][data-sheet-id]',
  );
  return activeTab?.dataset.sheetId
    || activeTab?.id.match(/(?:docs-sheet-tab-|gid-)(\d+)/)?.[1]
    || '0';
}

function getActiveSheetName(): string {
  const tab = document.querySelector<HTMLElement>(
    '.docs-sheet-active-tab .docs-sheet-tab-name, .docs-sheet-tab[aria-selected="true"] .docs-sheet-tab-name, .docs-sheet-active-tab',
  );
  const label = tab?.getAttribute('aria-label') || tab?.textContent || '';
  return normalizeCell(label.replace(/\s*(?:selected|active)\s*$/i, ''));
}

function getActiveRange(): string {
  const fromUrl = getLocationParameter('range');
  if (fromUrl) return fromUrl.trim();

  const nameBox = document.querySelector<HTMLElement>([
    'input[aria-label*="Name box" i]',
    '.waffle-name-box input',
    '#waffle-name-box input',
    '.waffle-name-box',
    '#waffle-name-box',
  ].join(', '));
  const value = nameBox instanceof HTMLInputElement ? nameBox.value : nameBox?.textContent || '';
  const range = value.trim();
  return /^(?:'[^']+'!|[^!\s]+!)?\$?[A-Z]{1,4}\$?\d+:\$?[A-Z]{1,4}\$?\d+$/i.test(range)
    ? range
    : '';
}

function getLocationParameter(name: string): string {
  const current = new URL(window.location.href);
  const queryValue = current.searchParams.get(name);
  if (queryValue) return queryValue;

  const hash = current.hash.replace(/^#/, '');
  if (!hash.includes('=')) return '';
  return new URLSearchParams(hash).get(name) || '';
}

function buildCsvExportUrl(spreadsheetId: string, gid: string, range: string): string {
  const url = new URL(`/spreadsheets/d/${spreadsheetId}/export`, window.location.origin);
  url.searchParams.set('format', 'csv');
  url.searchParams.set('gid', gid);
  if (range) url.searchParams.set('range', range);
  return url.href;
}

function buildHtmlExportUrl(spreadsheetId: string, gid: string, range: string): string {
  const url = new URL(`/spreadsheets/d/${spreadsheetId}/gviz/tq`, window.location.origin);
  url.searchParams.set('tqx', 'out:html');
  url.searchParams.set('gid', gid);
  if (range) url.searchParams.set('range', range);
  return url.href;
}

async function fetchSheetResource(url: string, kind: 'csv' | 'html'): Promise<string> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`Google Sheets request returned ${response.status}`);

  const text = await response.text();
  if (!text.trim()) throw new Error('Google Sheets request returned an empty response');
  if (
    response.url.includes('ServiceLogin')
    || /accounts\.google\.com/i.test(text)
    || /<title>\s*sign in/i.test(text)
  ) {
    throw new Error('Google Sheets request redirected to sign-in');
  }
  if (kind === 'csv' && /^\s*<!doctype html|^\s*<html/i.test(text)) {
    throw new Error('Google Sheets CSV export returned HTML');
  }
  return text;
}

function parseExportedHtmlGrid(html: string): string[][] {
  const parsed = Markdown.parseHtmlDocument(html);
  const table = parsed.querySelector('table');
  if (!table) return [];
  return Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
      normalizeCell(cell.textContent || ''),
    ),
  );
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function extractVisibleGrid(): string[][] {
  const table = document.querySelector(
    '#waffle-grid-container table, .waffle-grid-container table, [role="grid"] table',
  );
  if (table) {
    const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
      Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) =>
        normalizeCell(cell.textContent || ''),
      ),
    );
    if (rows.some((row) => row.some(Boolean))) return rows;
  }

  const grid = document.querySelector('[role="grid"], #waffle-grid-container, .waffle-grid-container');
  if (!grid) return [];
  const roleRows = Array.from(grid.querySelectorAll<HTMLElement>('[role="row"]'));
  const rows = roleRows.map((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(':scope > [role="gridcell"], :scope > [role="columnheader"]'))
      .map((cell) => normalizeCell(cell.getAttribute('aria-label') || cell.textContent || '')),
  ).filter((row) => row.length > 0);
  if (rows.some((row) => row.some(Boolean))) return rows;

  const cells = Array.from(grid.querySelectorAll<HTMLElement>('[role="gridcell"]'));
  const indexed = new Map<number, Map<number, string>>();
  cells.forEach((cell, index) => {
    const rowElement = cell.closest<HTMLElement>('[role="row"]');
    const rowIndex = Number(cell.getAttribute('aria-rowindex') || rowElement?.getAttribute('aria-rowindex'));
    const columnIndex = Number(cell.getAttribute('aria-colindex'));
    const rowKey = Number.isFinite(rowIndex) && rowIndex > 0 ? rowIndex : 1;
    const columnKey = Number.isFinite(columnIndex) && columnIndex > 0 ? columnIndex : index + 1;
    if (!indexed.has(rowKey)) indexed.set(rowKey, new Map());
    indexed.get(rowKey)?.set(columnKey, normalizeCell(cell.getAttribute('aria-label') || cell.textContent || ''));
  });
  return Array.from(indexed.entries()).sort(([a], [b]) => a - b).map(([, columns]) => {
    const last = Math.max(0, ...columns.keys());
    return Array.from({ length: last }, (_, index) => columns.get(index + 1) || '');
  });
}

function trimGrid(rows: string[][]): string[][] {
  const normalized = rows.map((row) => row.map(normalizeCell));
  while (normalized.length > 0 && normalized[normalized.length - 1].every((cell) => !cell)) {
    normalized.pop();
  }
  const columnCount = normalized.reduce((largest, row) => {
    let lastValue = row.length;
    while (lastValue > 0 && !row[lastValue - 1]) lastValue -= 1;
    return Math.max(largest, lastValue);
  }, 0);
  return normalized.map((row) => row.slice(0, columnCount));
}

function buildSheetMarkdown(
  metadata: Record<string, string | number | undefined>,
  title: string,
  extraction: GridExtraction,
): string {
  const totalRows = extraction.rows.length;
  const totalColumns = extraction.rows.reduce((largest, row) => Math.max(largest, row.length), 0);
  const limitedRows = limitCollection(extraction.rows, MAX_ROWS);
  const includedColumns = Math.min(totalColumns, MAX_COLUMNS);
  const boundedRows = limitedRows.items.map((row) => row.slice(0, includedColumns));
  const collectionTruncated = limitedRows.truncated || totalColumns > includedColumns;
  const table = boundedRows.length > 0 && includedColumns > 0
    ? gridToMarkdownTable(boundedRows, includedColumns, getRangeStart(String(metadata.range || '')))
    : '*Selected sheet or range is empty.*';
  const body = limitMarkdown(`# ${escapeHeading(title)}\n\n${table}`, BODY_LIMIT);
  const truncated = collectionTruncated || body.truncated;

  metadata.scope = extraction.scope;
  metadata.rows_total = totalRows;
  metadata.rows_included = boundedRows.length;
  metadata.columns_total = totalColumns;
  metadata.columns_included = includedColumns;
  metadata.output_limits = `${MAX_ROWS} rows, ${MAX_COLUMNS} columns, ${BODY_LIMIT} characters`;
  addExtractionMetadata(metadata, {
    contentSource: extraction.contentSource,
    total: totalRows,
    included: boundedRows.length,
    truncated,
    complete: extraction.complete && !truncated,
  });
  return Markdown.buildPageMarkdown(metadata, body.markdown);
}

function gridToMarkdownTable(
  rows: string[][],
  columnCount: number,
  start: { row: number; column: number },
): string {
  const headers = Array.from(
    { length: columnCount },
    (_, index) => columnName(start.column + index),
  );
  const lines = [
    `| Row | ${headers.join(' | ')} |`,
    `| --- | ${headers.map(() => '---').join(' | ')} |`,
  ];
  rows.forEach((row, index) => {
    const cells = Array.from({ length: columnCount }, (_, column) => escapeTableCell(row[column] || ''));
    lines.push(`| ${start.row + index} | ${cells.join(' | ')} |`);
  });
  return lines.join('\n');
}

function getRangeStart(range: string): { row: number; column: number } {
  const reference = range.includes('!') ? range.slice(range.lastIndexOf('!') + 1) : range;
  const match = reference.match(/^\$?([A-Z]+)\$?(\d+)/i);
  if (!match) return { row: 1, column: 0 };

  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]) || 1, column: Math.max(0, column - 1) };
}

function columnName(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function normalizeCell(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function escapeTableCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, '<br>');
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim() || 'Google Sheet';
}
