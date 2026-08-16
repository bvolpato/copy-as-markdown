/** DeepSWE benchmark, leaderboard, blog, and task-page extractor. */

import { addExtractionMetadata, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;

type LeaderboardArtifact = {
  version: string;
  path: string;
  data: JsonRecord;
  rows: JsonRecord[];
};

register({
  name: 'DeepSWE',
  matches: ['*://deepswe.datacurve.ai/*'],

  async extract() {
    if (isLeaderboardPage()) return extractLeaderboardPage();
    return extractContentPage();
  },
});

function isLeaderboardPage(): boolean {
  return window.location.pathname === '/' || document.querySelector('#leaderboard') !== null;
}

async function extractLeaderboardPage(): Promise<string> {
  const title = textOf(document.querySelector('main h1')) || Utils.getPageTitle() || 'DeepSWE';
  const version = activeBenchmarkVersion();
  const artifact = await fetchLeaderboardArtifact(version);
  const rows = artifact?.rows.length ? artifact.rows : rowsFromDom();
  const parts: string[] = [`# ${title}`];

  appendIntroduction(parts);
  appendOverview(parts);
  appendLeaderboard(parts, artifact?.data || null, rows, version);
  appendBenchmarkDescription(parts);
  appendTaskExamples(parts);
  appendBlogOutline(parts);
  appendSources(parts, artifact?.path || `/artifacts/${version}/leaderboard-live.json`);

  const metadata: Record<string, string | number> = {
    source: 'DeepSWE',
    title,
    url: Utils.getCanonicalUrl(),
    benchmark_version: version,
  };
  addExtractionMetadata(metadata, {
    contentSource: artifact ? 'published leaderboard artifact and live page DOM' : 'live page DOM',
    total: rows.length,
    included: rows.length,
    complete: artifact !== null,
  });

  const limited = limitMarkdown(Markdown.cleanMarkdown(parts.filter(Boolean).join('\n\n')));
  metadata.truncated = String(limited.truncated);
  if (limited.truncated) metadata.complete = 'false';
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

async function extractContentPage(): Promise<string> {
  const main = document.querySelector('main, article, [role="main"]') || document.body;
  const title = textOf(main.querySelector('h1')) || Utils.getPageTitle() || 'DeepSWE';
  const cleaned = Utils.removeNoise(main, [
    ...Utils.NOISE_SELECTORS,
    'svg', 'form', 'button', '#updates',
    '[data-slot="popover-content"]', '[role="dialog"]',
  ]);
  const limited = limitMarkdown(Markdown.elementToMarkdown(cleaned));
  const metadata: Record<string, string> = {
    source: 'DeepSWE',
    title,
    url: Utils.getCanonicalUrl(),
  };
  addExtractionMetadata(metadata, {
    contentSource: 'cleaned live page DOM',
    truncated: limited.truncated,
    complete: !limited.truncated,
  });
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function activeBenchmarkVersion(): string {
  const candidates = Array.from(
    document.querySelectorAll('#leaderboard button[aria-pressed="true"]'),
  ).map((element) => textOf(element));
  return candidates.find((value) => /^v\d+(?:\.\d+)*$/i.test(value)) || 'v1.1';
}

async function fetchLeaderboardArtifact(version: string): Promise<LeaderboardArtifact | null> {
  const safeVersion = /^v\d+(?:\.\d+)*$/i.test(version) ? version : 'v1.1';
  const path = `/artifacts/${safeVersion}/leaderboard-live.json`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = asRecord(await response.json());
    const rows = recordArray(data?.rows);
    if (!data || rows.length === 0) return null;
    return { version: safeVersion, path, data, rows };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function appendIntroduction(parts: string[]): void {
  const tagline = firstText([
    textOf(document.querySelector('main header p')),
    Utils.getMeta('description'),
  ]);
  if (tagline) parts.push(tagline);

  const links = [
    linkFor('a[href="/blog"]', 'Read blog'),
    linkFor('a[href="/run"]', 'Run DeepSWE'),
  ].filter(Boolean);
  if (links.length > 0) parts.push(links.map((link) => `- ${link}`).join('\n'));
}

function appendOverview(parts: string[]): void {
  const rows = Array.from(document.querySelectorAll('main header dl > div')).map((element) => [
    textOf(element.querySelector('dt')),
    textOf(element.querySelector('dd')),
  ]).filter((row) => row[0] && row[1]);
  if (rows.length > 0) parts.push(`## Benchmark Overview\n\n${table(['Field', 'Value'], rows)}`);
}

function appendLeaderboard(
  parts: string[],
  artifact: JsonRecord | null,
  rows: JsonRecord[],
  version: string,
): void {
  if (rows.length === 0) return;

  const metadataRows: string[][] = [];
  pushMetadataRow(metadataRows, 'Version', version);
  pushMetadataRow(metadataRows, 'Configurations', rows.length);
  pushMetadataRow(metadataRows, 'Tasks in set', artifact?.n_tasks_in_set);
  pushMetadataRow(metadataRows, 'Generated at', artifact?.generated_at);
  const latestJob = asRecord(artifact?.latest_job);
  pushMetadataRow(metadataRows, 'Latest job', latestJob?.name);
  pushMetadataRow(metadataRows, 'Latest job finished at', latestJob?.finished_at);

  const context = selectedLeaderboardContext();
  if (context) pushMetadataRow(metadataRows, 'Page selection', context);

  parts.push(`## Leaderboard\n\n${table(['Field', 'Value'], metadataRows)}`);

  const scope = stringValue(artifact?.scope);
  const unit = stringValue(artifact?.unit);
  if (scope) parts.push(`**Scope:** ${scope}`);
  if (unit) parts.push(`**Scoring:** ${unit}`);

  const summaryRows = rows.map((row) => [
    displayModel(row),
    stringValue(row.reasoning_effort) || 'default',
    formatPercent(row.pass_at_1 ?? row.pass_rate),
    formatInterval(row.ci_lo, row.ci_hi),
    formatPercent(row.pass_at_4),
    ratio(row.n_passed, row.n_attempted),
    ratio(row.n_tasks_passed_any, row.n_tasks_attempted),
    exactValue(row.n_runs),
    formatUsd(row.mean_cost_usd),
    formatCount(row.mean_output_tokens),
    formatDecimal(row.mean_agent_steps, 1),
  ]);
  parts.push(`### All Published Configurations (${rows.length})\n\n${table([
    'Model', 'Effort', 'Pass@1', '95% CI', 'Pass@4', 'Passed / attempted',
    'Tasks solved / attempted', 'Runs', 'Avg cost', 'Avg output tokens', 'Avg steps',
  ], summaryRows)}`);

  const detailRows = rows.filter(hasDefinitionDetails).map((row) => [
    stringValue(row.config),
    stringValue(row.harness),
    stringValue(row.source),
    formatUsd(row.median_cost_usd),
    formatCount(row.mean_input_tokens),
    formatCount(row.median_input_tokens),
    formatCount(row.median_output_tokens),
    formatDecimal(row.mean_duration_seconds, 1),
    formatDecimal(row.median_duration_seconds, 1),
    formatDecimal(row.median_agent_steps, 1),
    formatCount(row.median_peak_context_tokens),
    formatCount(row.median_output_tokens_to_pass),
  ]);
  if (detailRows.length > 0) {
    parts.push(`### Configuration Definitions\n\n${table([
      'Configuration', 'Harness', 'Source', 'Median cost', 'Avg input tokens',
      'Median input tokens', 'Median output tokens', 'Avg duration (s)',
      'Median duration (s)', 'Median steps', 'Median peak context',
      'Median output tokens to pass',
    ], detailRows)}`);
  }

  const ciMethod = firstText(rows.map((row) => stringValue(row.ci_method)));
  if (ciMethod) parts.push(`**Confidence intervals:** ${ciMethod}`);
}

function appendBenchmarkDescription(parts: string[]): void {
  const section = document.querySelector('main section.article-prose');
  if (!section) return;
  const markdown = Markdown.elementToMarkdown(section);
  if (markdown) parts.push(`## About the Benchmark\n\n${markdown}`);
}

function appendTaskExamples(parts: string[]): void {
  const section = sectionWithHeading('Task Examples');
  if (!section) return;
  const cards = Array.from(section.querySelectorAll('a[href^="/data/tasks/"]'));
  const entries = cards.map((card) => {
    const title = textOf(card.querySelector('h3'));
    if (!title) return '';
    const description = textOf(card.querySelector('p'));
    const footerSpans = Array.from(card.querySelectorAll('div:last-child > span'));
    const repository = textOf(footerSpans[0]);
    const language = textOf(footerSpans[1]);
    const details = [
      repository ? `Repository: ${repository}` : '',
      language ? `Language: ${language}` : '',
    ].filter(Boolean).join(' | ');
    return [
      `### [${escapeInline(title)}](${absoluteHref(card)})`,
      description,
      details,
    ].filter(Boolean).join('\n\n');
  }).filter(Boolean);
  if (entries.length === 0) return;
  const allTasks = linkFor('a[href="/data/tasks"]', 'All tasks');
  parts.push(`## Task Examples\n\n${entries.join('\n\n')}${allTasks ? `\n\n${allTasks}` : ''}`);
}

function appendBlogOutline(parts: string[]): void {
  const links = Array.from(document.querySelectorAll('a[href^="/blog/deepswe#"]'));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const link of links) {
    const labels = Array.from(link.querySelectorAll('span'))
      .map((element) => textOf(element))
      .filter((value) => value && !/^\d+$/.test(value));
    const label = labels[0] || textOf(link);
    const href = absoluteHref(link);
    if (!label || !href || seen.has(href)) continue;
    seen.add(href);
    lines.push(`- [${escapeInline(label)}](${href})`);
  }
  if (lines.length > 0) parts.push(`## Full Blog Outline\n\n${lines.join('\n')}`);
}

function appendSources(parts: string[], artifactPath: string): void {
  const origin = window.location.origin;
  parts.push(`## Sources\n\n- [DeepSWE homepage](${origin}/)\n- [Published leaderboard artifact](${origin}${artifactPath})\n- [DeepSWE blog](${origin}/blog/deepswe)\n- [Task catalog](${origin}/data/tasks)`);
}

function rowsFromDom(): JsonRecord[] {
  return Array.from(document.querySelectorAll('#leaderboard [data-chart-pin-source]')).map((element) => {
    const spans = Array.from(element.querySelectorAll('span'));
    const model = textOf(spans.find((span) => /font-medium/.test(span.className) && /text-foreground/.test(span.className)) || null);
    const effortText = textOf(spans.find((span) => /^\[[^\]]+\]$/.test(textOf(span))) || null);
    const raw = element.textContent || '';
    const pass = raw.match(/(\d+(?:\.\d+)?)%±(\d+(?:\.\d+)?)%/);
    const cost = raw.match(/Avg cost\s*(\$[\d.]+)/i);
    const output = raw.match(/Out tok\s*([\d.]+k?)/i);
    const steps = raw.match(/Steps\s*(\d+(?:\.\d+)?)/i);
    return {
      model,
      reasoning_effort: effortText.replace(/^\[|\]$/g, ''),
      pass_at_1: pass ? Number(pass[1]) / 100 : null,
      ci_lo: pass ? (Number(pass[1]) - Number(pass[2])) / 100 : null,
      ci_hi: pass ? (Number(pass[1]) + Number(pass[2])) / 100 : null,
      mean_cost_usd: cost ? Number(cost[1].slice(1)) : null,
      mean_output_tokens: output ? parseCompactNumber(output[1]) : null,
      mean_agent_steps: steps ? Number(steps[1]) : null,
    };
  }).filter((row) => stringValue(row.model));
}

function selectedLeaderboardContext(): string {
  const values = Array.from(document.querySelectorAll('#leaderboard button[aria-pressed="true"]'))
    .map((element) => textOf(element))
    .filter(Boolean);
  return [...new Set(values)].join(', ');
}

function sectionWithHeading(heading: string): Element | null {
  return Array.from(document.querySelectorAll('main section')).find((section) =>
    Array.from(section.querySelectorAll('h2')).some((element) => textOf(element) === heading),
  ) || null;
}

function hasDefinitionDetails(row: JsonRecord): boolean {
  return [row.config, row.harness, row.source, row.median_cost_usd, row.mean_input_tokens]
    .some((value) => value !== null && value !== undefined && value !== '');
}

function displayModel(row: JsonRecord): string {
  return stringValue(row.model).replace(/-(\d)/g, '-$1').replace(/_/g, '-');
}

function pushMetadataRow(rows: string[][], field: string, value: unknown): void {
  const formatted = exactValue(value);
  if (formatted) rows.push([field, formatted]);
}

function linkFor(selector: string, fallbackLabel: string): string {
  const link = document.querySelector(selector);
  if (!link) return '';
  const href = absoluteHref(link);
  if (!href) return '';
  return `[${escapeInline(textOf(link) || fallbackLabel)}](${href})`;
}

function absoluteHref(element: Element): string {
  const href = element.getAttribute('href');
  if (!href) return '';
  try {
    return new URL(href, document.baseURI).href;
  } catch {
    return href;
  }
}

function table(headers: string[], rows: string[][]): string {
  const line = (values: string[]) => `| ${values.map(tableCell).join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

function tableCell(value: string): string {
  return Markdown.escapeMarkdownTableCell(String(value ?? '').replace(/\s+/g, ' '));
}

function escapeInline(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}

function formatPercent(value: unknown): string {
  const number = numberValue(value);
  return number === null ? '' : `${formatDecimal(number * 100, 2)}%`;
}

function formatInterval(low: unknown, high: unknown): string {
  const lowValue = formatPercent(low);
  const highValue = formatPercent(high);
  return lowValue && highValue ? `${lowValue} to ${highValue}` : '';
}

function formatUsd(value: unknown): string {
  const number = numberValue(value);
  if (number === null) return '';
  return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

function formatCount(value: unknown): string {
  const number = numberValue(value);
  return number === null ? '' : Math.round(number).toLocaleString('en-US');
}

function formatDecimal(value: unknown, digits: number): string {
  const number = numberValue(value);
  if (number === null) return '';
  return number.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function ratio(numerator: unknown, denominator: unknown): string {
  const left = numberValue(numerator);
  const right = numberValue(denominator);
  if (left === null || right === null) return '';
  return `${formatCount(left)} / ${formatCount(right)}`;
}

function parseCompactNumber(value: string): number | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(k)?$/i);
  if (!match) return null;
  return Number(match[1]) * (match[2] ? 1_000 : 1);
}

function exactValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is JsonRecord => item !== null) : [];
}

function textOf(element: Element | null | undefined): string {
  return Markdown.normalizeWhitespace(element?.textContent || '');
}

function firstText(values: string[]): string {
  return values.find(Boolean) || '';
}
