/**
 * Baidu Search extractor.
 * Extracts standard web results and common answer/knowledge cards.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Baidu Search',
  matches: [
    '*://baidu.com/s*',
    '*://www.baidu.com/s*',
    '*://m.baidu.com/s*',
    '*://baidu.cn/s*',
    '*://www.baidu.cn/s*',
  ],
  pathnameRegex: /^\/s\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#s_tab',
      '#form',
      '.s_form',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = cleanText(params.get('wd') || params.get('word') || params.get('q') || '');
    const metadata = { source: 'Baidu Search', query, url };
    const parts: string[] = ['# Baidu Search\n'];
    if (query) parts.push(`**Query:** ${escapeMarkdownText(query)}\n`);

    const answer = document.querySelector(
      '.op_exactqa, .reference-summary, [data-testid="answer"]',
    );
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '#content_right .op_bk, .op_bk, [data-testid="knowledge-panel"]',
    );
    if (knowledge && knowledge !== answer) {
      const title = cleanText(knowledge.querySelector('h2, h3, .t, [data-testid="title"]')?.textContent || '');
      const description = cleanText(knowledge.querySelector('.c-span-last, .c-abstract, .op_exactqa, p')?.textContent || '');
      if ((title || description) && description !== answerText) {
        parts.push(`## Knowledge Panel${title ? `: ${escapeMarkdownText(title)}` : ''}\n`);
        if (description) parts.push(`${description}\n`);
      }
    }

    const results = document.querySelectorAll(
      '#content_left > .result, #content_left > .c-container, #content_left .result, #content_left .c-container, .c-result',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    results.forEach((result) => {
      // Current results nest a second .c-container inside the result that holds the target URL.
      if (result.parentElement?.closest('[mu]')) return;
      if (isBaiduAd(result)) return;
      const title = cleanText(result.querySelector('h3 a, h3, [data-testid="result-title"]')?.textContent || '');
      const muUrl = safeHttpUrl(result.getAttribute('mu') || '');
      const link = muUrl || firstSafeLink(result.querySelectorAll<HTMLAnchorElement>(
        'h3 a[href], [data-testid="result-title"] a[href], a[href]',
      ));
      const snippet = cleanText(result.querySelector(
        '.c-abstract, .content-right_8Zs40, .c-span-last, [data-testid="result-snippet"], p',
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
      '#rs a[href], .rs a[href], [data-testid="related-search"] a[href]',
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

function isBaiduAd(result: Element): boolean {
  const adSelector = 'div[id^="300"], .ec_tuiguang_ppimlink, [data-cmatchid]';
  return result.matches(adSelector)
    || Boolean(result.closest(adSelector))
    || Boolean(result.querySelector('.ec_tuiguang_ppimlink, [data-cmatchid]'));
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
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    if (!/^https?:$/.test(url.protocol)) return '';
    if (/^(?:e|pos|cpro|nourl\.ubs)\.baidu\.com$/i.test(url.hostname)) return '';
    if (/(?:^|\.)baidu\.(?:com|cn)$/i.test(url.hostname)) {
      if (url.pathname === '/s' || url.pathname === '/s/' || url.pathname === '/baidu.php') return '';
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
