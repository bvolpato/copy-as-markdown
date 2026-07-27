/**
 * Google Docs extractor.
 *
 * Uses the document export endpoint rather than the live canvas editor so we
 * can capture the full document with headings, lists, tables, links, and
 * images — including content that is currently off-screen.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Google Docs',
  matches: [
    '*://docs.google.com/document/d/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#docs-titlebar-share-client-button',
      '#docs-sidekick-button-container',
      '#workspace-onegoogle-pep-container',
      '.docs-titlebar-buttons > :last-child',
    ].join(', '),
    position: 'before',
    style: 'link',
    wrapperTag: 'div',
    wrapperClass: 'goog-inline-block docs-titlebar-button',
    wrapperCss: {
      marginInlineEnd: '8px',
    },
    css: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      height: '36px',
      padding: '0 14px',
      border: '1px solid #dadce0',
      borderRadius: '18px',
      background: '#fff',
      color: '#1f1f1f',
      opacity: '1',
      fontSize: '14px',
      fontWeight: '500',
      lineHeight: '20px',
      textDecoration: 'none',
      whiteSpace: 'nowrap',
    },
    label: 'Copy as Markdown',
  },

  async extract() {
    const docId = getGoogleDocId();
    const title = getGoogleDocTitle();
    const url = window.location.href;

    const metadata: Record<string, string> = {
      source: 'Google Docs',
      title,
      url,
    };
    if (docId) metadata.doc_id = docId;

    if (!docId) {
      return Markdown.buildPageMarkdown(
        metadata,
        '*Could not determine the current Google Doc ID.*',
      );
    }

    try {
      const html = await fetchGoogleDocExport(docId, 'html');
      const body = parseGoogleDocHtml(html);
      const markdown = body ? Markdown.elementToMarkdown(body) : '';
      if (markdown.trim()) {
        return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${markdown}`);
      }
    } catch (err) {
      console.warn('[Copy as Markdown] Google Docs HTML export failed', err);
    }

    try {
      const html = await fetchGoogleDocMobileView(docId);
      const body = parseGoogleDocHtml(html, '.doc-content, #doc-contents');
      const markdown = body ? Markdown.elementToMarkdown(body) : '';
      if (markdown.trim()) {
        return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${markdown}`);
      }
    } catch (err) {
      console.warn('[Copy as Markdown] Google Docs mobile view failed', err);
    }

    try {
      const text = await fetchGoogleDocExport(docId, 'txt');
      const trimmed = text.trim();
      if (trimmed) {
        return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${trimmed}`);
      }
    } catch (err) {
      console.warn('[Copy as Markdown] Google Docs text export failed', err);
    }

    return Markdown.buildPageMarkdown(
      metadata,
      '*Could not export this Google Doc. Make sure the document is fully loaded and you have access to it.*',
    );
  },
});

function getGoogleDocId(): string {
  return window.location.pathname.match(/\/document\/d\/([^/]+)/)?.[1] || '';
}

function getGoogleDocTitle(): string {
  const title =
    document.querySelector('.docs-title-input-label-inner')?.textContent?.trim() ||
    document.querySelector('#docs-title-input-label-inner')?.textContent?.trim() ||
    document.querySelector('.docs-title-input')?.textContent?.trim() ||
    Utils.getPageTitle();

  return title.replace(/\s*-\s*Google Docs$/, '').trim();
}

function buildGoogleDocExportUrl(docId: string, format: 'html' | 'txt'): string {
  const exportUrl = buildGoogleDocUrl(docId, 'export');
  exportUrl.searchParams.set('format', format);
  return exportUrl.toString();
}

function buildGoogleDocUrl(docId: string, endpoint: 'export' | 'mobilebasic'): URL {
  const current = new URL(window.location.href);
  const url = new URL(`/document/d/${docId}/${endpoint}`, current.origin);

  const tab = current.searchParams.get('tab');
  if (tab) url.searchParams.set('tab', tab);

  return url;
}

async function fetchGoogleDocExport(docId: string, format: 'html' | 'txt'): Promise<string> {
  return fetchGoogleDocUrl(buildGoogleDocExportUrl(docId, format));
}

async function fetchGoogleDocMobileView(docId: string): Promise<string> {
  return fetchGoogleDocUrl(buildGoogleDocUrl(docId, 'mobilebasic').toString());
}

async function fetchGoogleDocUrl(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Google Docs request returned ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error('Google Docs request returned an empty response');
  }

  if (
    response.url.includes('ServiceLogin') ||
    /<title>\s*sign in/i.test(text) ||
    /accounts\.google\.com/i.test(text)
  ) {
    throw new Error('Google Docs request redirected to a sign-in page');
  }

  return text;
}

function parseGoogleDocHtml(html: string, contentSelector?: string): HTMLElement | null {
  const parsed = Markdown.parseHtmlDocument(html);
  const body = contentSelector
    ? parsed.querySelector<HTMLElement>(contentSelector) || parsed.body
    : parsed.body;
  if (!body) return null;

  unwrapGoogleRedirectLinks(body);
  unwrapSingleCellTables(body);
  return body;
}

function unwrapGoogleRedirectLinks(root: ParentNode): void {
  root.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    try {
      const url = new URL(href, window.location.origin);
      if (
        (url.hostname === 'www.google.com' || url.hostname === 'google.com') &&
        url.pathname === '/url'
      ) {
        const target = url.searchParams.get('q');
        if (target) link.setAttribute('href', target);
      }
    } catch {
      // keep original href
    }
  });
}

function unwrapSingleCellTables(root: ParentNode): void {
  root.querySelectorAll('table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
    if (rows.length !== 1) return;

    const cells = Array.from(rows[0].querySelectorAll(':scope > th, :scope > td'));
    if (cells.length !== 1) return;

    const fragment = document.createDocumentFragment();
    Array.from(cells[0].childNodes).forEach((child) => fragment.appendChild(child.cloneNode(true)));
    table.replaceWith(fragment);
  });
}
