/**
 * Yahoo Search extractor.
 * Covers web search and legacy Yahoo search result routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Yahoo Search',
  matches: [
    '*://search.yahoo.com/search*',
    '*://search.yahoo.com/yhs/search*',
    '*://yahoo.com/search*',
    '*://www.yahoo.com/search*',
  ],
  pathnameRegex: /^\/(?:search|yhs\/search)\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#searchCenterMiddle',
      '#web',
      '#header',
      '.searchCenterMiddle',
      '[data-test-locator="search-input"]',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('p') || params.get('q') || '');
    const metadata = { source: 'Yahoo Search', query, url };
    const parts: string[] = ['# Yahoo Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const answer = document.querySelector(
      '[data-test-locator="answer"], .searchCenterTop .compText, .compArticle .compText',
    );
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '#right .compCard, #right .infobox, [data-test-locator="knowledge-panel"]',
    );
    if (knowledge) {
      const title = cleanText(knowledge.querySelector('h2, h3, .compTitle')?.textContent || '');
      const description = cleanText(knowledge.querySelector('.compText, .compDescription, p')?.textContent || '');
      if ((title || description) && description !== answerText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '#web li[class*="algo"], #web .algo, #web article, .searchCenterMiddle .algo, [data-test-locator="result"]',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    if (results.length) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector('h3 a, h3, [data-test-locator="result-title"]')?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('h3 a[href], [data-test-locator="result-title"] a[href], a[href]'));
        const snippet = cleanText(result.querySelector(
          '.compText.aAbs, .aAbs, [data-test-locator="description"], .compSummary p, p',
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
      '.related-searches a[href], #brs a[href], [data-test-locator="related-search"] a[href]',
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
    const href = safeYahooUrl(link.href || link.getAttribute('href') || '');
    if (href) return href;
  }
  return '';
}

function safeYahooUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    for (const key of ['url', 'RU', 'u']) {
      const redirected = url.searchParams.get(key);
      if (!redirected) continue;
      try {
        const destination = new URL(redirected);
        if (/^https?:$/.test(destination.protocol)) return destination.href;
      } catch {
        // Keep Yahoo result URL when redirect target is malformed.
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
