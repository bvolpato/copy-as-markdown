/**
 * Dev.to extractor.
 * Extracts article title, author, tags, reactions, and full article body.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Dev.to',
  matches: [
    '*://dev.to/*/*',
  ],

  anchor: {
    selector: '.crayons-article__header__meta, #article-show-container .spec__header, .article-header',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('#article-show-container h1, .crayons-article__header h1, h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const authorEl = document.querySelector('.crayons-article__header .crayons-story__secondary a, .profile-preview-card__name, a.crayons-story__secondary');
    const author = authorEl?.textContent?.trim() || '';

    const dateEl = document.querySelector('.crayons-article__header time, time[datetime]');
    const date = dateEl?.textContent?.trim() || '';

    const tagsEls = document.querySelectorAll('.crayons-article__header .crayons-tag, .spec__tags .crayons-tag');
    const tags = Array.from(tagsEls).map(el => el.textContent?.trim()).filter(Boolean);

    const reactionsEl = document.querySelector('.crayons-article__header .reactions-count, [id="article-show-container"] .reactions-count');
    const reactions = reactionsEl?.textContent?.trim() || '';

    const commentsCountEl = document.querySelector('.comments-count, #comments .crayons-subtitle-1');
    const commentsCount = commentsCountEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = {
      source: 'Dev.to',
      title,
      url,
    };
    if (author) metadata.author = author;
    if (date) metadata.date = date;
    if (tags.length) metadata.tags = tags.join(', ');

    const parts: string[] = [`# ${title}\n`];

    const meta: string[] = [];
    if (author) meta.push(`**Author:** ${author}`);
    if (date) meta.push(`**Date:** ${date}`);
    if (reactions) meta.push(`**Reactions:** ${reactions}`);
    if (tags.length) meta.push(`**Tags:** ${tags.join(', ')}`);
    if (meta.length) parts.push(meta.join(' · ') + '\n');

    // Article body
    const bodyEl = document.querySelector('#article-body, .crayons-article__main .crayons-article__body');
    if (bodyEl) {
      parts.push(Markdown.elementToMarkdown(bodyEl));
    }

    // Comments
    const commentEls = document.querySelectorAll('.comment, .crayons-comment');
    if (commentEls.length > 0) {
      parts.push(`\n## Comments (${commentEls.length})\n`);
      commentEls.forEach(comment => {
        const cAuthor = comment.querySelector('.comment__header a, .crayons-comment__header a')?.textContent?.trim() || '';
        const cBody = comment.querySelector('.comment__body, .crayons-comment__body');
        const cText = cBody ? Markdown.elementToMarkdown(cBody) : '';
        if (cText) {
          parts.push(`- **${cAuthor}:**`);
          cText.split('\n').filter(l => l.trim()).forEach(line => parts.push(`  ${line}`));
          parts.push('');
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
