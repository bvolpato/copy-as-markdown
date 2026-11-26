/**
 * Google Search extractor.
 * Reserved inline anchor hook: search tools bar.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const GOOGLE_TLDS = [
  'com', 'co.uk', 'ca', 'com.au', 'de', 'fr', 'com.br', 'es', 'it', 'nl',
  'co.in', 'co.jp', 'com.mx', 'com.tr', 'co.za', 'pl', 'se', 'ch', 'at',
  'be', 'pt', 'com.ar', 'co.kr', 'com.tw', 'com.hk', 'com.sg', 'co.nz',
  'ie', 'dk', 'no', 'fi', 'cz', 'co.id', 'ae', 'com.ua', 'ro', 'gr',
  'hu', 'cl', 'com.co', 'com.pe', 'com.ph', 'com.my', 'co.th', 'com.vn',
  'co.il', 'com.sa', 'com.eg', 'com.ng',
];

const GOOGLE_MATCHES = GOOGLE_TLDS.flatMap((tld) => [
  `*://google.${tld}/search*`,
  `*://www.google.${tld}/search*`,
]);

register({
  name: 'Google Search',
  matches: GOOGLE_MATCHES,
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

    // AI Overview
    const aiOverviewText = firstMatchingText(['.M8OgIe', '[data-mcpr]']);
    if (aiOverviewText) {
      parts.push('## AI Overview\n', `${aiOverviewText}\n`);
    }

    // Featured snippet
    const featuredText = firstMatchingText([
      '.IZ6rdc', '.hgKElc', '[data-attrid="wa:/description"]',
      '[data-attrid="wa:/title"] + [data-attrid="wa:/description"]',
    ]);
    if (featuredText && featuredText !== aiOverviewText) {
      parts.push('## Featured Snippet\n', `${featuredText}\n`);
    }

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

    // Results: prefer granular result containers (.tF2Cxc, .g:not(.g-blk)) before outer .MjjYud wrappers.
    const candidates: Element[] = [];
    const seenContainers = new Set<Element>();
    const addCandidate = (el: Element) => {
      if (seenContainers.has(el)) return;
      if (el.closest('#tads, #tadsb, [data-text-ad], .uEierd')) return;
      // "People also ask" answers hold result markup, but they are not ranked results.
      if (el.closest('.related-question-pair') || el.querySelector('.related-question-pair')) return;
      seenContainers.add(el);
      candidates.push(el);
    };
    document.querySelectorAll('.tF2Cxc').forEach(addCandidate);
    document.querySelectorAll('.g:not(.g-blk)').forEach((el) => {
      if (!el.querySelector('.tF2Cxc')) addCandidate(el);
    });
    document.querySelectorAll('.MjjYud').forEach((el) => {
      if (!el.querySelector('.tF2Cxc, .g:not(.g-blk)')) addCandidate(el);
    });

    const seen = new Set<string>();
    let resultCount = 0;
    for (const result of candidates) {
      const title = cleanText(result.querySelector('h3')?.textContent || '');
      const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('a[href]'));
      const snippet = cleanText(result.querySelector(
        '.VwiC3b, .yXK7lf, .st, .IsZvec, [data-sncf]',
      )?.textContent || '');
      if (!title || !link) continue;
      const key = `${title}\n${link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (resultCount === 0) parts.push('## Search Results\n');
      resultCount += 1;
      parts.push(`### ${resultCount}. ${escapeMarkdownText(title)}\n`);
      parts.push(`**URL:** ${link}\n`);
      if (snippet) parts.push(`${snippet}\n`);
    }

    // People also ask
    const paaItems = document.querySelectorAll('.related-question-pair, [data-q]');
    const paaSeen = new Set<string>();
    const paaQuestions: string[] = [];
    paaItems.forEach((item) => {
      const q = item.getAttribute('data-q') ||
        item.querySelector('[data-q]')?.getAttribute('data-q') ||
        item.querySelector('.dnXCYb')?.textContent?.trim() ||
        item.textContent?.trim();
      const question = cleanText(q || '');
      if (question && !paaSeen.has(question)) {
        paaSeen.add(question);
        paaQuestions.push(question);
      }
    });
    if (paaQuestions.length > 0) {
      parts.push('## People Also Ask\n');
      paaQuestions.forEach((question) => parts.push(`- ${escapeMarkdownText(question)}`));
      parts.push('');
    }

    const relatedSeen = new Set<string>();
    const related = Array.from(document.querySelectorAll<HTMLAnchorElement>(
      '.s75CSd a[href], .y6Uyqe a[href], [data-testid="related-searches"] a[href]',
    ))
      .map((link) => cleanText(link.textContent || ''))
      .filter((item) => {
        if (!item || relatedSeen.has(item)) return false;
        relatedSeen.add(item);
        return true;
      });
    if (related.length) {
      parts.push('## Related Searches\n');
      related.forEach((item) => parts.push(`- ${escapeMarkdownText(item)}`));
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function firstMatchingText(selectors: string[]): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element ? cleanText(Utils.removeNoise(element, ['script', 'style']).textContent || '') : '';
    if (text) return text;
  }
  return '';
}

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
    const isGoogleHost = /^(?:www\.)?google\.[^/]+$/i.test(url.hostname)
      || /(?:^|\.)googleadservices\.com$/i.test(url.hostname);
    if (isGoogleHost) {
      if (url.pathname.startsWith('/aclk') || url.pathname.startsWith('/pagead')) return '';
      if (url.pathname === '/url') {
        const destination = url.searchParams.get('q') || url.searchParams.get('url');
        if (destination) {
          const parsed = new URL(destination);
          if (/^https?:$/.test(parsed.protocol)) return parsed.href;
        }
        return '';
      }
      if (url.pathname === '/search' || url.pathname === '/search/') return '';
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
