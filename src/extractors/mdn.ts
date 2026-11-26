/**
 * MDN Web Docs extractor.
 * Extracts developer documentation with code examples, browser compat tables, and specs.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'MDN Web Docs',
  matches: [
    '*://developer.mozilla.org/*/docs/*',
    '*://developer.mozilla.org/*/blog/*',
    '*://developer.mozilla.org/*/curriculum/*',
  ],

  buttonPlacement: 'anchor',
  anchor: {
    selector: '.reference-layout__header > h1, .document-toc-container, .article-actions-container, .on-github',
    position: 'after',
    style: 'pill',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('#content h1, article h1, .main-page-content h1, h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    // Breadcrumb path (e.g., "Web > JavaScript > Reference > Array")
    const breadcrumbEls = document.querySelectorAll('.breadcrumbs-container li, nav.breadcrumbs ol li, ol.breadcrumbs li');
    const breadcrumb = Array.from(breadcrumbEls).map((el) => el.textContent?.trim()).filter(Boolean).join(' > ');

    // Browser compat status
    const statusEl = document.querySelector('.page-header .bc-level');
    const status = statusEl?.textContent?.trim()
      || Markdown.normalizeWhitespace(
        Array.from(document.querySelectorAll('.baseline-indicator .status-title, .baseline-indicator .pill'))
          .map((el) => el.textContent?.trim())
          .join(' '),
      );

    const metadata: Record<string, string> = {
      source: 'MDN Web Docs',
      title,
      url,
    };
    if (breadcrumb) metadata.path = breadcrumb;

    const parts: string[] = [`# ${title}\n`];

    if (breadcrumb) parts.push(`**Path:** ${breadcrumb}\n`);
    if (status) parts.push(`**Status:** ${status}\n`);

    // Main content
    const contentEl = document.querySelector('.main-page-content, article.main-page-content, #content article, #content');
    if (contentEl) {
      const clone = contentEl.cloneNode(true) as HTMLElement;
      expandMdnCodeExamples(contentEl, clone);
      annotateMdnCodeLanguages(clone);
      // Remove noise
      clone.querySelectorAll([
        ...Utils.NOISE_SELECTORS,
        'mdn-button',
        'button',
        '.code-example .example-header',
        '.baseline-indicator',
        '.article-footer',
        '#help-improve-mdn',
        '.metadata-content-container',
        'article h1',
        '.section-content .hidden',
        '.bc-data',
        '.bc-table',
        'mdn-compat-table',
        'mdn-compat-table-lazy',
        '.metadata',
        '.prev-next',
        '.reference-layout__toc',
        '.reference-toc',
        'mdn-placement-sidebar',
        'mdn-survey',
        '.reference-layout__header > h1',
        '#cam-copy-btn',
        '[data-cam-instance]',
      ].join(', ')).forEach((el) => el.remove());
      parts.push(Markdown.elementToMarkdown(clone));
    }

    // Browser compatibility table (including <mdn-compat-table> Shadow DOM)
    const compatTable = findCompatTable();
    if (compatTable) {
      parts.push('\n## Browser Compatibility\n');
      parts.push(Markdown.tableToMarkdown(compatTable));
    }

    // Specifications (only append separately if not already included in main content)
    const specTable = document.querySelector('#specifications + .standard-table, #specifications ~ table');
    if (specTable && !contentEl?.contains(specTable)) {
      parts.push('\n## Specifications\n');
      parts.push(Markdown.tableToMarkdown(specTable));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function findCompatTable(): Element | null {
  const lightTable = document.querySelector('.bc-table');
  if (lightTable) return lightTable;

  return findShadowCompatTable(document);
}

/** The lazy element renders the compat table element inside its own shadow root. */
function findShadowCompatTable(root: ParentNode): Element | null {
  for (const host of root.querySelectorAll('mdn-compat-table, mdn-compat-table-lazy')) {
    if (!host.shadowRoot) continue;
    const table = host.shadowRoot.querySelector('.bc-table, table') || findShadowCompatTable(host.shadowRoot);
    if (table) return table;
  }
  return null;
}

/** Cloning drops shadow roots, where current pages render every code example. */
function expandMdnCodeExamples(source: Element, clone: HTMLElement): void {
  const targets = clone.querySelectorAll('mdn-code-example');
  source.querySelectorAll('mdn-code-example').forEach((example, index) => {
    const pre = example.shadowRoot?.querySelector('pre');
    if (!pre) return;
    const copy = pre.cloneNode(true) as HTMLElement;
    if (!/\bbrush:/.test(copy.className)) copy.className = `${copy.className} ${example.className}`.trim();
    targets[index]?.replaceWith(copy);
  });
}

function annotateMdnCodeLanguages(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    const code = pre.querySelector<HTMLElement>(':scope > code');
    const existingClass = code?.className || '';
    if (/\blanguage-([\w.+#-]+)/.test(existingClass)) return;

    const sources = [
      pre.className || '',
      pre.closest<HTMLElement>('.code-example')?.className || '',
      code?.className || '',
    ].join(' ');
    const brushMatch = sources.match(/\bbrush:\s*([\w.+#-]+)/i);
    const langMatch = sources.match(/\blanguage-([\w.+#-]+)/i);
    const rawLang = (brushMatch?.[1] || langMatch?.[1] || '').toLowerCase();
    if (!rawLang || rawLang === 'plain' || rawLang === 'nolang') return;

    if (code) {
      code.classList.add(`language-${rawLang}`);
    } else {
      const wrapped = root.ownerDocument.createElement('code');
      wrapped.className = `language-${rawLang}`;
      wrapped.textContent = pre.textContent || '';
      pre.replaceChildren(wrapped);
    }
  });
}
