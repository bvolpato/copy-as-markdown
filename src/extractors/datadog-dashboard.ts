/**
 * Datadog dashboard extractor.
 *
 * Dashboard charts are mostly canvas-rendered. Extract stable semantic DOM:
 * dashboard context, template variables, groups, point values, top lists, and
 * visible chart annotations. Skip axes, controls, watermarks, and resize UI.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import {
  fetchDatadogSeriesCandidates,
  getMetricQueries,
  mapWithConcurrency,
  materializeDatadogQuery,
  type DatadogSeriesCandidate,
} from '../core/datadog-api';
import { getDatadogCanvasSeries } from '../core/datadog-visualization';

type WidgetSummary = {
  title: string;
  detail: string;
  appendix?: string;
};

register({
  name: 'Datadog Dashboard',
  matches: [
    '*://*.datadoghq.com/dashboard/*',
    '*://*.datadoghq.eu/dashboard/*',
    '*://*.ddog-gov.com/dashboard/*',
  ],
  pathnameRegex: /^\/dashboard\/[a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3}(?:\/[^/?#]+)?\/?$/i,
  buttonPlacement: 'anchor',
  extensionPageButton: true,
  anchor: {
    selector: '.dashboard_header__toolbar .actions_trigger',
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
    const title = getDashboardTitle();
    const metadata: Record<string, string> = {
      source: 'Datadog Dashboard',
      title,
      url: window.location.href,
    };

    const timeRange = textOf(
      document.querySelector<HTMLInputElement>('input[aria-label="Time range picker"]'),
    );
    const timezone = textOf(
      document.querySelector('[class*="date-range-picker__time-zone__label"]'),
    );
    if (timeRange) metadata.time_range = timeRange;
    if (timezone) metadata.timezone = timezone;

    const parts: string[] = [`# ${title}`];
    const filters = getTemplateVariables();
    if (filters.length > 0) {
      metadata.filters = JSON.stringify(Object.fromEntries(filters));
    }
    const seriesCandidates = await getDashboardSeriesCandidates(filters);

    let emittedWidgetCount = 0;
    const groupedWidgets = new Set<Element>();
    const groups = getDashboardGroups();
    for (const group of groups) {
      const groupTitle = getGroupTitle(group);
      const widgets = Array.from(group.querySelectorAll('.dashboard_widget'));
      widgets.forEach((widget) => groupedWidgets.add(widget));

      if (!groupTitle || widgets.length === 0) continue;
      parts.push(`## ${groupTitle}`);
      emittedWidgetCount += await appendWidgetTable(parts, widgets, seriesCandidates);
    }

    const ungrouped = Array.from(document.querySelectorAll('.dashboard_widget'))
      .filter((widget) => !groupedWidgets.has(widget));
    if (ungrouped.length > 0) {
      parts.push('## Other widgets');
      emittedWidgetCount += await appendWidgetTable(parts, ungrouped, seriesCandidates);
    }

    if (emittedWidgetCount === 0) {
      parts.push('*No dashboard widgets found. Wait for dashboard to finish loading and copy again.*');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n\n'));
  },
});

function getDashboardTitle(): string {
  return textOf(
    document.querySelector(
      '.new-dashboard-header__board_title h1, .new-dashboard-header__title-wrapper h1, h1.new-dashboard-header__title-wrapper',
    ),
  ) || Utils.getPageTitle().replace(/\s*\|\s*Datadog\s*$/, '').trim();
}

function getTemplateVariables(): Array<[string, string]> {
  const visibleRow =
    document.querySelector('.dashboard_header__bottom-row .template-variable-list') ||
    document.querySelector('.dashboard_header__template-var-row .template-variable-list');
  if (!visibleRow) return [];

  const variables: Array<[string, string]> = [];
  const seen = new Set<string>();
  visibleRow.querySelectorAll('fieldset.templateVariableSelect').forEach((field) => {
    if (!isVisible(field)) return;
    const name = textOf(field.querySelector('legend'));
    const value = textOf(field.querySelector('[role="combobox"]'));
    if (!name || !value || seen.has(name)) return;
    seen.add(name);
    variables.push([name, value]);
  });
  return variables;
}

function getDashboardGroups(): Element[] {
  return Array.from(
    document.querySelectorAll('.multi-size-layout__group[data-testid^="group-"]'),
  ).filter((group) => !!group.querySelector('.group-header__title'));
}

function getGroupTitle(group: Element): string {
  return textOf(
    group.querySelector('.group-header__title [data-component-name="overflower-original"]'),
  ) || textOf(group.querySelector('.group-header__title'));
}

async function appendWidgetTable(
  parts: string[],
  widgets: Element[],
  seriesCandidates: Map<string, DatadogSeriesCandidate[]>,
): Promise<number> {
  const summaries = (await Promise.all(widgets.map((widget) =>
    summarizeWidget(widget, seriesCandidates.get(getWidgetId(widget)) || []),
  )))
    .filter((summary): summary is WidgetSummary => summary !== null);
  if (summaries.length === 0) return 0;

  parts.push([
    '| Widget | Snapshot |',
    '| --- | --- |',
    ...summaries.map(({ title, detail }) =>
      `| ${escapeCell(title)} | ${escapeCell(detail)} |`,
    ),
  ].join('\n'));
  summaries.forEach(({ appendix }) => {
    if (appendix) parts.push(appendix);
  });
  return summaries.length;
}

async function summarizeWidget(
  widget: Element,
  candidates: DatadogSeriesCandidate[],
): Promise<WidgetSummary | null> {
  const accessibleTitle = widget.querySelector(
    ':scope > [role="group"] > button[aria-label]',
  );
  const title = textOf(
    widget.querySelector('[data-testid="widget-title"], .widget__title-text'),
  ) || accessibleTitle?.getAttribute('aria-label')?.trim() || '';
  if (!title) return null;

  const queryValue = getQueryValue(widget);
  if (queryValue) return { title, detail: queryValue };

  const topList = getTopList(widget);
  if (topList.length > 0) {
    const unit = textOf(widget.querySelector('.stacked-toplist__unit-label'));
    return {
      title,
      detail: `${topList.length} ${topList.length === 1 ? 'entry' : 'entries'}${unit ? ` (${unit})` : ''}`,
      appendix: buildDetailTable(title, 'Name', 'Value', topList),
    };
  }

  const dataTable = getDataTable(widget);
  if (dataTable) {
    return {
      title,
      detail: 'Table below',
      appendix: `### ${title}\n\n${dataTable}`,
    };
  }

  const annotations = uniqueTexts(
    widget.querySelectorAll(
      '.dataviz-annotations-renderer [role="note"], [role="note"]',
    ),
  );

  if (widget.querySelector('.widget.timeseries')) {
    const sparklines = getDatadogCanvasSeries(widget, candidates);
    if (sparklines.length > 0) {
      const series = sparklines
        .map(({ label, sparkline, stats }, index) =>
          `${label || `Series ${index + 1}`}: ${sparkline}${stats ? ` (${stats})` : ''}`,
        )
        .join('; ');
      const values = annotations.length > 0 ? `Values: ${annotations.join(', ')}; ` : '';
      return { title, detail: `${values}${series}` };
    }
  }

  if (annotations.length > 0) {
    return { title, detail: annotations.join('; ') };
  }

  const responseState = widget.querySelector('[data-response-state]')?.getAttribute('data-response-state');
  if (responseState === 'no-response') return { title, detail: 'No data' };

  return { title, detail: getWidgetType(widget) };
}

async function getDashboardSeriesCandidates(
  filters: Array<[string, string]>,
): Promise<Map<string, DatadogSeriesCandidate[]>> {
  const dashboardId = window.location.pathname.match(
    /^\/dashboard\/([a-z0-9]{3}-[a-z0-9]{3}-[a-z0-9]{3})/i,
  )?.[1];
  if (!dashboardId) return new Map();

  try {
    const response = await fetch(
      `/api/v1/dashboard/${encodeURIComponent(dashboardId)}`,
      { credentials: 'include', headers: { Accept: 'application/json' } },
    );
    if (!response.ok) return new Map();
    const dashboard = await response.json() as DashboardDefinition;
    const definitions = flattenWidgetDefinitions(dashboard.widgets || []);
    const variables = getDashboardVariables(dashboard.template_variables || [], filters);
    const [fromMs, toMs] = getDashboardTimeRange();
    const entries = [...definitions.entries()].filter(([, definition]) =>
      definition.type === 'timeseries',
    );
    const results = await mapWithConcurrency(entries, 6, async ([id, definition]) => {
      const queries = getMetricQueries(definition)
        .map(({ query, alias }) => ({
          query: materializeDatadogQuery(query, variables),
          alias,
        }));
      return [id, await fetchDatadogSeriesCandidates(queries, fromMs, toMs)] as const;
    });
    return new Map(results);
  } catch {
    return new Map();
  }
}

type DashboardDefinition = {
  template_variables?: Array<Record<string, unknown>>;
  widgets?: Array<Record<string, unknown>>;
};

function flattenWidgetDefinitions(
  widgets: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const definitions = new Map<string, Record<string, unknown>>();
  widgets.forEach((widget) => {
    const id = typeof widget.id === 'number' || typeof widget.id === 'string'
      ? String(widget.id)
      : '';
    const definition = isRecord(widget.definition) ? widget.definition : null;
    if (id && definition) definitions.set(id, definition);
    if (definition && Array.isArray(definition.widgets)) {
      const children = definition.widgets.filter(isRecord);
      flattenWidgetDefinitions(children).forEach((child, childId) => {
        definitions.set(childId, child);
      });
    }
  });
  return definitions;
}

function getDashboardVariables(
  definitions: Array<Record<string, unknown>>,
  filters: Array<[string, string]>,
): Map<string, { prefix: string; value: string }> {
  const selected = new Map(filters);
  const variables = new Map<string, { prefix: string; value: string }>();
  definitions.forEach((definition) => {
    if (typeof definition.name !== 'string') return;
    const prefix = typeof definition.prefix === 'string'
      ? definition.prefix
      : definition.name;
    const fallback = typeof definition.default === 'string' ? definition.default : '*';
    variables.set(definition.name, {
      prefix,
      value: selected.get(definition.name) || fallback,
    });
  });
  return variables;
}

function getDashboardTimeRange(): [number, number] {
  const params = new URLSearchParams(window.location.search);
  const toMs = Number(params.get('to_ts')) || Date.now();
  const fromMs = Number(params.get('from_ts')) || toMs - 3_600_000;
  return [fromMs, toMs];
}

function getWidgetId(widget: Element): string {
  return widget.id.match(/^widget_(.+)$/)?.[1]
    || widget.getAttribute('data-testid')?.match(/^widget-(.+)$/)?.[1]
    || '';
}

function getQueryValue(widget: Element): string {
  const noData = widget.querySelector('.query-value__container--no-data');
  if (noData) return normalizeNoData(textOf(noData));

  const value = textOf(widget.querySelector('.query-value__value'));
  if (!value) return '';

  const unit = textOf(
    widget.querySelector(
      '.query-value__unit, .query-value__unit-container, [class*="query-value__unit"]',
    ),
  );
  if (!unit || value.endsWith(unit)) return value;
  return `${value} ${unit}`.replace(/\s+([/%$])/g, ' $1').trim();
}

function getTopList(widget: Element): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  widget.querySelectorAll('.stacked-toplist__item').forEach((item) => {
    const value = textOf(
      item.querySelector('.stacked-toplist__value-label, [class*="value-label"]'),
    );
    const labelElement = item.querySelector(
      '[data-synthetics-toplist-label], [data-testid*="toplist-label"], '
        + '[class*="label"]:not([class*="value-label"]):not([class*="unit-label"])',
    );
    const label = labelElement?.getAttribute('data-synthetics-toplist-label')?.trim()
      || labelElement?.getAttribute('aria-label')?.trim()
      || textOf(labelElement);
    if (!label && !value) return;
    rows.push([label || 'Value', value || 'No value']);
  });
  return rows;
}

function getDataTable(widget: Element): string {
  const nativeTable = Array.from(widget.querySelectorAll('table')).find(isVisible);
  if (nativeTable) return Markdown.tableToMarkdown(nativeTable);

  const roleTable = Array.from(widget.querySelectorAll('[role="table"], [role="grid"]'))
    .find(isVisible);
  if (!roleTable) return '';

  const rows = Array.from(roleTable.querySelectorAll('[role="row"]'))
    .filter(isVisible)
    .map((row) => Array.from(
      row.querySelectorAll(':scope > [role="columnheader"], :scope > [role="rowheader"], :scope > [role="cell"], :scope > [role="gridcell"]'),
    ).filter(isVisible).map(textOf))
    .filter((row) => row.some(Boolean));
  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((row) => row.length));
  rows.forEach((row) => {
    while (row.length < width) row.push('');
  });
  return buildMarkdownTable(rows);
}

function buildDetailTable(
  title: string,
  firstHeader: string,
  secondHeader: string,
  rows: Array<[string, string]>,
): string {
  return [
    `### ${title}`,
    '',
    `| ${firstHeader} | ${secondHeader} |`,
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${escapeCell(label)} | ${escapeCell(value)} |`),
  ].join('\n');
}

function buildMarkdownTable(rows: string[][]): string {
  const escaped = rows.map((row) => row.map(escapeCell));
  return [
    `| ${escaped[0].join(' | ')} |`,
    `| ${escaped[0].map(() => '---').join(' | ')} |`,
    ...escaped.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function getWidgetType(widget: Element): string {
  const root = widget.querySelector('.widget');
  if (!root) return 'Widget';
  if (root.classList.contains('timeseries')) return 'Timeseries chart';
  if (root.classList.contains('toplist')) return 'Top list';
  if (root.classList.contains('query_table')) return 'Table';
  if (root.classList.contains('heatmap')) return 'Heatmap';
  if (root.classList.contains('distribution')) return 'Distribution chart';
  if (root.classList.contains('note')) return 'Note';
  return 'Widget';
}

function uniqueTexts(elements: NodeListOf<Element>): string[] {
  const values = new Set<string>();
  elements.forEach((element) => {
    if (!isVisible(element)) return;
    const text = textOf(element);
    if (text) values.add(text);
  });
  return [...values];
}

function isVisible(element: Element): boolean {
  if (
    element.closest('[hidden], [aria-hidden="true"]') ||
    getComputedStyle(element).display === 'none' ||
    getComputedStyle(element).visibility === 'hidden'
  ) {
    return false;
  }

  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    parent = parent.parentElement;
  }
  return true;
}

function textOf(element: Element | null): string {
  if (!element) return '';
  if (element instanceof HTMLInputElement) return element.value.trim();
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

function normalizeNoData(value: string): string {
  return value.replace(/[()]/g, '').trim() || 'No data';
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
