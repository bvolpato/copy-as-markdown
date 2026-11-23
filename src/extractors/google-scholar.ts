/**
 * Google Scholar search results and author profile extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const googleScholarExtractor = register({
  name: 'Google Scholar',
  matches: [
    '*://scholar.google.com/scholar*',
    '*://scholar.google.com/citations*',
    '*://scholar.google.co.uk/scholar*',
    '*://scholar.google.co.uk/citations*',
    '*://scholar.google.de/scholar*',
    '*://scholar.google.ca/scholar*',
    '*://scholar.google.com.br/scholar*',
  ],
  pathnameRegex: /^\/(?:scholar|citations)\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#gs_ab_md, #gsc_prf_in, #gs_res_ccl_top',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px' },
  },

  async extract() {
    const isProfile = window.location.pathname.startsWith('/citations');
    const query = new URLSearchParams(window.location.search).get('q') || '';
    const title = isProfile
      ? Markdown.normalizeWhitespace(document.querySelector('#gsc_prf_in')?.textContent || Utils.getPageTitle())
      : (query ? `Google Scholar: ${query}` : Utils.getPageTitle());

    const metadata: PageMetadata = {
      source: 'Google Scholar',
      title,
      url: window.location.href,
    };

    const parts: string[] = [`# ${title}`];

    if (isProfile) {
      const affiliation = Markdown.normalizeWhitespace(document.querySelector('.gsc_prf_il')?.textContent || '');
      if (affiliation) parts.push(`**Affiliation:** ${affiliation}`);

      const statsTable = document.querySelector('#gsc_rsb_st');
      if (statsTable) {
        parts.push('\n## Citation Metrics\n\n' + Markdown.tableToMarkdown(statsTable));
      }

      const rows = Array.from(document.querySelectorAll('#gsc_a_b .gsc_a_tr'));
      if (rows.length > 0) {
        parts.push('\n## Publications\n');
        parts.push('| Title | Authors / Venue | Cited by | Year |');
        parts.push('| --- | --- | ---: | ---: |');
        for (const row of rows) {
          const link = row.querySelector<HTMLAnchorElement>('.gsc_a_at');
          const pubTitle = Markdown.normalizeWhitespace(link?.textContent || '');
          if (!pubTitle) continue;
          const href = link?.href || '';
          const details = Array.from(row.querySelectorAll('.gs_gray'))
            .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
            .filter(Boolean)
            .join(' - ');
          const cited = Markdown.normalizeWhitespace(row.querySelector('.gsc_a_ac')?.textContent || '');
          const year = Markdown.normalizeWhitespace(row.querySelector('.gsc_a_hc')?.textContent || '');
          const titleCell = href
            ? `[${Markdown.escapeMarkdownLinkText(pubTitle)}](${href})`
            : pubTitle;
          parts.push(`| ${Markdown.escapeMarkdownTableCell(titleCell)} | ${Markdown.escapeMarkdownTableCell(details)} | ${cited} | ${year} |`);
        }
      }
    } else {
      const results = Array.from(document.querySelectorAll('#gs_res_ccl_mid .gs_r.gs_or.gs_scl, .gs_ri'));
      const seen = new Set<Element>();
      const items: string[] = [];
      let index = 0;

      for (const result of results) {
        const inner = result.classList.contains('gs_ri') ? result : result.querySelector('.gs_ri');
        if (!inner || seen.has(inner)) continue;
        seen.add(inner);

        const titleEl = inner.querySelector<HTMLAnchorElement>('.gs_rt a');
        const headingText = Markdown.normalizeWhitespace(inner.querySelector('.gs_rt')?.textContent || '');
        if (!headingText) continue;
        const href = titleEl?.href || '';
        const authors = Markdown.normalizeWhitespace(inner.querySelector('.gs_a')?.textContent || '');
        const snippet = Markdown.normalizeWhitespace(inner.querySelector('.gs_rs')?.textContent || '');
        const cited = Markdown.normalizeWhitespace(
          Array.from(inner.querySelectorAll('.gs_fl a')).find((a) => /cited by/i.test(a.textContent || ''))?.textContent || '',
        );
        const pdfLink = result.querySelector<HTMLAnchorElement>('.gs_or_ggsm a')?.href || '';

        index += 1;
        const lines = [`### ${index}. ${headingText}`];
        if (href) lines.push(`**URL:** ${href}`);
        if (pdfLink) lines.push(`**PDF:** ${pdfLink}`);
        if (authors) lines.push(`*${authors}*${cited ? ` (${cited})` : ''}`);
        if (snippet) lines.push(snippet);
        items.push(lines.join('\n'));
      }

      if (items.length > 0) {
        parts.push('\n## Results\n\n' + items.join('\n\n'));
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Google Scholar page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
