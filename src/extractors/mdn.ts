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
    const breadcrumbEls = document.querySelectorAll('.breadcrumbs-container li, nav.breadcrumbs ol li');
    const breadcrumb = Array.from(breadcrumbEls).map(el => el.textContent?.trim()).filter(Boolean).join(' > ');

    // Browser compat status
    const statusEl = document.querySelector('.page-header .bc-level');
    const status = statusEl?.textContent?.trim() || '';

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
      // Remove noise
      clone.querySelectorAll([
        '.section-content .hidden', '.bc-data', '.metadata', '.prev-next',
        '.reference-layout__toc', '.reference-toc', 'mdn-placement-sidebar', 'mdn-survey',
        '.reference-layout__header > h1', '#cam-copy-btn', '[data-cam-instance]',
      ].join(', ')).forEach(el => el.remove());
      parts.push(Markdown.elementToMarkdown(clone));
    }

    // Browser compatibility table
    const compatTable = document.querySelector('.bc-table');
    if (compatTable) {
      parts.push('\n## Browser Compatibility\n');
      parts.push(Markdown.tableToMarkdown(compatTable));
    }

    // Specifications
    const specTable = document.querySelector('#specifications + .standard-table, #specifications ~ table');
    if (specTable) {
      parts.push('\n## Specifications\n');
      parts.push(Markdown.tableToMarkdown(specTable));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
