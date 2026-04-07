/**
 * Hacker News extractor.
 * Extracts post title, link, score, and comment threads.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Hacker News',
  matches: [
    '*://news.ycombinator.com/item*',
  ],
  // No anchor — HN uses table-based layout; floating icon (top-right) is cleanest

  async extract() {
    const url = Utils.getCanonicalUrl();

    // Post title
    const titleEl = document.querySelector('.titleline > a, .athing .titleline a');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();
    const postUrl = (titleEl as HTMLAnchorElement)?.href || '';

    // Post metadata
    const scoreEl = document.querySelector('.score');
    const score = scoreEl?.textContent?.trim() || '';
    const authorEl = document.querySelector('.hnuser');
    const author = authorEl?.textContent?.trim() || '';
    const ageEl = document.querySelector('.age a');
    const age = ageEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = {
      source: 'Hacker News',
      title,
      url,
    };
    if (postUrl && postUrl !== url) metadata.link = postUrl;
    if (author) metadata.author = author;

    const parts: string[] = [`# ${title}\n`];
    if (postUrl && postUrl !== url) parts.push(`**Link:** ${postUrl}`);
    if (score) parts.push(`**Score:** ${score}`);
    if (author) parts.push(`**Author:** ${author}`);
    if (age) parts.push(`**Posted:** ${age}`);
    parts.push('');

    // Post text (for Ask HN, Show HN, etc.)
    const postTextEl = document.querySelector('.fatitem .toptext, .fatitem .commtext');
    if (postTextEl) {
      parts.push('## Post\n');
      parts.push(Markdown.elementToMarkdown(postTextEl));
      parts.push('');
    }

    // Comments
    const commentEls = document.querySelectorAll('.comtr');
    if (commentEls.length > 0) {
      parts.push(`## Comments (${commentEls.length})\n`);

      commentEls.forEach((comment) => {
        const indent = comment.querySelector('.ind img') as HTMLImageElement | null;
        const depth = indent ? Math.floor((parseInt(indent.getAttribute('width') || '0', 10)) / 40) : 0;
        const prefix = '  '.repeat(depth);

        const commentAuthor = comment.querySelector('.hnuser')?.textContent?.trim() || '';
        const commentAge = comment.querySelector('.age a')?.textContent?.trim() || '';

        const textEl = comment.querySelector('.commtext');
        const text = textEl ? Markdown.elementToMarkdown(textEl) : '';

        if (text) {
          parts.push(`${prefix}- **${commentAuthor}** (${commentAge}):`);
          // Indent the comment text
          const lines = text.split('\n').filter((l) => l.trim());
          lines.forEach((line) => {
            parts.push(`${prefix}  ${line}`);
          });
          parts.push('');
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
