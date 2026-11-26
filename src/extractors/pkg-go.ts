/**
 * pkg.go.dev (Go package documentation) extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const pkgGoExtractor = register({
  name: 'pkg.go.dev',
  matches: [
    '*://pkg.go.dev/*',
  ],
  pathnameRegex: /^\/(?!$|search(?:\/|$)|about(?:\/|$)|badge(?:\/|$)|license-policy(?:\/|$)|vuln(?:\/|$)).+/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '.go-Main-headerTitle, .go-Main-header h1, main h1',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px', verticalAlign: 'middle' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('.go-Main-headerTitle h1, .go-Main-header h1, main h1')?.textContent
        || Utils.getPageTitle().replace(/\s*-\s*Go Packages$/i, ''),
    );
    const versionEl = document.querySelector(
      '.go-Main-headerDetails [data-test-id="UnitHeader-version"] a, .go-Main-headerDetailItem a[href*="?tab=versions"], .go-Main-headerDetails [data-test-id="UnitHeader-version"]',
    );
    const rawVersion = versionEl
      ? Utils.removeNoise(versionEl, ['.go-ScreenReaderOnly', '[aria-hidden="true"]', 'img', 'svg']).textContent || ''
      : '';
    const version = Markdown.normalizeWhitespace(rawVersion)
      .replace(/^Version:\s*/i, '')
      .replace(/\s+Opens a new window.*$/i, '')
      .replace(/\s+Latest\b.*$/i, '')
      .trim();
    const published = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="UnitHeader-commitTime"]')?.textContent || '',
    ).replace(/^Published:\s*/i, '').trim();
    const license = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="UnitHeader-licenses"] a, [data-test-id="UnitHeader-licenses"]')?.textContent || '',
    ).replace(/^License:\s*/i, '').trim();

    const metadata: PageMetadata = {
      source: 'pkg.go.dev',
      title,
      url: Utils.getCanonicalUrl(),
      version: version || undefined,
      license: license || undefined,
    };

    const parts: string[] = [`# ${title}`];
    const metaLine = [
      version ? `**Version:** ${version}` : '',
      published ? `**Published:** ${published}` : '',
      license ? `**License:** ${license}` : '',
    ].filter(Boolean);
    if (metaLine.length > 0) parts.push('\n' + metaLine.join(' | '));

    const contentEl = document.querySelector('.go-Main-article, .UnitDetails-content, main article, main');
    if (contentEl) {
      const cleaned = Utils.removeNoise(contentEl, [
        ...Utils.NOISE_SELECTORS,
        '.UnitDoc-jumpTo',
        '.Documentation-indexHeading',
        '.go-Clipboard',
        '.Documentation-number',
        '.go-Tooltip > p',
        'a[href^="#"][aria-label^="Go to "]',
        'button',
      ]);
      restoreExampleCode(contentEl, cleaned);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered pkg.go.dev documentation',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});

/** Example editors are textareas, and their code exists only as the live value. */
function restoreExampleCode(source: Element, clone: Element): void {
  const selector = 'textarea.Documentation-exampleCode';
  const targets = clone.querySelectorAll(selector);
  source.querySelectorAll<HTMLTextAreaElement>(selector).forEach((editor, index) => {
    const code = editor.value || editor.textContent || '';
    if (!code.trim()) return;
    const pre = editor.ownerDocument.createElement('pre');
    pre.className = 'language-go';
    pre.textContent = code;
    targets[index]?.replaceWith(pre);
  });
}
