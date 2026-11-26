/**
 * SEC EDGAR filing extractor (10-K, 10-Q, 8-K, S-1, iXBRL viewer).
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const secEdgarExtractor = register({
  name: 'SEC EDGAR',
  matches: [
    '*://www.sec.gov/Archives/edgar/*',
    '*://www.sec.gov/ix*',
  ],
  pathnameRegex: /^\/(?:Archives\/edgar\/.+|ix(?:\.html)?\/?)$/,

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('#formHeader, #dynamic-xbrl-form h1, .companyName, h1')?.textContent
        || Utils.getPageTitle(),
    );
    const metadata: PageMetadata = {
      source: 'SEC EDGAR',
      title,
      url: window.location.href,
    };

    const filingRoot = document.querySelector('#dynamic-xbrl-form, #formDiv') || document.querySelector('main') || document.body;
    const cleaned = Utils.removeNoise(filingRoot, [
      ...Utils.NOISE_SELECTORS,
      '#sec-header',
      '.navbar',
      '.modal',
      '#sections-menu',
      '#fact-modal',
      'button',
    ]);

    const body = Markdown.elementToMarkdown(cleaned);
    const parts = title && !body.startsWith(`# ${title}`) ? [`# ${title}`, '', body] : [body];

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered SEC EDGAR filing',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
