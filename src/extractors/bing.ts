/**
 * Bing Search extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Bing Search',
  matches: [
    '*://www.bing.com/search*',
    '*://bing.com/search*',
  ],
  pathnameRegex: /^\/search\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#b_header .b_scopebar ul, #b_header',
    position: 'append',
    style: 'pill',
    css: { marginLeft: '12px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('q') || '');

    const metadata = { source: 'Bing Search', query, url };
    const parts: string[] = ['# Bing Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const answer = document.querySelector('.b_ans .b_focusTextLarge, .b_ans .b_xlText, .b_focusTextLarge');
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const results = document.querySelectorAll('.b_algo');
    if (results.length > 0) {
      parts.push('## Search Results\n');
      let count = 0;
      const seen = new Set<string>();
      results.forEach((result) => {
        if (count >= MAX_RESULTS) return;
        const titleEl = result.querySelector('h2 a, h2') as HTMLAnchorElement | HTMLElement | null;
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('h2 a[href], a[href]'));
        const snippet = cleanText(result.querySelector('.b_caption p, .b_lineclamp2, .b_paractl')?.textContent || '');
        const title = cleanText(titleEl?.textContent || '');
        if (!title || !link) return;
        const key = `${title}\n${link}`;
        if (seen.has(key)) return;
        seen.add(key);
        count += 1;
        parts.push(`### ${count}. ${escapeMarkdownText(title)}\n`);
        parts.push(`**URL:** ${link}\n`);
        if (snippet) parts.push(`${snippet}\n`);
      });
    }

    const sidebar = document.querySelector('#b_context .b_entityTP, #b_context .lite-entcard-main, .b_entityTP, .lite-entcard-main');
    if (sidebar) {
      const title = cleanText(sidebar.querySelector('h2, h3')?.textContent || '');
      const description = cleanText(sidebar.querySelector('.b_entityText, .b_entitySubTitle, .b_paractl')?.textContent || '');
      if (title || description) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>('.b_rs a[href], #brs a[href]'))
      .map((a) => cleanText(a.textContent || ''))
      .filter(Boolean)
      .slice(0, MAX_RELATED);
    if (related.length > 0) {
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
    if (!/^https?:$/.test(url.protocol)) return '';
    if (/^(?:www\.)?bing\.com$/i.test(url.hostname) && url.pathname === '/ck/a') {
      const direct = url.searchParams.get('url');
      const encoded = url.searchParams.get('u');
      const destination = direct || (encoded?.startsWith('a1') ? decodeBingUrl(encoded.slice(2)) : '');
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

function decodeBingUrl(value: string): string {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
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
