/**
 * Google Search extractor.
 * Reserved inline anchor hook: search tools bar.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Google Search',
  matches: [
    '*://www.google.com/search*',
    '*://www.google.co.uk/search*',
    '*://www.google.ca/search*',
    '*://www.google.com.au/search*',
    '*://www.google.de/search*',
    '*://www.google.fr/search*',
    '*://www.google.com.br/search*',
  ],
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
    const query = params.get('q') || '';

    const metadata = { source: 'Google Search', query, url };
    const parts: string[] = [`# Google Search: "${query}"\n`];

    // Featured snippet
    const featured = document.querySelector('.IZ6rdc, .hgKElc, [data-attrid="wa:/description"]');
    if (featured) {
      parts.push('## Featured Snippet\n');
      parts.push(Markdown.elementToMarkdown(featured));
      parts.push('');
    }

    // Knowledge panel
    const kp = document.querySelector('.kp-wholepage, .knowledge-panel');
    if (kp) {
      const kpTitle = kp.querySelector('h2')?.textContent?.trim();
      if (kpTitle) parts.push(`## Knowledge Panel: ${kpTitle}\n`);
      const kpDesc = kp.querySelector('.kno-rdesc span, [data-attrid="description"] span');
      if (kpDesc) {
        parts.push(kpDesc.textContent!.trim());
        parts.push('');
      }
    }

    // Results
    const results = document.querySelectorAll('.g:not(.g-blk), .tF2Cxc');
    if (results.length > 0) {
      parts.push('## Search Results\n');
      results.forEach((result, i) => {
        const titleEl = result.querySelector('h3');
        const linkEl = result.querySelector('a[href]') as HTMLAnchorElement | null;
        const snippetEl = result.querySelector('.VwiC3b, .st, .IsZvec');
        if (!titleEl) return;
        parts.push(`### ${i + 1}. ${titleEl.textContent!.trim()}\n`);
        if (linkEl?.href) parts.push(`**URL:** ${linkEl.href}\n`);
        if (snippetEl) parts.push(`${snippetEl.textContent!.trim()}\n`);
      });
    }

    // People also ask
    const paaItems = document.querySelectorAll('.related-question-pair');
    if (paaItems.length > 0) {
      parts.push('## People Also Ask\n');
      paaItems.forEach((item) => {
        const q = item.querySelector('[data-q]')?.getAttribute('data-q') ||
          item.querySelector('.dnXCYb')?.textContent?.trim() ||
          item.textContent?.trim();
        if (q) parts.push(`- ${q}`);
      });
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
