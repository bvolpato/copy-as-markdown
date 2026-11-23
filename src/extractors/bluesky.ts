/**
 * Bluesky (bsky.app) post thread and profile extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const blueskyExtractor = register({
  name: 'Bluesky',
  matches: [
    '*://bsky.app/profile/*',
    '*://bsky.app/search*',
  ],
  pathnameRegex: /^\/(?:profile\/[^/?#]+(?:\/post\/[^/?#]+)?|search)\/?$/,

  async extract() {
    const isPost = /\/profile\/[^/]+\/post\/[^/]+/.test(window.location.pathname);
    const title = Markdown.normalizeWhitespace(Utils.getPageTitle().replace(/\s*—\s*Bluesky$/i, '').replace(/\s*-\s*Bluesky$/i, ''));

    const metadata: PageMetadata = {
      source: 'Bluesky',
      title,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# ${title}`];
    const postSelector = '[data-testid^="postThreadItem"], [data-testid^="feedItem"]';
    const postEls = Array.from(document.querySelectorAll(postSelector));
    let count = 0;

    for (const post of postEls) {
      const textEl = post.querySelector('[data-testid="postText"]');
      const body = textEl ? Markdown.elementToMarkdown(textEl) : '';
      const images = Array.from(post.querySelectorAll<HTMLImageElement>('img[src]'))
        .filter((img) => !img.closest('[data-testid="userAvatarImage"]'))
        .map((img) => {
          const alt = Markdown.escapeMarkdownLinkText(Markdown.normalizeWhitespace(img.alt || 'Image'));
          return img.src ? `![${alt}](${img.src})` : '';
        })
        .filter(Boolean);

      if (!body && images.length === 0) continue;

      const authorLink = post.querySelector<HTMLAnchorElement>('a[href^="/profile/"]');
      const author = Markdown.normalizeWhitespace(authorLink?.textContent || '') || 'User';
      const isFocal = post.getAttribute('data-testid')?.includes('postThreadItem-by-') && count === 0 && isPost;

      count += 1;
      const heading = isFocal ? '##' : '###';
      const content = [body, ...images].filter(Boolean).join('\n\n');
      parts.push(`\n${heading} ${author}\n\n${content}`);
    }

    if (count === 0) {
      const main = document.querySelector('main') || document.body;
      parts.push('\n' + Markdown.elementToMarkdown(Utils.removeNoise(main, [...Utils.NOISE_SELECTORS, 'button'])));
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Bluesky DOM',
      included: count,
      truncated: limited.truncated,
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
