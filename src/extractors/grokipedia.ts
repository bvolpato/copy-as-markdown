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
    selector: 'header nav, header .actions, header',
    position: 'append',
    style: 'pill',
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
