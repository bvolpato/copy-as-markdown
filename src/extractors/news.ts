/**
 * Generic news site extractor (20+ sites).
 * Handles paywalls and live blogs.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'News (Generic)',
  matches: [
    '*://www.foxnews.com/*',
    '*://foxnews.com/*',
    '*://m.foxnews.com/*',
    '*://www.cnn.com/*',
    '*://cnn.com/*',
    '*://edition.cnn.com/*',
    '*://lite.cnn.com/*',
    '*://m.cnn.com/*',
    '*://www.bbc.com/*',
    '*://bbc.com/*',
    '*://m.bbc.com/*',
    '*://www.bbc.co.uk/*',
    '*://bbc.co.uk/*',
    '*://m.bbc.co.uk/*',
    '*://www.nytimes.com/*',
    '*://nytimes.com/*',
    '*://m.nytimes.com/*',
    '*://www.washingtonpost.com/*',
    '*://washingtonpost.com/*',
    '*://www.theguardian.com/*',
    '*://theguardian.com/*',
    '*://m.theguardian.com/*',
    '*://www.reuters.com/*',
    '*://reuters.com/*',
    '*://mobile.reuters.com/*',
    '*://apnews.com/*',
    '*://www.apnews.com/*',
    '*://www.bloomberg.com/*',
    '*://bloomberg.com/*',
    '*://www.wsj.com/*',
    '*://wsj.com/*',
    '*://www.cnbc.com/*',
    '*://cnbc.com/*',
    '*://www.nbcnews.com/*',
    '*://nbcnews.com/*',
    '*://abcnews.go.com/*',
    '*://www.usatoday.com/*',
    '*://usatoday.com/*',
    '*://www.politico.com/*',
    '*://politico.com/*',
    '*://www.politico.eu/*',
    '*://politico.eu/*',
    '*://www.axios.com/*',
    '*://axios.com/*',
    '*://www.theatlantic.com/*',
    '*://theatlantic.com/*',
    '*://www.vox.com/*',
    '*://vox.com/*',
    '*://www.vice.com/*',
    '*://vice.com/*',
    '*://techcrunch.com/*',
    '*://www.techcrunch.com/*',
    '*://www.theverge.com/*',
    '*://theverge.com/*',
    '*://arstechnica.com/*',
    '*://www.arstechnica.com/*',
    '*://www.wired.com/*',
    '*://wired.com/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      'article header',              // semantic article header
      '.article-header',             // common class
      '.headline',                   // headline wrapper
      '.article-meta',               // meta (author, date) area
      '.byline',                     // byline row
      'h1',                          // article title
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px', display: 'inline-flex' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const isLiveBlog = /live-news|liveblog|live-updates|\/live\//i.test(url);

    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      Utils.getMeta('title') || Utils.getPageTitle();
    const author =
      Utils.getMeta('author') ||
      document.querySelector('.author-name, [rel="author"], .byline, .article-author')?.textContent?.trim() || '';
    const dateStr =
      Utils.getMeta('article:published_time') ||
      Utils.getMeta('datePublished') ||
      document.querySelector('time[datetime]')?.getAttribute('datetime') ||
      document.querySelector('time')?.textContent?.trim() || '';
    const description = Utils.getMeta('description') || '';

    const metadata = {
      source: new URL(url).hostname.replace('www.', ''),
      title, author, date: dateStr ? Utils.formatDate(dateStr) : '', url,
    };

    const parts: string[] = [`# ${title}\n`];
    if (author) parts.push(`**By:** ${author}`);
    if (dateStr) parts.push(`**Date:** ${Utils.formatDate(dateStr)}`);
    if (description) parts.push(`\n*${description}*`);
    parts.push('');

    const paywallNotice = '> ⚠️ **Paywall detected.** Content below may be incomplete.\n';
    if (isLiveBlog) {
      if (isPaywalled(null, '')) parts.push(paywallNotice);
      parts.push('## Live Updates\n');
      const updates = Array.from(document.querySelectorAll('.live-blog-post, [data-testid="live-blog-post"], article, .post-item'));
      updates.filter((update) => !updates.some((other) => other !== update && update.contains(other))).forEach((update) => {
        const ut = update.querySelector('h2, h3')?.textContent?.trim() || '';
        const uTime = update.querySelector('time')?.textContent?.trim() || '';
        const body = update.querySelector('.post-body, .body') || update;
        const clone = Utils.removeNoise(body, [...Utils.NOISE_SELECTORS, 'h2', 'h3', 'time', 'button', '[data-cam-instance]']);
        const uBody = Markdown.elementToMarkdown(clone);
        if (ut || uBody) {
          parts.push(`### ${ut || 'Update'}${uTime ? ` (${uTime})` : ''}\n`);
          if (uBody) parts.push(uBody);
          parts.push('');
        }
      });
    } else {
      const articleEl =
        document.querySelector('article') ||
        document.querySelector('.article-body') ||
        document.querySelector('.article-content') ||
        document.querySelector('.story-body') ||
        document.querySelector('.post-content') ||
        document.querySelector('.entry-content') ||
        document.querySelector('[role="main"]') ||
        document.querySelector('main');

      const articleNoise = [
        ...Utils.NOISE_SELECTORS,
        'h1', 'button', 'details',
        '.ad', '.advertisement', '.embed', '.social-share',
        '.article-footer', '.tags', '.related-articles', '.related-content',
        '[data-testid*="related"]', '[data-component="links-block"]', '[data-component="topic-list"]',
        '.comments-section', '.newsletter-signup',
        '[data-component*="most-popular"]', '[data-component="most-viewed"]', '[data-testid="most-popular"]',
        '[class*="recirc-most-popular"]', '.duet--layout--rail', '.duet--cta--newsletter',
        '[id^="taboola"]', '.ad-feedback-link', '.jwplayer',
      ];

      const body = Markdown.elementToMarkdown(Utils.removeNoise(articleEl || document.body, articleNoise));
      if (isPaywalled(articleEl, body)) parts.push(paywallNotice);
      parts.push(articleEl ? '## Article\n' : '## Content\n', body);
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

/** The copied length against JSON-LD is the best evidence. Class names decide only when it is missing or unclear. */
function isPaywalled(article: Element | null, body: string): boolean {
  const share = article ? copiedShare(body) : null;
  if (share !== null && share < 0.5) return true;
  const isVisible = Utils.createVisibilityChecker();
  const links = Array.from(article?.querySelectorAll<HTMLAnchorElement>('a[href]') || []);
  if (links.some((link) => /paywall/i.test(link.search) && isVisible(link))) return true;
  const markers = Array.from(document.querySelectorAll([
    '.paywall', '.subscription-wall', '.meter-wall',
    '[class*="paywall"]', '[class*="Paywall"]',
    '[id*="paywall"]', '[id*="Paywall"]',
    '.tp-modal', '.piano-offer',
    '.article-gate', '.gate-content',
  ].join(', '))).filter(isVisible);
  if (share === null || share < 0.9) return markers.length > 0;
  // Some sites put the class on each visible paragraph of a metered article, so a prompt must ask the reader to act.
  return markers.some((marker) => article?.contains(marker)
    && !marker.matches('p, h2, h3, h4, ul, ol, blockquote, figure')
    && /subscri|sign in|log in|unlock/i.test(marker.textContent || ''));
}

/** The copied text as a share of the first article length in JSON-LD. */
function copiedShare(body: string): number | null {
  const text = body.replace(/\]\([^)]*\)/g, ']');
  const find = (value: unknown, depth = 0): number | null => {
    if (!value || typeof value !== 'object' || depth > 5) return null;
    const { articleBody, wordCount } = value as Record<string, unknown>;
    if (typeof articleBody === 'string' && articleBody.trim()) return text.length / articleBody.trim().length;
    if (Number(wordCount) > 0) return text.split(/\s+/).length / Number(wordCount);
    for (const child of Object.values(value)) {
      const share = find(child, depth + 1);
      if (share !== null) return share;
    }
    return null;
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const share = find(JSON.parse(script.textContent || ''));
      if (share !== null) return share;
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
}
