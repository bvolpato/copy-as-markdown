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

    if (hasVisiblePaywall()) {
      parts.push('> ⚠️ **Paywall detected.** Content below may be incomplete.\n');
    }

    if (isLiveBlog) {
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

      if (articleEl) {
        const cleaned = Utils.removeNoise(articleEl, articleNoise);
        parts.push('## Article\n', Markdown.elementToMarkdown(cleaned));
      } else {
        const cleaned = Utils.removeNoise(document.body, articleNoise);
        parts.push('## Content\n', Markdown.elementToMarkdown(cleaned));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function hasVisiblePaywall(): boolean {
  const paywallSelectors = [
    '.paywall', '.subscription-wall', '.meter-wall',
    '[class*="paywall"]', '[class*="Paywall"]',
    '[id*="paywall"]', '[id*="Paywall"]',
    '.tp-modal', '.piano-offer',
    '.article-gate', '.gate-content',
  ];
  const isVisible = Utils.createVisibilityChecker();
  for (const selector of paywallSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      // Some sites put the class on each visible paragraph of a metered article.
      if (element.matches('article :is(p, h2, h3, h4, ul, ol, blockquote, figure)')) continue;
      // An empty slot is not a paywall prompt.
      if (!element.textContent?.trim() && !element.querySelector('iframe')) continue;
      if (isVisible(element)) return true;
    }
  }
  return false;
}
