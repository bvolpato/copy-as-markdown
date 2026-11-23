/**
 * Mastodon / Fediverse extractor.
 * Detects Mastodon instances on any domain via semantic markers.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function isMastodonPage(contextDocument: Document = document): boolean {
  const generator = contextDocument.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  const hasRoot = Boolean(
    contextDocument.querySelector('#mastodon, .detailed-status, .status__content, .public-layout .status'),
  );
  if (!hasRoot) return false;
  if (/mastodon/i.test(generator)) return true;
  return Boolean(contextDocument.querySelector('#mastodon, .detailed-status__wrapper, .status__content__text'));
}

export const mastodonExtractor = register({
  name: 'Mastodon',
  matches: [],
  detect: isMastodonPage,

  async extract() {
    const title = Markdown.normalizeWhitespace(Utils.getPageTitle());
    const metadata: PageMetadata = {
      source: 'Mastodon',
      title,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# ${title}`];
    const detailed = document.querySelector('.detailed-status');
    const statuses = Array.from(document.querySelectorAll('.detailed-status, article .status, .status__wrapper, .entry .status'));
    const seen = new Set<Element>();

    let count = 0;
    for (const status of statuses) {
      if (seen.has(status)) continue;
      let nested = false;
      for (const existing of seen) {
        if (existing.contains(status) || status.contains(existing)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      seen.add(status);

      const contentEl = status.querySelector('.status__content__text, .status__content, .e-content');
      if (!contentEl) continue;
      const author = Markdown.normalizeWhitespace(
        status.querySelector('.display-name__html, .display-name strong, .p-name')?.textContent || '',
      );
      const handle = Markdown.normalizeWhitespace(
        status.querySelector('.display-name__account, .p-nickname')?.textContent || '',
      );
      const timeEl = status.querySelector('time[datetime], .detailed-status__datetime');
      const timestamp = timeEl?.getAttribute('datetime') || Markdown.normalizeWhitespace(timeEl?.textContent || '');
      const body = Markdown.elementToMarkdown(contentEl);
      if (!body) continue;

      count += 1;
      const who = [author, handle].filter(Boolean).join(' ') || 'User';
      const heading = status === detailed ? '##' : '###';
      parts.push(`\n${heading} ${who}${timestamp ? ` (${timestamp})` : ''}\n\n${body}`);
    }

    if (count === 0) {
      const main = document.querySelector('main, #mastodon') || document.body;
      parts.push('\n' + Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS)));
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Mastodon thread',
      included: count,
      truncated: limited.truncated,
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
