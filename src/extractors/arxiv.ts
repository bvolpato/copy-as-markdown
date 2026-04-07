/**
 * arXiv extractor.
 * Extracts paper title, authors, abstract, and links to PDF/HTML.
 * Works on both abs (abstract) and html (full paper) pages.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'arXiv',
  matches: [
    '*://arxiv.org/abs/*',
    '*://arxiv.org/html/*',
    '*://arxiv.org/pdf/*',
    '*://www.arxiv.org/abs/*',
    '*://www.arxiv.org/html/*',
  ],
  anchor: {
    selector: [
      '.submission-history',              // submission history section
      '.extra-services',                  // right sidebar
      '.abs-button-row',                  // action buttons row
      '.html-header-message',             // HTML view header
      'h1.title',                         // paper title
    ].join(', '),
    position: 'prepend',
    style: 'icon',
    css: { marginRight: '8px', marginBottom: '4px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const isAbsPage = /\/abs\//.test(url);
    const isHtmlPage = /\/html\//.test(url);

    if (isAbsPage) return extractAbstract(url);
    if (isHtmlPage) return extractFullPaper(url);

    // PDF page fallback
    return extractAbstract(url.replace('/pdf/', '/abs/'));
  },
});

function extractAbstract(url: string): string {
  // Paper ID
  const idMatch = url.match(/(?:abs|html|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  const paperId = idMatch ? idMatch[1] : '';

  // Title
  const titleEl = document.querySelector('h1.title, .ltx_title');
  let title = titleEl?.textContent?.trim() || Utils.getPageTitle();
  title = title.replace(/^Title:\s*/i, '');

  // Authors
  const authorEl = document.querySelector('.authors a, .ltx_authors');
  const authorEls = document.querySelectorAll('.authors a, .ltx_personname');
  const authors = Array.from(authorEls).map((el) => el.textContent?.trim()).filter(Boolean);

  // Abstract
  const abstractEl = document.querySelector('.abstract, blockquote.abstract, .ltx_abstract');
  let abstract = abstractEl?.textContent?.trim() || '';
  abstract = abstract.replace(/^Abstract:\s*/i, '');

  // Subjects/categories
  const subjectEl = document.querySelector('.primary-subject, .tablecell.subjects');
  const subjects = subjectEl?.textContent?.trim() || '';

  // Submission date
  const dateEl = document.querySelector('.dateline, .submission-history');
  const date = dateEl?.textContent?.trim().match(/\[Submitted on (.+?)\]/)?.[1] || '';

  // DOI
  const doiEl = document.querySelector('.arxivdoi a, td.doi a');
  const doi = doiEl?.textContent?.trim() || '';

  const metadata: Record<string, string> = {
    source: 'arXiv',
    paper_id: paperId,
    title,
    url: url.includes('/abs/') ? url : url.replace(/\/(html|pdf)\//, '/abs/'),
  };
  if (authors.length > 0) metadata.authors = authors.join(', ');
  if (date) metadata.submitted = date;
  if (doi) metadata.doi = doi;

  const parts: string[] = [`# ${title}\n`];
  if (authors.length > 0) parts.push(`**Authors:** ${authors.join(', ')}`);
  if (paperId) parts.push(`**arXiv:** ${paperId}`);
  if (date) parts.push(`**Submitted:** ${date}`);
  if (subjects) parts.push(`**Subjects:** ${subjects}`);
  if (doi) parts.push(`**DOI:** ${doi}`);
  parts.push('');

  if (abstract) {
    parts.push('## Abstract\n');
    parts.push(abstract);
    parts.push('');
  }

  // Links
  parts.push('## Links\n');
  if (paperId) {
    parts.push(`- **Abstract:** https://arxiv.org/abs/${paperId}`);
    parts.push(`- **PDF:** https://arxiv.org/pdf/${paperId}`);
    parts.push(`- **HTML:** https://arxiv.org/html/${paperId}`);
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractFullPaper(url: string): string {
  // Paper ID
  const idMatch = url.match(/html\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  const paperId = idMatch ? idMatch[1] : '';

  // Title
  const titleEl = document.querySelector('.ltx_title, h1.title, h1');
  let title = titleEl?.textContent?.trim() || Utils.getPageTitle();
  title = title.replace(/^Title:\s*/i, '');

  // Authors
  const authorEls = document.querySelectorAll('.ltx_personname, .ltx_creator .ltx_role_author');
  const authors = Array.from(authorEls).map((el) => el.textContent?.trim()).filter(Boolean);

  const metadata: Record<string, string> = {
    source: 'arXiv',
    paper_id: paperId,
    title,
    url,
    format: 'full_paper',
  };
  if (authors.length > 0) metadata.authors = authors.join(', ');

  const parts: string[] = [`# ${title}\n`];
  if (authors.length > 0) parts.push(`**Authors:** ${authors.join(', ')}`);
  if (paperId) parts.push(`**arXiv:** ${paperId}`);
  parts.push('');

  // Full paper body
  const articleEl = document.querySelector('.ltx_document, article, .ltx_page_main');
  if (articleEl) {
    const cleaned = Utils.removeNoise(articleEl, [
      ...Utils.NOISE_SELECTORS,
      '.ltx_bibliography', '.ltx_appendix',
      '.ltx_authors', '.ltx_title',
      '.ltx_page_header', '.ltx_page_footer',
    ]);
    parts.push(Markdown.elementToMarkdown(cleaned));
  } else {
    parts.push('*Full paper content could not be extracted. Visit the HTML page directly.*');
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}
