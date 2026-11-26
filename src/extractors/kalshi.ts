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
    const outcomes = extractOutcomes(main);
    if (outcomes.length > 0) {
      parts.push(
        '\n## Outcomes\n',
        '| Outcome | Chance | Yes | No |',
        '| --- | --- | --- | --- |',
        ...outcomes.map((row) => `| ${row.map((cell) => Markdown.escapeMarkdownTableCell(cell)).join(' | ')} |`),
      );
    }
    const cleaned = Utils.removeNoise(main, [
      ...Utils.NOISE_SELECTORS,
      'h1',
      'button',
      'input',
      'form',
      ...(outcomes.length > 0 ? ['[data-tile-group]'] : []),
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

/** Outcome names and prices are buttons, which the page cleanup removes. */
function extractOutcomes(root: Element): string[][] {
  const rows = new Map<string, string[]>();
  // A later tile group lists the markets of other events.
  Array.from(root.querySelector('[data-tile-group]')?.children || []).forEach((tile) => {
    const prices = Array.from(tile.querySelectorAll('[data-testid="price-pill"]'))
      .map((pill) => Markdown.normalizeWhitespace(pill.textContent || ''));
    const name = Markdown.normalizeWhitespace(
      Array.from(tile.querySelectorAll('button:not([data-testid="price-pill"])'))
        .map((button) => button.textContent || '').find((text) => text.trim()) || '',
    );
    const chance = Array.from(tile.querySelectorAll('span:not(button *)'))
      .map((span) => Markdown.normalizeWhitespace(span.textContent || ''))
      .find((text) => /^[<>]?\s*\d+(?:\.\d+)?%$/.test(text)) || '';
    if (!name || !(chance || prices.length) || rows.has(name)) return;
    const price = (side: string) => prices.find((text) => text.startsWith(side))?.slice(side.length).trim() || '';
    rows.set(name, [name, chance, price('Yes'), price('No')]);
  });
  return [...rows.values()];
}
