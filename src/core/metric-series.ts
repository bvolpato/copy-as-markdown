export type MetricPoint = {
  step?: number;
  timestamp?: number;
  value: number;
};

export type MetricSeries = {
  name: string;
  points: MetricPoint[];
};

export type MetricMarkdownOptions = {
  maxSeries?: number;
  maxHistoryPoints?: number;
};

export type MetricMarkdownResult = {
  markdown: string;
  seriesIncluded: number;
  seriesTotal: number;
  pointsIncluded: number;
  pointsTotal: number;
  truncated: boolean;
};

const SPARKLINE_BLOCKS = '▁▂▃▄▅▆▇█';

export function metricSeriesToMarkdown(
  input: MetricSeries[],
  options: MetricMarkdownOptions = {},
): MetricMarkdownResult {
  const maxSeries = Math.max(1, options.maxSeries ?? 50);
  const maxHistoryPoints = Math.max(1, options.maxHistoryPoints ?? 2000);
  const allSeries = input
    .map((series) => ({
      name: series.name.trim(),
      points: normalizePoints(series.points),
    }))
    .filter((series) => series.name && series.points.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
  const includedSeries = allSeries.slice(0, maxSeries);
  const perSeriesLimit = includedSeries.length > 0
    ? Math.max(1, Math.floor(maxHistoryPoints / includedSeries.length))
    : maxHistoryPoints;
  const history = includedSeries.map((series) => ({
    ...series,
    renderedPoints: sampleEvenly(series.points, perSeriesLimit),
  }));
  const pointsTotal = allSeries.reduce((total, series) => total + series.points.length, 0);
  const pointsIncluded = history.reduce((total, series) => total + series.renderedPoints.length, 0);
  const truncated = includedSeries.length < allSeries.length || pointsIncluded < pointsTotal;

  if (history.length === 0) {
    return {
      markdown: '*No numeric metric history found.*',
      seriesIncluded: 0,
      seriesTotal: 0,
      pointsIncluded: 0,
      pointsTotal: 0,
      truncated: false,
    };
  }

  const parts = [
    '## Metrics Summary',
    [
      '| Metric | Points | Step range | First | Min | Max | Average | Last | Trend |',
      '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |',
      ...history.map(({ name, points }) => {
        const values = points.map(({ value }) => value);
        const steps = points.map(({ step }) => step).filter(isFiniteNumber);
        const stepRange = steps.length > 0
          ? steps[0] === steps[steps.length - 1]
            ? formatNumber(steps[0])
            : `${formatNumber(steps[0])} to ${formatNumber(steps[steps.length - 1])}`
          : '';
        return [
          escapeCell(name),
          String(points.length),
          stepRange,
          formatNumber(values[0]),
          formatNumber(Math.min(...values)),
          formatNumber(Math.max(...values)),
          formatNumber(values.reduce((sum, value) => sum + value, 0) / values.length),
          formatNumber(values[values.length - 1]),
          sparkline(values),
        ].join(' | ').replace(/^/, '| ').replace(/$/, ' |');
      }),
    ].join('\n'),
    '## Metric History',
  ];

  history.forEach(({ name, renderedPoints }) => {
    parts.push(`### ${escapeHeading(name)}`);
    parts.push(metricPointsTable(renderedPoints));
  });

  if (truncated) {
    parts.push(
      `*Showing ${includedSeries.length} of ${allSeries.length} metric series and ${pointsIncluded} of ${pointsTotal} fetched points. History rows are evenly sampled for Markdown context.*`,
    );
  }

  return {
    markdown: parts.join('\n\n'),
    seriesIncluded: includedSeries.length,
    seriesTotal: allSeries.length,
    pointsIncluded,
    pointsTotal,
    truncated,
  };
}

function normalizePoints(points: MetricPoint[]): MetricPoint[] {
  const normalized = points
    .filter(({ value }) => Number.isFinite(value))
    .map(({ step, timestamp, value }) => ({
      step: isFiniteNumber(step) ? step : undefined,
      timestamp: isFiniteNumber(timestamp) ? timestamp : undefined,
      value,
    }));
  normalized.sort((left, right) =>
    (left.step ?? left.timestamp ?? 0) - (right.step ?? right.timestamp ?? 0)
      || (left.timestamp ?? 0) - (right.timestamp ?? 0),
  );
  return normalized;
}

function metricPointsTable(points: MetricPoint[]): string {
  const hasStep = points.some(({ step }) => step !== undefined);
  const hasTime = points.some(({ timestamp }) => timestamp !== undefined);
  const headers = [hasStep ? 'Step' : 'Index', ...(hasTime ? ['Time'] : []), 'Value'];
  const rows = points.map((point, index) => [
    point.step === undefined ? String(index) : formatNumber(point.step),
    ...(hasTime ? [point.timestamp === undefined ? '' : formatTimestamp(point.timestamp)] : []),
    formatNumber(point.value),
  ]);
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map((header) => header === 'Value' ? '---:' : '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n');
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) return values;
  if (limit === 1) return [values[values.length - 1]];
  const indexes = new Set<number>();
  for (let index = 0; index < limit; index++) {
    indexes.add(Math.round(index * (values.length - 1) / (limit - 1)));
  }
  return [...indexes].sort((left, right) => left - right).map((index) => values[index]);
}

function sparkline(values: number[], width = 32): string {
  const sampled = sampleEvenly(values, width);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (min === max) return SPARKLINE_BLOCKS[3].repeat(sampled.length);
  return sampled.map((value) => {
    const index = Math.round((value - min) / (max - min) * (SPARKLINE_BLOCKS.length - 1));
    return SPARKLINE_BLOCKS[index];
  }).join('');
}

function formatTimestamp(value: number): string {
  const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Object.is(value, -0)) return '0';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute >= 1_000_000 || absolute < 0.0001)) {
    return value.toExponential(5).replace(/\.0+e/, 'e').replace(/(\.\d*?[1-9])0+e/, '$1e');
  }
  return Number(value.toPrecision(6)).toString();
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function escapeHeading(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, '').trim();
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
