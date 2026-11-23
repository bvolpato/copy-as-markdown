/**
 * Sentry issue, stacktrace, tags, and breadcrumbs extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const sentryExtractor = register({
  name: 'Sentry',
  matches: [
    '*://*.sentry.io/issues/*',
    '*://sentry.io/organizations/*/issues/*',
  ],
  pathnameRegex: /^\/(?:organizations\/[^/]+\/)?issues\/\d+/i,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-test-id="group-header"] h1, [data-test-id="issue-header"] h1, main h1',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '10px' },
  },

  async extract() {
    const title = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="group-header"] h1, [data-test-id="issue-title"], main h1, h1')?.textContent
        || Utils.getPageTitle().replace(/\s*—\s*Sentry$/i, '').replace(/\s*-\s*Sentry$/i, ''),
    );
    const subtitle = Markdown.normalizeWhitespace(
      document.querySelector('[data-test-id="event-message"], [data-test-id="group-header"] [class*="Message"]')?.textContent || '',
    );

    const metadata: PageMetadata = {
      source: 'Sentry',
      title,
      url: window.location.href,
    };

    const parts: string[] = [`# ${title}`];
    if (subtitle && subtitle !== title) parts.push(`\n> ${subtitle}`);

    const tags = Array.from(document.querySelectorAll('[data-test-id="tag-pill"], [data-test-id="event-tags"] li, .tags li'))
      .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
      .filter(Boolean);
    if (tags.length > 0) {
      parts.push('\n## Tags\n\n' + [...new Set(tags)].map((t) => `- ${t}`).join('\n'));
    }

    const frames = Array.from(document.querySelectorAll('[data-test-id="frame"], .traceback li.frame, ul.traceback > li'));
    if (frames.length > 0) {
      parts.push('\n## Stack Trace\n');
      const traceLines: string[] = [];
      for (const frame of frames) {
        const line = Markdown.normalizeWhitespace(frame.querySelector('.title, [data-test-id="frame-title"]')?.textContent || frame.textContent || '');
        if (line) traceLines.push(line);
      }
      if (traceLines.length > 0) {
        parts.push(Markdown.fencedCodeToMarkdown(traceLines.join('\n'), 'text'));
      }
    }

    const breadcrumbs = document.querySelector('[data-test-id="event-section-breadcrumbs"], [data-test-id="breadcrumbs"]');
    if (breadcrumbs) {
      const cleaned = Utils.removeNoise(breadcrumbs, [...Utils.NOISE_SELECTORS, 'button', 'input']);
      const crumbsMd = Markdown.elementToMarkdown(cleaned);
      if (crumbsMd) parts.push('\n## Breadcrumbs\n\n' + crumbsMd);
    }

    if (parts.length <= 2) {
      const main = document.querySelector('[data-test-id="issue-details"], main') || document.body;
      parts.push('\n' + Markdown.elementToMarkdown(Utils.removeNoise(main, [...Utils.NOISE_SELECTORS, 'button'])));
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Sentry issue',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
