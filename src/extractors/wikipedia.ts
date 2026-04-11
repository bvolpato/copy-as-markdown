/**
 * Wikipedia extractor.
 * Anchor: injected as a tab in the "Read | Edit | View history" bar.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Wikipedia',
  matches: [
    '*://*.wikipedia.org/wiki/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#p-views ul, .mw-portlet-views ul',
    position: 'append',
    style: 'tab',
    css: {
      marginLeft: '8px',
      paddingLeft: '8px',
      borderLeft: '1px solid #a2a9b1',
    },
    label: 'Copy as Markdown',
  },

  async extract() {
    const title =
      document.getElementById('firstHeading')?.textContent?.trim() ||
      Utils.getPageTitle();
    const url = Utils.getCanonicalUrl();

    const metadata = {
      source: 'Wikipedia',
      title,
      url,
    };

    const lastMod = document.getElementById('footer-info-lastmod');
    if (lastMod) {
      (metadata as any).last_modified = lastMod.textContent!
        .replace('This page was last edited on ', '')
        .replace(/,.*$/, '')
        .trim();
    }

    const content = document.getElementById('mw-content-text');
    if (!content)
      return Markdown.buildPageMarkdown(metadata, '*No content found.*');

    const cleaned = Utils.removeNoise(content, [
      '.mw-editsection', '.reference', '.reflist', '.refbegin',
      '.navbox', '.sistersitebox', '.mw-authority-control',
      '.noprint', '.mw-empty-elt', '.mw-jump-link',
      '.sidebar', '.hatnote', '.portalbox',
      '.mw-references-wrap', '#coordinates',
      'sup.reference', '.toc', '#toc',
      '.ambox', '.tmbox', '.ombox', '.cmbox', '.fmbox',
      'style', 'script',
    ]);

    const body = Markdown.elementToMarkdown(cleaned);
    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});
