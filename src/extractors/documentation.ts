/** Semantic extractor for common documentation frameworks on any public domain. */

import { addExtractionMetadata, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { type PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type DocumentationFramework =
  | 'Docusaurus'
  | 'GitBook'
  | 'Mintlify'
  | 'MkDocs'
  | 'Nextra'
  | 'Read the Docs'
  | 'Sphinx'
  | 'VitePress';

const ROOT_SELECTORS: Record<DocumentationFramework, readonly string[]> = {
  'Mintlify': [
    '#content-area',
    '[data-page-title][data-page-href]',
    'main [data-pagefind-body]',
    'main article',
  ],
  'Docusaurus': [
    '.theme-doc-markdown.markdown',
    '.theme-doc-markdown',
    'main article',
  ],
  'GitBook': [
    '[data-content-ref-root]',
    'main [data-testid="page-content"]',
    'main [data-pagefind-body]',
    'main article',
    'main',
  ],
  'MkDocs': [
    'article.md-content__inner',
    '.md-content__inner',
    'main .md-content',
    '.container [role="main"]',
    '[role="main"]',
  ],
  'VitePress': [
    '.VPDoc .vp-doc',
    '.VPDoc main',
    '.vp-doc',
  ],
  'Nextra': [
    'article.nextra-body-typesetting-articles',
    'article[class*="nextra-content"]',
    'main [class*="nextra-content"]',
    'main article',
  ],
  'Read the Docs': [
    '[itemprop="articleBody"]',
    '.wy-nav-content .rst-content [role="main"]',
    '.rst-content .document',
    '.wy-nav-content .rst-content',
  ],
  'Sphinx': [
    '[itemprop="articleBody"]',
    '.document .body[role="main"]',
    'article.bd-article',
    'main#furo-main-content',
    '[role="main"].document',
    '.document .body',
    '.rst-content .document',
    '.rst-content',
    '.document',
  ],
};

const FALLBACK_ROOT_SELECTORS = [
  '[data-pagefind-body]',
  'main article',
  'main[role="main"]',
  'main',
];

export const documentationExtractor = register({
  // Keep established name stable for library callers and saved UI state.
  name: 'Sphinx / Read the Docs',
  matches: [],
  detect: (contextDocument) => detectFramework(contextDocument) !== null,

  async extract() {
    const framework = detectFramework(document) || 'Sphinx';
    const root = findDocumentationRoot(document, framework);
    const title = getTitle(root);
    const metadata: PageMetadata = {
      source: framework,
      type: 'Documentation',
      title,
      url: Utils.getCanonicalUrl(),
    };
    const version = document.querySelector<HTMLMetaElement>(
      'meta[name="readthedocs-version-slug"]',
    )?.content.trim();
    if (version) metadata.version = version;

    const markdownUrl = findSamePageMarkdownUrl(document, window.location.href);
    if (markdownUrl) {
      try {
        const sourceMarkdown = await fetchPublicMarkdown(markdownUrl, window.location.href);
        const body = ensureTitle(resolveMarkdownUrls(sourceMarkdown, markdownUrl), title);
        const limited = limitMarkdown(body);
        addExtractionMetadata(metadata, {
          contentSource: `${framework} same-page public Markdown`,
          truncated: limited.truncated,
          complete: !limited.truncated,
        });
        return Markdown.buildPageMarkdown(metadata, limited.markdown);
      } catch (error) {
        console.warn('[Copy as Markdown] Documentation Markdown fetch failed; using rendered DOM', error);
      }
    }

    if (!root) {
      addExtractionMetadata(metadata, {
        contentSource: `${framework} rendered documentation DOM (unavailable)`,
        complete: false,
      });
      return Markdown.buildPageMarkdown(
        metadata,
        `# ${title}\n\n*Could not find rendered documentation content. Wait for page to finish loading and try again.*`,
      );
    }

    const clone = root.cloneNode(true) as HTMLElement;
    removeDocumentationNoise(clone);
    unwrapStructuralFigureCaptions(clone);
    annotateCodeLanguages(clone);
    const markdown = Markdown.elementToMarkdown(clone).trim();
    const body = ensureTitle(markdown, title, Boolean(clone.querySelector('h1')));
    const limited = limitMarkdown(body);
    addExtractionMetadata(metadata, {
      contentSource: `${framework} semantic documentation DOM`,
      truncated: limited.truncated,
      complete: Boolean(markdown) && !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

function detectFramework(contextDocument: Document = document): DocumentationFramework | null {
  const generator = getGenerator(contextDocument);

  if (hasDocumentationRoot(contextDocument, 'Read the Docs') && (
    /\.readthedocs\.(?:io|org)$/i.test(getHostname(contextDocument))
    || /\bRead the Docs\b/i.test(generator)
    || hasAny(contextDocument, [
      'meta[name="readthedocs-project-slug"]',
      'script[src*="readthedocs"]',
      'readthedocs-flyout',
      '[data-readthedocs-flyout]',
    ])
  )) return 'Read the Docs';

  if (hasDocumentationRoot(contextDocument, 'Mintlify') && (
    /\bMintlify\b/i.test(generator)
    || Boolean(contextDocument.querySelector('[data-page-title][data-page-href]'))
    || hasAny(contextDocument, [
      '[data-mintlify]',
      'script[src*="mintlify"]',
      'link[href*="mintlify"]',
    ])
  )) return 'Mintlify';

  if (hasDocumentationRoot(contextDocument, 'Docusaurus') && (
    /\bDocusaurus\b/i.test(generator)
    || Boolean(contextDocument.querySelector('#__docusaurus .theme-doc-markdown'))
  )) return 'Docusaurus';

  if (hasDocumentationRoot(contextDocument, 'GitBook') && (
    /\bGitBook\b/i.test(generator)
    || Boolean(contextDocument.querySelector('[data-content-ref-root]'))
    || hasAny(contextDocument, [
      'script[src*="gitbook"]',
      'link[href*="gitbook"]',
    ])
  )) return 'GitBook';

  if (hasDocumentationRoot(contextDocument, 'MkDocs') && (
    /\bMkDocs\b/i.test(generator)
    || Boolean(contextDocument.querySelector('.md-content [data-md-component], [data-md-component] .md-content'))
    || Boolean(contextDocument.querySelector('article.md-content__inner.md-typeset'))
    || Boolean(
      contextDocument.querySelector('#mkdocs_search_modal')
      && contextDocument.querySelector('#mkdocs-search-query')
      && contextDocument.querySelector('[role="main"]'),
    )
  )) return 'MkDocs';

  if (hasDocumentationRoot(contextDocument, 'VitePress') && (
    /\bVitePress\b/i.test(generator)
    || Boolean(contextDocument.querySelector('.VPDoc .vp-doc'))
  )) return 'VitePress';

  if (hasDocumentationRoot(contextDocument, 'Nextra') && (
    /\bNextra\b/i.test(generator)
    || Boolean(
      contextDocument.querySelector('main[data-pagefind-body]')
      && contextDocument.querySelector('.nextra-navbar, #nextra-skip-nav'),
    )
  )) return 'Nextra';

  if (hasDocumentationRoot(contextDocument, 'Sphinx') && (
    /\bSphinx\b/i.test(generator)
    || hasAny(contextDocument, [
      'html[data-content_root]',
      'html[data-content-root]',
      'script[src*="/_static/documentation_options.js"]',
      'script[src$="documentation_options.js"]',
      'script#documentation_options',
    ])
  )) return 'Sphinx';

  return null;
}

function unwrapStructuralFigureCaptions(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('figcaption').forEach((caption) => {
    if (!caption.querySelector('h1, h2, h3, h4, h5, h6')) return;
    const container = caption.ownerDocument.createElement('div');
    while (caption.firstChild) container.append(caption.firstChild);
    caption.replaceWith(container);
  });
}

function getGenerator(contextDocument: Document): string {
  return contextDocument.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content || '';
}

function getHostname(contextDocument: Document): string {
  return contextDocument.location?.hostname || '';
}

function hasAny(contextDocument: Document, selectors: readonly string[]): boolean {
  return selectors.some((selector) => Boolean(contextDocument.querySelector(selector)));
}

function hasDocumentationRoot(
  contextDocument: Document,
  framework: DocumentationFramework,
): boolean {
  return Boolean(findDocumentationRoot(contextDocument, framework));
}

function findDocumentationRoot(
  contextDocument: Document,
  framework: DocumentationFramework,
): HTMLElement | null {
  if (framework === 'MkDocs') {
    const sections = selectDocumentationElements(contextDocument, '.md-content__inner')
      .filter((element) => isPopulatedDocumentationRoot(element) && isVisibleDocumentationRoot(element))
      .filter((element, _index, candidates) => !candidates.some(
        (candidate) => candidate !== element && candidate.contains(element),
      ));
    if (sections.length > 1 && typeof contextDocument.createElement === 'function') {
      const aggregate = contextDocument.createElement('main');
      sections.forEach((section) => aggregate.append(cloneCompleteDocumentationSection(section)));
      return aggregate;
    }
  }

  const selectors = [...ROOT_SELECTORS[framework], ...FALLBACK_ROOT_SELECTORS];
  let emptyCandidate: HTMLElement | null = null;
  const seen = new Set<HTMLElement>();
  for (const selector of selectors) {
    for (const element of selectDocumentationElements(contextDocument, selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      emptyCandidate ||= element;
      if (isPopulatedDocumentationRoot(element)) return element;
    }
  }
  return emptyCandidate;
}

function cloneCompleteDocumentationSection(section: HTMLElement): HTMLElement {
  const clone = section.cloneNode(true) as HTMLElement;
  for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('[hidden], [aria-hidden="true"]'))]) {
    element.hidden = false;
    element.removeAttribute('hidden');
    element.removeAttribute('aria-hidden');
  }
  return clone;
}

function selectDocumentationElements(
  contextDocument: Document,
  selector: string,
): HTMLElement[] {
  return typeof contextDocument.querySelectorAll === 'function'
    ? Array.from(contextDocument.querySelectorAll<HTMLElement>(selector))
    : [contextDocument.querySelector<HTMLElement>(selector)].filter(
      (element): element is HTMLElement => Boolean(element),
    );
}

function isPopulatedDocumentationRoot(element: HTMLElement): boolean {
  if (Markdown.normalizeWhitespace(element.textContent || '')) return true;
  return Boolean(element.querySelector('img[alt], picture, video, audio, table, pre, code'));
}

function isVisibleDocumentationRoot(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const view: Window | null | undefined = current.ownerDocument?.defaultView;
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    current = current.parentElement;
  }
  return true;
}

function getTitle(root: HTMLElement | null): string {
  const heading = Markdown.normalizeWhitespace(root?.querySelector('h1')?.textContent || '');
  if (heading) return cleanHeadingTitle(heading);
  return Utils.getPageTitle()
    .replace(/\s+(?:—|\||-)\s+.+?(?:documentation|docs)\s*$/i, '')
    .trim() || 'Documentation';
}

function cleanHeadingTitle(value: string): string {
  return value.replace(/[¶#]+$/g, '').trim();
}

function ensureTitle(markdown: string, title: string, hasDomHeading = false): string {
  const clean = stripSourceFrontmatter(markdown).trim();
  if (hasDomHeading || /^#\s+/m.test(clean)) return clean;
  return `# ${title}\n\n${clean}`.trim();
}

function stripSourceFrontmatter(markdown: string): string {
  return markdown.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
}

function findSamePageMarkdownUrl(
  contextDocument: Document,
  href: string,
): URL | null {
  const current = new URL(href);
  if (!/^https?:$/.test(current.protocol)) return null;

  const candidates = contextDocument.querySelectorAll<HTMLLinkElement | HTMLAnchorElement>([
    'link[rel~="alternate"][type="text/markdown"][href]',
    'link[rel~="alternate"][type="text/x-markdown"][href]',
    'a[data-testid="view-as-markdown"][href]',
    'a[data-copy-page-action="view-markdown"][href]',
    'a[aria-label="View as Markdown"][href]',
  ].join(', '));

  for (const candidate of candidates) {
    const value = candidate.getAttribute('href');
    if (!value) continue;
    try {
      const url = new URL(value, current);
      if (isSamePublicMarkdownPage(url, current)) return url;
    } catch {
      // Ignore malformed page-provided URLs.
    }
  }
  return null;
}

function isSamePublicMarkdownPage(markdownUrl: URL, pageUrl: URL): boolean {
  if (!/^https?:$/.test(markdownUrl.protocol)) return false;
  if (markdownUrl.origin !== pageUrl.origin) return false;
  if (markdownUrl.username || markdownUrl.password) return false;
  if (markdownUrl.search) return false;
  return normalizeDocumentationPath(markdownUrl.pathname)
    === normalizeDocumentationPath(pageUrl.pathname);
}

function normalizeDocumentationPath(pathname: string): string {
  let path = pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  path = path.replace(/\/(?:index)?\.(?:md|markdown|html?)$/i, '');
  path = path.replace(/\.(?:md|markdown|html?)$/i, '');
  return path || '/';
}

async function fetchPublicMarkdown(markdownUrl: URL, pageHref: string): Promise<string> {
  const pageUrl = new URL(pageHref);
  if (!isSamePublicMarkdownPage(markdownUrl, pageUrl)) {
    throw new Error('Documentation Markdown URL does not describe current public page');
  }

  const response = await fetch(markdownUrl.toString(), {
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'text/markdown, text/x-markdown;q=0.9, text/plain;q=0.8' },
  });
  if (!response.ok) {
    throw new Error(`Documentation Markdown request returned ${response.status}`);
  }
  if (response.url && !isSamePublicMarkdownPage(new URL(response.url), pageUrl)) {
    throw new Error('Documentation Markdown response does not describe current public page');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/^text\/(?:markdown|x-markdown|plain)\b/i.test(contentType)) {
    throw new Error(`Documentation Markdown request returned unsupported content type: ${contentType || 'missing'}`);
  }

  const text = await response.text();
  if (!text.trim()) throw new Error('Documentation Markdown request returned an empty response');
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
    throw new Error('Documentation Markdown request did not return Markdown');
  }
  return text;
}

function resolveMarkdownUrls(markdown: string, baseUrl: URL): string {
  const lines = markdown.split(/\r?\n/);
  let fence: { marker: string; length: number } | null = null;

  return lines.map((line) => {
    const fenceMatch = line.match(
      /^(?:(?:[ \t]*>[ \t]?)|(?:[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+))*[ \t]*(`{3,}|~{3,})(.*)$/,
    );
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) {
        fence = { marker, length: fenceMatch[1].length };
      } else if (
        marker === fence.marker
        && fenceMatch[1].length >= fence.length
        && fenceMatch[2].trim() === ''
      ) {
        fence = null;
      }
      return line;
    }
    return fence ? line : resolveMarkdownLineUrls(line, baseUrl);
  }).join('\n');
}

function resolveMarkdownLineUrls(line: string, baseUrl: URL): string {
  const reference = line.match(/^(\s{0,3}\[([^\]]+)\]:[ \t]*)(<([^>]*)>|(\S+))(.*)$/);
  if (reference && !reference[2].trim().startsWith('^')) {
    const destination = reference[4] ?? reference[5];
    const resolved = resolveMarkdownDestination(destination, baseUrl);
    const formatted = reference[4] !== undefined ? `<${resolved}>` : resolved;
    return `${reference[1]}${formatted}${reference[6]}`;
  }

  let result = '';
  let inlineCodeTicks = 0;
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      const tickCount = countRepeatedCharacter(line, index, '`');
      result += line.slice(index, index + tickCount);
      if (inlineCodeTicks === 0) inlineCodeTicks = tickCount;
      else if (tickCount === inlineCodeTicks) inlineCodeTicks = 0;
      index += tickCount;
      continue;
    }

    if (
      inlineCodeTicks === 0
      && line[index] === ']'
      && line[index + 1] === '('
      && hasMarkdownLinkOpening(line, index)
    ) {
      const closing = findMarkdownDestinationEnd(line, index + 1);
      if (closing !== -1) {
        const target = line.slice(index + 2, closing);
        result += `](${resolveInlineMarkdownTarget(target, baseUrl)})`;
        index = closing + 1;
        continue;
      }
    }

    result += line[index];
    index += 1;
  }
  return result;
}

function resolveInlineMarkdownTarget(target: string, baseUrl: URL): string {
  const leadingWhitespace = target.match(/^\s*/)?.[0] || '';
  const remainder = target.slice(leadingWhitespace.length);
  if (remainder.startsWith('<')) {
    const closing = findUnescapedCharacter(remainder, '>', 1);
    if (closing !== -1) {
      const destination = remainder.slice(1, closing);
      return `${leadingWhitespace}<${resolveMarkdownDestination(destination, baseUrl)}>${remainder.slice(closing + 1)}`;
    }
  }

  let destinationEnd = 0;
  while (destinationEnd < remainder.length) {
    if (remainder[destinationEnd] === '\\' && destinationEnd + 1 < remainder.length) {
      destinationEnd += 2;
      continue;
    }
    if (/\s/.test(remainder[destinationEnd])) break;
    destinationEnd += 1;
  }
  const destination = remainder.slice(0, destinationEnd);
  return `${leadingWhitespace}${resolveMarkdownDestination(destination, baseUrl)}${remainder.slice(destinationEnd)}`;
}

function resolveMarkdownDestination(destination: string, baseUrl: URL): string {
  if (!destination || destination.startsWith('#')) return destination;
  if (/^[a-z][a-z\d+.-]*:/i.test(destination)) return destination;
  try {
    return new URL(destination, baseUrl).href;
  } catch {
    return destination;
  }
}

function hasMarkdownLinkOpening(line: string, closingBracket: number): boolean {
  let bracketDepth = 0;
  for (let index = closingBracket - 1; index >= 0; index -= 1) {
    if (isEscapedCharacter(line, index)) continue;
    if (line[index] === ']') bracketDepth += 1;
    if (line[index] !== '[') continue;
    if (bracketDepth === 0) return true;
    bracketDepth -= 1;
  }
  return false;
}

function findMarkdownDestinationEnd(line: string, openingParenthesis: number): number {
  let depth = 1;
  let titleQuote = '';
  let destinationEnded = false;
  for (let index = openingParenthesis + 1; index < line.length; index += 1) {
    if (isEscapedCharacter(line, index)) continue;
    const character = line[index];
    if (titleQuote) {
      if (character === titleQuote) titleQuote = '';
      continue;
    }
    if (depth === 1 && /\s/.test(character)) {
      destinationEnded = true;
      continue;
    }
    if (destinationEnded && depth === 1 && (character === '"' || character === "'")) {
      titleQuote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character !== ')') continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function findUnescapedCharacter(value: string, character: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === character && !isEscapedCharacter(value, index)) return index;
  }
  return -1;
}

function isEscapedCharacter(value: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function countRepeatedCharacter(value: string, start: number, character: string): number {
  let count = 0;
  while (value[start + count] === character) count += 1;
  return count;
}

function removeDocumentationNoise(root: HTMLElement): void {
  root.querySelectorAll([
    ...Utils.NOISE_SELECTORS,
    'button',
    'a.headerlink',
    'a.header-anchor',
    'a.hash-link',
    'a.anchor-link',
    'a.subheading-anchor',
    'a[aria-label^="Direct link to heading"]',
    'a[aria-label^="Permalink to"]',
    '.copybtn',
    '.edit-this-page',
    '.show-source',
    '.viewcode-link',
    '.viewcode-back',
    '.prev-next-area',
    '.related-pages',
    '.rst-footer-buttons',
    '.wy-breadcrumbs',
    '.wy-nav-top',
    '.rst-versions',
    '.sidebar-drawer',
    '.toc-drawer',
    '.bd-header',
    '.bd-sidebar',
    '.bd-footer',
    '.theme-doc-breadcrumbs',
    '.theme-doc-toc-mobile',
    '.theme-doc-footer',
    '.theme-edit-this-page',
    '.pagination-nav',
    '.table-of-contents',
    '.md-content__button',
    '.md-source-file',
    '.md-headerlink',
    '.VPDocFooter',
    '.VPDocAside',
    '.nextra-breadcrumb',
    '.nextra-toc',
    '.nextra-feedback',
    '.nextra-navigation-links',
    '[data-testid="page-footer"]',
    '[data-testid="page-feedback"]',
    '[data-testid="ai-chat"]',
    '[data-testid^="ai-chat-"]',
    '[data-page-feedback]',
    '[data-gitbook-assistant]',
    '[class~="group/ask-ai"]',
    '[class~="group/input"]',
    '[aria-label="Ask AI"]',
    '[aria-label^="Ask GitBook"]',
    '[data-nosnippet]',
    'readthedocs-flyout',
    '[data-readthedocs-flyout]',
  ].join(', ')).forEach((element) => element.remove());
}

function annotateCodeLanguages(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    const existingCode = pre.querySelector<HTMLElement>(':scope > code');
    const existingLanguage = Array.from(existingCode?.classList || [])
      .map((name) => name.match(/^language-([\w.+#-]+)$/)?.[1] || '')
      .find((name) => name && !/^(?:default|none|text)$/i.test(name));
    if (existingLanguage) {
      return;
    }

    const container = pre.closest<HTMLElement>([
      '[language]',
      '[data-language]',
      '[class*="highlight-"]',
      '[class*="language-"]',
    ].join(', '));
    const attributeLanguage = existingCode?.getAttribute('language')
      || pre.getAttribute('language')
      || container?.getAttribute('language')
      || '';
    const dataLanguage = container?.dataset.language || pre.dataset.language || '';
    const classLanguage = Array.from(container?.classList || [])
      .map((name) => name.match(/^(?:highlight|language)-([\w.+#-]+)$/)?.[1] || '')
      .find((name) => name && !/^(?:default|none|text)$/i.test(name));
    const language = normalizeCodeLanguage(attributeLanguage)
      || normalizeCodeLanguage(dataLanguage)
      || classLanguage;
    if (!language) return;

    if (existingCode) {
      existingCode.classList.remove('language-default', 'language-none', 'language-text');
      existingCode.classList.add(`language-${language}`);
      return;
    }
    const code = document.createElement('code');
    code.className = `language-${language}`;
    code.textContent = pre.textContent || '';
    pre.replaceChildren(code);
  });
}

function normalizeCodeLanguage(value: string): string {
  const language = value.trim().replace(/^language-/i, '');
  return /^[\w.+#-]+$/.test(language) ? language : '';
}
