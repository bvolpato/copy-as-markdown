/**
 * Brave Search extractor.
 * Covers web search and Brave's answer route.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Brave Search',
  matches: [
    '*://search.brave.com/search*',
    '*://search.brave.com/ask*',
  ],
  pathnameRegex: /^\/(?:search|ask)\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#searchbox',
      '[data-testid="search-header"]',
      'header',
      'form[action*="/search"]',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('q') || params.get('query') || '');
    const metadata = { source: 'Brave Search', query, url };
    const parts: string[] = ['# Brave Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const answer = document.querySelector(
      '[data-testid="answer"], [data-testid="summarizer"], .answer, .summarizer, [class*="answer"]',
    );
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '[data-testid="knowledge-panel"], .infobox, .knowledge-panel, [class*="knowledge"]',
    );
    if (knowledge && knowledge !== answer) {
      const title = cleanText(knowledge.querySelector('h2, h3, [data-testid="title"]')?.textContent || '');
      const description = cleanText(knowledge.querySelector('[data-testid="description"], p, .description')?.textContent || '');
      if ((title || description) && description !== answerText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '[data-testid="search-result"], [data-testid="result"], .snippet, article.result, article',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    if (results.length) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector(
          'h3 a, h2 a, [data-testid="result-title"], [data-testid="result-title"] a',
        )?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
          'h3 a[href], h2 a[href], [data-testid="result-title"] a[href], a[href]',
        ));
        const snippet = cleanText(result.querySelector(
          '[data-testid="result-description"], [data-testid="result-snippet"], .snippet-description, .description, p',
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
      '[data-testid="related-searches"] a[href], .related-searches a[href], a[href*="/search?q="]',
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
    const href = safeHttpUrl(link.href || link.getAttribute('href') || '');
    if (href) return href;
  }
  return '';
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
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
