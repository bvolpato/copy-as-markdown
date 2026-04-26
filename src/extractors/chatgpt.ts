/**
 * ChatGPT shared conversation extractor.
 * Extracts the full conversation from shared ChatGPT links.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'ChatGPT',
  matches: [
    '*://chatgpt.com/share/*',
    '*://chat.openai.com/share/*',
  ],

  async extract() {
    const url = Utils.getCanonicalUrl();

    // Title from the page or first user message
    const titleEl = document.querySelector('h1, title');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    // Model info
    const modelEl = document.querySelector('[class*="model"], .text-token-text-secondary');
    const model = modelEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = {
      source: 'ChatGPT (Shared Conversation)',
      title,
      url,
    };
    if (model) metadata.model = model;

    const parts: string[] = [`# ${title}\n`];
    if (model) parts.push(`**Model:** ${model}\n`);

    // Extract conversation turns
    const turns = document.querySelectorAll('[data-message-author-role], [class*="agent-turn"], [class*="human-turn"], .group\\/conversation-turn');

    if (turns.length > 0) {
      turns.forEach(turn => {
        const role = turn.getAttribute('data-message-author-role') || '';
        const isUser = role === 'user' || turn.className.includes('human') || !!turn.querySelector('[data-message-author-role="user"]');
        const isAssistant = role === 'assistant' || turn.className.includes('agent') || !!turn.querySelector('[data-message-author-role="assistant"]');

        const roleLabel = isUser ? '👤 User' : isAssistant ? '🤖 Assistant' : 'System';

        const contentEl = turn.querySelector('.markdown, .whitespace-pre-wrap, [class*="markdown"]');
        if (contentEl) {
          parts.push(`## ${roleLabel}\n`);
          parts.push(Markdown.elementToMarkdown(contentEl));
          parts.push('');
        }
      });
    } else {
      // Fallback: try to find any conversation container
      const container = document.querySelector('[class*="thread"], main, .flex.flex-col');
      if (container) {
        parts.push(Markdown.elementToMarkdown(container));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
