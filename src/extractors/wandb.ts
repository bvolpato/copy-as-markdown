import { metricSeriesToMarkdown, type MetricSeries } from '../core/metric-series';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const MAX_METRICS = 50;
const HISTORY_SAMPLES = 500;
const MAX_METADATA_VALUE_LENGTH = 2_000;

register({
  name: 'Weights & Biases',
  matches: [
    '*://wandb.ai/*/*/runs/*',
  ],
  pathnameRegex: /^\/[^/]+\/[^/]+\/runs\/[^/?#]+(?:\/.*)?$/,
  detect: isWandbRunPage,
  extensionPageButton: true,

  async extract() {
    const route = getWandbRunRoute();
    if (!route) return buildDomFallback();

    try {
      const apiHost = getWandbApiHost();
      const run = await fetchRun(apiHost, route);
      const allMetricKeys = getNumericMetricKeys(run.historyKeys);
      const metricKeys = allMetricKeys.slice(0, MAX_METRICS);
      const rows = metricKeys.length > 0
        ? await fetchSampledHistory(apiHost, route, metricKeys)
        : [];
      const series = historyRowsToSeries(rows, metricKeys);
      const summary = parseJsonRecord(run.summaryMetrics);
      const resolvedSeries = series.length > 0 ? series : summaryToSeries(summary);
      return buildRunMarkdown(route, run, resolvedSeries, allMetricKeys.length);
    } catch {
      return buildDomFallback(route);
    }
  },
});

type WandbRoute = {
  entity: string;
  project: string;
  runId: string;
};

type WandbRun = {
  name?: string;
  displayName?: string;
  state?: string;
  config?: unknown;
  group?: string;
  jobType?: string;
  commit?: string;
  createdAt?: string;
  heartbeatAt?: string;
  description?: string;
  notes?: string;
  summaryMetrics?: unknown;
  historyLineCount?: number;
  historyKeys?: unknown;
  user?: { name?: string; username?: string };
};

function getWandbRunRoute(): WandbRoute | null {
  const match = window.location.pathname.match(
    /^\/([^/]+)\/([^/]+)\/runs\/([^/?#]+)(?:\/.*)?$/,
  );
  if (!match) return null;
  try {
    return {
      entity: decodeURIComponent(match[1]),
      project: decodeURIComponent(match[2]),
      runId: decodeURIComponent(match[3]),
    };
  } catch {
    return null;
  }
}

function isWandbRunPage(): boolean {
  if (!getWandbRunRoute()) return false;
  if (/(?:^|\.)wandb\.ai$/i.test(window.location.hostname)) return true;
  const marker = [
    document.title,
    document.querySelector('meta[name="application-name"]')?.getAttribute('content'),
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content'),
  ].filter(Boolean).join(' ');
  return /(?:weights\s*&\s*biases|\bwandb\b|\bw&b\b)/i.test(marker);
}

function getWandbApiHost(): string {
  const configured = (window as Window & {
    CONFIG?: { BACKEND_HOST?: unknown };
  }).CONFIG?.BACKEND_HOST;
  if (typeof configured === 'string' && /^https?:\/\//.test(configured)) {
    return configured.replace(/\/$/, '');
  }
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'wandb.ai' || hostname.endsWith('.wandb.ai')) {
    return 'https://api.wandb.ai';
  }
  if (hostname.startsWith('app.')) {
    return `${window.location.protocol}//api.${hostname.slice(4)}${portSuffix()}`;
  }
  return window.location.origin;
}

function portSuffix(): string {
  return window.location.port ? `:${window.location.port}` : '';
}

async function fetchRun(apiHost: string, route: WandbRoute): Promise<WandbRun> {
  const query = `query CopyAsMarkdownRun($project: String!, $entity: String!, $name: String!) {
    project(name: $project, entityName: $entity) {
      run(name: $name) {
        name displayName state config group jobType commit createdAt heartbeatAt
        description notes summaryMetrics historyLineCount historyKeys
        user { name username }
      }
    }
  }`;
  const payload = await fetchGraphql(apiHost, query, {
    entity: route.entity,
    project: route.project,
    name: route.runId,
  });
  const project = asRecord(payload.project);
  const run = project ? asRecord(project.run) : null;
  if (!run) throw new Error('W&B run not found');
  return run as WandbRun;
}

async function fetchSampledHistory(
  apiHost: string,
  route: WandbRoute,
  metricKeys: string[],
): Promise<Array<Record<string, unknown>>> {
  const query = `query RunSampledHistory($project: String!, $entity: String!, $name: String!, $specs: [JSONString!]!) {
    project(name: $project, entityName: $entity) {
      run(name: $name) { sampledHistory(specs: $specs) }
    }
  }`;
  const payload = await fetchGraphql(apiHost, query, {
    entity: route.entity,
    project: route.project,
    name: route.runId,
    specs: [JSON.stringify({ keys: ['_step', '_timestamp', ...metricKeys], samples: HISTORY_SAMPLES })],
  });
  const project = asRecord(payload.project);
  const run = project ? asRecord(project.run) : null;
  const sampled = run?.sampledHistory;
  const rows = Array.isArray(sampled) && Array.isArray(sampled[0]) ? sampled[0] : sampled;
  return Array.isArray(rows)
    ? rows.map(asRecord).filter((row): row is Record<string, unknown> => !!row)
    : [];
}

async function fetchGraphql(
  apiHost: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiHost}/graphql`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`W&B API returned ${response.status}`);
  const result = await response.json() as { data?: unknown; errors?: unknown };
  if (result.errors || !asRecord(result.data)) throw new Error('W&B GraphQL query failed');
  return result.data as Record<string, unknown>;
}

function getNumericMetricKeys(rawHistoryKeys: unknown): string[] {
  const historyKeys = parseJsonRecord(rawHistoryKeys);
  const keys = asRecord(historyKeys.keys) || historyKeys;
  return Object.entries(keys)
    .filter(([key, value]) => {
      if (key.startsWith('_') || key.startsWith('system/')) return false;
      const record = asRecord(value);
      const typeCounts = record && Array.isArray(record.typeCounts) ? record.typeCounts : [];
      return typeCounts.some((entry) => asRecord(entry)?.type === 'number')
        || typeof record?.previousValue === 'number';
    })
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function historyRowsToSeries(
  rows: Array<Record<string, unknown>>,
  metricKeys: string[],
): MetricSeries[] {
  return metricKeys.map((name) => ({
    name,
    points: rows.flatMap((row) => {
      const value = numberValue(row[name]);
      if (value === null) return [];
      const step = numberValue(row._step);
      const timestamp = numberValue(row._timestamp);
      return [{
        value,
        ...(step === null ? {} : { step }),
        ...(timestamp === null ? {} : { timestamp }),
      }];
    }),
  })).filter(({ points }) => points.length > 0);
}

function summaryToSeries(summary: Record<string, unknown>): MetricSeries[] {
  return Object.entries(summary)
    .filter(([key, value]) => !key.startsWith('_') && numberValue(value) !== null)
    .slice(0, MAX_METRICS)
    .map(([name, value]) => ({ name, points: [{ value: value as number }] }));
}

function buildRunMarkdown(
  route: WandbRoute,
  run: WandbRun,
  series: MetricSeries[],
  numericMetricCount: number,
): string {
  const title = run.displayName || run.name || route.runId;
  const metadata: Record<string, string | number | undefined> = {
    source: 'Weights & Biases',
    title,
    url: window.location.href,
    entity: route.entity,
    project: route.project,
    run_id: route.runId,
    state: run.state,
    author: run.user?.name || run.user?.username,
    created: run.createdAt,
    updated: run.heartbeatAt,
  };
  const parts = [`# ${title}`];
  const details = compactEntries({
    State: run.state,
    Group: run.group,
    'Job type': run.jobType,
    Commit: run.commit,
  });
  if (details.length > 0) parts.push(details.map(([key, value]) => `- **${key}:** ${value}`).join('\n'));
  if (run.description) parts.push(`## Description\n\n${limitText(run.description, 10_000)}`);
  if (run.notes && run.notes !== run.description) parts.push(`## Notes\n\n${limitText(run.notes, 10_000)}`);

  const config = parseJsonRecord(run.config);
  const configRows = compactEntries(config, true).slice(0, 100);
  if (configRows.length > 0) {
    parts.push('## Configuration');
    parts.push(keyValueTable(configRows));
  }

  const metrics = metricSeriesToMarkdown(series);
  parts.push(metrics.markdown);
  const historyLineCount = numberValue(run.historyLineCount);
  if (
    historyLineCount !== null
    && historyLineCount > HISTORY_SAMPLES
    && numericMetricCount > 0
  ) {
    parts.push(`*W&B API returned sampled history: up to ${HISTORY_SAMPLES} rows from ${historyLineCount} logged history rows.*`);
  }
  if (numericMetricCount > MAX_METRICS) {
    parts.push(`*Showing first ${MAX_METRICS} of ${numericMetricCount} numeric metric keys.*`);
  }
  return buildBoundedPageMarkdown(metadata, parts.join('\n\n'));
}

function buildDomFallback(route = getWandbRunRoute()): string {
  const title = textOf(document.querySelector('main h1, [role="main"] h1, h1'))
    || Utils.getPageTitle().replace(/\s*[|·-]\s*(?:Weights\s*&\s*Biases|W&B|wandb).*$/i, '').trim()
    || route?.runId
    || 'Weights & Biases run';
  const metadata: Record<string, string | undefined> = {
    source: 'Weights & Biases',
    title,
    url: window.location.href,
    entity: route?.entity,
    project: route?.project,
    run_id: route?.runId,
  };
  const parts = [`# ${title}`];
  const content = document.querySelector('main, [role="main"]');
  if (content) {
    const clone = content.cloneNode(true) as Element;
    clone.querySelectorAll('nav, button, [role="navigation"], [role="menu"], [aria-hidden="true"], script, style, svg, canvas')
      .forEach((element) => element.remove());
    const visible = Markdown.elementToMarkdown(clone)
      .replace(/^#\s+.*$/m, '')
      .trim();
    if (visible) parts.push(`## Visible Run Content\n\n${visible}`);
  }
  if (parts.length === 1) {
    parts.push('*Metric API unavailable and no rendered run data found. Wait for run page to load, then copy again.*');
  }
  return buildBoundedPageMarkdown(metadata, parts.join('\n\n'));
}

function buildBoundedPageMarkdown(metadata: Record<string, string | number | undefined>, body: string): string {
  const boundedMetadata = boundMetadata(metadata);
  return Markdown.buildPageMarkdown(boundedMetadata, body);
}

function boundMetadata(
  metadata: Record<string, string | number | undefined>,
): Record<string, string | number | undefined> {
  const bounded: Record<string, string | number | undefined> = {};
  for (const [key, value] of Object.entries(metadata)) {
    bounded[key] = typeof value === 'string'
      ? limitText(value, MAX_METADATA_VALUE_LENGTH)
      : value;
  }
  return bounded;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value)) || {};
    } catch {
      return {};
    }
  }
  return asRecord(value) || {};
}

function compactEntries(
  value: Record<string, unknown>,
  unwrapConfig = false,
): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, raw]) => {
    if (key.startsWith('_')) return [];
    const record = asRecord(raw);
    const resolved = unwrapConfig && record && 'value' in record ? record.value : raw;
    const formatted = formatValue(resolved);
    return formatted ? [[key, formatted]] : [];
  });
}

function keyValueTable(rows: Array<[string, string]>): string {
  return [
    '| Key | Value |',
    '| --- | --- |',
    ...rows.map(([key, value]) => `| ${escapeCell(key)} | ${escapeCell(value)} |`),
  ].join('\n');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return limitText(String(value), 2000);
  }
  try {
    return limitText(JSON.stringify(value), 2000);
  } catch {
    return '';
  }
}

function limitText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 14)}... [truncated]`;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}
