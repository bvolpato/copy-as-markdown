/**
 * Brave Search extractor.
 * Covers web search and Brave's answer route.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

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
      '[data-testid="search-header"]',
      '#searchform',
      'form[action*="/search"]',
      'header',
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
      '#summarizer, #llm-context, #chatllm-content, [data-testid="answer"], [data-testid="summarizer"]',
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
      'div.snippet[data-type="web"], [data-testid="search-result"], [data-testid="result"], .snippet:not([data-type]), article.result',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    results.forEach((result) => {
      const dataType = result.getAttribute('data-type');
      if (dataType && dataType !== 'web') return;
      if (result.matches('.ad, [data-type="ad"]') || result.closest('.ad, [data-type="ad"]')) return;

      const title = cleanText(result.querySelector(
        '.search-snippet-title, .title, a.l1, h3 a, h2 a, [data-testid="result-title"], [data-testid="result-title"] a',
      )?.textContent || '');
      const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
        'a.l1[href], h3 a[href], h2 a[href], [data-testid="result-title"] a[href], a[href]',
      ));
      const snippet = cleanText(result.querySelector(
        '.snippet-description, .snippet-content, [data-testid="result-description"], [data-testid="result-snippet"], .description, p',
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
      '.related-queries a[href], .related-searches a[href], [data-testid="related-searches"] a[href]',
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
    const href = safeHttpUrl(link.href || raw);
    if (href) return href;
  }
  return '';
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    if (/^search\.brave\.com$/i.test(url.hostname)) {
      if (/^\/(?:search|ask)\/?$/i.test(url.pathname)) return '';
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
