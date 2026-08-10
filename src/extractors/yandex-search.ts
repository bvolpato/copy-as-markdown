/**
 * Yandex Search extractor.
 * Supports the primary regional Yandex web-search domains.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Yandex Search',
  matches: [
    '*://yandex.com/search*',
    '*://www.yandex.com/search*',
    '*://yandex.ru/search*',
    '*://www.yandex.ru/search*',
    '*://yandex.kz/search*',
    '*://www.yandex.kz/search*',
    '*://yandex.com.tr/search*',
    '*://www.yandex.com.tr/search*',
    '*://ya.ru/search*',
  ],
  pathnameRegex: /^\/search\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '.search2__navigation',
      '.SearchHeader',
      '#search-result',
      '.search-header',
      'form[action*="search"]',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('text') || params.get('q') || params.get('query') || '');
    const metadata = { source: 'Yandex Search', query, url };
    const parts: string[] = ['# Yandex Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const answer = document.querySelector(
      '.serp-adv__snippet, .CbirSites-Item, [data-testid="answer"], [class*="Answer"]',
    );
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '.Knowledge, .entity-snippet, .Card[data-state], [data-testid="knowledge-panel"]',
    );
    if (knowledge && knowledge !== answer) {
      const title = cleanText(knowledge.querySelector('h2, h3, .Card-Title, [data-testid="title"]')?.textContent || '');
      const description = cleanText(knowledge.querySelector('.Card-Content, .entity-snippet__description, p')?.textContent || '');
      if ((title || description) && description !== answerText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '.serp-item, .Organic, [data-cid], [data-testid="search-result"]',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    if (results.length) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector(
          'h2 a, .OrganicTitle-Link, .serp-item__title, [data-testid="result-title"]',
        )?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
          'h2 a[href], .OrganicTitle-Link[href], .serp-item__title[href], [data-testid="result-title"] a[href], a[href]',
        ));
        const snippet = cleanText(result.querySelector(
          '.OrganicTextContentSpan, .TextContainer, .serp-item__snippet, [data-snippet], [data-testid="result-snippet"], p',
        )?.textContent || '');
        if (!title || !link) return;
        const key = `${title}\n${link}`;
        if (seen.has(key)) return;
        seen.add(key);
        resultCount += 1;
        parts.push(`### ${resultCount}. ${escapeMarkdownText(title)}\n`);
        parts.push(`**URL:** ${link}\n`);
        if (snippet) parts.push(`${snippet}\n`);
      });
    }

    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>(
      '.RelatedQueries a[href], .related-queries a[href], [data-testid="related-search"] a[href]',
    ))
      .map((link) => cleanText(link.textContent || ''))
      .filter(Boolean)
      .slice(0, MAX_RELATED);
    if (related.length) {
      parts.push('## Related Searches\n');
      related.forEach((item) => parts.push(`- ${escapeMarkdownText(item)}`));
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function firstSafeLink(links: NodeListOf<HTMLAnchorElement>): string {
  for (const link of links) {
    const href = safeYandexUrl(link.href || link.getAttribute('href') || '');
    if (href) return href;
  }
  return '';
}

function safeYandexUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    for (const key of ['url', 'u']) {
      const redirected = url.searchParams.get(key);
      if (!redirected) continue;
      try {
        const destination = new URL(redirected);
        if (/^https?:$/.test(destination.protocol)) return destination.href;
      } catch {
        // Keep Yandex result URL when redirect target is malformed.
      }
    }
    return url.href;
  } catch {
    return '';
  }
}

function cleanText(value: string): string {
  return Utils.truncate(value.replace(/\s+/g, ' ').trim(), 600);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\\[\]]/g, '\\$&');
}
