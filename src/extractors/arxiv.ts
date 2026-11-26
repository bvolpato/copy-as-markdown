/**
 * arXiv extractor.
 * Extracts paper title, authors, abstract, and links to PDF/HTML.
 * Works on abs (abstract), html (full paper), and pdf pages.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

const ARXIV_ID_RE = /(?:abs|html|pdf)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?)(?:\.pdf)?/i;

register({
  name: 'arXiv',
  matches: [
    '*://arxiv.org/abs/*',
    '*://arxiv.org/html/*',
    '*://arxiv.org/pdf/*',
    '*://www.arxiv.org/abs/*',
    '*://www.arxiv.org/html/*',
    '*://www.arxiv.org/pdf/*',
    '*://ar5iv.labs.arxiv.org/html/*',
    '*://export.arxiv.org/abs/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '.submission-history',              // submission history section
      '.extra-services',                  // right sidebar
      '.abs-button-row',                  // action buttons row
      '.html-header-message',             // HTML view header
      '.ltx_title',                       // HTML paper title
      'h1.title',                         // paper title
    ].join(', '),
    position: 'prepend',
    style: 'icon',
    css: { marginRight: '8px', marginBottom: '4px' },
  },

  async extract() {
    const pathname = window.location.pathname;
    const currentUrl = window.location.href;
    const canonicalUrl = Utils.getCanonicalUrl();

    if (/^\/abs\//.test(pathname)) {
      return extractAbstract(canonicalUrl, document);
    }
    if (/^\/html\//.test(pathname)) {
      return extractFullPaper(currentUrl);
    }
    if (/^\/pdf\//.test(pathname)) {
      const paperId = extractPaperId(pathname);
      const absUrl = paperId
        ? `${window.location.origin}/abs/${paperId}`
        : currentUrl.replace('/pdf/', '/abs/').replace(/\.pdf$/i, '');
      const absDoc = await fetchAbstractDocument(absUrl);
      return extractAbstract(absUrl, absDoc || document);
    }

    return extractAbstract(canonicalUrl, document);
  },
});

function extractPaperId(value: string): string {
  const match = value.match(ARXIV_ID_RE);
  return match ? match[1] : '';
}

async function fetchAbstractDocument(absUrl: string): Promise<Document | null> {
  try {
    const response = await Utils.fetchWithTimeout(absUrl, {
      credentials: 'omit',
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (!html.trim()) return null;
    return Markdown.parseHtmlDocument(html);
  } catch {
    return null;
  }
}

function extractAbstract(url: string, doc: Document): string {
  // Paper ID. The canonical URL drops the version that the page shows.
  const paperId = extractPaperId(window.location.pathname) || extractPaperId(url);

  // Title
  const titleEl = doc.querySelector('h1.title, .ltx_title');
  let title = titleEl?.textContent?.trim()
    || doc.querySelector('meta[name="citation_title"]')?.getAttribute('content')?.trim()
    || doc.title
    || Utils.getPageTitle();
  title = title.replace(/^Title:\s*/i, '');

  // Authors
  const authorEls = doc.querySelectorAll('.authors a, .ltx_personname');
  const authors = Array.from(authorEls).map((el) => el.textContent?.trim()).filter(Boolean);

  // Abstract
  const abstractEl = doc.querySelector('.abstract, blockquote.abstract, .ltx_abstract');
  let abstract = abstractEl?.textContent?.trim() || '';
  abstract = abstract.replace(/^Abstract:\s*/i, '');

  // Subjects/categories
  const subjectEl = doc.querySelector('.primary-subject, .tablecell.subjects');
  const subjects = subjectEl?.textContent?.trim() || '';

  // Submission date
  const dateEl = doc.querySelector('.dateline, .submission-history');
  const date = dateEl?.textContent?.trim().match(/\[Submitted on (.+?)\]/)?.[1] || '';

  // DOI
  const doiEl = doc.querySelector('.arxivdoi a, td.doi a');
  const doi = doiEl?.textContent?.trim() || '';

  const metadata: Record<string, string> = {
    source: 'arXiv',
    paper_id: paperId,
    title,
    url: /v\d+$/.test(paperId) ? `https://arxiv.org/abs/${paperId}`
      : url.includes('/abs/') ? url : url.replace(/\/(html|pdf)\//, '/abs/'),
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

/** MathML holds each formula twice: as presentation markup and as TeX. Keep only the TeX. */
function convertMath(root: Element): void {
  root.querySelectorAll('math').forEach((math) => {
    const tex = (math.getAttribute('alttext')
      || math.querySelector('annotation[encoding="application/x-tex"]')?.textContent || '')
      .replace(/%\s*\n/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^\s*\\displaystyle\s*/, '')
      .trim();
    if (!tex) return;
    const delimiter = math.getAttribute('display') === 'block' ? '$$' : '$';
    math.replaceWith(`${delimiter}${tex}${delimiter}`);
  });
  // LaTeXML lays out display equations with tables.
  root.querySelectorAll('table.ltx_eqn_table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr')).map((row) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = Array.from(row.querySelectorAll(':scope > td, :scope > th'))
        .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() || '')
        .filter(Boolean)
        .join(' ');
      return paragraph;
    });
    table.replaceWith(...rows);
  });
}

function extractFullPaper(url: string): string {
  // Paper ID
  const paperId = extractPaperId(url) || extractPaperId(window.location.pathname);

  // Title
  const titleEl = document.querySelector('.ltx_title, h1.title, h1');
  let title = titleEl?.textContent?.trim() || Utils.getPageTitle();
  title = title.replace(/^Title:\s*/i, '');

  // Authors (avoid matching both .ltx_role_author and its nested .ltx_personname)
  const personNameEls = document.querySelectorAll('.ltx_authors .ltx_personname');
  const authorEls = personNameEls.length > 0
    ? personNameEls
    : document.querySelectorAll('.ltx_personname').length > 0
      ? document.querySelectorAll('.ltx_personname')
      : document.querySelectorAll('.ltx_creator .ltx_role_author');
  const authors = [...new Set(
    Array.from(authorEls)
      .map((el) => Utils.removeNoise(el, ['.ltx_note']).textContent?.replace(/\s+/g, ' ').trim())
      .filter((name): name is string => Boolean(name)),
  )];

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

  // Full paper body (preserve appendices and bibliography)
  const articleEl = document.querySelector('.ltx_document, article, .ltx_page_main');
  if (articleEl) {
    const cleaned = Utils.removeNoise(articleEl, [
      ...Utils.NOISE_SELECTORS,
      '.ltx_authors', '.ltx_title_document',
      '.ltx_page_header', '.ltx_page_footer',
    ]);
    convertMath(cleaned);
    parts.push(Markdown.elementToMarkdown(cleaned));
  } else {
    parts.push('*Full paper content could not be extracted. Visit the HTML page directly.*');
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}
