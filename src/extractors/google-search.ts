/**
 * Google Search extractor.
 * Reserved inline anchor hook: search tools bar.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Google Search',
  matches: [
    '*://google.com/search*',
    '*://www.google.com/search*',
    '*://google.co.uk/search*',
    '*://www.google.co.uk/search*',
    '*://google.ca/search*',
    '*://www.google.ca/search*',
    '*://google.com.au/search*',
    '*://www.google.com.au/search*',
    '*://google.de/search*',
    '*://www.google.de/search*',
    '*://google.fr/search*',
    '*://www.google.fr/search*',
    '*://google.com.br/search*',
    '*://www.google.com.br/search*',
    '*://google.es/search*',
    '*://www.google.es/search*',
    '*://google.it/search*',
    '*://www.google.it/search*',
    '*://google.nl/search*',
    '*://www.google.nl/search*',
    '*://google.co.in/search*',
    '*://www.google.co.in/search*',
    '*://google.co.jp/search*',
    '*://www.google.co.jp/search*',
    '*://google.com.mx/search*',
    '*://www.google.com.mx/search*',
    '*://google.com.tr/search*',
    '*://www.google.com.tr/search*',
    '*://google.co.za/search*',
    '*://www.google.co.za/search*',
  ],
  pathnameRegex: /^\/search\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    // Insert after the "Tools" toggle in the search navigation bar
    selector: [
      '#hdtb-tls',                   // "Tools" dropdown button (stable ID)
      '.yeKjxb',                     // Tools container
      '#appbar',                     // search tools bar
      '#hdtb',                       // horizontal tab bar
    ].join(', '),
    position: 'after',
    style: 'icon',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('q') || '');

    const metadata = { source: 'Google Search', query, url };
    const parts: string[] = ['# Google Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    // Featured snippet
    appendTextSection(parts, 'Featured Snippet', [
      '.IZ6rdc', '.hgKElc', '[data-attrid="wa:/description"]',
      '[data-attrid="wa:/title"] + [data-attrid="wa:/description"]',
    ]);

    // Knowledge panel
    const knowledge = document.querySelector(
      '#rhs .kp-wholepage, #rhs .knowledge-panel, .kp-wholepage, .knowledge-panel',
    );
    if (knowledge) {
      const title = cleanText(knowledge.querySelector('h2, h3, [data-attrid="title"]')?.textContent || '');
      const description = cleanText(knowledge.querySelector(
        '.kno-rdesc span, [data-attrid="description"] span, [data-attrid="description"]',
      )?.textContent || '');
      if (title || description) {
        parts.push(`## Knowledge Panel${title ? `: ${title}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    // Results
    const results = document.querySelectorAll('.MjjYud, .g:not(.g-blk), .tF2Cxc');
    const seen = new Set<string>();
    let resultCount = 0;
    if (results.length > 0) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector('h3')?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('a[href]'));
        const snippet = cleanText(result.querySelector(
          '.VwiC3b, .yXK7lf, .st, .IsZvec, [data-sncf]',
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

    // People also ask
    const paaItems = document.querySelectorAll('.related-question-pair, [data-q]');
    if (paaItems.length > 0) {
      parts.push('## People Also Ask\n');
      let count = 0;
      paaItems.forEach((item) => {
        if (count >= 10) return;
        const q = item.querySelector('[data-q]')?.getAttribute('data-q') ||
          item.querySelector('.dnXCYb')?.textContent?.trim() ||
          item.textContent?.trim();
        const question = cleanText(q || '');
        if (question) {
          parts.push(`- ${escapeMarkdownText(question)}`);
          count += 1;
        }
      });
      parts.push('');
    }

    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>(
      '.s75CSd a[href], .y6Uyqe a[href], [data-testid="related-searches"] a[href]',
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

function appendTextSection(parts: string[], heading: string, selectors: string[]): void {
  const element = document.querySelector(selectors.join(', '));
  const text = cleanText(element?.textContent || '');
  if (!text) return;
  parts.push(`## ${heading}\n`, `${text}\n`);
}

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
    if (!/^https?:$/.test(url.protocol)) return '';
    if (/^(?:www\.)?google\.[^/]+$/i.test(url.hostname) && url.pathname === '/url') {
      const destination = url.searchParams.get('q') || url.searchParams.get('url');
      if (destination) {
        const parsed = new URL(destination);
        if (/^https?:$/.test(parsed.protocol)) return parsed.href;
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
