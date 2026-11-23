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
  pathnameRegex: /^\/.+/,
  detect: (contextDocument = document) => {
    const isMedium =
      /^medium$/i.test(contextDocument.querySelector<HTMLMetaElement>('meta[property="al:android:app_name"]')?.content?.trim() || '')
      || /^medium$/i.test(contextDocument.querySelector<HTMLMetaElement>('meta[name="twitter:app:name:iphone"]')?.content?.trim() || '')
      || /medium\.com/i.test(contextDocument.querySelector<HTMLMetaElement>('meta[name="parsely-network-canonical"]')?.content || '');
    return isMedium && Boolean(contextDocument.querySelector('article'));
  },

  buttonPlacement: 'anchor',
  anchor: {
    selector: 'article [data-testid="headerSocialShareButton"], article .pw-multi-vote-count, article button[data-testid="headerClapButton"]',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    // Title
    const titleEl = document.querySelector('h1[data-testid="storyTitle"], article h1, h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    // Author
    const authorEl = document.querySelector('[data-testid="authorName"], article a[rel="author"], .pw-author-name');
    const author = authorEl?.textContent?.trim() || Utils.getMeta('author') || '';

    // Publication
    const pubEl = document.querySelector('[data-testid="publicationName"], .pw-published-in-publication a');
    const publication = pubEl?.textContent?.trim() || '';

    // Date
    const dateEl = document.querySelector('article span[data-testid="storyPublishDate"], article time, [data-testid="publishedAt"]');
    const date = dateEl?.textContent?.trim() || '';

    // Subtitle
    const subtitleEl = document.querySelector('[data-testid="storySubtitle"], article h2:first-of-type');
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

    // Article body: collect all <section> children inside <article> (or fallback to .meteredContent / <article>).
    const article = document.querySelector('article');
    const sections = article ? Array.from(article.querySelectorAll(':scope > section, :scope > div > section')) : [];
    let bodyContainer: HTMLElement | null = null;
    if (sections.length > 0) {
      const wrapper = document.createElement('div');
      sections.forEach((section) => wrapper.appendChild(section.cloneNode(true)));
      bodyContainer = wrapper;
    } else {
      const fallback = document.querySelector('article .meteredContent, article');
      if (fallback) bodyContainer = fallback.cloneNode(true) as HTMLElement;
    }

    if (bodyContainer) {
      const cleaned = Utils.removeNoise(bodyContainer, [
        ...Utils.NOISE_SELECTORS,
        'h1',
        '[data-testid="headerClapButton"]',
        '[data-testid="headerSocialShareButton"]',
        '[data-testid="headerBookmarkButton"]',
        '[data-testid="audioPlayButton"]',
        '.pw-multi-vote-count',
      ]);

      // Remove interactive button wrappers except those wrapping zoomable images/figures.
      cleaned.querySelectorAll('[role="button"]').forEach((el) => {
        if (el.querySelector('img, figure, picture')) return;
        el.remove();
      });

      // Preserve <br> line breaks inside <pre> code blocks before text extraction.
      cleaned.querySelectorAll('pre br').forEach((br) => {
        br.replaceWith(document.createTextNode('\n'));
      });

      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push(body);
    }

    if (hasMediumPaywall()) {
      parts.push('\n---\n*⚠️ The rest of this article is behind a Medium paywall.*\n');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function hasMediumPaywall(): boolean {
  const selectors = [
    '#paywall-background-color',
    '#regwall-heading',
    '[data-testid="paywall"]',
    '.paywall',
    '[class*="paywall"]',
  ];
  const isVisible = Utils.createVisibilityChecker();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (isVisible(element)) return true;
    }
  }
  return false;
}
