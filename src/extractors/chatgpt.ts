/**
 * ChatGPT conversation extractor.
 * Extracts the full conversation from shared AND live ChatGPT pages.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

function getImageSource(img: HTMLImageElement): string {
  return img.currentSrc || img.src || img.getAttribute('src') || '';
}

function getStandaloneImages(turn: Element, contentEl: Element | null): string[] {
  const seenSources = new Set(
    contentEl
      ? Array.from(contentEl.querySelectorAll<HTMLImageElement>('img[src]'))
          .map(getImageSource)
          .filter(Boolean)
      : [],
  );
  const images: string[] = [];

  turn.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
    if (contentEl?.contains(img) || img.getAttribute('aria-hidden') === 'true') return;

    const src = getImageSource(img);
    if (!src || seenSources.has(src)) return;

    const rect = img.getBoundingClientRect();
    const width = Math.max(img.naturalWidth, img.width, rect.width);
    const height = Math.max(img.naturalHeight, img.height, rect.height);
    const alt = img.getAttribute('alt') || '';
    const imageContainer = img.closest('figure, [data-testid*="image"], [class*="image"]');
    const looksGenerated = /generated image|image generated/i.test(alt);

    if (Math.max(width, height) < 100 && !imageContainer && !looksGenerated) return;

    seenSources.add(src);
    images.push(`![${alt.replace(/]/g, '\\]')}](${src})`);
  });

  return images;
}

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

        // Extract content: try markdown first, then user message bubbles.
        const markdownEl = turn.querySelector('.markdown');
        const userTextEl = turn.querySelector('.whitespace-pre-wrap');
        const contentEl = markdownEl || userTextEl;
        // Images within contentEl are already converted by elementToMarkdown.
        const standaloneImages = getStandaloneImages(turn, contentEl);

        if (contentEl || standaloneImages.length > 0) {
          parts.push(`## ${roleLabel}\n`);

          if (standaloneImages.length > 0) {
            parts.push(standaloneImages.join('\n'));
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
