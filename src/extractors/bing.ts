/**
 * Bing Search extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Bing Search',
  matches: [
    '*://www.bing.com/search*',
    '*://bing.com/search*',
  ],
  anchor: {
    selector: '#b_header .b_scopebar ul, #b_header',
    position: 'append',
    style: 'pill',
    css: { marginLeft: '12px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q') || '';

    const metadata = { source: 'Bing Search', query, url };
    const parts: string[] = [`# Bing Search: "${query}"\n`];

    const results = document.querySelectorAll('.b_algo');
    if (results.length > 0) {
      parts.push('## Search Results\n');
      results.forEach((result, i) => {
        const titleEl = result.querySelector('h2 a') as HTMLAnchorElement | null;
        const snippetEl = result.querySelector('.b_caption p, .b_lineclamp2');
        if (!titleEl) return;
        parts.push(`### ${i + 1}. ${titleEl.textContent!.trim()}\n`);
        if (titleEl.href) parts.push(`**URL:** ${titleEl.href}\n`);
        if (snippetEl) parts.push(`${snippetEl.textContent!.trim()}\n`);
      });
    }

    const sidebar = document.querySelector('.b_entityTP, .lite-entcard-main');
    if (sidebar) {
      const st = sidebar.querySelector('h2')?.textContent?.trim();
      if (st) parts.push(`## Knowledge: ${st}\n`);
      const sb = sidebar.querySelector('.b_entityText, .b_entitySubTitle');
      if (sb) { parts.push(sb.textContent!.trim()); parts.push(''); }
    }

    const related = document.querySelectorAll('.b_rs a');
    if (related.length > 0) {
      parts.push('## Related Searches\n');
      related.forEach((a) => parts.push(`- ${a.textContent!.trim()}`));
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
