/**
 * Discourse forum extractor (OpenAI, PyTorch, Rust, Hugging Face, Meta, etc.).
 * Uses semantic DOM detection so any hosted or self-hosted Discourse forum works.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function isDiscoursePage(contextDocument: Document = document): boolean {
  const generator = contextDocument.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  const hasGenerator = /discourse/i.test(generator);
  const hasTopicDom = Boolean(
    contextDocument.querySelector('.topic-post .cooked, #topic-title .fancy-title, article[data-post-id] .cooked'),
  );
  if (hasGenerator && hasTopicDom) return true;
  if (hasTopicDom && contextDocument.querySelector('#ember-basic-dropdown-wormhole, .discourse-root, meta[name="discourse_theme_id"]')) {
    return true;
  }
  return false;
}

export const discourseExtractor = register({
  name: 'Discourse',
  matches: [],
  detect: isDiscoursePage,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#topic-title .title-wrapper, #topic-title h1, .topic-title',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const titleEl = document.querySelector('#topic-title .fancy-title, #topic-title h1 a, #topic-title h1, h1');
    const title = Markdown.normalizeWhitespace(titleEl?.textContent || Utils.getPageTitle());
    const category = Markdown.normalizeWhitespace(
      document.querySelector('#topic-title .badge-category__name, #topic-title .category-name')?.textContent || '',
    );
    const tags = Array.from(document.querySelectorAll('#topic-title .discourse-tag, .list-tags .discourse-tag'))
      .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
      .filter(Boolean);

    const metadata: PageMetadata = {
      source: 'Discourse',
      title,
      url: Utils.getCanonicalUrl(),
      category: category || undefined,
      tags: tags.length > 0 ? [...new Set(tags)].join(', ') : undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (category) parts.push(`**Category:** ${category}`);
    if (tags.length > 0) parts.push(`**Tags:** ${[...new Set(tags)].map((t) => `\`${t}\``).join(' ')}`);

    const postEls = Array.from(document.querySelectorAll('.topic-post article[data-post-id], article[data-post-id], .topic-post'));
    const seenPosts = new Set<Element>();
    const uniquePosts = postEls.filter((el) => {
      if (seenPosts.has(el)) return false;
      for (const existing of seenPosts) {
        if (existing.contains(el) || el.contains(existing)) return false;
      }
      seenPosts.add(el);
      return true;
    });

    let renderedCount = 0;
    for (const post of uniquePosts) {
      const cooked = post.querySelector('.cooked');
      if (!cooked) continue;

      const author = Markdown.normalizeWhitespace(
        post.querySelector('.names .username a, .names .first a, .creator a, [data-user-card]')?.textContent || '',
      ) || 'Unknown';
      const dateEl = post.querySelector('.post-date .relative-date, .post-date a, time[datetime]');
      const dateStr = dateEl?.getAttribute('title')
        || dateEl?.getAttribute('datetime')
        || Markdown.normalizeWhitespace(dateEl?.textContent || '');
      const postNumber = post.getAttribute('data-post-number')
        || post.closest('[data-post-number]')?.getAttribute('data-post-number')
        || '';
      const isAccepted = Boolean(post.querySelector('.accepted-answer, .accepted-text, .solved'));

      const cleaned = Utils.removeNoise(cooked, [
        ...Utils.NOISE_SELECTORS,
        '.anchor',
        '.lightbox-wrapper .meta',
        'button',
        '.post-menu-area',
      ]);
      const body = Markdown.elementToMarkdown(cleaned);
      if (!body) continue;

      renderedCount += 1;
      const headingTag = renderedCount === 1 ? '##' : '###';
      const numSuffix = postNumber ? ` (#${postNumber})` : '';
      const solvedBadge = isAccepted ? ' [Accepted Solution]' : '';
      const dateSuffix = dateStr ? ` - ${dateStr}` : '';
      parts.push(`\n${headingTag} ${author}${numSuffix}${dateSuffix}${solvedBadge}\n\n${body}`);
    }

    if (renderedCount === 0) {
      const fallback = document.querySelector('#main-outlet, main') || document.body;
      parts.push('\n' + Markdown.elementToMarkdown(Utils.removeNoise(fallback, Utils.NOISE_SELECTORS)));
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Discourse topic',
      included: renderedCount,
      truncated: limited.truncated,
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
