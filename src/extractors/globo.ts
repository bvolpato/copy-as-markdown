/** Globo article and video page extractor. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';

type JsonLd = Record<string, unknown>;

register({
  name: 'Globo',
  matches: [
    '*://globo.com/*',
    '*://www.globo.com/*',
    '*://*.globo.com/*',
  ],
  pathnameRegex: /^\/(?!$).+/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: 'article header, .content-head, .mc-article-header, h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const schema = findSchema(['NewsArticle', 'Article', 'VideoObject']);
    const title = text('h1, .content-head__title, [data-testid="content-title"]')
      || stringValue(schema?.headline)
      || stringValue(schema?.name)
      || Utils.getPageTitle();
    const author = text('[rel="author"], .content-publication-data__from, .mc-article-author')
      || schemaAuthor(schema?.author);
    const published = text('time, .content-publication-data__updated')
      || stringValue(schema?.datePublished);
    const description = Utils.getMeta('description') || stringValue(schema?.description);
    const content = document.querySelector([
      'article .mc-article-body',
      'article [data-block-type="unstyled"]',
      '.mc-article-body',
      '.content-text',
      'article',
      'main',
    ].join(', '));

    const metadata: Record<string, string> = { source: 'Globo', title, url };
    if (author) metadata.author = author;
    if (published) metadata.date = published;
    const parts = [`# ${title}`];
    if (author) parts.push('', `**Author:** ${author}`);
    if (published) parts.push(`**Published:** ${published}`);
    if (description) parts.push('', `*${description}*`);

    if (content) {
      const cleaned = Utils.removeNoise(content, [
        ...Utils.NOISE_SELECTORS,
        '.content-ads',
        '.mc-column',
        '.shadow-video-flow-overlay',
        '[data-testid*="recommend"]',
      ]);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('', '## Content', '', body);
    }

    const output = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: schema ? 'Globo rendered page and structured data' : 'Globo rendered page',
      truncated: output.truncated,
      complete: Boolean(content) && !output.truncated,
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

function schemaAuthor(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => typeof item === 'string' ? item : stringValue((item as JsonLd | null)?.name))
    .filter(Boolean)
    .join(', ');
}

function findSchema(types: string[]): JsonLd | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent || 'null');
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        const candidates = value && typeof value === 'object' && Array.isArray(value['@graph'])
          ? value['@graph']
          : [value];
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') continue;
          const type = candidate['@type'];
          const names = Array.isArray(type) ? type : [type];
          if (names.some((name) => typeof name === 'string' && types.includes(name))) return candidate;
        }
      }
    } catch { /* ignore malformed site data */ }
  }
  return null;
}
