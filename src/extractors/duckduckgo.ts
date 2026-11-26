/**
 * DuckDuckGo Search extractor.
 * Covers the regular, HTML, and lightweight result routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'DuckDuckGo Search',
  matches: [
    '*://duckduckgo.com/*',
    '*://www.duckduckgo.com/*',
    '*://start.duckduckgo.com/*',
    '*://html.duckduckgo.com/*',
    '*://lite.duckduckgo.com/*',
    '*://safe.duckduckgo.com/*',
    '*://noai.duckduckgo.com/*',
    '*://safe-noai.duckduckgo.com/*',
  ],
  pathnameRegex: /^\/(?:$|html(?:\/|$)|lite(?:\/|$)|search(?:\/|$))/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="duckbar"] nav > ul:first-of-type',
      '#react-duckbar nav > ul:first-of-type',
      '#duckbar nav > ul:first-of-type',
    ].join(', '),
    position: 'append',
    style: 'link',
    wrapperTag: 'li',
    wrapperCss: {
      display: 'flex',
      alignItems: 'center',
      marginLeft: '4px',
    },
    css: {
      padding: '8px 0',
      fontSize: '13px',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      opacity: '1',
    },
    label: 'Copy as Markdown',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const inputQuery = document.querySelector<HTMLInputElement>('input[name="q"]')?.value || '';
    const query = cleanText(params.get('q') || inputQuery);
    const metadata = { source: 'DuckDuckGo Search', query, url };
    const parts: string[] = ['# DuckDuckGo Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const assistCard = document.querySelector('[data-testid="assist-card"]');
    const assistText = cleanText(assistCard?.textContent || '');
    if (assistText) parts.push('## DuckAssist\n', `${assistText}\n`);

    const instantAnswer = document.querySelector(
      '#zero_click_wrapper .zci__body, .zci__body, .module--text .module__content, [data-testid="instant-answer"]',
    );
    const answerText = cleanText(instantAnswer?.textContent || '');
    if (answerText && answerText !== assistText) {
      parts.push('## Instant Answer\n', `${answerText}\n`);
    }

    const knowledge = document.querySelector(
      '[data-testid="about_module"], #zero_click_wrapper .zci, .results--sidebar .module, [data-testid="knowledge-panel"]',
    );
    if (knowledge && knowledge !== instantAnswer && knowledge !== assistCard) {
      const title = cleanText(knowledge.querySelector('h2, h3, .module__title')?.textContent || '');
      const description = cleanText(knowledge.querySelector('.module__content, .zci__body, p')?.textContent || '');
      if ((title || description) && description !== answerText && description !== assistText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '.result, .results_links, article[data-testid="result"], [data-testid="result"]',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    function appendResult(title: string, link: string, snippet: string): void {
      if (!title || !link) return;
      const key = `${title}\n${link}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (resultCount === 0) parts.push('## Search Results\n');
      resultCount += 1;
      parts.push(`### ${resultCount}. ${escapeMarkdownText(title)}\n`);
      parts.push(`**URL:** ${link}\n`);
      if (snippet) parts.push(`${snippet}\n`);
    }

    results.forEach((result) => {
      if (
        result.matches('.result--ad, [data-testid="ad"], li[data-layout="ad"]')
        || result.closest('.result--ad, [data-testid="ad"], li[data-layout="ad"]')
      ) {
        return;
      }
      const title = cleanText(result.querySelector(
        '.result__title, h2 a, h2, [data-testid="result-title"]',
      )?.textContent || '');
      const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
        '.result__a[href], h2 a[href], [data-testid="result-title-a"][href], a[href]',
      ));
      // On the HTML route, .result__body wraps the title, the URL, and the snippet.
      const snippet = cleanText((result.querySelector(
        '.result__snippet, [data-result="snippet"], [data-testid="result-snippet"]',
      ) || result.querySelector('.result__body, p'))?.textContent || '');
      appendResult(title, link, snippet);
    });

    document.querySelectorAll<HTMLAnchorElement>('a.result-link[href]').forEach((link) => {
      const raw = (link.getAttribute('href') || '').trim();
      if (!raw || raw.startsWith('#')) return;
      if (link.closest('.result--ad, [data-testid="ad"], li[data-layout="ad"]')) return;
      let row = link.closest('tr')?.nextElementSibling;
      let snippet = '';
      while (row && !row.querySelector('a.result-link')) {
        const cell = row.querySelector('.result-snippet');
        if (cell) {
          snippet = cleanText(cell.textContent || '');
          break;
        }
        row = row.nextElementSibling;
      }
      appendResult(cleanText(link.textContent || ''), safeSearchUrl(link.href || raw), snippet);
    });

    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>(
      '.related-searches a[href], .tile--c a[href], [data-testid="related-searches"] a[href], [data-testid="related-search"] a[href]',
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
    const href = safeSearchUrl(link.href || raw);
    if (href) return href;
  }
  return '';
}

function safeSearchUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    const redirected = url.searchParams.get('uddg');
    if (redirected) {
      try {
        const destination = new URL(redirected);
        if (/^https?:$/.test(destination.protocol)) return destination.href;
      } catch {
        return '';
      }
    }
    if (/(?:^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      if (url.pathname === '/y.js' || url.pathname === '/search' || url.pathname === '/search/' || url.pathname === '/l/') {
        return '';
      }
    }
    return url.href;
  } catch {
    // Ignore malformed or non-HTTP links.
  }
  return '';
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\\[\]]/g, '\\$&');
}
