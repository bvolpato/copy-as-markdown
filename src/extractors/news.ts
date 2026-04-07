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
    '*://www.cnn.com/*',
    '*://www.bbc.com/*',
    '*://www.bbc.co.uk/*',
    '*://www.nytimes.com/*',
    '*://www.washingtonpost.com/*',
    '*://www.theguardian.com/*',
    '*://www.reuters.com/*',
    '*://apnews.com/*',
    '*://www.bloomberg.com/*',
    '*://www.wsj.com/*',
    '*://www.cnbc.com/*',
    '*://www.nbcnews.com/*',
    '*://abcnews.go.com/*',
    '*://www.usatoday.com/*',
    '*://www.politico.com/*',
    '*://www.axios.com/*',
    '*://www.theatlantic.com/*',
    '*://www.vox.com/*',
    '*://www.vice.com/*',
    '*://techcrunch.com/*',
    '*://www.theverge.com/*',
    '*://arstechnica.com/*',
    '*://www.wired.com/*',
  ],
  anchor: {
    selector: [
      'article header',              // semantic article header
      '.article-header',             // common class
      '.headline',                   // headline wrapper
      '.article-meta',               // meta (author, date) area
      '.byline',                      // byline row
      'h1',                           // article title
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px', display: 'inline-flex' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const isLiveBlog = /live-news|liveblog|live-updates/i.test(url);

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

    if (Utils.hasPaywall()) {
      parts.push('> ⚠️ **Paywall detected.** Content below may be incomplete.\n');
    }

    if (isLiveBlog) {
      parts.push('## Live Updates\n');
      const updates = document.querySelectorAll('.live-blog-post, [data-testid="live-blog-post"], article, .post-item');
      updates.forEach((update, i) => {
        if (i >= 50) return;
        const ut = update.querySelector('h2, h3')?.textContent?.trim() || '';
        const uTime = update.querySelector('time')?.textContent?.trim() || '';
        const uBody = update.querySelector('.post-body, .body, p')?.textContent?.trim() || '';
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

      if (articleEl) {
        const cleaned = Utils.removeNoise(articleEl, [
          ...Utils.NOISE_SELECTORS,
          '.ad', '.advertisement', '.embed', '.social-share',
          '.article-footer', '.tags', '.related-articles',
          '.comments-section', '.newsletter-signup',
        ]);
        parts.push('## Article\n', Markdown.elementToMarkdown(cleaned));
      } else {
        const cleaned = Utils.removeNoise(document.body, Utils.NOISE_SELECTORS);
        parts.push('## Content\n', Markdown.elementToMarkdown(cleaned));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
