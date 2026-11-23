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
    '*://*.wikipedia.org/w/index.php?*title=*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#p-views ul, .mw-portlet-views ul, #page-actions',
    position: 'append',
    style: 'tab',
    wrapperTag: 'li',
    wrapperClass: 'vector-tab-noicon mw-list-item',
    wrapperCss: {
      marginLeft: '8px',
      paddingLeft: '8px',
      borderLeft: '1px solid #a2a9b1',
    },
    css: {
      paddingTop: '12px',
      paddingBottom: '7px',
      marginBottom: '-1px',
    },
    label: 'Copy as Markdown',
  },

  async extract() {
    const title =
      document.getElementById('firstHeading')?.textContent?.trim() ||
      Utils.getPageTitle();
    const url = Utils.getCanonicalUrl();

    const metadata: Record<string, string> = {
      source: 'Wikipedia',
      title,
      url,
    };

    const lastMod =
      document.getElementById('footer-info-lastmod')
      || document.querySelector('.last-modified-bar');
    if (lastMod) {
      const formatted = extractLastModified(lastMod);
      if (formatted) metadata.last_modified = formatted;
    }

    const content = document.getElementById('mw-content-text');
    if (!content) {
      return Markdown.buildPageMarkdown(metadata, '*No content found.*');
    }

    const cleaned = Utils.removeNoise(content, [
      '.mw-editsection',
      '.navbox', '.sistersitebox', '.mw-authority-control',
      '.noprint', '.mw-empty-elt', '.mw-jump-link',
      '.sidebar', '.hatnote', '.portalbox',
      '.toc', '#toc',
      '.ambox', '.tmbox', '.ombox', '.cmbox', '.fmbox',
      '.mwe-math-mathml-inline', '.mwe-math-mathml-display',
      '.mw-cite-backlink', '.mw-indicators', '.catlinks', '.printfooter',
      'style', 'script',
    ]);

    const body = Markdown.elementToMarkdown(cleaned);
    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});

function extractLastModified(element: Element): string {
  const timestamp = element.getAttribute('data-timestamp')
    || element.querySelector('time[datetime]')?.getAttribute('datetime');
  if (timestamp) {
    const trimmed = timestamp.trim();
    if (/^\d{10,13}$/.test(trimmed)) {
      const ms = trimmed.length === 10 ? Number(trimmed) * 1000 : Number(trimmed);
      return Utils.formatDate(new Date(ms).toISOString());
    }
    return Utils.formatDate(trimmed);
  }

  const raw = (element.textContent || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (/^This page was last edited on\s+/i.test(raw)) {
    return raw
      .replace(/^This page was last edited on\s+/i, '')
      .replace(/,.*$/, '')
      .trim();
  }
  return raw;
}
