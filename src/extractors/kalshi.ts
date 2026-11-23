/**
 * Kalshi prediction market extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const kalshiExtractor = register({
  name: 'Kalshi',
  matches: [
    '*://kalshi.com/markets/*',
    '*://www.kalshi.com/markets/*',
  ],
  pathnameRegex: /^\/markets\/.+/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: 'main h1, h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('main h1, h1')?.textContent
        || Utils.getPageTitle().replace(/\s*\|\s*Kalshi$/i, ''),
    );

    const metadata: PageMetadata = {
      source: 'Kalshi',
      title,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# ${title}`];
    const main = document.querySelector('main') || document.body;
    const cleaned = Utils.removeNoise(main, [
      ...Utils.NOISE_SELECTORS,
      'h1',
      'button',
      'input',
      'form',
    ]);
    const body = Markdown.elementToMarkdown(cleaned);
    if (body) parts.push('\n' + body);

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Kalshi market page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
