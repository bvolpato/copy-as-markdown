/**
 * PubMed & PubMed Central (PMC) biomedical paper extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const pubmedExtractor = register({
  name: 'PubMed',
  matches: [
    '*://pubmed.ncbi.nlm.nih.gov/*',
    '*://pmc.ncbi.nlm.nih.gov/articles/*',
    '*://www.ncbi.nlm.nih.gov/pmc/articles/*',
  ],
  pathnameRegex: /^\/(?:\d+\/?|(?:pmc\/)?articles\/PMC\d+\/?)/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: 'h1.heading-title, .article-header h1, main h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const isPmc = /pmc/i.test(window.location.hostname) || /\/pmc\/articles\//i.test(window.location.pathname);
    const title = Markdown.normalizeWhitespace(
      document.querySelector('h1.heading-title, h1.content-title, article h1, main h1')?.textContent
        || Utils.getPageTitle(),
    );

    const authors = Array.from(document.querySelectorAll('.authors-list .full-name, .contrib-group .name, meta[name="citation_author"]'))
      .map((el) => Markdown.normalizeWhitespace(
        el.tagName === 'META' ? el.getAttribute('content') || '' : el.textContent || '',
      ))
      .filter(Boolean);
    const uniqueAuthors = [...new Set(authors)];

    const journal = Utils.getMeta('citation_journal_title')
      || Markdown.normalizeWhitespace(document.querySelector('#full-view-journal-trigger, .journal-actions-trigger')?.textContent || '');
    const doi = Utils.getMeta('citation_doi')
      || Markdown.normalizeWhitespace(document.querySelector('.citation-doi, .id-link[href*="doi.org"]')?.textContent || '');
    const pmid = Utils.getMeta('citation_pmid')
      || Markdown.normalizeWhitespace(document.querySelector('.current-id')?.textContent || '');
    const date = Utils.getMeta('citation_date')
      || Markdown.normalizeWhitespace(document.querySelector('.cit, .fm-vol-iss-date')?.textContent || '');

    const metadata: PageMetadata = {
      source: isPmc ? 'PubMed Central' : 'PubMed',
      title,
      url: Utils.getCanonicalUrl(),
      authors: uniqueAuthors.length > 0 ? uniqueAuthors.join(', ') : undefined,
      journal: journal || undefined,
      doi: doi || undefined,
      pmid: pmid || undefined,
      published: date || undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (uniqueAuthors.length > 0) parts.push(`**Authors:** ${uniqueAuthors.join(', ')}`);
    const metaItems = [
      journal ? `**Journal:** ${journal}` : '',
      date ? `**Date:** ${date}` : '',
      pmid ? `**PMID:** ${pmid}` : '',
      doi ? `**DOI:** ${doi}` : '',
    ].filter(Boolean);
    if (metaItems.length > 0) parts.push(metaItems.join(' | '));

    if (isPmc) {
      const articleEl = document.querySelector('article.pmc-layout__citation, main article, .body.main-article-body, #maincontent article')
        || document.querySelector('main');
      if (articleEl) {
        const cleaned = Utils.removeNoise(articleEl, [
          ...Utils.NOISE_SELECTORS,
          'h1',
          '.pmc-layout__aside',
          '.actions-bar',
          'button',
        ]);
        const body = Markdown.elementToMarkdown(cleaned);
        if (body) parts.push('\n' + body);
      }
    } else {
      const abstractEl = document.querySelector('#eng-abstract, .abstract-content');
      if (abstractEl) {
        const abstractMd = Markdown.elementToMarkdown(Utils.removeNoise(abstractEl, [...Utils.NOISE_SELECTORS, 'button']));
        if (abstractMd) parts.push('\n## Abstract\n\n' + abstractMd);
      }
      const keywordsEl = document.querySelector('.keywords-section, #abstract .keywords');
      if (keywordsEl) {
        const kw = Markdown.normalizeWhitespace(keywordsEl.textContent || '');
        if (kw) parts.push(`\n**${kw}**`);
      }
      const meshTerms = Array.from(document.querySelectorAll('#mesh-terms .keyword-actions-trigger, .mesh-terms-list button'))
        .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
        .filter(Boolean);
      if (meshTerms.length > 0) {
        parts.push('\n## MeSH Terms\n\n' + [...new Set(meshTerms)].map((t) => `- ${t}`).join('\n'));
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: isPmc ? 'PubMed Central full article' : 'PubMed abstract page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
