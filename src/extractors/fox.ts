/** FOX show, episode, movie, and video page extractor. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';

type JsonLd = Record<string, unknown>;

const NON_SHOW_ROOT_SLUGS = new Set([
  'shows', 'movies', 'live', 'schedule', 'sports', 'news',
  'account', 'search', 'help', 'settings', 'about', 'privacy', 'terms',
]);

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
    const title = firstText([
      '[data-testid="video-title"]',
      '.details__title',
      '.show-detail__title',
      'main h1',
      'h1',
    ])
      || stringValue(schema?.name)
      || Utils.getPageTitle();
    const description = firstText([
      '[data-testid="description"]',
      '.details__description',
      '.show-detail__description',
    ])
      || stringValue(schema?.description)
      || Utils.getMeta('description');
    const type = schemaType(schema) || routeType(window.location.pathname);
    const metadata: Record<string, string> = { source: 'FOX', title, url, type };
    const parts = [`# ${title}`];

    const rawDuration = stringValue(schema?.duration)
      || firstText(['[data-testid="duration"]', '.details__duration']);
    const details = unique([
      pair('Type', type),
      pair('Series', stringValue(schema?.partOfSeries && (schema.partOfSeries as JsonLd).name)),
      pair('Season', numberValue(schema?.seasonNumber)),
      pair('Episode', numberValue(schema?.episodeNumber)),
      pair('Published', stringValue(schema?.datePublished) || firstText(['time[datetime]', 'time'])),
      pair('Duration', formatDuration(rawDuration)),
      pair('Rating', stringValue(schema?.contentRating) || firstText(['[data-testid="rating"]', '.rating'])),
    ]);
    if (details.length) parts.push('', ...details);
    if (description) parts.push('', description);

    const content = [
      '[data-testid="video-details"]',
      '.details',
      '.show-detail',
      'article',
      'main',
    ].map((selector) => document.querySelector(selector)).find(Boolean);

    if (content) {
      const noise = [
        ...Utils.NOISE_SELECTORS,
        '[class*="recommend"]',
        '[data-testid*="recommend"]',
        'h1',
        '[data-testid="video-title"]',
        '.details__title',
        '.show-detail__title',
      ];
      if (description) {
        noise.push(
          '[data-testid="description"]',
          '.details__description',
          '.show-detail__description',
        );
      }
      const cleaned = Utils.removeNoise(content, noise);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body && normalize(body) !== normalize(description) && normalize(body) !== normalize(title)) {
        parts.push('', '## Details', '', body);
      }
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

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (value) return value;
  }
  return '';
}

function formatDuration(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return trimmed;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const units: string[] = [];
  if (hours) units.push(`${hours}h`);
  if (minutes) units.push(`${minutes}m`);
  if (seconds) units.push(`${seconds}s`);
  return units.length ? units.join(' ') : trimmed;
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
  const rootSlug = pathname.match(/^\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase();
  if (rootSlug && !NON_SHOW_ROOT_SLUGS.has(rootSlug)) return 'show';
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
