/**
 * Datadog notebook extractor.
 *
 * Preserves notebook narrative and visualization-cell order while skipping
 * editor controls, chart axes, canvas internals, drag handles, and comments.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import {
  datadogLiveSpanToMs,
  fetchDatadogSeriesCandidates,
  getMetricQueries,
  mapWithConcurrency,
  materializeDatadogQuery,
  type DatadogSeriesCandidate,
} from '../core/datadog-api';
import { getDatadogCanvasSeries } from '../core/datadog-visualization';

register({
  name: 'Datadog Notebook',
  matches: [
    '*://*.datadoghq.com/notebook/*',
    '*://*.datadoghq.eu/notebook/*',
    '*://*.ddog-gov.com/notebook/*',
  ],
  pathnameRegex: /^\/notebook\/\d+(?:\/[^/?#]+)?\/?$/i,
  buttonPlacement: 'anchor',
  extensionPageButton: true,
  anchor: {
    selector: '.NotebooksShareButton',
    position: 'before',
    style: 'link',
    label: 'Copy as Markdown',
    css: {
      alignSelf: 'center',
      gap: '6px',
      minHeight: '32px',
      padding: '0 8px',
      borderRadius: '4px',
      color: 'inherit',
      fontSize: '14px',
      fontWeight: '400',
      lineHeight: '20px',
      opacity: '1',
      whiteSpace: 'nowrap',
    },
  },

  async extract() {
    const title = textOf(document.querySelector('h1.NotebookTitle__text')) ||
      Utils.getPageTitle().replace(/\s*\|\s*Datadog\s*$/, '').trim();
    const metadata: Record<string, string | number> = {
      source: 'Datadog Notebook',
      title,
      url: window.location.href,
    };

    const notebookId = getNotebookId();
    if (notebookId) metadata.notebook_id = notebookId;
    const seriesCandidates = notebookId
      ? await getNotebookSeriesCandidates(notebookId)
      : new Map<string, DatadogSeriesCandidate[]>();
    addMetadata(metadata, 'author', getAuthor());
    addMetadata(metadata, 'notebook_type', textOf(
      document.querySelector('.NotebookTypeButton__typeModalButton .druids_pills_tag__text'),
    ));
    addMetadata(metadata, 'updated', textOf(
      document.querySelector('.Notebook__toggleVersionSidePanel'),
    ));
    addMetadata(metadata, 'access', textOf(
      document.querySelector('.NotebookMetadata__access-pill'),
    ));
    addMetadata(metadata, 'view_mode', textOf(
      document.querySelector('.viewModeSelect [aria-selected="true"]'),
    ));

    const parts = [`# ${title}`];
    const editor = document.querySelector('.dd-rich-text-editor__content .tiptap.ProseMirror');
    if (editor) {
      for (const child of Array.from(editor.children)) {
        const cellMarkdown = extractNotebookChild(child, seriesCandidates);
        if (cellMarkdown) parts.push(cellMarkdown);
      }
    }

    if (parts.length === 1) {
      parts.push('*No notebook cells found. Wait for notebook to finish loading and copy again.*');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n\n'));
  },
});

function getNotebookId(): number | null {
  const match = window.location.pathname.match(/^\/notebook\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function getAuthor(): string {
  const original = document.querySelector(
    '.NotebookMetadata [data-testid="user-pill"] [data-component-name="overflower-original"]',
  );
  return textOf(original) || textOf(
    document.querySelector('.NotebookMetadata [data-testid="user-pill"]'),
  );
}

function addMetadata(
  metadata: Record<string, string | number>,
  key: string,
  value: string,
): void {
  if (value) metadata[key] = value;
}

function extractNotebookChild(
  child: Element,
  seriesCandidates: Map<string, DatadogSeriesCandidate[]>,
): string {
  if (child.matches('.react-renderer.node-widget') || child.querySelector('[data-qa="cell"]')) {
    return summarizeNotebookCell(child, seriesCandidates);
  }

  if (
    child.matches(
      'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr',
    )
  ) {
    return Markdown.elementToMarkdown(child);
  }

  return '';
}

function summarizeNotebookCell(
  container: Element,
  seriesCandidates: Map<string, DatadogSeriesCandidate[]>,
): string {
  const cell = container.querySelector<HTMLElement>('[data-qa="cell"][data-cell]');
  if (!cell) return '';

  const typedCell = cell.querySelector<HTMLElement>('[data-cell-id][data-test-cell-type]');
  const type = typedCell?.dataset.testCellType || 'visualization';
  const titleElement = cell.querySelector<HTMLElement>('[data-toc-graph-title]');
  const title = titleElement?.dataset.tocGraphTitle || textOf(titleElement);
  if (!title) return '';

  const details = [`Type: ${formatType(type)}`];
  const state = cell.querySelector('[data-response-state]')?.getAttribute('data-response-state');
  if (state === 'no-response') {
    details.push('Snapshot: No data');
  } else {
    const annotations = uniqueVisibleTexts(
      cell.querySelectorAll('.dataviz-annotations-renderer [role="note"]'),
    );
    if (annotations.length > 0) details.push(`Snapshot: ${annotations.join('; ')}`);
    const candidates = seriesCandidates.get(typedCell?.dataset.cellId || '') || [];
    getDatadogCanvasSeries(cell, candidates).forEach(({ label, sparkline, stats }, index) => {
      details.push(
        `${label || `Series ${index + 1}`}: ${sparkline}${stats ? ` (${stats})` : ''}`,
      );
    });
  }

  return `### ${title}\n\n${details.map((detail) => `- ${detail}`).join('\n')}`;
}

async function getNotebookSeriesCandidates(
  notebookId: number,
): Promise<Map<string, DatadogSeriesCandidate[]>> {
  try {
    const response = await fetch(
      `/api/v1/notebooks/${encodeURIComponent(String(notebookId))}`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return new Map();
    const payload = await response.json() as NotebookResponse;
    const attributes = payload.data?.attributes;
    if (!attributes) return new Map();

    const variables = getNotebookVariables(attributes.template_variables || []);
    const cells = (attributes.cells || []).filter((cell) =>
      !!cell.id && isRecord(cell.attributes?.definition),
    );
    const results = await mapWithConcurrency(cells, 6, async (cell) => {
      const definition = cell.attributes!.definition!;
      const queries = getMetricQueries(definition).map(({ query, alias }) => ({
        query: materializeDatadogQuery(query, variables),
        alias,
      }));
      const [fromMs, toMs] = getNotebookTimeRange(
        cell.attributes?.time || attributes.time,
      );
      return [
        cell.id!,
        await fetchDatadogSeriesCandidates(queries, fromMs, toMs),
      ] as const;
    });
    return new Map(results);
  } catch {
    return new Map();
  }
}

type NotebookResponse = {
  data?: {
    attributes?: {
      cells?: NotebookCell[];
      template_variables?: Array<Record<string, unknown>>;
      time?: Record<string, unknown> | null;
    };
  };
};

type NotebookCell = {
  id?: string;
  attributes?: {
    definition?: Record<string, unknown>;
    time?: Record<string, unknown> | null;
  };
};

function getNotebookVariables(
  definitions: Array<Record<string, unknown>>,
): Map<string, { prefix: string; value: string }> {
  const selected = new Map<string, string>();
  document.querySelectorAll('fieldset.templateVariableSelect').forEach((field) => {
    if (!isVisible(field)) return;
    const name = textOf(field.querySelector('legend'));
    const value = textOf(field.querySelector('[role="combobox"]'));
    if (name && value && !selected.has(name)) selected.set(name, value);
  });

  const variables = new Map<string, { prefix: string; value: string }>();
  definitions.forEach((definition) => {
    if (typeof definition.name !== 'string') return;
    variables.set(definition.name, {
      prefix: typeof definition.prefix === 'string'
        ? definition.prefix
        : definition.name,
      value: selected.get(definition.name)
        || (typeof definition.default === 'string' ? definition.default : '*'),
    });
  });
  return variables;
}

function getNotebookTimeRange(
  time: Record<string, unknown> | null | undefined,
): [number, number] {
  const params = new URLSearchParams(window.location.search);
  const queryTo = Number(params.get('to_ts'));
  const queryFrom = Number(params.get('from_ts'));
  if (queryFrom && queryTo) return [queryFrom, queryTo];

  const toMs = numberOrDate(time?.to) || numberOrDate(time?.end) || Date.now();
  const fromMs = numberOrDate(time?.from)
    || numberOrDate(time?.start)
    || toMs - datadogLiveSpanToMs(
      typeof time?.live_span === 'string' ? time.live_span : undefined,
      3_600_000,
    );
  return [fromMs, toMs];
}

function numberOrDate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value) || Date.parse(value);
    if (Number.isFinite(parsed)) return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  }
  return 0;
}

function formatType(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function uniqueVisibleTexts(elements: NodeListOf<Element>): string[] {
  const values = new Set<string>();
  elements.forEach((element) => {
    if (!isVisible(element)) return;
    const text = textOf(element);
    if (text) values.add(text);
  });
  return [...values];
}

function isVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  let current: Element | null = element;
  while (current) {
    const style = getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function textOf(element: Element | null): string {
  return (element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
