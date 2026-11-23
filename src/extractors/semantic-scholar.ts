/**
 * Semantic Scholar paper page extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const semanticScholarExtractor = register({
  name: 'Semantic Scholar',
  matches: [
    '*://www.semanticscholar.org/paper/*',
    '*://semanticscholar.org/paper/*',
  ],
  pathnameRegex: /^\/paper\/.+/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-test-id="paper-detail-title"], h1[data-test-id="paper-detail-title"], main h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="paper-detail-title"], main h1, h1')?.textContent
        || Utils.getPageTitle().replace(/\s*\|\s*Semantic Scholar$/i, ''),
    );
    const authors = Array.from(document.querySelectorAll('[data-test-id="author-list"] a, .author-list a, meta[name="citation_author"]'))
      .map((el) => Markdown.normalizeWhitespace(
        el.tagName === 'META' ? el.getAttribute('content') || '' : el.textContent || '',
      ))
      .filter(Boolean);
    const uniqueAuthors = [...new Set(authors)];
    const venue = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="venue-metadata"], .paper-meta-item')?.textContent || '',
    );
    const year = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="paper-year"]')?.textContent || Utils.getMeta('citation_publication_date') || '',
    );

    const metadata: PageMetadata = {
      source: 'Semantic Scholar',
      title,
      url: Utils.getCanonicalUrl(),
      authors: uniqueAuthors.length > 0 ? uniqueAuthors.join(', ') : undefined,
      venue: venue || undefined,
      published: year || undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (uniqueAuthors.length > 0) parts.push(`**Authors:** ${uniqueAuthors.join(', ')}`);
    const meta = [venue ? `**Venue:** ${venue}` : '', year ? `**Year:** ${year}` : ''].filter(Boolean);
    if (meta.length > 0) parts.push(meta.join(' | '));

    const tldr = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="tldr-abstract-text"], .tldr-abstract-replacement')?.textContent || '',
    );
    if (tldr) parts.push(`\n## TL;DR\n\n${tldr}`);

    const abstractEl = document.querySelector('[data-test-id="abstract-text"], .abstract__text, [class*="abstract"]');
    if (abstractEl) {
      const abstractMd = Markdown.elementToMarkdown(Utils.removeNoise(abstractEl, [...Utils.NOISE_SELECTORS, 'button']));
      if (abstractMd) parts.push(`\n## Abstract\n\n${abstractMd}`);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Semantic Scholar paper',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
