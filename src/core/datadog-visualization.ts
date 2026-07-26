import type { DatadogSeriesCandidate } from './datadog-api';

export type DatadogCanvasSeries = {
  label?: string;
  sparkline: string;
  stats?: string;
};

const SPARKLINE_LEVELS = '▁▂▃▄▅▆▇█';
const MAX_SPARKLINE_SERIES = 8;
const SPARKLINE_WIDTH = 32;

type AxisScale = {
  slope: number;
  intercept: number;
  cssHeight: number;
  unit: string;
};

type ExtractedCanvasSeries = DatadogCanvasSeries & {
  shape: number[];
};

export function getDatadogCanvasSeries(
  container: Element,
  candidates: DatadogSeriesCandidate[] = [],
): DatadogCanvasSeries[] {
  const canvases = Array.from(
    container.querySelectorAll<HTMLCanvasElement>(
      '.rendering-layers-container .rendering-layer canvas',
    ),
  ).filter((canvas) => canvas.width > 1 && canvas.height > 1);

  const series: ExtractedCanvasSeries[] = [];
  for (const canvas of canvases) {
    const scale = getAxisScale(container, canvas);
    for (const summary of extractCanvasSeries(canvas, scale)) {
      if (!series.some(({ sparkline }) => sparkline === summary.sparkline)) {
        series.push(summary);
      }
      if (series.length >= MAX_SPARKLINE_SERIES) {
        return labelCanvasSeries(series, candidates);
      }
    }
  }
  return labelCanvasSeries(series, candidates);
}

function extractCanvasSeries(
  canvas: HTMLCanvasElement,
  scale: AxisScale | null,
): ExtractedCanvasSeries[] {
  let pixels: Uint8ClampedArray;
  try {
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) return [];
    context.drawImage(canvas, 0, 0);
    pixels = context.getImageData(0, 0, copy.width, copy.height).data;
  } catch {
    return [];
  }

  return getDominantSeriesColors(pixels)
    .map((color) => pixelsToSparkline(
      pixels,
      canvas.width,
      canvas.height,
      color,
      scale,
    ))
    .filter((summary): summary is ExtractedCanvasSeries => !!summary);
}

function getDominantSeriesColors(pixels: Uint8ClampedArray): Array<[number, number, number]> {
  const counts = new Map<string, { color: [number, number, number]; count: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (alpha < 128 || Math.max(red, green, blue) - Math.min(red, green, blue) < 32) continue;

    const key = `${red >> 4},${green >> 4},${blue >> 4}`;
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { color: [red, green, blue], count: 1 });
    }
  }

  const selected: Array<[number, number, number]> = [];
  for (const { color, count } of [...counts.values()].sort((a, b) => b.count - a.count)) {
    if (count < 4 || selected.some((other) => colorDistance(color, other) < 72)) continue;
    selected.push(color);
    if (selected.length >= MAX_SPARKLINE_SERIES) break;
  }
  return selected;
}

function pixelsToSparkline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  color: [number, number, number],
  scale: AxisScale | null,
): ExtractedCanvasSeries | null {
  const values: Array<number | null> = [];
  const sampleWidth = Math.min(SPARKLINE_WIDTH, width);
  for (let bucket = 0; bucket < sampleWidth; bucket++) {
    const startX = Math.floor(bucket * width / sampleWidth);
    const endX = Math.max(startX + 1, Math.floor((bucket + 1) * width / sampleWidth));
    const yValues: number[] = [];
    for (let x = startX; x < endX; x++) {
      for (let y = 0; y < height; y++) {
        const index = (y * width + x) * 4;
        if (
          pixels[index + 3] >= 128
          && colorDistance(color, [pixels[index], pixels[index + 1], pixels[index + 2]]) < 72
        ) {
          yValues.push(y);
        }
      }
    }
    values.push(yValues.length > 0 ? median(yValues) : null);
  }

  if (values.filter((value) => value !== null).length < Math.max(3, sampleWidth / 8)) {
    return null;
  }

  interpolateMissing(values);
  const sampledY = values.filter((value): value is number => value !== null);
  const plotted = sampledY.map((value) => height - value);
  const minimum = Math.min(...plotted);
  const maximum = Math.max(...plotted);
  const sparkline = maximum === minimum
    ? SPARKLINE_LEVELS[0].repeat(plotted.length)
    : plotted.map((value) => {
      const level = Math.round(
        (value - minimum) / (maximum - minimum) * (SPARKLINE_LEVELS.length - 1),
      );
      return SPARKLINE_LEVELS[level];
    }).join('');

  return {
    sparkline,
    stats: scale ? summarizeApproximateStats(sampledY, height, scale) : undefined,
    shape: normalizeShape(plotted),
  };
}

function labelCanvasSeries(
  series: ExtractedCanvasSeries[],
  candidates: DatadogSeriesCandidate[],
): DatadogCanvasSeries[] {
  const selectedCandidates = candidates.length <= MAX_SPARKLINE_SERIES
    ? candidates
    : [...candidates]
      .sort((first, second) => seriesMagnitude(second) - seriesMagnitude(first))
      .slice(0, MAX_SPARKLINE_SERIES);

  if (series.length === 0 || selectedCandidates.length === 0) {
    if (selectedCandidates.length > 0) return selectedCandidates.map(candidateToSeries);
    return series.map(({ sparkline, stats }) => ({ sparkline, stats }));
  }

  const availableSeries = new Set(series.map((_, index) => index));
  const availableCandidates = new Set(selectedCandidates.map((_, index) => index));
  const matches: Array<{ seriesIndex: number; candidateIndex: number; score: number }> = [];

  series.forEach((item, seriesIndex) => {
    selectedCandidates.forEach((candidate, candidateIndex) => {
      matches.push({
        seriesIndex,
        candidateIndex,
        score: shapeSimilarity(item.shape, normalizeShape(
          resample(candidate.values, item.shape.length),
        )),
      });
    });
  });

  const matchedSeries = new Map<number, number>();
  matches.sort((first, second) => second.score - first.score);
  for (const match of matches) {
    if (
      !availableSeries.has(match.seriesIndex)
      || !availableCandidates.has(match.candidateIndex)
    ) {
      continue;
    }
    matchedSeries.set(match.candidateIndex, match.seriesIndex);
    availableSeries.delete(match.seriesIndex);
    availableCandidates.delete(match.candidateIndex);
  }

  return selectedCandidates.map((candidate, candidateIndex) => {
    const seriesIndex = matchedSeries.get(candidateIndex);
    if (seriesIndex === undefined) return candidateToSeries(candidate);
    return {
      label: candidate.label,
      sparkline: series[seriesIndex].sparkline,
      stats: series[seriesIndex].stats,
    };
  });
}

function seriesMagnitude(candidate: DatadogSeriesCandidate): number {
  return candidate.values.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(value)),
    0,
  );
}

function candidateToSeries(candidate: DatadogSeriesCandidate): DatadogCanvasSeries {
  const values = resample(candidate.values, SPARKLINE_WIDTH);
  return {
    label: candidate.label,
    sparkline: valuesToSparkline(values),
    stats: summarizeExactStats(candidate.values),
  };
}

function valuesToSparkline(values: number[]): string {
  const normalized = normalizeShape(values);
  return normalized.map((value) =>
    SPARKLINE_LEVELS[Math.round(value * (SPARKLINE_LEVELS.length - 1))],
  ).join('');
}

function summarizeExactStats(values: number[]): string {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const stats: Array<[string, number]> = [
    ['first', values[0]],
    ['min', Math.min(...values)],
    ['max', Math.max(...values)],
    ['avg', average],
    ['last', values[values.length - 1]],
  ];
  return stats.map(([name, value]) => `${name} ${formatStatNumber(value)}`).join(', ');
}

function resample(values: number[], width: number): number[] {
  if (values.length <= width) return [...values];
  return Array.from({ length: width }, (_, bucket) => {
    const start = Math.floor(bucket * values.length / width);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * values.length / width));
    const slice = values.slice(start, end);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

function normalizeShape(values: number[]): number[] {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum === minimum) return values.map(() => 0);
  return values.map((value) => (value - minimum) / (maximum - minimum));
}

function shapeSimilarity(first: number[], second: number[]): number {
  if (first.length !== second.length || first.length === 0) return -1;
  const firstRange = Math.max(...first) - Math.min(...first);
  const secondRange = Math.max(...second) - Math.min(...second);
  if (firstRange === 0 || secondRange === 0) {
    return firstRange === secondRange ? 1 : -1;
  }

  const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length;
  const secondMean = second.reduce((sum, value) => sum + value, 0) / second.length;
  let numerator = 0;
  let firstVariance = 0;
  let secondVariance = 0;
  for (let index = 0; index < first.length; index++) {
    const firstDelta = first[index] - firstMean;
    const secondDelta = second[index] - secondMean;
    numerator += firstDelta * secondDelta;
    firstVariance += firstDelta ** 2;
    secondVariance += secondDelta ** 2;
  }
  return numerator / Math.sqrt(firstVariance * secondVariance);
}

function getAxisScale(container: Element, canvas: HTMLCanvasElement): AxisScale | null {
  const axis = container.querySelector('.dataviz_y-axis.left, .dataviz_y-axis');
  if (!axis) return null;

  const ticks = Array.from(axis.querySelectorAll('.tick')).map((tick) => {
    const transform = tick.getAttribute('transform') || '';
    const match = transform.match(/translate\(\s*[-+\d.]+(?:px)?[\s,]+([-+\d.]+)/i);
    const value = parseAxisNumber(textOf(tick.querySelector('text')));
    return match && value !== null ? { y: Number(match[1]), value } : null;
  }).filter((tick): tick is { y: number; value: number } => !!tick);
  if (ticks.length < 2) return null;

  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (first.y === last.y) return null;

  const cssHeight = canvas.getBoundingClientRect().height
    || Number.parseFloat(canvas.style.height)
    || canvas.height;
  const slope = (last.value - first.value) / (last.y - first.y);
  return {
    slope,
    intercept: first.value - slope * first.y,
    cssHeight,
    unit: getAxisUnit(axis),
  };
}

function parseAxisNumber(value: string): number | null {
  const match = value.replace(/[$,%]/g, '').replace(/,/g, '').trim()
    .match(/^([-+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([kKmMgGtT])?$/);
  if (!match) return null;
  const multipliers: Record<string, number> = {
    k: 1e3,
    m: 1e6,
    g: 1e9,
    t: 1e12,
  };
  return Number(match[1]) * (match[2] ? multipliers[match[2].toLowerCase()] : 1);
}

function getAxisUnit(axis: Element): string {
  const label = textOf(axis.querySelector('.dataviz_y-axis__label'));
  if (label) return label;
  const tick = textOf(axis.querySelector('.tick text'));
  if (tick.includes('%')) return '%';
  if (tick.includes('$')) return '$';
  return '';
}

function summarizeApproximateStats(
  sampledY: number[],
  canvasHeight: number,
  scale: AxisScale,
): string {
  const values = sampledY.map((y) => {
    const cssY = y * scale.cssHeight / canvasHeight;
    return scale.intercept + scale.slope * cssY;
  });
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const stats: Array<[string, number]> = [
    ['first', values[0]],
    ['min', Math.min(...values)],
    ['max', Math.max(...values)],
    ['avg', average],
    ['last', values[values.length - 1]],
  ];
  const formatted = stats
    .map(([name, value]) => `${name} ${formatStatNumber(value)}`)
    .join(', ');
  return `≈ ${formatted}${scale.unit ? ` ${scale.unit}` : ''}`;
}

function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  if (value === 0) return '0';
  const absolute = Math.abs(value);
  if (absolute >= 1000 || absolute < 0.01) return value.toPrecision(3);
  return String(Number(value.toPrecision(3)));
}

function interpolateMissing(values: Array<number | null>): void {
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== null) continue;
    let left = index - 1;
    let right = index + 1;
    while (left >= 0 && values[left] === null) left--;
    while (right < values.length && values[right] === null) right++;
    if (left >= 0 && right < values.length) {
      const ratio = (index - left) / (right - left);
      values[index] = values[left]! + (values[right]! - values[left]!) * ratio;
    } else if (left >= 0) {
      values[index] = values[left];
    } else if (right < values.length) {
      values[index] = values[right];
    }
  }
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function colorDistance(
  first: [number, number, number],
  second: [number, number, number],
): number {
  return Math.hypot(
    first[0] - second[0],
    first[1] - second[1],
    first[2] - second[2],
  );
}

function textOf(element: Element | null): string {
  return (element?.textContent || '').replace(/\s+/g, ' ').trim();
}
