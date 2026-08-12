/** Semantic extractor for Sphinx and Read the Docs documentation pages. */

import { addExtractionMetadata, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import { type PageMetadata } from '../core/types';
import * as Utils from '../core/utils';

type DocumentationFramework = 'Read the Docs' | 'Sphinx';

register({
  name: 'Sphinx / Read the Docs',
  matches: [],
  detect: () => detectFramework() !== null,

  async extract() {
    const framework = detectFramework() || 'Sphinx';
    const root = findDocumentationRoot();
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
    annotateCodeLanguages(clone);
    const markdown = Markdown.elementToMarkdown(clone).trim();
    const hasHeading = Boolean(clone.querySelector('h1')) || /^#\s/m.test(markdown);
    const body = hasHeading
      ? markdown
      : `# ${title}\n\n${markdown}`;
    const limited = limitMarkdown(body);
    addExtractionMetadata(metadata, {
      contentSource: `${framework} semantic documentation DOM`,
      truncated: limited.truncated,
      complete: Boolean(markdown) && !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

function detectFramework(): DocumentationFramework | null {
  if (!findDocumentationRoot()) return null;
  if (/\.readthedocs\.(?:io|org)$/i.test(window.location.hostname) || document.querySelector([
    'meta[name="readthedocs-project-slug"]',
    'script[src*="readthedocs"]',
    'readthedocs-flyout',
    '[data-readthedocs-flyout]',
  ].join(', '))) return 'Read the Docs';

  const generator = document.querySelector<HTMLMetaElement>('meta[name="generator"]')?.content || '';
  if (/\bSphinx\b/i.test(generator) || document.querySelector([
    'html[data-content_root]',
    'html[data-content-root]',
    'script[src*="/_static/documentation_options.js"]',
    'script[src$="documentation_options.js"]',
    'script#documentation_options',
  ].join(', '))) return 'Sphinx';
  return null;
}

function findDocumentationRoot(): HTMLElement | null {
  const selectors = [
    '[itemprop="articleBody"]',
    '.document .body[role="main"]',
    'article.bd-article',
    'main#furo-main-content',
    '.wy-nav-content .rst-content [role="main"]',
    '[role="main"].document',
    '.document .body',
    '.rst-content .document',
    '.wy-nav-content .rst-content',
    '.rst-content',
    '.document',
    'main article',
    'main[role="main"]',
    'main',
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function getTitle(root: HTMLElement | null): string {
  const heading = Markdown.normalizeWhitespace(root?.querySelector('h1')?.textContent || '');
  if (heading) return heading.replace(/[¶#]+$/g, '').trim();
  return Utils.getPageTitle()
    .replace(/\s+(?:—|\||-)\s+.+?(?:documentation|docs)\s*$/i, '')
    .trim() || 'Documentation';
}

function removeDocumentationNoise(root: HTMLElement): void {
  root.querySelectorAll([
    ...Utils.NOISE_SELECTORS,
    'button',
    'a.headerlink',
    'a.anchor-link',
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
    'readthedocs-flyout',
    '[data-readthedocs-flyout]',
  ].join(', ')).forEach((element) => element.remove());
}

function annotateCodeLanguages(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('div[class*="highlight-"] pre').forEach((pre) => {
    if (pre.querySelector(':scope > code')) return;
    const container = pre.closest<HTMLElement>('div[class*="highlight-"]');
    const language = Array.from(container?.classList || [])
      .map((name) => name.match(/^highlight-([\w.+-]+)$/)?.[1] || '')
      .find((name) => name && !/^(?:default|none|text)$/i.test(name));
    if (!language) return;
    const code = document.createElement('code');
    code.className = `language-${language}`;
    code.textContent = pre.textContent || '';
    pre.replaceChildren(code);
  });
}
