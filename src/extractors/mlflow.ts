import { metricSeriesToMarkdown, type MetricPoint, type MetricSeries } from '../core/metric-series';
import { DEFAULT_MARKDOWN_LIMIT, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const MAX_METRICS = 50;
const MAX_COMPARISON_RUNS = 10;
const MAX_COMPARISON_METRICS = 12;
const MAX_COMPARISON_SERIES = 50;
const PAGE_SIZE = 2500;
const MAX_POINTS_PER_METRIC = 10_000;
const MAX_COMPARISON_POINTS_PER_METRIC = 2500;
const MAX_METADATA_VALUE_LENGTH = 2_000;

register({
  name: 'MLflow',
  matches: [],
  detect: () => getMlflowRoute() !== null,

  async extract() {
    const route = getMlflowRoute();
    if (!route) return buildDomFallback();
    if (route.kind === 'comparison') {
      return buildComparisonMarkdown(route);
    }
    try {
      const { run, apiBase } = await fetchRun(route);
      return await buildRunMarkdown(route, run, apiBase);
    } catch {
      return buildDomFallback(route);
    }
  },
});

type MlflowRunRoute = {
  kind: 'run';
  runId: string;
  experimentId?: string;
  prefix: string;
};

type MlflowComparisonRoute = {
  kind: 'comparison';
  experimentId: string;
  prefix: string;
  searchFilter: string;
};

type MlflowRoute = MlflowRunRoute | MlflowComparisonRoute;

type MlflowMetric = {
  key?: string;
  value?: unknown;
  timestamp?: unknown;
  step?: unknown;
};

type MlflowRun = {
  info?: {
    run_id?: string;
    run_uuid?: string;
    run_name?: string;
    experiment_id?: string;
    status?: string;
    start_time?: number;
    end_time?: number;
    artifact_uri?: string;
    lifecycle_stage?: string;
    user_id?: string;
  };
  data?: {
    metrics?: MlflowMetric[];
    params?: Array<{ key?: string; value?: unknown }>;
    tags?: Array<{ key?: string; value?: unknown }>;
  };
  inputs?: unknown;
  outputs?: unknown;
};

type HistoryResult = {
  series: MetricSeries;
  truncated: boolean;
};

type ComparisonRun = {
  runId: string;
  name: string;
  run?: MlflowRun;
  apiBase?: string;
};

function getMlflowRoute(): MlflowRoute | null {
  if (!isMlflowPage()) return null;
  const hash = window.location.hash.replace(/^#!?\/?/, '/');
  const queryIndex = hash.indexOf('?');
  const hashPath = queryIndex === -1 ? hash : hash.slice(0, queryIndex);
  const hashSearch = new URLSearchParams(queryIndex === -1 ? '' : hash.slice(queryIndex + 1));
  const prefix = window.location.pathname.replace(/\/+$/, '');
  const hashRunRoute = parseRunPath(hashPath);
  if (hashRunRoute) return { kind: 'run', ...hashRunRoute, prefix };

  const comparisonRoute = parseComparisonPath(hashPath, hashSearch);
  if (comparisonRoute) return { kind: 'comparison', ...comparisonRoute, prefix };

  const pathRunRoute = parseRunPath(window.location.pathname);
  if (!pathRunRoute) return null;
  const marker = window.location.pathname.match(/\/(?:experiments\/[^/]+\/)?runs\//)?.index ?? 0;
  return {
    kind: 'run',
    ...pathRunRoute,
    prefix: window.location.pathname.slice(0, marker).replace(/\/+$/, ''),
  };
}

function isMlflowPage(): boolean {
  if (document.querySelector([
    '#root.mlflow-ui-container',
    '.mlflow-ui-container',
    '[data-component-id^="mlflow."]',
    '[data-testid^="experiment-view-"]',
  ].join(', '))) {
    return true;
  }
  const marker = [
    document.title,
    document.querySelector('meta[name="application-name"]')?.getAttribute('content'),
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content'),
  ].filter(Boolean).join(' ');
  return /\bmlflow\b/i.test(marker);
}

function parseRunPath(path: string): Omit<MlflowRunRoute, 'kind' | 'prefix'> | null {
  const match = path.match(
    /^\/(?:experiments\/([^/?#]+)\/)?runs\/([^/?#]+)(?:\/(?:overview|metrics|artifacts|traces))?\/?$/,
  );
  if (!match) return null;
  try {
    return {
      ...(match[1] ? { experimentId: decodeURIComponent(match[1]) } : {}),
      runId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function parseComparisonPath(
  path: string,
  search: URLSearchParams,
): Omit<MlflowComparisonRoute, 'kind' | 'prefix'> | null {
  const match = path.match(/^\/experiments\/([^/?#]+)\/runs\/?$/);
  if (!match) return null;
  const chartMode = search.get('compareRunsMode')?.toUpperCase() === 'CHART';
  const chartArea = document.querySelector('[data-testid="experiment-view-compare-runs-chart-area"]');
  if (!chartMode && !chartArea) return null;
  try {
    return {
      experimentId: decodeURIComponent(match[1]),
      searchFilter: search.get('searchFilter') || '',
    };
  } catch {
    return null;
  }
}

async function fetchRun(route: MlflowRunRoute): Promise<{ run: MlflowRun; apiBase: string }> {
  return fetchRunById(route.prefix, route.runId);
}

async function fetchRunById(prefix: string, runId: string): Promise<{ run: MlflowRun; apiBase: string }> {
  const apiBases = getApiBases(prefix);
  let lastError: unknown;
  for (const apiBase of apiBases) {
    for (const idParameter of ['run_id', 'run_uuid']) {
      try {
        const payload = await fetchJson(
          `${apiBase}/runs/get?${idParameter}=${encodeURIComponent(runId)}`,
        );
        const run = asRecord(payload.run) as MlflowRun | null;
        if (!run?.info) throw new Error('MLflow run response missing run info');
        return { run, apiBase };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError || new Error('MLflow run unavailable');
}

function getApiBases(prefix: string): string[] {
  const normalized = prefix ? `/${prefix.replace(/^\/+|\/+$/g, '')}` : '';
  return [
    `${window.location.origin}${normalized}/ajax-api/2.0/mlflow`,
    `${window.location.origin}${normalized}/api/2.0/mlflow`,
  ];
}

async function buildRunMarkdown(
  route: MlflowRunRoute,
  run: MlflowRun,
  apiBase: string,
): Promise<string> {
  const info = run.info || {};
  const title = info.run_name || info.run_id || info.run_uuid || route.runId;
  const latestMetrics = (run.data?.metrics || [])
    .filter((metric): metric is MlflowMetric & { key: string } => !!metric.key)
    .sort((left, right) => left.key.localeCompare(right.key));
  const selectedMetrics = latestMetrics.slice(0, MAX_METRICS);
  const histories = await mapWithConcurrency(selectedMetrics, 6, (metric) =>
    fetchMetricHistory(apiBase, route.runId, metric),
  );
  const metricMarkdown = metricSeriesToMarkdown(histories.map(({ series }) => series));
  const metadata: Record<string, string | number | undefined> = {
    source: 'MLflow',
    title,
    url: window.location.href,
    run_id: info.run_id || info.run_uuid || route.runId,
    experiment_id: info.experiment_id || route.experimentId,
    status: info.status,
    user: info.user_id,
    started: formatTimestamp(info.start_time),
    ended: formatTimestamp(info.end_time),
  };
  const parts = [`# ${title}`];
  const details = compactEntries({
    Status: info.status,
    'Lifecycle stage': info.lifecycle_stage,
    'Artifact URI': info.artifact_uri,
  });
  if (details.length > 0) parts.push(details.map(([key, value]) => `- **${key}:** ${value}`).join('\n'));

  const params = keyValueRows(run.data?.params || []);
  if (params.length > 0) parts.push(`## Parameters\n\n${keyValueTable(params)}`);
  const tags = keyValueRows(run.data?.tags || []);
  if (tags.length > 0) parts.push(`## Tags\n\n${keyValueTable(tags)}`);
  parts.push(metricMarkdown.markdown);

  if (latestMetrics.length > MAX_METRICS) {
    parts.push(`*Showing first ${MAX_METRICS} of ${latestMetrics.length} metrics.*`);
  }
  const truncatedHistories = histories.filter(({ truncated }) => truncated).length;
  if (truncatedHistories > 0) {
    parts.push(`*${truncatedHistories} metric histories exceeded ${MAX_POINTS_PER_METRIC} fetched points and were truncated.*`);
  }
  appendJsonSection(parts, 'Inputs', run.inputs);
  appendJsonSection(parts, 'Outputs', run.outputs);
  return buildBoundedPageMarkdown(metadata, parts.join('\n\n'));
}

async function buildComparisonMarkdown(route: MlflowComparisonRoute): Promise<string> {
  const allRunRefs = getVisibleComparisonRuns(route);
  const selectedRunRefs = allRunRefs.slice(0, MAX_COMPARISON_RUNS);
  const runs = await mapWithConcurrency(selectedRunRefs, 4, async (reference): Promise<ComparisonRun> => {
    try {
      const result = await fetchRunById(route.prefix, reference.runId);
      return {
        ...reference,
        name: result.run.info?.run_name || reference.name,
        run: result.run,
        apiBase: result.apiBase,
      };
    } catch {
      return reference;
    }
  });
  const displayedMetricKeys = getDisplayedMetricKeys();
  const availableMetricKeys = getAvailableMetricKeys(runs);
  const metricLimit = Math.max(
    1,
    Math.min(MAX_COMPARISON_METRICS, Math.floor(MAX_COMPARISON_SERIES / Math.max(1, runs.length))),
  );
  const selectedMetricKeys = (displayedMetricKeys.length > 0 ? displayedMetricKeys : availableMetricKeys)
    .slice(0, metricLimit);
  const apiBase = runs.find((run) => run.apiBase)?.apiBase || getApiBases(route.prefix)[0];
  const historyJobs = runs.flatMap((run) => selectedMetricKeys.map((metricKey) => ({ run, metricKey })));
  const histories = await mapWithConcurrency(historyJobs, 6, async ({ run, metricKey }) => {
    const latest = run.run?.data?.metrics?.find((metric) => metric.key === metricKey) || { key: metricKey };
    const result = await fetchMetricHistory(
      run.apiBase || apiBase,
      run.runId,
      { ...latest, key: metricKey },
      MAX_COMPARISON_POINTS_PER_METRIC,
    );
    return {
      ...result,
      series: {
        ...result.series,
        name: `${metricKey} (${run.name})`,
      },
    };
  });
  const metricMarkdown = metricSeriesToMarkdown(
    histories.map(({ series }) => series),
    { maxSeries: MAX_COMPARISON_SERIES, maxHistoryPoints: 2500 },
  );
  const experimentName = getExperimentName(route.experimentId);
  const title = `${experimentName} Run Comparison`;
  const metadata: Record<string, string | number | undefined> = {
    source: 'MLflow',
    title,
    url: window.location.href,
    experiment_id: route.experimentId,
    visible_runs: allRunRefs.length,
    metric_charts: displayedMetricKeys.length,
  };
  const parts = [
    `# ${title}`,
    [
      `- **Visible runs:** ${allRunRefs.length}`,
      `- **Metric charts:** ${displayedMetricKeys.length}`,
    ].join('\n'),
    `## Runs\n\n${comparisonRunTable(runs)}`,
    metricMarkdown.markdown,
  ];
  if (allRunRefs.length > MAX_COMPARISON_RUNS) {
    parts.push(`*Showing first ${MAX_COMPARISON_RUNS} of ${allRunRefs.length} visible runs.*`);
  }
  const metricKeyCount = displayedMetricKeys.length > 0 ? displayedMetricKeys.length : availableMetricKeys.length;
  if (metricKeyCount > selectedMetricKeys.length) {
    parts.push(`*Showing first ${selectedMetricKeys.length} of ${metricKeyCount} matching metric charts.*`);
  }
  const unavailableRuns = runs.filter((run) => !run.run).length;
  if (unavailableRuns > 0) {
    parts.push(`*MLflow API metadata was unavailable for ${unavailableRuns} runs; rendered run names were preserved.*`);
  }
  const truncatedHistories = histories.filter(({ truncated }) => truncated).length;
  if (truncatedHistories > 0) {
    parts.push(`*${truncatedHistories} metric histories exceeded ${MAX_COMPARISON_POINTS_PER_METRIC} fetched points and were truncated.*`);
  }
  if (selectedMetricKeys.length === 0) {
    parts.push('*No loaded numeric metric charts found. Wait for charts to load, then copy again.*');
  }
  return buildBoundedPageMarkdown(metadata, parts.join('\n\n'));
}

function getVisibleComparisonRuns(route: MlflowComparisonRoute): ComparisonRun[] {
  const runs: ComparisonRun[] = [];
  const seen = new Set<string>();
  document.querySelectorAll('.ag-row[row-id]').forEach((row) => {
    const runId = row.getAttribute('row-id')?.trim() || '';
    const visibility = row.querySelector<HTMLInputElement>('.is-visibility-toggle-checkbox');
    const link = row.querySelector<HTMLAnchorElement>('a[href*="/runs/"]');
    if (!runId || !visibility?.checked || !link || seen.has(runId)) return;
    seen.add(runId);
    runs.push({ runId, name: textOf(link) || runId });
  });
  if (runs.length > 0) return runs;

  const quotedValues = route.searchFilter.matchAll(/['"]([^'"]+)['"]/g);
  for (const match of quotedValues) {
    const runId = match[1].trim();
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    runs.push({ runId, name: runId });
  }
  return runs;
}

function getDisplayedMetricKeys(): string[] {
  const keys = new Set<string>();
  document.querySelectorAll('[data-testid="experiment-view-compare-runs-card"] h4').forEach((heading) => {
    const key = heading.getAttribute('title')?.trim() || textOf(heading);
    if (key) keys.add(key);
  });
  return [...keys];
}

function getAvailableMetricKeys(runs: ComparisonRun[]): string[] {
  const filter = document.querySelector<HTMLInputElement>(
    '[data-testid="experiment-view-compare-runs-chart-area"] input[role="searchbox"]',
  )?.value.trim().toLowerCase() || '';
  const keys = new Set<string>();
  runs.forEach(({ run }) => run?.data?.metrics?.forEach(({ key }) => {
    if (key && (!filter || key.toLowerCase().includes(filter))) keys.add(key);
  }));
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function getExperimentName(experimentId: string): string {
  return textOf(document.querySelector('[data-testid="experiment-link"]')) || `Experiment ${experimentId}`;
}

function comparisonRunTable(runs: ComparisonRun[]): string {
  return [
    '| Run | Run ID | Status | Started |',
    '| --- | --- | --- | --- |',
    ...runs.map(({ runId, name, run }) => [
      escapeCell(name),
      escapeCell(runId),
      escapeCell(run?.info?.status || ''),
      escapeCell(formatTimestamp(run?.info?.start_time) || ''),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
  ].join('\n');
}

async function fetchMetricHistory(
  apiBase: string,
  runId: string,
  latest: MlflowMetric & { key: string },
  maxPoints = MAX_POINTS_PER_METRIC,
): Promise<HistoryResult> {
  const points: MetricPoint[] = [];
  let pageToken = '';
  let truncated = false;
  try {
    do {
      const query = new URLSearchParams({
        run_id: runId,
        metric_key: latest.key,
        max_results: String(Math.min(PAGE_SIZE, maxPoints - points.length)),
      });
      if (pageToken) query.set('page_token', pageToken);
      const payload = await fetchJson(`${apiBase}/metrics/get-history?${query}`);
      const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
      for (const raw of metrics) {
        const metric = asRecord(raw);
        const value = metric ? numberValue(metric.value) : null;
        if (value === null) continue;
        const step = numberValue(metric!.step);
        const timestamp = numberValue(metric!.timestamp);
        points.push({
          value,
          ...(step === null ? {} : { step }),
          ...(timestamp === null ? {} : { timestamp }),
        });
        if (points.length >= maxPoints) break;
      }
      pageToken = typeof payload.next_page_token === 'string' ? payload.next_page_token : '';
      if (points.length >= maxPoints && pageToken) truncated = true;
    } while (pageToken && points.length < maxPoints);
  } catch {
    // Latest run metric remains useful when history endpoint is unavailable.
  }

  if (points.length === 0) {
    const value = numberValue(latest.value);
    if (value !== null) {
      const step = numberValue(latest.step);
      const timestamp = numberValue(latest.timestamp);
      points.push({
        value,
        ...(step === null ? {} : { step }),
        ...(timestamp === null ? {} : { timestamp }),
      });
    }
  }
  return { series: { name: latest.key, points }, truncated };
}

async function fetchJson(url: string): Promise<Record<string, any>> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`MLflow API returned ${response.status}`);
  const payload = await response.json();
  const record = asRecord(payload);
  if (!record) throw new Error('MLflow API returned non-object JSON');
  return record;
}

async function buildDomFallback(route = getMlflowRoute()): Promise<string> {
  if (route?.kind === 'comparison') return buildComparisonMarkdown(route);
  const title = textOf(document.querySelector('main h1, [role="main"] h1, h1'))
    || Utils.getPageTitle().replace(/\s*[|·-]\s*MLflow.*$/i, '').trim()
    || route?.runId
    || 'MLflow run';
  const metadata: Record<string, string | undefined> = {
    source: 'MLflow',
    title,
    url: window.location.href,
    run_id: route?.runId,
    experiment_id: route?.experimentId,
  };
  const parts = [`# ${title}`];
  const content = document.querySelector('main, [role="main"]');
  if (content) {
    const clone = content.cloneNode(true) as Element;
    clone.querySelectorAll('nav, button, [role="navigation"], [role="menu"], [aria-hidden="true"], script, style, svg, canvas')
      .forEach((element) => element.remove());
    const visible = Markdown.elementToMarkdown(clone).replace(/^#\s+.*$/m, '').trim();
    if (visible) parts.push(`## Visible Run Content\n\n${visible}`);
  }
  if (parts.length === 1) {
    parts.push('*Metric API unavailable and no rendered run data found. Wait for run page to load, then copy again.*');
  }
  return buildBoundedPageMarkdown(metadata, parts.join('\n\n'));
}

function buildBoundedPageMarkdown(metadata: Record<string, string | number | undefined>, body: string): string {
  const boundedMetadata = boundMetadata(metadata);
  const metadataBlock = Markdown.formatMetadata(boundedMetadata);
  const bodyLimit = Math.max(1, DEFAULT_MARKDOWN_LIMIT - metadataBlock.length - 2);
  return Markdown.buildPageMarkdown(boundedMetadata, limitMarkdown(body, bodyLimit).markdown);
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

function keyValueRows(rows: Array<{ key?: string; value?: unknown }>): Array<[string, string]> {
  return rows.flatMap<[string, string]>(({ key, value }) => {
    const formatted = formatValue(value);
    return key && formatted ? [[key, formatted]] : [];
  }).slice(0, 200);
}

function compactEntries(value: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(value).flatMap(([key, raw]) => {
    const formatted = formatValue(raw);
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

function appendJsonSection(parts: string[], heading: string, value: unknown): void {
  if (value === undefined || value === null) return;
  const formatted = formatValue(value);
  if (!formatted || formatted === '{}' || formatted === '[]') return;
  const json = JSON.stringify(value, null, 2);
  const excerpt = limitText(json, 20_000);
  const language = excerpt === json ? 'json' : '';
  parts.push(`## ${heading}\n\n\`\`\`${language}\n${excerpt}\n\`\`\``);
}

function formatTimestamp(value: number | undefined): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  const date = new Date(value!);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
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

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await callback(values[index]);
    }
  }));
  return results;
}
