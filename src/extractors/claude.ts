/**
 * Claude.ai conversation extractor.
 * Extracts the full conversation from Claude.ai chat pages.
 *
 * DOM structure (2025):
 *   [role="article"] = each message
 *     [data-user-message-bubble] > [data-testid="user-message"] = user text
 *     .standard-markdown / .progressive-markdown = assistant response
 *     h2.sr-only[data-find-omitted] = screen reader duplicate (skip)
 *     [data-message-action-bar] = action buttons (skip)
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Claude',
  matches: [
    '*://claude.ai/chat/*',
  ],

  buttonPlacement: 'anchor',
  anchor: {
    selector: '[data-testid="wiggle-controls-actions"]',
    position: 'overlay',
    style: 'icon',
    css: {
      borderRadius: '8px',
      padding: '8px',
    },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const title = Utils.getPageTitle() || 'Claude Conversation';

    const metadata: Record<string, string> = {
      source: 'Claude',
      title,
      url,
    };

    const parts: string[] = [`# ${title}\n`];

    // Each conversation turn is a [role="article"] element
    const articles = document.querySelectorAll('[role="article"]');

    if (articles.length > 0) {
      for (const article of articles) {
        // Determine role
        const userMsg = article.querySelector('[data-testid="user-message"]');
        if (userMsg) {
          // User turn: extract just the user message text
          parts.push(`## 👤 User\n`);
          parts.push(Markdown.elementToMarkdown(userMsg));
          parts.push('');
          continue;
        }

        // Assistant turn: find the markdown content container
        const markdownEl = article.querySelector(
          '.standard-markdown, .progressive-markdown'
        );

        if (markdownEl) {
          parts.push(`## 🤖 Claude\n`);

          // Also grab images from the response (web search image grids)
          const imageGrid = article.querySelector('[data-find-omitted] .grid');
          if (imageGrid) {
            const imgs = imageGrid.querySelectorAll('img[src]');
            for (const img of imgs) {
              const src = img.getAttribute('src') || '';
              const alt = img.getAttribute('alt') || '';
              if (src && !src.startsWith('data:')) {
                parts.push(`![${alt}](${src})`);
              }
            }
            parts.push('');
          }

          parts.push(Markdown.elementToMarkdown(markdownEl));
          parts.push('');
        }
      }
    } else {
      // Fallback: grab main content area
      const main = document.querySelector('[data-autoscroll-container]')
        || document.querySelector('main')
        || document.body;
      parts.push(Markdown.elementToMarkdown(main));
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
