/**
 * Yahoo Search extractor.
 * Covers web search and legacy Yahoo search result routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Yahoo Search',
  matches: [
    '*://search.yahoo.com/search*',
    '*://*.search.yahoo.com/search*',
    '*://search.yahoo.com/yhs/search*',
    '*://*.search.yahoo.com/yhs/search*',
    '*://search.yahoo.co.jp/search*',
    '*://yahoo.com/search*',
    '*://www.yahoo.com/search*',
  ],
  pathnameRegex: /^\/(?:search|yhs\/search)(?:;[^/?#]*)?\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#hd',
      '#yucs-top-bar',
      '#ysch',
      '#header',
    ].join(', '),
    position: 'append',
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
    results.forEach((result) => {
      if (result.matches('.dd.Ad, .ads') || result.closest('.dd.Ad, .ads')) return;
      const title = cleanText(result.querySelector('h3 a, h3, [data-test-locator="result-title"]')?.textContent || '');
      const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('h3 a[href], [data-test-locator="result-title"] a[href], a[href]'));
      const snippet = cleanText(result.querySelector(
        '.compText.aAbs, .aAbs, [data-test-locator="description"], .compSummary p, .compText p, .compText, p',
      )?.textContent || '');
      if (!title || !link) return;
      const key = `${title}\n${link}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (resultCount === 0) parts.push('## Search Results\n');
      resultCount += 1;
      parts.push(`### ${resultCount}. ${escapeMarkdownText(title)}\n`);
      parts.push(`**URL:** ${link}\n`);
      if (snippet) parts.push(`${snippet}\n`);
    });

    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>(
      '.related-searches a[href], #brs a[href], [data-test-locator="related-search"] a[href]',
    ))
      .map((link) => cleanText(link.textContent || ''))
      .filter(Boolean);
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
    const raw = (link.getAttribute('href') || '').trim();
    if (!raw || raw.startsWith('#')) continue;
    const href = safeYahooUrl(link.href || raw);
    if (href) return href;
  }
  return '';
}

function safeYahooUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    const ruMatch = url.pathname.match(/\/RU=([^/]+)(?:\/|$)/i);
    if (ruMatch) {
      try {
        const destination = new URL(decodeURIComponent(ruMatch[1]));
        if (/^https?:$/.test(destination.protocol)) return destination.href;
      } catch {
        // Fall through to query parameter checks.
      }
    }
    for (const key of ['url', 'RU', 'u']) {
      const redirected = url.searchParams.get(key);
      if (!redirected) continue;
      try {
        const destination = new URL(redirected);
        if (/^https?:$/.test(destination.protocol)) return destination.href;
      } catch {
        // Ignore malformed redirect parameter.
      }
    }
    if (/(?:^|\.)yahoo\.(?:com|co\.jp)$/i.test(url.hostname)) {
      if (
        /^\/(?:search|yhs\/search)(?:;[^/?#]*)?\/?$/i.test(url.pathname)
        || url.pathname.startsWith('/cbclk')
        || url.hostname.startsWith('r.search.')
      ) {
        return '';
      }
    }
    return url.href;
  } catch {
    return '';
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\\[\]]/g, '\\$&');
}
