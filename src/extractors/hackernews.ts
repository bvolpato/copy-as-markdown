/**
 * Hacker News extractor.
 * Extracts post title, link, score, and comment threads.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Hacker News',
  pathnameRegex: /^\/item\/?$/,
  matches: [
    '*://news.ycombinator.com/item*',
  ],
  // No anchor: HN uses table-based layout; the default bottom-right floating button is cleanest

  async extract() {
    const url = Utils.getCanonicalUrl();

    // Scope post metadata to .fatitem (or the post table) so navbar #me and comment authors do not leak
    const postScope = document.querySelector('table.fatitem')
      || document.querySelector('.athing')?.closest('table')
      || document.querySelector('.fatitem');

    // Post title
    const titleEl = queryPostMeta(postScope, '.titleline > a, .athing .titleline a')
      || document.querySelector('.titleline > a, .athing .titleline a');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();
    const postUrl = (titleEl as HTMLAnchorElement)?.href || '';

    // Post metadata
    const scoreEl = queryPostMeta(postScope, '.score');
    const score = scoreEl?.textContent?.trim() || '';
    const authorEl = queryPostMeta(postScope, '.hnuser');
    const author = authorEl?.textContent?.trim() || '';
    const ageEl = queryPostMeta(postScope, '.age a');
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
    const postText = postTextEl ? Markdown.elementToMarkdown(postTextEl).trim() : '';
    if (postText) {
      parts.push('## Post\n');
      parts.push(postText);
      parts.push('');
    }

    // Comments
    const commentEls = document.querySelectorAll('.comtr');
    const renderedComments: string[][] = [];
    commentEls.forEach((comment) => {
      const textEl = comment.querySelector('.commtext');
      const text = textEl ? Markdown.elementToMarkdown(textEl).trim() : '';
      if (!text) return;

      const depth = getCommentDepth(comment);
      const prefix = '  '.repeat(depth);

      const commentAuthor = comment.querySelector('.hnuser')?.textContent?.trim() || '';
      const commentAge = comment.querySelector('.age a')?.textContent?.trim() || '';
      const header = formatCommentHeader(prefix, commentAuthor, commentAge);

      const block: string[] = [header];
      text.split('\n').forEach((line) => {
        block.push(`${prefix}  ${line}`);
      });
      block.push('');
      renderedComments.push(block);
    });

    if (renderedComments.length > 0) {
      parts.push(`## Comments (${renderedComments.length})\n`);
      for (const block of renderedComments) {
        parts.push(...block);
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function queryPostMeta(scope: ParentNode | null, selector: string): Element | null {
  if (!scope) return null;
  for (const el of scope.querySelectorAll(selector)) {
    if (!el.closest('.comtr') && el.id !== 'me') {
      return el;
    }
  }
  return null;
}

function getCommentDepth(comment: Element): number {
  const indCell = comment.querySelector('td.ind, .ind');
  const indentAttr = indCell?.getAttribute('indent');
  if (indentAttr !== null && indentAttr !== undefined && /^\d+$/.test(indentAttr.trim())) {
    return parseInt(indentAttr.trim(), 10);
  }
  const indentImg = comment.querySelector('.ind img') as HTMLImageElement | null;
  return indentImg ? Math.floor((parseInt(indentImg.getAttribute('width') || '0', 10)) / 40) : 0;
}

function formatCommentHeader(prefix: string, author: string, age: string): string {
  if (author && age) return `${prefix}- **${author}** (${age}):`;
  if (author) return `${prefix}- **${author}**:`;
  if (age) return `${prefix}- (${age}):`;
  return `${prefix}- Comment:`;
}
