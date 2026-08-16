/**
 * OpenRouter model extractor.
 *
 * Model pages expose stable JSON-LD for their published description and FAQ,
 * while OpenRouter's same-origin APIs contain exact model and endpoint fields.
 * Use both so copied definitions stay complete when presentation markup changes.
 */

import { limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;

type ModelRoute = {
  author: string;
  slug: string;
};

type EndpointCatalog = {
  data: JsonRecord;
  endpoints: JsonRecord[];
  path: string;
};

const NON_MODEL_PREFIXES = [
  'api', 'apps', 'benchmarks', 'chat', 'compare', 'docs', 'models',
  'rankings', 'settings', 'workspaces',
];

const TOKEN_PRICING_UNITS: Record<string, string> = {
  prompt: 'input tokens',
  completion: 'output tokens',
  image: 'image input units',
  audio: 'audio input units',
  input_audio_cache: 'cached audio input units',
  internal_reasoning: 'reasoning tokens',
  input_cache_read: 'cached input tokens',
  input_cache_write: 'cache write tokens',
};

const MODEL_FIELDS = new Set([
  'id', 'canonical_slug', 'name', 'created', 'description', 'context_length',
  'architecture', 'pricing', 'top_provider', 'per_request_limits',
  'supported_parameters', 'default_parameters', 'expiration_date',
  'hugging_face_id', 'knowledge_cutoff', 'links', 'reasoning',
  'supported_voices', 'benchmarks',
]);

register({
  name: 'OpenRouter',
  matches: [
    '*://openrouter.ai/*',
    '*://www.openrouter.ai/*',
  ],
  pathnameRegex: new RegExp(
    `^/(?!(${NON_MODEL_PREFIXES.join('|')})(?:/|$))[^/?#]+/[^/?#]+/?$`,
    'i',
  ),

  async extract() {
    const route = getModelRoute();
    const url = Utils.getCanonicalUrl();
    const software = findJsonLd('SoftwareApplication');
    const faq = findJsonLd('FAQPage');
    const model = route ? await fetchModel(route) : null;
    const endpoints = route ? await fetchEndpoints(route, model) : null;

    const modelId = stringValue(model?.id)
      || (route ? `${route.author}/${route.slug}` : '')
      || modelIdFromDom();
    const title = firstText([
      stringValue(software?.name),
      stringValue(model?.name),
      textOf(document.querySelector('#model-title-row h1, main h1, h1')),
      Utils.getPageTitle().replace(/\s*[-|]\s*OpenRouter.*$/i, ''),
    ]) || modelId || 'OpenRouter model';
    const description = firstText([
      stringValue(software?.description),
      visibleDescription(),
      stringValue(model?.description),
      Utils.getMeta('description'),
    ]);

    const parts: string[] = [`# ${title}`];
    if (description) parts.push(description);

    appendOverview(parts, model, software, modelId);
    appendPublishedFeatures(parts, software);

    if (model) {
      appendObjectSection(parts, 'Architecture', model.architecture);
      appendPricing(parts, 'Model Pricing', model.pricing);
      appendObjectSection(parts, 'Top Provider Limits', model.top_provider);
      appendObjectSection(parts, 'Reasoning', model.reasoning);
      appendSupportedParameters(parts, model.supported_parameters, model.default_parameters);
      appendObjectSection(parts, 'Per-request Limits', model.per_request_limits);
      appendObjectSection(parts, 'Benchmarks', model.benchmarks);
      appendObjectSection(parts, 'Supported Voices', model.supported_voices);
      appendObjectSection(parts, 'Links', resolveLinks(model.links));
      appendAdditionalModelFields(parts, model);
    }

    if (endpoints && endpoints.endpoints.length > 0) {
      appendEndpointCatalog(parts, endpoints);
    } else {
      appendDomTables(parts, model ? ['providers'] : undefined);
    }

    appendFaq(parts, faq);

    if (!model && !software && parts.length <= 2) {
      appendDomFallback(parts);
    }

    if (route) {
      const encodedAuthor = encodeURIComponent(route.author);
      const encodedSlug = encodeURIComponent(route.slug);
      const sourceLines = [
        `[Model definition](${window.location.origin}/api/v1/model/${encodedAuthor}/${encodedSlug})`,
      ];
      if (endpoints) {
        sourceLines.push(`[Endpoint definitions](${window.location.origin}${endpoints.path})`);
      }
      parts.push(`## API Sources\n\n${sourceLines.map((line) => `- ${line}`).join('\n')}`);
    }

    const metadata: Record<string, string> = {
      source: 'OpenRouter',
      title,
      url,
    };
    if (modelId) metadata.model = modelId;
    const canonicalSlug = stringValue(model?.canonical_slug);
    if (canonicalSlug) metadata.canonical_slug = canonicalSlug;

    const limited = limitMarkdown(Markdown.cleanMarkdown(parts.join('\n\n')));
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

function getModelRoute(): ModelRoute | null {
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!match || NON_MODEL_PREFIXES.includes(match[1].toLowerCase())) return null;
  try {
    return {
      author: decodeURIComponent(match[1]),
      slug: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

async function fetchModel(route: ModelRoute): Promise<JsonRecord | null> {
  const path = `/api/v1/model/${encodeURIComponent(route.author)}/${encodeURIComponent(route.slug)}`;
  const payload = await fetchJson(path);
  return asRecord(payload?.data);
}

async function fetchEndpoints(
  route: ModelRoute,
  model: JsonRecord | null,
): Promise<EndpointCatalog | null> {
  const author = encodeURIComponent(route.author);
  const slug = encodeURIComponent(route.slug);
  const architecture = asRecord(model?.architecture);
  const outputModalities = stringArray(architecture?.output_modalities);
  const imageOnly = outputModalities.includes('image') && !outputModalities.includes('text');
  const paths = imageOnly
    ? [`/api/v1/images/models/${author}/${slug}/endpoints`, `/api/v1/models/${author}/${slug}/endpoints`]
    : [`/api/v1/models/${author}/${slug}/endpoints`, `/api/v1/images/models/${author}/${slug}/endpoints`];

  for (const path of paths) {
    const payload = await fetchJson(path);
    const data = asRecord(payload?.data) || payload;
    const endpoints = recordArray(data?.endpoints);
    if (data && endpoints.length > 0) return { data, endpoints, path };
  }
  return null;
}

async function fetchJson(path: string): Promise<JsonRecord | null> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return asRecord(await response.json());
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function appendOverview(
  parts: string[],
  model: JsonRecord | null,
  software: JsonRecord | null,
  modelId: string,
): void {
  const author = asRecord(software?.author);
  const rows: string[][] = [];
  pushRow(rows, 'Model ID', stringValue(model?.id) || modelId);
  pushRow(rows, 'Canonical slug', model?.canonical_slug);
  pushRow(rows, 'Author', author?.name);
  pushRow(rows, 'Created', formatCreated(model?.created));
  pushRow(rows, 'Context length', formatTokenCount(model?.context_length));
  pushRow(rows, 'Knowledge cutoff', model?.knowledge_cutoff, model ? true : false);
  pushRow(rows, 'Expiration date', model?.expiration_date, model ? true : false);
  pushRow(rows, 'Hugging Face ID', model?.hugging_face_id, model ? true : false);
  if (rows.length > 0) parts.push(`## Model Definition\n\n${table(['Field', 'Value'], rows)}`);
}

function appendPublishedFeatures(parts: string[], software: JsonRecord | null): void {
  const features = stringArray(software?.featureList);
  if (features.length === 0) return;
  parts.push(`## Published Features\n\n${features.map((feature) => `- ${feature}`).join('\n')}`);
}

function appendPricing(parts: string[], title: string, value: unknown): void {
  const pricing = asRecord(value);
  if (!pricing) return;
  const rows = Object.entries(pricing).map(([field, raw]) => [
    field,
    exactValue(raw),
    priceDisplay(field, raw),
  ]);
  if (rows.length > 0) {
    parts.push(`## ${title}\n\n${table(['Field', 'Raw USD rate', 'Readable rate'], rows)}`);
  }
}

function appendSupportedParameters(
  parts: string[],
  supportedValue: unknown,
  defaultsValue: unknown,
): void {
  const supported = stringArray(supportedValue);
  const defaults = asRecord(defaultsValue);
  const names = new Set([...supported, ...Object.keys(defaults || {})]);
  if (names.size === 0 && defaults === null) return;
  if (names.size === 0) {
    parts.push('## Supported Parameters\n\n_No parameters published._');
    return;
  }
  const rows = [...names].sort().map((name) => [
    name,
    defaults && Object.prototype.hasOwnProperty.call(defaults, name)
      ? exactValue(defaults[name])
      : '',
  ]);
  parts.push(`## Supported Parameters\n\n${table(['Parameter', 'Default'], rows)}`);
}

function appendEndpointCatalog(parts: string[], catalog: EndpointCatalog): void {
  const metadata = Object.fromEntries(
    Object.entries(catalog.data).filter(([key]) => key !== 'endpoints'),
  );
  appendObjectSection(parts, 'Endpoint Catalog Metadata', metadata);

  const summaryRows = catalog.endpoints.map((endpoint) => {
    const pricing = asRecord(endpoint.pricing);
    return [
      stringValue(endpoint.provider_name) || stringValue(endpoint.name),
      stringValue(endpoint.tag),
      formatTokenCount(endpoint.context_length),
      formatTokenCount(endpoint.max_completion_tokens),
      priceDisplay('prompt', pricing?.prompt),
      priceDisplay('completion', pricing?.completion),
      formatPercent(endpoint.uptime_last_30m),
      exactValue(endpoint.status),
    ];
  });
  parts.push(`## Provider Endpoints\n\n${table([
    'Provider', 'Endpoint tag', 'Context', 'Max output', 'Input', 'Output',
    '30m uptime', 'Status',
  ], summaryRows)}`);

  catalog.endpoints.forEach((endpoint, index) => {
    const provider = stringValue(endpoint.provider_name) || `Endpoint ${index + 1}`;
    const tag = stringValue(endpoint.tag);
    const rows = flattenJson(endpoint);
    if (rows.length === 0) return;
    parts.push(`### ${headingText(tag ? `${provider}: ${tag}` : provider)}\n\n${table(['Property', 'Value'], rows)}`);
  });
}

function appendAdditionalModelFields(parts: string[], model: JsonRecord): void {
  const additional = Object.fromEntries(
    Object.entries(model).filter(([key]) => !MODEL_FIELDS.has(key)),
  );
  if (Object.keys(additional).length === 0) return;
  appendObjectSection(parts, 'Additional Model Properties', additional);
}

function appendObjectSection(parts: string[], title: string, value: unknown): void {
  if (value === undefined) return;
  const rows = flattenJson(value);
  if (rows.length === 0) return;
  parts.push(`## ${title}\n\n${table(['Property', 'Value'], rows)}`);
}

function appendFaq(parts: string[], faq: JsonRecord | null): void {
  const questions = recordArray(faq?.mainEntity);
  if (questions.length === 0) {
    const faqEl = document.querySelector('section#faq');
    if (faqEl) parts.push(`## FAQ\n\n${Markdown.elementToMarkdown(faqEl)}`);
    return;
  }

  const entries = questions.flatMap((question) => {
    const name = stringValue(question.name);
    const answer = asRecord(question.acceptedAnswer);
    const text = stringValue(answer?.text);
    if (!name || !text) return [];
    return [`### ${headingText(name)}\n\n${htmlTextToMarkdown(text)}`];
  });
  if (entries.length > 0) parts.push(`## FAQ\n\n${entries.join('\n\n')}`);
}

function appendDomTables(parts: string[], sectionIds?: string[]): void {
  const ids = sectionIds || ['providers', 'pricing', 'performance', 'uptime', 'benchmarks', 'api'];
  const seen = new Set<string>();
  for (const id of ids) {
    const section = document.querySelector(`section#${id}`);
    if (!section) continue;
    const heading = textOf(section.querySelector('h2')) || titleCase(id);
    const tables = Array.from(section.querySelectorAll('table'))
      .map((tableEl) => Markdown.tableToMarkdown(tableEl))
      .filter((markdown) => markdown && !seen.has(markdown));
    if (tables.length === 0) continue;
    tables.forEach((markdown) => seen.add(markdown));
    parts.push(`## ${heading} (Page Snapshot)\n\n${tables.join('\n\n')}`);
  }
}

function appendDomFallback(parts: string[]): void {
  const main = document.querySelector('#page-content, main, [role="main"]');
  if (!main) return;
  const clone = Utils.removeNoise(main, [
    ...Utils.NOISE_SELECTORS,
    '#cam-copy-btn', '[data-cam-instance]', '[data-base-ui-portal]',
    '[data-model-scrolled-nav]', '.recharts-responsive-container',
    'section#apps', 'section#activity',
  ]);
  const markdown = Markdown.elementToMarkdown(clone);
  if (markdown) parts.push(`## Page Definition\n\n${markdown}`);
}

function findJsonLd(type: string): JsonRecord | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const found = findTypedObject(JSON.parse(script.textContent || ''), type);
      if (found) return found;
    } catch {
      // Ignore malformed or unrelated structured data.
    }
  }
  return null;
}

function findTypedObject(value: unknown, type: string): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTypedObject(item, type);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const recordType = record['@type'];
  if (recordType === type || (Array.isArray(recordType) && recordType.includes(type))) return record;
  return findTypedObject(record['@graph'], type);
}

function flattenJson(value: unknown, path = ''): string[][] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [[path || 'value', '[]']];
    if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
      return [[path || 'value', value.map(exactValue).join(', ')]];
    }
    return value.flatMap((item, index) => flattenJson(item, `${path}[${index}]`));
  }

  const record = asRecord(value);
  if (record) {
    const entries = Object.entries(record);
    if (entries.length === 0) return [[path || 'value', '{}']];
    return entries.flatMap(([key, child]) => flattenJson(child, path ? `${path}.${key}` : key));
  }
  return [[path || 'value', exactValue(value)]];
}

function resolveLinks(value: unknown): unknown {
  const links = asRecord(value);
  if (!links) return value;
  return Object.fromEntries(Object.entries(links).map(([key, link]) => {
    if (typeof link !== 'string') return [key, link];
    try {
      return [key, new URL(link, window.location.origin).href];
    } catch {
      return [key, link];
    }
  }));
}

function table(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(tableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${headers.map((_, index) => tableCell(row[index] || '')).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function tableCell(value: string): string {
  return Markdown.escapeMarkdownTableCell(value, '<br>');
}

function priceDisplay(field: string, raw: unknown): string {
  const value = numberValue(raw);
  if (value === null) return exactValue(raw);
  if (field === 'discount') return `${trimNumber(value * 100)}%`;
  if (field === 'web_search') return `${formatUsd(value * 1_000)} / 1K calls`;
  if (field === 'request') return `${formatUsd(value)} / request`;
  const unit = TOKEN_PRICING_UNITS[field];
  if (unit) return `${formatUsd(value * 1_000_000)} / 1M ${unit}`;
  return '';
}

function formatUsd(value: number): string {
  return `$${trimNumber(value)}`;
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(10).replace(/\.?0+$/, '');
}

function formatTokenCount(value: unknown): string {
  const count = numberValue(value);
  return count === null ? exactValue(value) : `${count.toLocaleString('en-US')} tokens`;
}

function formatCreated(value: unknown): string {
  const timestamp = numberValue(value);
  if (timestamp === null) return exactValue(value);
  const date = new Date(timestamp * 1_000);
  if (Number.isNaN(date.getTime())) return exactValue(value);
  return `${date.toISOString().slice(0, 10)} (${timestamp})`;
}

function formatPercent(value: unknown): string {
  const number = numberValue(value);
  return number === null ? exactValue(value) : `${trimNumber(number)}%`;
}

function pushRow(
  rows: string[][],
  label: string,
  value: unknown,
  includeNull = false,
): void {
  if (value === undefined || (value === null && !includeNull) || value === '') return;
  rows.push([label, exactValue(value)]);
}

function exactValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((record): record is JsonRecord => record !== null)
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textOf(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function modelIdFromDom(): string {
  return textOf(document.querySelector('#model-title-row h3[title*="Model identifier" i]'));
}

function visibleDescription(): string {
  const titleRow = document.querySelector('#model-title-row');
  const header = titleRow?.parentElement;
  const paragraphs = Array.from(header?.querySelectorAll(':scope > div p') || [])
    .map(textOf)
    .filter(Boolean);
  return longestText(paragraphs);
}

function longestText(values: Array<string | undefined>): string {
  return values.filter((value): value is string => !!value?.trim())
    .sort((left, right) => right.length - left.length)[0]?.trim() || '';
}

function firstText(values: Array<string | undefined>): string {
  return values.find((value) => !!value?.trim())?.trim() || '';
}

function htmlTextToMarkdown(value: string): string {
  return /<[^>]+>/.test(value)
    ? Markdown.htmlToMarkdown(value)
    : value.replace(/\s+/g, ' ').trim();
}

function headingText(value: string): string {
  return value.replace(/[\r\n#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
