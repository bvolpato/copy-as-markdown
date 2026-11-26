/**
 * Substack extractor.
 * Extracts newsletter posts with title, author, publication, date, likes, and full body.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

type JsonLd = Record<string, unknown>;

register({
  name: 'Substack',
  matches: [
    '*://*.substack.com/p/*',
    '*://*.substack.com/publish/post/*',
  ],
  detect: (contextDocument = document) => {
    const hasBody = Boolean(contextDocument.querySelector('.body.markup, .available-content, article .body'));
    if (!hasBody) return false;
    return /substack/i.test(contextDocument.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content || '')
      || Boolean(contextDocument.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"]'))
      || Boolean(contextDocument.querySelector('.pencraft') && contextDocument.querySelector('.body.markup, .available-content'));
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const schema = findArticleSchema();

    const title = firstText(['.post-title', 'h1.post-title', 'article h1', 'h1'])
      || Utils.getPageTitle();

    const subtitle = firstText(['.subtitle', 'h3.subtitle']);

    const author = firstText([
      '.byline-wrapper a',
      '.author-name',
      '.post-meta .byline a',
      'a.frontend-pencraft-Text-module__decoration-hover-underline--BEYAn',
    ])
      || Utils.getMeta('author')
      || schemaAuthor(schema?.author);

    const publication = firstText([
      '[data-testid="navbar"] h1 a',
      '.publication-name',
      '.navbar-title-link',
    ])
      || Utils.getMeta('site_name');

    const dateEl = document.querySelector('.post-date time, .pencraft time, time[datetime]');
    const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime')?.split('T')[0] || '';

    const likes = firstMainUfiText(['.like-count', '.post-ufi-button .label']);
    const commentsCount = firstMainUfiText(['.post-ufi-comment-button .label']);

    const metadata: Record<string, string> = {
      source: 'Substack',
      title,
      url,
    };
    if (author) metadata.author = author;
    if (publication) metadata.publication = publication;
    if (date) metadata.date = date;

    const parts: string[] = [`# ${title}\n`];
    if (subtitle && subtitle !== title) parts.push(`*${subtitle}*\n`);

    const meta: string[] = [];
    if (author) meta.push(`**Author:** ${author}`);
    if (publication) meta.push(`**Publication:** ${publication}`);
    if (date) meta.push(`**Date:** ${date}`);
    if (likes) meta.push(`**Likes:** ${likes}`);
    if (commentsCount) meta.push(`**Comments:** ${commentsCount}`);
    if (meta.length) parts.push(meta.join(' · ') + '\n');

    // Article body
    const bodyEl = document.querySelector('.body.markup, .post-content, .available-content, article .body');
    if (bodyEl) {
      const cleaned = Utils.removeNoise(bodyEl, [
        ...Utils.NOISE_SELECTORS,
        '.captioned-button-wrap',
        '.subscribe-widget',
        '.subscription-widget',
        '.subscription-widget-wrap',
        '.image-link-expand',
        '.paywall',
      ]);
      parts.push(Markdown.elementToMarkdown(cleaned));
    }

    // Paywall detection
    if (hasVisiblePaywall()) {
      parts.push('\n---\n*⚠️ The rest of this article is behind a paywall.*\n');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function firstText(selectors: string[]): string {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (value) return value;
  }
  return '';
}

function firstMainUfiText(selectors: string[]): string {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest('.portable-archive-list, .recommendations, aside')) continue;
      const value = element.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (value) return value;
    }
  }
  return '';
}

function hasVisiblePaywall(): boolean {
  const isVisible = Utils.createVisibilityChecker();
  for (const element of document.querySelectorAll('.paywall, .paywall-title, [class*="paywall"]')) {
    // Posts that a subscriber can read keep an empty marker where the free part ends.
    if (element.textContent?.trim() && isVisible(element)) return true;
  }
  return false;
}

function schemaAuthor(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => typeof item === 'string'
      ? item.trim()
      : (item && typeof item === 'object' && typeof (item as JsonLd).name === 'string'
        ? ((item as JsonLd).name as string).trim()
        : ''))
    .filter(Boolean)
    .join(', ');
}

function findArticleSchema(): JsonLd | null {
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
          const rawType = (candidate as JsonLd)['@type'];
          const types = Array.isArray(rawType) ? rawType : [rawType];
          if (types.some((type) => typeof type === 'string' && /Article|BlogPosting|NewsArticle/i.test(type))) {
            return candidate as JsonLd;
          }
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
}
