/**
 * Netflix title and watch-page extractor.
 * Keeps output focused on title metadata and the active title, not catalogue navigation.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Netflix',
  matches: [
    '*://www.netflix.com/watch/*',
    '*://www.netflix.com/title/*',
    '*://netflix.com/watch/*',
    '*://netflix.com/title/*',
  ],
  pathnameRegex: /^\/(?:watch|title)\/\d+(?:\/[^/?#]*)?\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-uia="video-title"], [data-uia="title-info"], h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const payload = firstStructuredPayload();
    const title = firstText([
      '[data-uia="video-title"]',
      '[data-uia="title-info"] h1',
      '.title-title',
      'h1',
    ]) || stringValue(payload?.name) || Utils.getMeta('title') || Utils.getPageTitle();
    const description = firstText([
      '[data-uia="video-description"]',
      '[data-uia="title-info-synopsis"]',
      '.title-info-synopsis',
    ]) || stringValue(payload?.description) || Utils.getMeta('description');
    const year = firstText([
      '[data-uia="video-year"]',
      '[data-uia="title-info-metadata-item"]',
      '.title-info-metadata-item',
    ]) || stringValue(payload?.dateCreated || payload?.datePublished).slice(0, 4);
    const maturity = firstText([
      '[data-uia="video-rating"]',
      '[data-uia="title-info-metadata-item"] + *',
      '.title-info-metadata-item--rating',
    ]);
    const duration = firstText([
      '[data-uia="video-duration"]',
      '[data-uia="title-info-duration"]',
      'meta[itemprop="duration"]',
    ], true) || stringValue(payload?.duration);
    const genres = firstText([
      '[data-uia="video-genres"]',
      '.title-info-metadata-item-container .title-info-metadata-item',
    ]) || listValue(payload?.genre);
    const creator = firstText([
      '[data-uia="video-cast"]',
      '[data-uia="title-info-cast"]',
      '.title-info-cast',
    ]) || peopleValue(payload?.creator);
    const rating = firstText([
      '[data-uia="video-rating"]',
      '[data-uia="rating"]',
    ]) || stringValue(payload?.aggregateRating && asRecord(payload.aggregateRating)?.ratingValue);
    const route = window.location.pathname.startsWith('/watch/') ? 'watch' : 'title';

    const metadata: Record<string, string> = {
      source: 'Netflix', title, url, route, year, maturity, duration, genres, creator, rating,
    };
    const parts: string[] = [`# ${title}`, ''];
    if (year) parts.push(`**Year:** ${year}`);
    if (maturity) parts.push(`**Rating:** ${maturity}`);
    if (duration) parts.push(`**Duration:** ${duration}`);
    if (genres) parts.push(`**Genres:** ${genres}`);
    if (creator) parts.push(`**Cast / creator:** ${creator}`);
    if (rating) parts.push(`**Score:** ${rating}`);
    parts.push('');
    if (description) parts.push('## Synopsis', '', Utils.truncate(description, 20_000), '');

    const episode = firstText([
      '[data-uia="video-episode-title"]',
      '[data-uia="episode-title"]',
      '.episode-title',
    ]);
    if (episode && episode !== title) {
      parts.push('## Current Episode', '', episode, '');
    }

    const details = Array.from(document.querySelectorAll(
      '[data-uia="video-details"] li, [data-uia="title-info"] li, .title-info-talent li',
    )).map((item) => item.textContent?.trim() || '').filter(Boolean).slice(0, 30);
    if (details.length) parts.push('## Details', '', ...details.map((item) => `- ${item}`), '');

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonRecord = Record<string, unknown>;

function firstText(selectors: string[], attributeMode = false): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const value = attributeMode
      ? element.getAttribute('content') || element.getAttribute('datetime') || element.textContent || ''
      : element.textContent || '';
    const text = value.trim();
    if (text) return text;
  }
  return '';
}

function firstStructuredPayload(): JsonRecord | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const raw: unknown = JSON.parse(script.textContent || '');
      const records = flattenRecords(raw);
      const found = records.find((record) =>
        /Movie|TVSeries|TVEpisode|VideoObject/i.test(stringValue(record['@type']))
        || Boolean(record.name),
      );
      if (found) return found;
    } catch {
      // Ignore transient JSON-LD while Netflix hydrates the title page.
    }
  }
  return null;
}

function flattenRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(flattenRecords);
  if (!value || typeof value !== 'object') return [];
  const record = value as JsonRecord;
  const graph = Array.isArray(record['@graph']) ? record['@graph'].flatMap(flattenRecords) : [];
  return [record, ...graph];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function listValue(value: unknown): string {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean).join(', ') : stringValue(value);
}

function peopleValue(value: unknown): string {
  if (!Array.isArray(value)) return stringValue(asRecord(value)?.name) || stringValue(value);
  return value.map((entry) => stringValue(asRecord(entry)?.name) || stringValue(entry)).filter(Boolean).join(', ');
}
