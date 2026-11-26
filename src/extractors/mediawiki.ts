/**
 * Generic MediaWiki extractor (ArchWiki, Fandom, Wikimedia sister projects, company wikis).
 * Wikipedia is matched first by URL; this covers all other MediaWiki installations via detect().
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import { prepareWikiContent } from '../core/wiki-content';
import type { PageMetadata } from '../core/types';

function isMediaWikiPage(contextDocument: Document = document): boolean {
  const generator = contextDocument.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  const hasContent = Boolean(contextDocument.querySelector('#mw-content-text .mw-parser-output, #mw-content-text'));
  if (!hasContent) return false;
  if (/mediawiki/i.test(generator)) return true;
  return Boolean(
    contextDocument.querySelector('#firstHeading, .mw-body-content')
    && contextDocument.querySelector('#p-views, #mw-navigation, .mw-wiki-logo, body.mediawiki'),
  );
}

export const mediawikiExtractor = register({
  name: 'MediaWiki',
  matches: [],
  detect: isMediaWikiPage,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#firstHeading, #p-views ul, .mw-portlet-views ul, .page-header__title',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const titleEl = document.querySelector('#firstHeading, .mw-first-heading, .page-header__title, h1');
    const title = Markdown.normalizeWhitespace(titleEl?.textContent || Utils.getPageTitle());
    const siteName = Utils.getMeta('site_name') || window.location.hostname;

    const metadata: PageMetadata = {
      source: siteName,
      title,
      url: Utils.getCanonicalUrl(),
    };

    const contentEl = document.querySelector('#mw-content-text .mw-parser-output')
      || document.querySelector('#mw-content-text')
      || document.querySelector('.mw-body-content');

    const parts: string[] = [`# ${title}`];
    if (contentEl) {
      const cleaned = Utils.removeNoise(prepareWikiContent(contentEl), [
        ...Utils.NOISE_SELECTORS,
        '.mw-editsection',
        '.navbox',
        '.navbox-styles',
        '.vertical-navbox',
        '.sistersitebox',
        '.toc',
        '#toc',
        '.mw-empty-elt',
        '.noprint',
        '.mw-jump-link',
        '.mw-cite-backlink',
        '.mw-indicators',
        '.catlinks',
        '.printfooter',
        '.mwe-math-mathml-inline',
        '.mwe-math-mathml-display',
        '.mbox-small',
        '.ambox',
        '.fandom-community-header',
        '.page-footer',
      ]);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered MediaWiki article',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
