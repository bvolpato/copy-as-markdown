/**
 * Google Docs extractor.
 *
 * Uses the document export endpoint rather than the live canvas editor so we
 * can capture the full document with headings, lists, tables, links, and
 * images — including content that is currently off-screen.
 */

import { addExtractionMetadata } from '../core/context';
import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

export const googleDocsExtractor = register({
  name: 'Google Docs',
  matches: [
    '*://docs.google.com/document/d/*',
    '*://docs.google.com/document/u/*/d/*',
    '*://docs.google.com/a/*/document/d/*',
    '*://docs.google.com/a/*/document/u/*/d/*',
  ],
  pathnameRegex: /^(?:\/a\/[^/]+)?\/document\/(?:u\/\d+\/)?d\/(?!e(?:\/|$))[^/]+(?:\/|$)/,
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
      addExtractionMetadata(metadata, {
        contentSource: 'Google Docs live page',
        total: 0,
        included: 0,
        truncated: false,
        complete: false,
      });
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
        addExtractionMetadata(metadata, {
          contentSource: 'Google Docs authenticated HTML export',
          complete: true,
        });
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
        addExtractionMetadata(metadata, {
          contentSource: 'Google Docs authenticated mobile view',
          complete: true,
        });
        return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${markdown}`);
      }
    } catch (err) {
      console.warn('[Copy as Markdown] Google Docs mobile view failed', err);
    }

    try {
      const text = await fetchGoogleDocExport(docId, 'txt');
      const trimmed = text.trim();
      if (trimmed) {
        addExtractionMetadata(metadata, {
          contentSource: 'Google Docs authenticated text export',
          complete: false,
        });
        return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${trimmed}`);
      }
    } catch (err) {
      console.warn('[Copy as Markdown] Google Docs text export failed', err);
    }

    addExtractionMetadata(metadata, {
      contentSource: 'Google Docs live page',
      total: 0,
      included: 0,
      truncated: false,
      complete: false,
    });
    return Markdown.buildPageMarkdown(
      metadata,
      '*Could not export this Google Doc. Make sure the document is fully loaded and you have access to it.*',
    );
  },
});

function getGoogleDocId(): string {
  return window.location.pathname.match(/^(?:\/a\/[^/]+)?\/document\/(?:u\/\d+\/)?d\/(?!e(?:\/|$))([^/]+)/)?.[1] || '';
}

function getGoogleDocTitle(): string {
  const titleInput = document.querySelector<HTMLInputElement>('.docs-title-input');
  const title =
    document.querySelector('.docs-title-input-label-inner')?.textContent?.trim() ||
    document.querySelector('#docs-title-input-label-inner')?.textContent?.trim() ||
    titleInput?.value?.trim() ||
    titleInput?.textContent?.trim() ||
    Utils.getPageTitle();

  return title.replace(/\s*-\s*Google Docs$/, '').trim();
}

function buildGoogleDocExportUrls(docId: string, format: 'html' | 'txt'): string[] {
  return buildGoogleDocUrls(docId, 'export').map((url) => {
    url.searchParams.set('format', format);
    return url.toString();
  });
}

function buildGoogleDocUrls(docId: string, endpoint: 'export' | 'mobilebasic'): URL[] {
  const current = new URL(window.location.href);
  const domainPrefix = current.pathname.match(/^(\/a\/[^/]+)/)?.[1] || '';
  const accountPrefix = current.pathname.match(/\/document\/(u\/\d+)\/d\//)?.[1] || '';
  const basePaths = new Set<string>([
    `${domainPrefix}/document/${accountPrefix ? `${accountPrefix}/` : ''}d/${docId}/${endpoint}`,
  ]);
  if (domainPrefix && accountPrefix) {
    basePaths.add(`${domainPrefix}/document/d/${docId}/${endpoint}`);
  }
  basePaths.add(`/document/d/${docId}/${endpoint}`);

  const tab = current.searchParams.get('tab');
  return Array.from(basePaths).map((pathname) => {
    const url = new URL(pathname, current.origin);
    if (tab) url.searchParams.set('tab', tab);
    return url;
  });
}

async function fetchGoogleDocExport(docId: string, format: 'html' | 'txt'): Promise<string> {
  return fetchGoogleDocWithFallback(buildGoogleDocExportUrls(docId, format));
}

async function fetchGoogleDocMobileView(docId: string): Promise<string> {
  return fetchGoogleDocWithFallback(buildGoogleDocUrls(docId, 'mobilebasic').map((url) => url.toString()));
}

async function fetchGoogleDocWithFallback(urls: string[]): Promise<string> {
  let lastError: unknown;
  for (let index = 0; index < urls.length; index += 1) {
    try {
      return await fetchGoogleDocUrl(urls[index]);
    } catch (err) {
      lastError = err;
      const isLast = index === urls.length - 1;
      if (isLast || !shouldRetryAccountFallback(err)) throw err;
    }
  }
  throw lastError;
}

class GoogleHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function shouldRetryAccountFallback(error: unknown): boolean {
  if (error instanceof GoogleHttpError) return error.status === 404;
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError');
}

function isGoogleSignInResponse(response: Response, text: string): boolean {
  try {
    const parsedUrl = response.url ? new URL(response.url) : null;
    if (parsedUrl && /(?:^|\.)accounts\.google\.com$/i.test(parsedUrl.hostname)) {
      return true;
    }
  } catch {
    // ignore invalid response URL
  }
  if (response.url.includes('ServiceLogin')) return true;
  if (/<title[^>]*>\s*(?:sign in|google accounts)\b/i.test(text)) return true;
  const hasSignInForm = /<form[^>]+(?:ServiceLogin|accounts\.google\.com)/i.test(text)
    || /name=["'](?:identifier|Passwd)["']/i.test(text);
  if (hasSignInForm) {
    const visibleText = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (visibleText.length < 2000) return true;
  }
  return false;
}

async function fetchGoogleDocUrl(url: string): Promise<string> {
  const response = await Utils.fetchWithTimeout(url, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new GoogleHttpError(`Google Docs request returned ${response.status}`, response.status);
  }

  const text = await response.text();
  if (!text.trim()) {
    throw new Error('Google Docs request returned an empty response');
  }

  if (isGoogleSignInResponse(response, text)) {
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
  let changed = true;
  while (changed) {
    changed = false;
    root.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
      if (rows.length !== 1) return;

      const cells = Array.from(rows[0].querySelectorAll(':scope > th, :scope > td'));
      if (cells.length !== 1) return;

      const fragment = table.ownerDocument.createDocumentFragment();
      Array.from(cells[0].childNodes).forEach((child) => fragment.appendChild(child.cloneNode(true)));
      table.replaceWith(fragment);
      changed = true;
    });
  }
}
