/**
 * OpenReview extractor (papers, abstracts, peer reviews, rebuttals, and decisions).
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const openreviewExtractor = register({
  name: 'OpenReview',
  matches: [
    '*://openreview.net/forum*',
    '*://www.openreview.net/forum*',
  ],
  pathnameRegex: /^\/forum\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '.forum-header h2, .note_content_title, main h2, main h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('.note_content_title, .forum-header h2, h2.citation_title, main h1')?.textContent
        || Utils.getPageTitle().replace(/\s*\|\s*OpenReview$/i, ''),
    );
    const authors = Array.from(document.querySelectorAll('.forum-authors a, .signatures a, .meta_row a[href*="/profile"]'))
      .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
      .filter(Boolean);
    const uniqueAuthors = [...new Set(authors)];

    const metadata: PageMetadata = {
      source: 'OpenReview',
      title,
      url: Utils.getCanonicalUrl(),
      authors: uniqueAuthors.length > 0 ? uniqueAuthors.join(', ') : undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (uniqueAuthors.length > 0) parts.push(`**Authors:** ${uniqueAuthors.join(', ')}`);

    const forumNote = document.querySelector('#forum-note, .forum-note, .note.panel');
    if (forumNote) {
      const fields = Array.from(forumNote.querySelectorAll('.note-content-field, .note_content_field'));
      for (const field of fields) {
        const label = Markdown.normalizeWhitespace(field.textContent || '').replace(/:$/, '');
        const valueEl = field.nextElementSibling;
        if (!label || !valueEl) continue;
        const valueMd = Markdown.elementToMarkdown(Utils.removeNoise(valueEl, [...Utils.NOISE_SELECTORS, 'button']));
        if (valueMd) parts.push(`\n## ${label}\n\n${valueMd}`);
      }
    }

    const reviewEls = Array.from(document.querySelectorAll('#forum-replies .note, .forum-replies .note, [data-note-id]'));
    const seen = new Set<Element>();
    let reviewCount = 0;
    const reviewParts: string[] = [];

    for (const note of reviewEls) {
      if (note === forumNote || seen.has(note)) continue;
      if (forumNote && note.contains(forumNote)) continue;
      seen.add(note);

      const heading = Markdown.normalizeWhitespace(
        note.querySelector('.note_content_title, h4, .title_pdf_row')?.textContent || '',
      );
      const signature = Markdown.normalizeWhitespace(
        note.querySelector('.signatures, .meta_row .signatures')?.textContent || '',
      );
      const contentEl = note.querySelector('.note_contents, .note-content');
      if (!contentEl) continue;

      const cleaned = Utils.removeNoise(contentEl, [...Utils.NOISE_SELECTORS, 'button', '.reply-btn']);
      const body = Markdown.elementToMarkdown(cleaned);
      if (!body) continue;

      reviewCount += 1;
      const label = [heading, signature].filter(Boolean).join(' - ') || `Comment ${reviewCount}`;
      reviewParts.push(`\n### ${label}\n\n${body}`);
    }

    if (reviewParts.length > 0) {
      parts.push(`\n## Reviews & Discussion (${reviewCount})`, ...reviewParts);
    } else if (parts.length <= 2) {
      const main = document.querySelector('main, #content') || document.body;
      parts.push('\n' + Markdown.elementToMarkdown(Utils.removeNoise(main, [...Utils.NOISE_SELECTORS, 'button'])));
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered OpenReview forum',
      included: reviewCount,
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
