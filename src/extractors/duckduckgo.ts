/**
 * DuckDuckGo Search extractor.
 * Covers the regular, HTML, and lightweight result routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'DuckDuckGo Search',
  matches: [
    '*://duckduckgo.com/*',
    '*://www.duckduckgo.com/*',
  ],
  pathnameRegex: /^\/(?:$|html(?:\/|$)|lite(?:\/|$)|search(?:\/|$))/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-testid="duckbar"] nav > ul:first-of-type',
      '#react-duckbar nav > ul:first-of-type',
      '#duckbar nav > ul:first-of-type',
      '#duckbar',
      '.header--aside',
      '.header--search',
      '.searchbox',
      '#search_form_input_homepage',
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
    const query = cleanText(params.get('q') || '');
    const metadata = { source: 'DuckDuckGo Search', query, url };
    const parts: string[] = ['# DuckDuckGo Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const instantAnswer = document.querySelector(
      '#zero_click_wrapper .zci__body, .zci__body, .module--text .module__content, [data-testid="instant-answer"]',
    );
    const answerText = cleanText(instantAnswer?.textContent || '');
    if (answerText) parts.push('## Instant Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '#zero_click_wrapper .zci, .results--sidebar .module, [data-testid="knowledge-panel"]',
    );
    if (knowledge && knowledge !== instantAnswer) {
      const title = cleanText(knowledge.querySelector('h2, h3, .module__title')?.textContent || '');
      const description = cleanText(knowledge.querySelector('.module__content, .zci__body, p')?.textContent || '');
      if ((title || description) && description !== answerText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '.result, .results_links, article[data-testid="result"], [data-testid="result"]',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    if (results.length) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector(
          '.result__title, h2 a, h2, [data-testid="result-title"]',
        )?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
          '.result__a[href], h2 a[href], [data-testid="result-title-a"][href], a[href]',
        ));
        const snippet = cleanText(result.querySelector(
          '.result__snippet, .result__body, [data-result="snippet"], [data-testid="result-snippet"], p',
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
      '.related-searches a[href], .tile--c a[href], [data-testid="related-search"] a[href]',
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
    const href = safeSearchUrl(link.href || link.getAttribute('href') || '');
    if (href) return href;
  }
  return '';
}

function safeSearchUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (/^https?:$/.test(url.protocol)) {
      const redirected = url.searchParams.get('uddg');
      if (redirected) {
        try {
          const destination = new URL(redirected);
          if (/^https?:$/.test(destination.protocol)) return destination.href;
        } catch {
          // Keep DuckDuckGo result URL when redirect target is malformed.
        }
      }
      return url.href;
    }
  } catch {
    // Ignore malformed or non-HTTP links.
  }
  return '';
}

function cleanText(value: string): string {
  return Utils.truncate(value.replace(/\s+/g, ' ').trim(), 600);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/[\\\[\]]/g, '\\$&');
}
