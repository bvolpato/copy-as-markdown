export type DatadogSeriesCandidate = {
  label: string;
  values: number[];
};

export type DatadogMetricQuery = {
  query: string;
  alias?: string;
};

type ApiSeries = {
  display_name?: string;
  expression?: string;
  pointlist?: Array<[number, number | null]>;
  tag_set?: string[];
};

type ApiResponse = {
  series?: ApiSeries[];
};

export function getMetricQueries(definition: Record<string, unknown>): DatadogMetricQuery[] {
  const requests = Array.isArray(definition.requests) ? definition.requests : [];
  const queries: DatadogMetricQuery[] = [];

  for (const requestValue of requests) {
    if (!isRecord(requestValue)) continue;
    const request = requestValue;

    if (typeof request.q === 'string') {
      queries.push({
        query: request.q,
        alias: getLegacyAlias(request, request.q),
      });
    }

    const namedQueries = Array.isArray(request.queries) ? request.queries : [];
    const formulaAliases = getFormulaAliases(request);
    for (const queryValue of namedQueries) {
      if (
        !isRecord(queryValue)
        || queryValue.data_source !== 'metrics'
        || typeof queryValue.query !== 'string'
      ) {
        continue;
      }
      const name = typeof queryValue.name === 'string' ? queryValue.name : '';
      queries.push({
        query: queryValue.query,
        alias: formulaAliases.get(name),
      });
    }
  }

  return queries;
}

export function materializeDatadogQuery(
  query: string,
  variables: Map<string, { prefix: string; value: string }>,
): string {
  let materialized = query;
  for (const [name, { prefix, value }] of variables) {
    const replacement = !value || value === '*' ? '*' : `${prefix}:${value}`;
    materialized = materialized
      .replace(new RegExp(`\\$${escapeRegExp(name)}\\.value\\b`, 'g'), replacement)
      .replace(new RegExp(`\\$${escapeRegExp(name)}\\b`, 'g'), replacement);
  }
  return materialized;
}

export async function fetchDatadogSeriesCandidates(
  queries: DatadogMetricQuery[],
  fromMs: number,
  toMs: number,
): Promise<DatadogSeriesCandidate[]> {
  const responses = await Promise.all(queries.map(async ({ query, alias }) => {
    try {
      const url = new URL('/api/v1/query', window.location.origin);
      url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
      url.searchParams.set('to', String(Math.floor(toMs / 1000)));
      url.searchParams.set('query', query);
      const response = await fetch(url.toString(), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return [];
      const payload = await response.json() as ApiResponse;
      return (payload.series || []).map((series) => toCandidate(series, alias));
    } catch {
      return [];
    }
  }));

  return deduplicateLabels(responses.flat().filter(
    (candidate): candidate is DatadogSeriesCandidate => candidate !== null,
  ));
}

export function datadogLiveSpanToMs(value: string | undefined, fallbackMs: number): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*([smhdw])$/i);
  if (!match) return fallbackMs;
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };
  return Number(match[1]) * unitMs[match[2].toLowerCase()];
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  transform: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await transform(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function toCandidate(
  series: ApiSeries,
  alias: string | undefined,
): DatadogSeriesCandidate | null {
  const values = (series.pointlist || [])
    .map((point) => point[1])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;

  const tags = (series.tag_set || []).filter(Boolean);
  const baseLabel = alias || series.display_name || series.expression || 'Series';
  const label = tags.length > 0
    ? `${alias ? `${alias} (` : ''}${tags.join(', ')}${alias ? ')' : ''}`
    : baseLabel;
  return { label, values };
}

function deduplicateLabels(candidates: DatadogSeriesCandidate[]): DatadogSeriesCandidate[] {
  const totals = new Map<string, number>();
  candidates.forEach(({ label }) => totals.set(label, (totals.get(label) || 0) + 1));
  const seen = new Map<string, number>();
  return candidates.map((candidate) => {
    if ((totals.get(candidate.label) || 0) === 1) return candidate;
    const index = (seen.get(candidate.label) || 0) + 1;
    seen.set(candidate.label, index);
    return { ...candidate, label: `${candidate.label} ${index}` };
  });
}

function getLegacyAlias(request: Record<string, unknown>, query: string): string | undefined {
  const metadata = Array.isArray(request.metadata) ? request.metadata : [];
  const match = metadata.find((value) =>
    isRecord(value) && value.expression === query && typeof value.alias_name === 'string',
  );
  return isRecord(match) && typeof match.alias_name === 'string'
    ? match.alias_name
    : undefined;
}

function getFormulaAliases(request: Record<string, unknown>): Map<string, string> {
  const aliases = new Map<string, string>();
  const formulas = Array.isArray(request.formulas) ? request.formulas : [];
  formulas.forEach((value) => {
    if (
      isRecord(value)
      && typeof value.formula === 'string'
      && /^[a-zA-Z_]\w*$/.test(value.formula)
      && typeof value.alias === 'string'
    ) {
      aliases.set(value.formula, value.alias);
    }
  });
  return aliases;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
