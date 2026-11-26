/**
 * Outlook on the Web (Microsoft 365 / Outlook.com) email thread extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

export const outlookExtractor = register({
  name: 'Outlook Web',
  matches: [
    '*://outlook.office.com/mail/*',
    '*://outlook.office365.com/mail/*',
    '*://outlook.live.com/mail/*',
    '*://outlook.cloud.microsoft/mail/*',
  ],

  async extract() {
    const isVisible = Utils.createVisibilityChecker();
    const readingPane = document.querySelector('[aria-label="Reading Pane"], [data-app-section="ConversationContainer"], [role="main"]');
    const scope = readingPane || document;

    const subject = Markdown.normalizeWhitespace(
      scope.querySelector('[role="heading"][aria-level="2"], [data-testid="conversation-subject"], .allowTextSelection[role="heading"], h1')?.textContent
        || Utils.getPageTitle(),
    );

    const metadata: PageMetadata = {
      source: 'Outlook Web',
      title: subject,
      url: window.location.href,
    };

    const parts: string[] = [`# ${subject}`];
    const messageContainers = Array.from(scope.querySelectorAll('[aria-label="Email message"], [data-testid="message-body-container"], .wide-content-host'))
      .filter((el) => isVisible(el));

    const seen = new Set<Element>();
    let messageCount = 0;

    for (const container of messageContainers) {
      if (seen.has(container)) continue;
      let nested = false;
      for (const existing of seen) {
        if (existing.contains(container) || container.contains(existing)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      seen.add(container);

      const sender = Markdown.normalizeWhitespace(
        container.querySelector('[aria-label^="From:"], .OZZZK, [data-testid="sender-name"]')?.textContent || '',
      ) || 'Sender';
      const date = Markdown.normalizeWhitespace(
        container.querySelector('[data-testid="SentReceivedSavedTime"], time')?.textContent || '',
      );
      const bodyEl = container.querySelector('[aria-label="Message body"], .UniqueMessageBody, [id^="UniqueMessageBody"]') || container;
      const cleaned = Utils.removeNoise(bodyEl, [...Utils.NOISE_SELECTORS, 'button', '[role="toolbar"]']);
      const body = Markdown.elementToMarkdown(cleaned);
      if (!body) continue;

      messageCount += 1;
      parts.push(`\n## ${sender}${date ? ` (${date})` : ''}\n\n${body}`);
    }

    if (messageCount === 0 && readingPane) {
      const cleaned = Utils.removeNoise(readingPane, [...Utils.NOISE_SELECTORS, 'button', '[role="toolbar"]']);
      const body = Markdown.elementToMarkdown(cleaned);
      if (body) parts.push('\n' + body);
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Outlook reading pane',
      included: messageCount,
      truncated: limited.truncated,
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
