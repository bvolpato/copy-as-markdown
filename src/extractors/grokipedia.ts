/**
 * Grokipedia extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Grokipedia',
  matches: [
    '*://grokipedia.com/*',
    '*://www.grokipedia.com/*',
  ],
  anchor: {
    // Append to the header toolbar next to Listen / Copy link / Edits history buttons
    selector: [
      '#edits-history-btn',          // stable: last toolbar button
      '#copy-link-btn',              // fallback: copy link button
      '#tts-listen-btn',             // fallback: listen button
    ].join(', '),
    position: 'after',
    style: 'icon',
    css: {
      width: '32px',
      height: '32px',
    },
  },

  async extract() {
    const title =
      document.querySelector('h1')?.textContent?.trim() ||
      Utils.getPageTitle();
    const url = Utils.getCanonicalUrl();

    const metadata = { source: 'Grokipedia', title, url };

    const articleEl =
      document.querySelector('article') ||
      document.querySelector('.article-content') ||
      document.querySelector('.page-content') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('main');

    if (!articleEl) {
      const cleaned = Utils.removeNoise(document.body, Utils.NOISE_SELECTORS);
      const body = Markdown.elementToMarkdown(cleaned);
      return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
    }

    const cleaned = Utils.removeNoise(articleEl, [
      ...Utils.NOISE_SELECTORS,
      '.share-buttons', '.social',
    ]);

    const body = Markdown.elementToMarkdown(cleaned);
    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});
