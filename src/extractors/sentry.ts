/**
 * Sentry issue, stacktrace, tags, and breadcrumbs extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function isSelfHostedSentryIssue(contextDocument: Document = document): boolean {
  if (!contextDocument.querySelector('[data-test-id="group-header"], [data-test-id="issue-details"], [data-test-id="event-section-breadcrumbs"]')) {
    return false;
  }
  const href = contextDocument.location?.href || contextDocument.baseURI || '';
  return /\/(?:organizations\/[^/]+\/)?issues\/\d+/i.test(href) || /\bsentry\b/i.test(contextDocument.title || '');
}

export const sentryExtractor = register({
  name: 'Sentry',
  matches: [
    '*://*.sentry.io/issues/*',
    '*://*.sentry.io/organizations/*/issues/*',
    '*://sentry.io/organizations/*/issues/*',
  ],
  pathnameRegex: /^\/(?:organizations\/[^/]+\/)?issues\/\d+/i,
  detect: isSelfHostedSentryIssue,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-test-id="group-header"] h1, [data-test-id="issue-header"] h1, main h1',
    position: 'overlay',
    style: 'pill',
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

    let hasTrace = false;
    const frames = Array.from(document.querySelectorAll('[data-test-id="frame"], .traceback li.frame, ul.traceback > li'));
    if (frames.length > 0) {
      const traceLines: string[] = [];
      for (const frame of frames) {
        const titleEl = frame.querySelector('.title, [data-test-id="frame-title"]');
        const cleanedFrame = titleEl || Utils.removeNoise(frame, ['button', 'svg', '[aria-hidden="true"]']);
        const line = Markdown.normalizeWhitespace(cleanedFrame.textContent || '');
        if (line) traceLines.push(line);
      }
      if (traceLines.length > 0) {
        hasTrace = true;
        parts.push('\n## Stack Trace\n');
        parts.push(Markdown.fencedCodeToMarkdown(traceLines.join('\n'), 'text'));
      }
    }

    let hasBreadcrumbs = false;
    const breadcrumbs = document.querySelector('[data-test-id="event-section-breadcrumbs"], [data-test-id="breadcrumbs"]');
    if (breadcrumbs) {
      const cleaned = Utils.removeNoise(breadcrumbs, [...Utils.NOISE_SELECTORS, 'button', 'input']);
      const crumbsMd = Markdown.elementToMarkdown(cleaned);
      if (crumbsMd) {
        hasBreadcrumbs = true;
        parts.push('\n## Breadcrumbs\n\n' + crumbsMd);
      }
    }

    if (!hasTrace && !hasBreadcrumbs) {
      const main = document.querySelector('[data-test-id="issue-details"], main') || document.body;
      if (main) {
        const cleaned = Utils.removeNoise(main, [...Utils.NOISE_SELECTORS, 'button', '[data-test-id="group-header"] h1', '[data-test-id="issue-title"]']);
        const fallbackMd = Markdown.elementToMarkdown(cleaned);
        if (fallbackMd) parts.push('\n' + fallbackMd);
      }
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
