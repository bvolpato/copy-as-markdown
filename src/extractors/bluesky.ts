/**
 * Bluesky (bsky.app) post thread and profile extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

/** Bluesky renders line breaks as newline characters, and wraps mentions in block elements. */
function postTextToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('div').forEach((wrapper) => wrapper.replaceWith(...wrapper.childNodes));
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const lineBreakNodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.includes('\n')) lineBreakNodes.push(walker.currentNode as Text);
  }
  lineBreakNodes.forEach((node) => node.replaceWith(
    ...node.data.split('\n').flatMap((line, index) => index ? [document.createElement('br'), line] : [line]),
  ));
  return Markdown.elementToMarkdown(clone);
}

export const blueskyExtractor = register({
  name: 'Bluesky',
  matches: [
    '*://bsky.app/profile/*',
    '*://bsky.app/search*',
  ],
  pathnameRegex: /^\/(?:profile\/[^/?#]+(?:\/post\/[^/?#]+)?|search)\/?$/,

  async extract() {
    const isPost = /\/profile\/[^/]+\/post\/[^/]+/.test(window.location.pathname);
    // In-app navigation updates the document title, but not the head metadata of the first page.
    const canonicalUrl = Utils.getCanonicalUrl();
    const staleHead = new URL(canonicalUrl).pathname.replace(/\/$/, '') !== window.location.pathname.replace(/\/$/, '');
    const pageTitle = staleHead ? document.title.replace(/^\(\d+\+?\)\s*/, '') : Utils.getPageTitle();
    const title = Markdown.normalizeWhitespace(pageTitle.replace(/\s*—\s*Bluesky$/i, '').replace(/\s*-\s*Bluesky$/i, ''));

    const metadata: PageMetadata = {
      source: 'Bluesky',
      title,
      url: staleHead ? window.location.href : canonicalUrl,
    };

    const parts: string[] = [`# ${title}`];
    const postSelector = '[data-testid^="postThreadItem"], [data-testid^="feedItem"]';
    // Earlier screens stay in the DOM behind aria-hidden.
    const postEls = Array.from(document.querySelectorAll(postSelector))
      .filter((post) => !post.closest('[aria-hidden="true"]'));
    let count = 0;

    for (const post of postEls) {
      const textEl = post.querySelector('[data-testid="postText"]')
        || Array.from(post.querySelectorAll('[data-word-wrap="1"]')).find((el) => {
          // Quoted posts are nested role="link" elements.
          const link = el.closest('[role="link"]');
          return !link || link.contains(post);
        });
      const body = textEl ? postTextToMarkdown(textEl) : '';
      const images = Array.from(post.querySelectorAll<HTMLImageElement>('img[src]'))
        .filter((img) => !img.closest('[data-testid="userAvatarImage"]'))
        .map((img) => {
          const alt = Markdown.escapeMarkdownLinkText(Markdown.normalizeWhitespace(img.alt || 'Image'));
          return img.src ? `![${alt}](${img.src})` : '';
        })
        .filter(Boolean);

      if (!body && images.length === 0) continue;

      const handle = post.getAttribute('data-testid')?.match(/-by-(.+)$/)?.[1] || '';
      const profileLinks = Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href^="/profile/"]'));
      const ownLinks = profileLinks.filter((link) => link.getAttribute('href') === `/profile/${handle}`);
      const name = (ownLinks.length ? ownLinks : profileLinks)
        .filter((link) => !/^Reposted by/i.test(link.getAttribute('aria-label') || ''))
        .map((link) => Markdown.normalizeWhitespace((link.querySelector('[dir="auto"]') || link).textContent || ''))
        .find((value) => value && !value.startsWith('@')) || '';
      const author = [name, handle ? `@${handle}` : ''].filter(Boolean).join(' ') || 'User';
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
