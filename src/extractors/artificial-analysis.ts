/**
 * Artificial Analysis homepage and model extractor.
 *
 * Charts expose exact values as Dataset JSON-LD. Homepage output keeps every
 * published leaderboard, while model pages keep rows for current model.
 */

import { limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

type JsonRecord = Record<string, unknown>;

register({
  name: 'Artificial Analysis',
  matches: [
    '*://artificialanalysis.ai/*',
    '*://www.artificialanalysis.ai/*',
  ],
  pathnameRegex: /^(?:\/|\/models\/[^/?#]+\/?)$/i,

  async extract() {
    return window.location.pathname === '/' ? extractHomepage() : extractModelPage();
  },
});

function extractHomepage(): string {
  const url = Utils.getCanonicalUrl();
  const titleElement = document.querySelector('h1');
  const title = textOf(titleElement)
    || Utils.getPageTitle().replace(/\s*[-|]\s*Artificial Analysis.*$/i, '')
    || 'Artificial Analysis';
  const datasets = findJsonLdObjects('Dataset');
  const parts: string[] = [`# ${title}`];
  const intro = homepageIntro(titleElement);

  if (intro) parts.push(intro);
  appendHomepageFeatured(parts, titleElement);
  appendHomepageSections(parts);
  appendHomepageDatasets(parts, datasets);
  appendDatasetProvenance(parts, datasets[0]);

  const limited = limitMarkdown(Markdown.cleanMarkdown(parts.join('\n\n')));
  return Markdown.buildPageMarkdown({
    source: 'Artificial Analysis',
    title,
    url,
  }, limited.markdown);
}

function extractModelPage(): string {
  const url = Utils.getCanonicalUrl();
  const titleElement = document.querySelector('h1');
  const title = textOf(titleElement)
    || Utils.getPageTitle().replace(/\s*[-|]\s*Artificial Analysis.*$/i, '')
    || 'Artificial Analysis model';
  const hero = titleElement?.closest('section') || titleElement?.parentElement;
  const overview = getOverview(hero);
  const datasets = findJsonLdObjects('Dataset');

  const parts: string[] = [`# ${title}`];
  appendOverview(parts, overview);
  appendSummary(parts);

  const comparison = findControlledRegion('Comparison Summary');
  if (comparison) {
    const markdown = Markdown.elementToMarkdown(comparison);
    if (markdown) parts.push(`## Comparison Summary\n\n${markdown}`);
  }

  appendTechnicalSpecifications(parts);
  appendBenchmarkData(parts, datasets);
  appendDatasetProvenance(parts, datasets[0]);
  appendFaq(parts, findJsonLdObjects('FAQPage')[0]);

  const metadata: Record<string, string> = {
    source: 'Artificial Analysis',
    title,
    url,
  };
  if (overview.provider) metadata.provider = overview.provider;
  if (overview.effort) metadata.effort = overview.effort;

  const limited = limitMarkdown(Markdown.cleanMarkdown(parts.join('\n\n')));
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

type Overview = {
  provider: string;
  providerUrl: string;
  effort: string;
  modelClass: string;
  released: string;
};

function homepageIntro(titleElement: Element | null): string {
  const hero = titleElement?.closest('section');
  const paragraph = Array.from(hero?.querySelectorAll('p') || [])
    .find((element) => !element.closest('a'));
  return textWithoutNoise(paragraph);
}

function appendHomepageFeatured(parts: string[], titleElement: Element | null): void {
  const hero = titleElement?.closest('section');
  const rows: string[][] = [];
  const seen = new Set<string>();

  hero?.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    const paragraphs = Array.from(link.querySelectorAll('p'))
      .map((element) => textWithoutNoise(element))
      .filter(Boolean);
    const label = textWithoutNoise(link.querySelector('span'));
    const name = paragraphs[0] || '';
    if (!name) return;

    const href = absoluteUrl(link.getAttribute('href') || '');
    const key = `${name}\u0000${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push([
      label,
      href ? `[${name}](${href})` : name,
      paragraphs.slice(1).join(' '),
    ]);
  });

  if (rows.length > 0) {
    parts.push(`## Featured\n\n${table(['Type', 'Item', 'Description'], rows)}`);
  }
}

function appendHomepageSections(parts: string[]): void {
  const rows: string[][] = [];
  const seen = new Set<string>();

  document.querySelectorAll('h2').forEach((heading) => {
    const link = heading.querySelector<HTMLAnchorElement>('a[href]');
    const name = textWithoutNoise(link || heading);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());

    const header = heading.parentElement?.parentElement;
    const descriptionElement = Array.from(header?.children || [])
      .find((element) => element.tagName === 'P');
    const description = textWithoutNoise(descriptionElement);
    const href = link ? absoluteUrl(link.getAttribute('href') || '') : '';
    rows.push([href ? `[${name}](${href})` : name, description]);
  });

  if (rows.length > 0) {
    parts.push(`## Analysis Sections\n\n${table(['Section', 'Description'], rows)}`);
  }
}

function appendHomepageDatasets(parts: string[], datasets: JsonRecord[]): void {
  const sections: string[] = [];
  const seen = new Set<string>();

  for (const dataset of datasets) {
    const name = stringValue(dataset.name) || 'Dataset';
    const description = stringValue(dataset.description);
    const records = Array.isArray(dataset.data)
      ? dataset.data.map(asRecord).filter((record): record is JsonRecord => !!record)
      : [asRecord(dataset.data)].filter((record): record is JsonRecord => !!record);
    if (records.length === 0) continue;

    const key = `${name}\u0000${description}\u0000${JSON.stringify(records)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rows = records.flatMap((record, index) => {
      const label = stringValue(record.label) || `Entry ${index + 1}`;
      const detailsUrl = stringValue(record.detailsUrl);
      const values = flattenRecord(record)
        .filter(([field]) => field !== 'label' && field !== 'detailsUrl')
        .map(([field, value]) => `${humanizeField(field)}: ${value}`)
        .join('; ');
      if (!values) return [];

      const linkedLabel = detailsUrl
        ? `[${label}](${absoluteUrl(detailsUrl)})`
        : label;
      return [[linkedLabel, values]];
    });
    if (rows.length === 0) continue;

    const content = [
      `### ${headingText(name)}`,
      description,
      table(['Model or provider', 'Published values'], rows),
    ].filter(Boolean).join('\n\n');
    sections.push(content);
  }

  if (sections.length > 0) {
    parts.push(`## Published Datasets\n\n${sections.join('\n\n')}`);
  }
}

function getOverview(hero: Element | null | undefined): Overview {
  const text = textWithoutNoise(hero);
  const providerLink = hero?.querySelector<HTMLAnchorElement>('a[target="_blank"][href^="http"]');
  const effortButton = hero?.querySelector('[aria-label="Effort"]');
  const released = text.match(/Released\s*([A-Z][a-z]+\s+\d{4})\b/i)?.[1] || '';
  const modelClass = text.match(/\b(Proprietary|Open weights?)\b/i)?.[1] || '';
  return {
    provider: textOf(providerLink),
    providerUrl: providerLink?.href || '',
    effort: textWithoutNoise(effortButton).replace(/^Effort\s*/i, '').trim(),
    modelClass,
    released,
  };
}

function appendOverview(parts: string[], overview: Overview): void {
  const rows: string[][] = [];
  if (overview.provider) {
    const provider = overview.providerUrl
      ? `[${overview.provider}](${overview.providerUrl})`
      : overview.provider;
    rows.push(['Provider', provider]);
  }
  if (overview.effort) rows.push(['Reasoning effort', overview.effort]);
  if (overview.modelClass) rows.push(['Model class', overview.modelClass]);
  if (overview.released) rows.push(['Released', overview.released]);
  if (rows.length > 0) parts.push(`## Model Overview\n\n${table(['Field', 'Value'], rows)}`);
}

function appendSummary(parts: string[]): void {
  const rows: string[][] = [];
  document.querySelectorAll('h4[id$="-title"]').forEach((heading) => {
    const card = heading.closest(`[aria-labelledby="${cssEscape(heading.id)}"]`);
    const valueElement = card?.querySelector('[class~="text-4xl"]');
    if (!card || !valueElement) return;

    const valueRow = valueElement.parentElement;
    const metricBlock = valueRow?.parentElement;
    const description = textWithoutNoise(valueElement.nextElementSibling);
    const rankButton = Array.from(card.querySelectorAll('button'))
      .find((button) => /#\s*\d+/.test(textWithoutNoise(button)));
    const details = metricBlock
      ? Array.from(metricBlock.children)
        .filter((child) => child !== valueRow)
        .map((child) => textWithoutNoise(child))
        .filter(Boolean)
        .join('; ')
      : '';

    rows.push([
      textOf(heading),
      textWithoutNoise(valueElement),
      textWithoutNoise(rankButton),
      description,
      details,
    ]);
  });
  if (rows.length > 0) {
    parts.push(`## Summary\n\n${table(['Metric', 'Value', 'Rank', 'Meaning', 'Details'], rows)}`);
  }
}

function appendTechnicalSpecifications(parts: string[]): void {
  const region = findControlledRegion('Technical specifications');
  const rows = region?.querySelectorAll('table tr');
  if (!rows || rows.length === 0) return;

  const specifications: string[][] = [];
  rows.forEach((row) => {
    const label = textWithoutNoise(row.querySelector('th'));
    const cell = row.querySelector('td');
    if (!label || !cell) return;

    const supportText = Array.from(cell.querySelectorAll('.sr-only'))
      .map(textOf)
      .find((value) => /^Supports:/i.test(value));
    const value = supportText
      ? supportText.replace(/^Supports:\s*/i, '')
      : textWithoutNoise(cell, ['button', '.sr-only']);
    if (value) specifications.push([label, value]);
  });

  if (specifications.length > 0) {
    parts.push(`## Technical Specifications\n\n${table(['Specification', 'Value'], specifications)}`);
  }
}

function appendBenchmarkData(parts: string[], datasets: JsonRecord[]): void {
  const currentPath = normalizePath(window.location.pathname);
  const resultRows: string[][] = [];
  const seen = new Set<string>();

  for (const dataset of datasets) {
    const name = stringValue(dataset.name) || 'Dataset';
    const description = stringValue(dataset.description);
    const records = Array.isArray(dataset.data)
      ? dataset.data.map(asRecord).filter((record): record is JsonRecord => !!record)
      : [asRecord(dataset.data)].filter((record): record is JsonRecord => !!record);

    for (const record of records) {
      const detailsPath = normalizePath(stringValue(record.detailsUrl));
      if (!detailsPath || detailsPath !== currentPath) continue;

      const label = stringValue(record.label);
      const values = flattenRecord(record)
        .filter(([field]) => field !== 'label' && field !== 'detailsUrl')
        .map(([field, value]) => `${humanizeField(field)}: ${value}`)
        .join('; ');
      if (!values) continue;

      const key = `${name}\u0000${label}\u0000${values}\u0000${description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      resultRows.push([name, label, values, description]);
    }
  }

  if (resultRows.length > 0) {
    parts.push(`## Published Benchmark Data\n\n${table([
      'Dataset', 'Model label', 'Result', 'Description',
    ], resultRows)}`);
  }
}

function appendDatasetProvenance(parts: string[], dataset: JsonRecord | undefined): void {
  if (!dataset) return;
  const creator = asRecord(dataset.creator);
  const rows: string[][] = [];
  const creatorName = stringValue(creator?.name);
  const creatorUrl = stringValue(creator?.url);
  if (creatorName) {
    rows.push(['Creator', creatorUrl ? `[${creatorName}](${creatorUrl})` : creatorName]);
  }
  pushRow(rows, 'Measurement technique', dataset.measurementTechnique);
  pushRow(rows, 'Citation', dataset.citation);
  const license = stringValue(dataset.license);
  if (license) rows.push(['License', `[Terms of use](${absoluteUrl(license)})`]);
  if (rows.length > 0) parts.push(`## Dataset Provenance\n\n${table(['Field', 'Value'], rows)}`);
}

function appendFaq(parts: string[], faq: JsonRecord | undefined): void {
  const questions = Array.isArray(faq?.mainEntity)
    ? faq.mainEntity.map(asRecord).filter((record): record is JsonRecord => !!record)
    : [];
  const entries = questions.flatMap((question) => {
    const name = stringValue(question.name);
    const answer = asRecord(question.acceptedAnswer);
    const answerText = stringValue(answer?.text);
    if (!name || !answerText) return [];
    return [`### ${headingText(name)}\n\n${Markdown.htmlToMarkdown(answerText)}`];
  });
  if (entries.length > 0) parts.push(`## Frequently Asked Questions\n\n${entries.join('\n\n')}`);
}

function findControlledRegion(label: string): Element | null {
  const control = Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]'))
    .find((element) => textWithoutNoise(element).toLowerCase() === label.toLowerCase());
  const id = control?.getAttribute('aria-controls');
  return id ? document.getElementById(id) : null;
}

function findJsonLdObjects(type: string): JsonRecord[] {
  const found: JsonRecord[] = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      collectTypedObjects(JSON.parse(script.textContent || ''), type, found);
    } catch {
      // Ignore malformed or unrelated structured data.
    }
  });
  return found;
}

function collectTypedObjects(value: unknown, type: string, found: JsonRecord[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTypedObjects(item, type, found));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const recordType = record['@type'];
  if (recordType === type || (Array.isArray(recordType) && recordType.includes(type))) {
    found.push(record);
  }
  if (record['@graph']) collectTypedObjects(record['@graph'], type, found);
}

function flattenRecord(record: JsonRecord, prefix = ''): string[][] {
  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = asRecord(value);
    if (nested) return flattenRecord(nested, path);
    if (Array.isArray(value)) {
      const propertyValues = value.map(asRecord);
      if (propertyValues.length > 0 && propertyValues.every((item) => (
        item
        && stringValue(item.name)
        && Object.prototype.hasOwnProperty.call(item, 'value')
      ))) {
        return propertyValues.map((item) => [
          `${path}.${stringValue(item?.name)}`,
          exactValue(item?.value),
        ]);
      }
      return [[path, value.map(exactValue).join(', ')]];
    }
    return [[path, exactValue(value)]];
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function exactValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function pushRow(rows: string[][], label: string, value: unknown): void {
  const text = exactValue(value);
  if (text) rows.push([label, text]);
}

function normalizePath(value: string): string {
  if (!value) return '';
  try {
    return new URL(value, window.location.origin).pathname.replace(/\/$/, '').toLowerCase();
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/$/, '').toLowerCase();
  }
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, window.location.origin).href;
  } catch {
    return value;
  }
}

function textOf(element: Element | null | undefined): string {
  return Markdown.normalizeWhitespace(element?.textContent || '');
}

function textWithoutNoise(
  element: Element | null | undefined,
  extraSelectors: string[] = [],
): string {
  if (!element) return '';
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll([
    'svg', '[aria-hidden="true"]', '[hidden]', ...extraSelectors,
  ].join(', ')).forEach((child) => child.remove());
  return textOf(clone);
}

function humanizeField(value: string): string {
  const words = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function headingText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/#+/g, '').trim();
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/(["\\])/g, '\\$1');
}

function table(headers: string[], rows: string[][]): string {
  const header = `| ${headers.map(tableCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${headers.map((_, index) => tableCell(row[index] || '')).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function tableCell(value: string): string {
  return Markdown.escapeMarkdownTableCell(value);
}
