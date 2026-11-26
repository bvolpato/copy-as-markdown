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
    const main = (document.querySelector('main') || document.body).cloneNode(true) as Element;
    main.querySelectorAll('[data-tile-group]').forEach((group, index) => replaceTileGroup(group, main, index));
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

/** Outcome names and prices are buttons, which the page cleanup removes. Put a table in place of each tile group. */
function replaceTileGroup(group: Element, root: Element, index: number): void {
  const rows = new Map<string, string[]>();
  const remainder: string[] = [];
  Array.from(group.children).forEach((tile) => {
    const prices = Array.from(tile.querySelectorAll('[data-testid="price-pill"]')).map(spacedText);
    const name = Array.from(tile.querySelectorAll('button:not([data-testid="price-pill"])')).map(spacedText).find(Boolean) || '';
    const chance = Array.from(tile.querySelectorAll('span:not(button *)')).map(spacedText)
      .find((text) => /^[<>]?\s*\d+(?:\.\d+)?%$/.test(text)) || '';
    if (name && (chance || prices.length)) {
      const price = (side: string) => prices.find((text) => text.startsWith(side))?.slice(side.length).trim() || '';
      if (!rows.has(name)) rows.set(name, [name, chance, price('Yes'), price('No')]);
    } else {
      // A collapsed list ends with text such as "2 more".
      remainder.push(spacedText(tile));
    }
  });
  if (rows.size === 0) return;
  const add = (tag: string, text: string): void => {
    const element = document.createElement(tag);
    element.textContent = text;
    group.before(element);
  };
  // The button that opens a panel is its heading.
  const panelId = group.closest('[id]')?.id;
  const heading = panelId ? spacedText(root.querySelector(`[aria-controls="${CSS.escape(panelId)}"]`)) : '';
  if (heading || index === 0) add('h2', heading || 'Outcomes');
  const table = document.createElement('table');
  for (const cells of [['Outcome', 'Chance', 'Yes', 'No'], ...rows.values()]) {
    const row = table.insertRow();
    cells.forEach((cell) => { row.insertCell().textContent = cell; });
  }
  group.before(table);
  if (remainder.some(Boolean)) add('p', remainder.filter(Boolean).join(' · '));
  group.remove();
}

function spacedText(element: Element | null): string {
  if (!element) return '';
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  while (walker.nextNode()) chunks.push(walker.currentNode.textContent || '');
  return Markdown.normalizeWhitespace(chunks.join(' '));
}
