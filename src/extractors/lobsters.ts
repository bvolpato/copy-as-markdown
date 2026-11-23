/**
 * Lobste.rs discussion and nested comments extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function extractNestedComments(listEl: Element, depth = 0): string[] {
  const lines: string[] = [];
  const items = Array.from(listEl.children).filter((el) => el.matches('li.comments_subtree, li'));
  for (const li of items) {
    const comment = li.querySelector(':scope > .comment');
    if (comment) {
      const author = Markdown.normalizeWhitespace(comment.querySelector('.byline a[href^="/~"], .byline a.u-author')?.textContent || '') || 'Anonymous';
      const age = Markdown.normalizeWhitespace(comment.querySelector('.byline time, .byline .timeago')?.textContent || '');
      const textEl = comment.querySelector('.comment_text');
      if (textEl) {
        const body = Markdown.elementToMarkdown(Utils.removeNoise(textEl, [...Utils.NOISE_SELECTORS, 'button']));
        if (body) {
          const indent = '  '.repeat(depth);
          const quoted = body.split('\n').map((line) => `${indent}  > ${line}`).join('\n');
          lines.push(`${indent}- **${author}**${age ? ` (${age})` : ''}:\n${quoted}`);
        }
      }
    }
    const childList = li.querySelector(':scope > ol.comments');
    if (childList) {
      lines.push(...extractNestedComments(childList, depth + 1));
    }
  }
  return lines;
}

export const lobstersExtractor = register({
  name: 'Lobsters',
  matches: [
    '*://lobste.rs/s/*',
  ],
  pathnameRegex: /^\/s\/[^/?#]+/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '.story .byline, .story h1, #story_header',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const titleLink = document.querySelector<HTMLAnchorElement>('.story .link a.u-url')
      || document.querySelector<HTMLAnchorElement>('.story a.u-url')
      || document.querySelector<HTMLAnchorElement>('.story h2 a');
    const title = Markdown.normalizeWhitespace(titleLink?.textContent || document.querySelector('.story h2, .story .link')?.textContent || Utils.getPageTitle());
    const storyUrl = titleLink?.href || '';
    const score = Markdown.normalizeWhitespace(document.querySelector('.story .voters .upvoter, .story .voters .score, .story .score')?.textContent || '');
    const author = Markdown.normalizeWhitespace(document.querySelector('.story .byline a.u-author, .story .byline a[href^="/~"]')?.textContent || '');
    const tags = Array.from(document.querySelectorAll('.story .tags a.tag'))
      .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
      .filter(Boolean);

    const metadata: PageMetadata = {
      source: 'Lobsters',
      title,
      url: Utils.getCanonicalUrl(),
      author: author || undefined,
      tags: tags.length > 0 ? tags.join(', ') : undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (storyUrl && storyUrl !== window.location.href) parts.push(`**Link:** ${storyUrl}`);
    const meta = [
      score ? `**Score:** ${score}` : '',
      author ? `**Submitted by:** ${author}` : '',
      tags.length > 0 ? `**Tags:** ${tags.map((t) => `\`${t}\``).join(' ')}` : '',
    ].filter(Boolean);
    if (meta.length > 0) parts.push(meta.join(' | '));

    const storyTextEl = document.querySelector('.story_text');
    if (storyTextEl) {
      const body = Markdown.elementToMarkdown(storyTextEl);
      if (body) parts.push('\n## Description\n\n' + body);
    }

    const rootComments = document.querySelector('ol.comments.comments1, ol.comments');
    let commentCount = 0;
    if (rootComments) {
      const commentLines = extractNestedComments(rootComments, 0);
      commentCount = commentLines.length;
      if (commentCount > 0) {
        parts.push(`\n## Comments (${commentCount})\n\n` + commentLines.join('\n\n'));
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Lobsters discussion',
      included: commentCount,
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
