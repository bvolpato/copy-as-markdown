/**
 * Medium extractor.
 * Extracts article title, author, publication, claps, and full article body.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Medium',
  matches: [
    '*://medium.com/*',
    '*://*.medium.com/*',
  ],
  regex: /^https?:\/\/([a-z0-9-]+\.)?medium\.com\/.+/,

  anchor: {
    selector: 'article [data-testid="headerSocialShareButton"], article .pw-multi-vote-count, article button[data-testid="headerClapButton"]',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    // Title
    const titleEl = document.querySelector('article h1, h1[data-testid="storyTitle"]');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    // Author
    const authorEl = document.querySelector('[data-testid="authorName"], article a[rel="author"], .pw-author-name');
    const author = authorEl?.textContent?.trim() || '';

    // Publication
    const pubEl = document.querySelector('[data-testid="publicationName"], .pw-published-in-publication a');
    const publication = pubEl?.textContent?.trim() || '';

    // Date
    const dateEl = document.querySelector('article span[data-testid="storyPublishDate"], article time, [data-testid="publishedAt"]');
    const date = dateEl?.textContent?.trim() || '';

    // Subtitle
    const subtitleEl = document.querySelector('article h2:first-of-type, [data-testid="storySubtitle"]');
    const subtitle = subtitleEl?.textContent?.trim() || '';

    // Reading time
    const readTimeEl = document.querySelector('[data-testid="storyReadTime"], .pw-reading-time');
    const readTime = readTimeEl?.textContent?.trim() || '';

    // Claps
    const clapEl = document.querySelector('[data-testid="headerClapCount"], .pw-multi-vote-count');
    const claps = clapEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = {
      source: 'Medium',
      title,
      url,
    };
    if (author) metadata.author = author;
    if (publication) metadata.publication = publication;
    if (date) metadata.date = date;
    if (readTime) metadata.reading_time = readTime;

    const parts: string[] = [`# ${title}\n`];
    if (subtitle && subtitle !== title) parts.push(`*${subtitle}*\n`);

    const meta: string[] = [];
    if (author) meta.push(`**Author:** ${author}`);
    if (publication) meta.push(`**Publication:** ${publication}`);
    if (date) meta.push(`**Date:** ${date}`);
    if (readTime) meta.push(`**Reading time:** ${readTime}`);
    if (claps) meta.push(`**Claps:** ${claps}`);
    if (meta.length) parts.push(meta.join(' · ') + '\n');

    // Article body
    const articleEl = document.querySelector('article section, article .meteredContent, article');
    if (articleEl) {
      // Remove elements we don't want
      const clone = articleEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-testid="headerClapButton"], [data-testid="headerSocialShareButton"], .pw-multi-vote-count, [role="button"]').forEach(el => el.remove());

      parts.push(Markdown.elementToMarkdown(clone));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
