/** FOX show, episode, movie, and video page extractor. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';

type JsonLd = Record<string, unknown>;

register({
  name: 'FOX',
  matches: [
    '*://fox.com/*',
    '*://www.fox.com/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="video-title"], .details__title, .show-detail h1, main h1, h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const schema = findSchema();
    const title = text('h1, [data-testid="video-title"], .details__title, .show-detail__title')
      || stringValue(schema?.name)
      || Utils.getPageTitle();
    const description = text('[data-testid="description"], .details__description, .show-detail__description')
      || stringValue(schema?.description)
      || Utils.getMeta('description');
    const type = schemaType(schema) || routeType(window.location.pathname);
    const metadata: Record<string, string> = { source: 'FOX', title, url, type };
    const parts = [`# ${title}`];

    const details = unique([
      pair('Type', type),
      pair('Series', stringValue(schema?.partOfSeries && (schema.partOfSeries as JsonLd).name)),
      pair('Season', numberValue(schema?.seasonNumber)),
      pair('Episode', numberValue(schema?.episodeNumber)),
      pair('Published', stringValue(schema?.datePublished) || text('time')),
      pair('Duration', stringValue(schema?.duration) || text('[data-testid="duration"], .details__duration')),
      pair('Rating', stringValue(schema?.contentRating) || text('.rating, [data-testid="rating"]')),
    ]);
    if (details.length) parts.push('', ...details);
    if (description) parts.push('', description);

    const content = document.querySelector([
      '[data-testid="video-details"]',
      '.details',
      '.show-detail',
      'article',
      'main',
    ].join(', '));
    if (content) {
      const cleaned = Utils.removeNoise(content, [
        ...Utils.NOISE_SELECTORS,
        '[class*="recommend"]',
        '[data-testid*="recommend"]',
        '[class*="carousel"]',
      ]);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body && !normalize(body).includes(normalize(description))) parts.push('', '## Details', '', body);
    }

    const output = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: schema ? 'FOX rendered page and structured data' : 'FOX rendered page',
      truncated: output.truncated,
      complete: Boolean(description || content) && !output.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

function pair(label: string, value: string): string {
  return value ? `**${label}:** ${value}` : '';
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function routeType(pathname: string): string {
  if (/\/shows?\//i.test(pathname)) return 'show';
  if (/\/episodes?\//i.test(pathname)) return 'episode';
  if (/\/movies?\//i.test(pathname)) return 'movie';
  if (/\/(?:watch|video|live)\//i.test(pathname)) return 'video';
  return 'page';
}

function schemaType(schema: JsonLd | null): string {
  const value = schema?.['@type'];
  return Array.isArray(value) ? stringValue(value[0]) : stringValue(value);
}

function findSchema(): JsonLd | null {
  const supported = new Set(['TVSeries', 'TVEpisode', 'Movie', 'VideoObject']);
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        const candidates = root && typeof root === 'object' && Array.isArray(root['@graph'])
          ? root['@graph']
          : [root];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') continue;
          const rawType = candidate['@type'];
          const types = Array.isArray(rawType) ? rawType : [rawType];
          if (types.some((type) => typeof type === 'string' && supported.has(type))) return candidate;
        }
      }
    } catch { /* ignore malformed site data */ }
  }
  return null;
}
