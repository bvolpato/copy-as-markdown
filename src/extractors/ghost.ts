/**
 * Ghost CMS & Obsidian Publish extractor.
 * Detects Ghost blogs and Obsidian Publish digital gardens on custom domains.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function detectPublishingPlatform(contextDocument: Document = document): 'ghost' | 'obsidian' | null {
  const generator = contextDocument.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  if (/^ghost\b/i.test(generator) && contextDocument.querySelector('.gh-content, article.post, .post-content')) {
    return 'ghost';
  }
  if (
    contextDocument.querySelector('.gh-content')
    && contextDocument.querySelector('.kg-canvas, .gh-foot, .gh-article, .gh-article-header, .gh-article-title, .gh-head, .gh-canvas')
  ) {
    return 'ghost';
  }
  if (contextDocument.querySelector('.obsidian-document, .publish-renderer .markdown-preview-view, .site-body-center-column .markdown-preview-view')) {
    return 'obsidian';
  }
  return null;
}

export const ghostExtractor = register({
  name: 'Ghost / Obsidian Publish',
  matches: [],
  detect: (contextDocument) => detectPublishingPlatform(contextDocument) !== null,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '.gh-article-header h1, .post-full-title, .page-header, article h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const platform = detectPublishingPlatform(document) || 'ghost';
    const title = Markdown.normalizeWhitespace(
      document.querySelector('.gh-article-title, .post-full-title, .page-header, article h1, h1')?.textContent
        || Utils.getPageTitle(),
    );
    const author = Markdown.normalizeWhitespace(
      document.querySelector('.gh-article-author-name, .author-name, meta[name="author"]')?.textContent
        || Utils.getMeta('author')
        || '',
    );
    const dateEl = document.querySelector('time[datetime], .gh-article-date');
    const published = dateEl?.getAttribute('datetime') || Markdown.normalizeWhitespace(dateEl?.textContent || '');

    const metadata: PageMetadata = {
      source: platform === 'obsidian' ? 'Obsidian Publish' : 'Ghost',
      title,
      url: Utils.getCanonicalUrl(),
      author: author || undefined,
      published: published ? Utils.formatDate(published) : undefined,
    };

    const bodyEl = platform === 'obsidian'
      ? document.querySelector('.publish-renderer .markdown-preview-sizer, .markdown-preview-view, .obsidian-document')
      : document.querySelector('.gh-content, .post-content, article');

    const parts: string[] = [`# ${title}`];
    if (author) parts.push(`**Author:** ${author}`);
    if (published) parts.push(`**Published:** ${Utils.formatDate(published)}`);

    if (bodyEl) {
      const cleaned = Utils.removeNoise(bodyEl, [
        ...Utils.NOISE_SELECTORS,
        'h1',
        '.gh-post-upgrade-cta',
        '.kg-signup-card',
        '.frontmatter-container',
        '.copy-code-button',
        'button',
      ]);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: platform === 'obsidian' ? 'Obsidian Publish page' : 'Ghost article',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
