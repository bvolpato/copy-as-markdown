/**
 * Dev.to extractor.
 * Extracts article title, author, tags, reactions, and full article body.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const DEVTO_ARTICLE_PATH_RE = /^\/(?!(?:t|top|pod|settings|tags|search|notifications|dashboard|readinglist)(?:\/|$))[^/]+\/[^/]+/i;

register({
  name: 'Dev.to',
  matches: [
    '*://dev.to/*/*',
    '*://www.dev.to/*/*',
  ],
  pathnameRegex: DEVTO_ARTICLE_PATH_RE,

  buttonPlacement: 'anchor',
  anchor: {
    selector: '.crayons-article__header__meta, #article-show-container .spec__header, .article-header',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('#article-show-container h1, .crayons-article__header h1, h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const authorEl = document.querySelector([
      '.crayons-article__header__meta a.crayons-link.fw-bold',
      '.crayons-article__header__meta .profile-preview-card__trigger',
      '.profile-preview-card__trigger',
      '.crayons-article__header .crayons-story__secondary a',
      '.profile-preview-card__name',
      'a.crayons-story__secondary',
    ].join(', '));
    const author = authorEl?.textContent?.trim()
      || document.querySelector('meta[name="author"]')?.getAttribute('content')?.trim()
      || '';

    const dateEl = document.querySelector('.crayons-article__header time, time[datetime]');
    const date = dateEl?.textContent?.trim() || '';

    const tagsEls = document.querySelectorAll('.crayons-article__header .crayons-tag, .spec__tags .crayons-tag');
    const tags = Array.from(tagsEls).map((el) => el.textContent?.trim()).filter(Boolean);

    const reactionsEl = document.querySelector('.crayons-article__header .reactions-count, [id="article-show-container"] .reactions-count');
    const reactions = reactionsEl?.textContent?.trim() || '';

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
      const cleanedBody = Utils.removeNoise(bodyEl, [
        ...Utils.NOISE_SELECTORS,
        '.anchor',
        '.highlight__panel',
      ]);
      parts.push(Markdown.elementToMarkdown(cleanedBody));
    }

    // Comments
    const commentEls = document.querySelectorAll('.comment, .crayons-comment');
    const renderedComments: string[][] = [];
    commentEls.forEach((comment) => {
      const cAuthor = comment.querySelector(
        '.comment__header a.crayons-link, .crayons-comment__header a.crayons-link, .comment__header .profile-preview-card__trigger, .comment__header a, .crayons-comment__header a',
      )?.textContent?.trim() || '';
      const cBody = comment.querySelector('.comment__body, .crayons-comment__body');
      if (!cBody) return;
      const cleanedComment = Utils.removeNoise(cBody, [
        ...Utils.NOISE_SELECTORS,
        '.comment__footer',
        '.crayons-comment__footer',
        '.comment-action',
        'button',
      ]);
      const cText = Markdown.elementToMarkdown(cleanedComment).trim();
      if (!cText) return;

      const block: string[] = [cAuthor ? `- **${cAuthor}:**` : '- Comment:'];
      cText.split('\n').filter((line) => line.trim()).forEach((line) => block.push(`  ${line}`));
      block.push('');
      renderedComments.push(block);
    });

    if (renderedComments.length > 0) {
      parts.push(`\n## Comments (${renderedComments.length})\n`);
      for (const block of renderedComments) {
        parts.push(...block);
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
