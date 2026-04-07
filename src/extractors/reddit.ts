/**
 * Reddit extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Reddit',
  matches: [
    '*://www.reddit.com/r/*/comments/*',
    '*://old.reddit.com/r/*/comments/*',
    '*://reddit.com/r/*/comments/*',
  ],
  anchor: {
    selector: [
      'shreddit-post [slot="post-actions"]',          // new Reddit action slot
      'shreddit-post .flex',                            // new Reddit flex row
      '[data-testid="post-actions"]',                   // React Reddit
      '.Post .flat-list.buttons',                       // old Reddit
      '.Post .actionBar',                               // old Reddit variant
    ].join(', '),
    position: 'append',
    style: 'link',
    css: { marginLeft: '8px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' },
    label: 'Copy as Markdown',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl =
      document.querySelector('shreddit-post h1') ||
      document.querySelector('[data-testid="post-title"]') ||
      document.querySelector('.Post h1') ||
      document.querySelector('h1');

    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const subreddit =
      document.querySelector('shreddit-post')?.getAttribute('subreddit-prefixed-name') ||
      window.location.pathname.match(/\/r\/([^/]+)/)?.[1] || '';
    const author =
      document.querySelector('shreddit-post')?.getAttribute('author') ||
      document.querySelector('[data-testid="post_author_link"]')?.textContent?.trim() || '';
    const scoreEl =
      document.querySelector('shreddit-post')?.getAttribute('score') ||
      document.querySelector('[data-testid="post-score"]')?.textContent?.trim() || '';

    const metadata = {
      source: 'Reddit',
      subreddit,
      title,
      author: author ? `u/${author.replace(/^u\//, '')}` : '',
      score: scoreEl,
      url,
    };

    const parts: string[] = [`# ${title}\n`];
    if (subreddit) parts.push(`**Subreddit:** ${subreddit}`);
    if (author) parts.push(`**Author:** u/${author.replace(/^u\//, '')}`);
    if (scoreEl) parts.push(`**Score:** ${scoreEl}`);
    parts.push('');

    const bodyEl =
      document.querySelector('shreddit-post [slot="text-body"]') ||
      document.querySelector('[data-testid="post-content"]') ||
      document.querySelector('.Post .RichTextJSON-root') ||
      document.querySelector('.expando .md');

    if (bodyEl) {
      const cleaned = Utils.removeNoise(bodyEl, ['script', 'style']);
      parts.push('## Post Content\n');
      parts.push(Markdown.elementToMarkdown(cleaned));
      parts.push('');
    }

    const comments = document.querySelectorAll(
      'shreddit-comment, .Comment, [data-testid="comment"]',
    );

    if (comments.length > 0) {
      parts.push('## Comments\n');
      let count = 0;
      comments.forEach((comment) => {
        if (count >= 30) return;
        const ca =
          (comment as HTMLElement).getAttribute('author') ||
          comment.querySelector('[data-testid="comment_author_link"]')?.textContent?.trim() ||
          comment.querySelector('.author')?.textContent?.trim() || 'Anonymous';
        const cs =
          (comment as HTMLElement).getAttribute('score') ||
          comment.querySelector('[data-testid="comment-score"]')?.textContent?.trim() || '';
        const cb =
          comment.querySelector('[slot="comment"]') ||
          comment.querySelector('[data-testid="comment-body"]') ||
          comment.querySelector('.md');

        if (cb) {
          const depth = parseInt((comment as HTMLElement).getAttribute('depth') || '0');
          const indent = '> '.repeat(Math.min(depth, 3));
          const scoreStr = cs ? ` (${cs} points)` : '';
          parts.push(`${indent}**${ca}**${scoreStr}:\n`);
          const md = Markdown.elementToMarkdown(cb);
          parts.push(indent ? md.split('\n').map((l) => indent + l).join('\n') : md);
          parts.push('');
          count++;
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
