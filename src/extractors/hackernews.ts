/**
 * Hacker News extractor.
 * Extracts post title, link, score, and comment threads.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const USER_SELECTOR = '.hnuser, .subtext a[href^="user?id="], .comhead a[href^="user?id="]';

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
    const authorEl = queryPostMeta(postScope, USER_SELECTOR);
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
    const postText = postTextEl ? textToMarkdown(postTextEl) : '';
    if (postText) {
      parts.push('## Post\n');
      parts.push(postText);
      parts.push('');
    }

    // Comments
    const commentEls = Array.from(document.querySelectorAll('.comtr'));
    const renderedComments: string[][] = [];
    let commentCount = 0;
    commentEls.forEach((comment, index) => {
      const depth = getCommentDepth(comment);
      const textEl = comment.querySelector('.commtext');
      let text = textEl ? textToMarkdown(textEl) : '';
      if (text) commentCount += 1;
      // Keep a removed comment that has replies, so that they do not move below another comment.
      else if (commentEls[index + 1] && getCommentDepth(commentEls[index + 1]) > depth) text = removedLabel(comment);
      if (!text) return;

      const prefix = '  '.repeat(depth);

      const commentAuthor = comment.querySelector(USER_SELECTOR)?.textContent?.trim() || '';
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
      parts.push(`## Comments (${commentCount})\n`);
      for (const block of renderedComments) {
        parts.push(...block);
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

/** The first paragraph is bare text before the first <p>, so wrap it to keep the paragraph break. */
function textToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  const paragraph = clone.ownerDocument.createElement('p');
  while (clone.firstChild && !(clone.firstChild instanceof Element && clone.firstChild.matches('p, pre, ul, ol, div'))) {
    paragraph.append(clone.firstChild);
  }
  clone.prepend(paragraph);
  return Markdown.elementToMarkdown(clone).trim();
}

function queryPostMeta(scope: ParentNode | null, selector: string): Element | null {
  if (!scope) return null;
  for (const el of scope.querySelectorAll(selector)) {
    if (!el.closest('.comtr') && el.id !== 'me') {
      return el;
    }
  }
  return null;
}

function removedLabel(comment: Element): string {
  const label = Array.from(comment.querySelector('.comment')?.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .find(Boolean);
  return label || '[deleted]';
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
