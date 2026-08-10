/**
 * Baidu Search extractor.
 * Extracts standard web results and common answer/knowledge cards.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const MAX_RESULTS = 25;
const MAX_RELATED = 15;

register({
  name: 'Baidu Search',
  matches: [
    '*://baidu.com/s*',
    '*://www.baidu.com/s*',
    '*://baidu.cn/s*',
    '*://www.baidu.cn/s*',
  ],
  pathnameRegex: /^\/s\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#s_tab',
      '#form',
      '#content_left',
      '.s_form',
      '#wrapper_wrapper',
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
      '.op_exactqa, .reference-summary, [data-testid="answer"], [class*="result-op"]',
    );
    const answerText = cleanText(answer?.textContent || '');
    if (answerText) parts.push('## Answer\n', `${answerText}\n`);

    const knowledge = document.querySelector(
      '#content_left > .result-op, .op_bk, .c-container[data-click], [data-testid="knowledge-panel"]',
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
      '#content_left > .result, #content_left > .c-container, #content_left .result, #content_left .c-container',
    );
    let resultCount = 0;
    const seen = new Set<string>();
    if (results.length) {
      parts.push('## Search Results\n');
      results.forEach((result) => {
        if (resultCount >= MAX_RESULTS) return;
        const title = cleanText(result.querySelector('h3 a, h3, [data-testid="result-title"]')?.textContent || '');
        const link = firstSafeLink(result.querySelectorAll<HTMLAnchorElement>('h3 a[href], [data-testid="result-title"] a[href], a[href]'));
        const snippet = cleanText(result.querySelector(
          '.c-abstract, .content-right_8Zs40, .c-span-last, [data-testid="result-snippet"], p',
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
      '#rs a[href], .rs a[href], [data-testid="related-search"] a[href]',
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
