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
    const title = firstText([
      '.content-head__title',
      '[data-testid="content-title"]',
      'article h1',
      'main h1',
      'h1',
    ])
      || stringValue(schema?.headline)
      || stringValue(schema?.name)
      || Utils.getPageTitle();
    const author = firstText([
      '.content-publication-data__from',
      '[rel="author"]',
      '.mc-article-author',
    ])
      || schemaAuthor(schema?.author);
    const published = firstText([
      '.content-publication-data__updated',
      'time[datetime]',
      'time',
    ])
      || stringValue(schema?.datePublished);
    const description = Utils.getMeta('description') || stringValue(schema?.description);
    const content = [
      'article[itemprop="articleBody"]',
      'article .mc-article-body',
      '.mc-article-body',
      'article',
      'main',
    ].map((selector) => document.querySelector(selector)).find(Boolean);

    const metadata: Record<string, string> = { source: 'Globo', title, url };
    if (author) metadata.author = author;
    if (published) metadata.date = published;
    const parts = [`# ${title}`];
    if (author) parts.push('', `**Author:** ${author}`);
    if (published) parts.push(`**Published:** ${published}`);
    if (description) parts.push('', `*${description}*`);
    if (hasGloboPaywall()) {
      parts.push('', '> **Paywall detected.** Content below may be incomplete.');
    }

    if (content) {
      const cleaned = Utils.removeNoise(content, [
        ...Utils.NOISE_SELECTORS,
        '.content-ads',
        '.shadow-video-flow-overlay',
        'bs-player',
        '.clappr-player',
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

function hasGloboPaywall(): boolean {
  const selectors = [
    '.barreira-paywall',
    '.paywall-barreira',
    '#barreiraJornada',
    '.assinante-wall',
    '.paywall',
    '#paywall',
    '[class*="paywall"]',
    '[id*="paywall"]',
  ];
  const isVisible = Utils.createVisibilityChecker();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (isVisible(element)) return true;
    }
  }
  return false;
}

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = spacedText(element);
    if (value) return value;
  }
  return '';
}

function spacedText(element: Element | null): string {
  if (!element) return '';
  const chunks: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const chunk = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks.join(' ').replace(/\s+([,.;:!?])/g, '$1').trim();
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
