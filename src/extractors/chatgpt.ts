/**
 * ChatGPT conversation extractor.
 * Extracts the full conversation from shared AND live ChatGPT pages.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'ChatGPT',
  matches: [
    '*://chatgpt.com/share/*',
    '*://chatgpt.com/c/*',
    '*://chat.openai.com/share/*',
    '*://chat.openai.com/c/*',
  ],

  buttonPlacement: 'anchor',
  anchor: {
    selector: '#conversation-header-actions',
    position: 'overlay',
    style: 'icon',
    css: {
      borderRadius: '8px',
      padding: '8px',
      color: 'var(--text-primary, inherit)',
      opacity: '0.85',
    },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('h1, title');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const modelEl = document.querySelector('[data-message-model-slug]');
    const model = modelEl?.getAttribute('data-message-model-slug') || '';

    const metadata: Record<string, string> = {
      source: 'ChatGPT',
      title,
      url,
    };
    if (model) metadata.model = model;

    const parts: string[] = [`# ${title}\n`];
    if (model) parts.push(`**Model:** ${model}\n`);

    // Each conversation turn is a <section data-testid="conversation-turn-N">
    const turns = document.querySelectorAll('section[data-testid^="conversation-turn-"]');

    if (turns.length > 0) {
      turns.forEach(turn => {
        const turnType = turn.getAttribute('data-turn');
        const isUser = turnType === 'user';
        const isAssistant = turnType === 'assistant';
        const roleLabel = isUser ? '👤 User' : isAssistant ? '🤖 Assistant' : 'System';

        // Extract content: try markdown first, then user message bubbles, then images
        const markdownEl = turn.querySelector('.markdown');
        const userTextEl = turn.querySelector('.whitespace-pre-wrap');

        // Check for generated images
        const images = turn.querySelectorAll('img[alt]:not([aria-hidden])');
        const meaningfulImages: { alt: string; src: string }[] = [];
        images.forEach(img => {
          const alt = img.getAttribute('alt') || '';
          const src = img.getAttribute('src') || '';
          // Skip tiny favicons/icons, only keep content images
          const w = parseInt(img.getAttribute('width') || '0', 10);
          if (alt && src && w > 100) {
            meaningfulImages.push({ alt, src });
          }
        });

        if (markdownEl || userTextEl || meaningfulImages.length > 0) {
          parts.push(`## ${roleLabel}\n`);

          if (meaningfulImages.length > 0) {
            meaningfulImages.forEach(img => {
              parts.push(`![${img.alt}](${img.src})\n`);
            });
          }

          if (markdownEl) {
            parts.push(Markdown.elementToMarkdown(markdownEl));
          } else if (userTextEl) {
            parts.push(userTextEl.textContent?.trim() || '');
          }

          parts.push('');
        }
      });
    } else {
      // Fallback for shared links or older UI
      const msgDivs = document.querySelectorAll('[data-message-author-role]');
      if (msgDivs.length > 0) {
        msgDivs.forEach(div => {
          const role = div.getAttribute('data-message-author-role') || '';
          const roleLabel = role === 'user' ? '👤 User' : role === 'assistant' ? '🤖 Assistant' : 'System';
          const contentEl = div.querySelector('.markdown, .whitespace-pre-wrap, [class*="markdown"]');
          if (contentEl) {
            parts.push(`## ${roleLabel}\n`);
            parts.push(Markdown.elementToMarkdown(contentEl));
            parts.push('');
          }
        });
      } else {
        const container = document.querySelector('[class*="thread"], main');
        if (container) {
          parts.push(Markdown.elementToMarkdown(container));
        }
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
