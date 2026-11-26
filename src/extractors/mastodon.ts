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

/** Attached images and videos, with their alternative text. */
function attachmentsToMarkdown(status: Element): string[] {
  return Array.from(status.querySelectorAll<HTMLImageElement | HTMLVideoElement>('.media-gallery img, .media-gallery video, .video-player video'))
    .filter((item) => !item.closest('.status__quote'))
    .map((item) => {
      if (item instanceof HTMLImageElement) return Markdown.elementToMarkdown(item).trim();
      const label = Markdown.escapeMarkdownLinkText(Markdown.normalizeWhitespace(item.getAttribute('aria-label') || '') || 'Video');
      return /^https?:/.test(item.src) ? `[${label}](${item.src})` : '';
    })
    .filter(Boolean);
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
    const detailed = document.querySelector('.detailed-status, article[data-variant="page"]');
    // Mastodon 5 uses article[data-variant] and CSS module names such as _comp_status_content__text.
    const statuses = Array.from(document.querySelectorAll(
      '.detailed-status, article .status, .status__wrapper, .entry .status, article[data-variant]',
    ));
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

      const contentEl = status.querySelector('.status__content__text, .status__content, .e-content, [class*="status_content__text"]');
      // Off-screen statuses collapse to spans that hold the author name and the HTML source.
      const spans = Array.from(status.children);
      const collapsed = !contentEl && spans.length > 1 && spans.every((child) => child.tagName === 'SPAN');
      const attachments = attachmentsToMarkdown(status);
      if (!contentEl && !collapsed && attachments.length === 0) continue;
      const author = Markdown.normalizeWhitespace(
        (collapsed ? spans[0] : status.querySelector('.display-name__html, .display-name strong, .p-name'))?.textContent || '',
      );
      const handle = Markdown.normalizeWhitespace(
        status.querySelector('.display-name__account, .p-nickname, [class*="status_header__handle"]')?.textContent || '',
      );
      const timeEl = status.querySelector('time[datetime], .detailed-status__datetime');
      const timestamp = timeEl?.getAttribute('datetime') || Markdown.normalizeWhitespace(timeEl?.textContent || '');
      const text = contentEl
        ? Markdown.elementToMarkdown(contentEl)
        : collapsed ? Markdown.htmlToMarkdown(spans[spans.length - 1].textContent || '') : '';
      const body = [text, ...attachments].filter(Boolean).join('\n\n');
      if (!body) continue;

      count += 1;
      const who = [author, handle].filter(Boolean).join(' ') || 'User';
      const heading = status === detailed ? '##' : '###';
      parts.push(`\n${heading} ${who}${timestamp ? ` (${timestamp})` : ''}\n\n${body}`);
    }

    if (count > 0 && !detailed) {
      const profile = document.querySelectorAll(
        '[class*="account_header"] [class*="account_bio__bio"], [class*="account_header__fieldList"], .account__header__content, .account__header__fields',
      );
      parts.splice(1, 0, ...Array.from(profile, (part) => '\n' + Markdown.elementToMarkdown(part)));
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
