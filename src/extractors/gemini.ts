/**
 * Google Gemini conversation extractor.
 * Extracts the full conversation from Gemini (gemini.google.com) pages.
 * Supports /app/*, /chat/*, /spark/chat/* URLs.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Gemini',
  matches: [
    '*://gemini.google.com/*',
  ],
  regex: /^https?:\/\/gemini\.google\.com\/(app|chat|gem|spark)/,

  async extract() {
    const url = Utils.getCanonicalUrl();
    const title = Utils.getPageTitle() || 'Gemini Conversation';

    const metadata: Record<string, string> = {
      source: 'Gemini',
      title,
      url,
    };

    const parts: string[] = [`# ${title}\n`];

    // Each conversation turn is a .conversation-container div
    const containers = document.querySelectorAll('.conversation-container');

    if (containers.length > 0) {
      containers.forEach(container => {
        // User message: <user-query> with .query-text-line paragraphs
        const userQuery = container.querySelector('user-query');
        if (userQuery) {
          const queryLines = userQuery.querySelectorAll('.query-text-line');
          let userText = '';
          if (queryLines.length > 0) {
            userText = Array.from(queryLines)
              .map(p => p.textContent?.trim() || '')
              .filter(t => t.length > 0)
              .join('\n');
          } else {
            const queryEl = userQuery.querySelector('.query-text');
            userText = queryEl?.textContent?.trim() || '';
          }
          if (userText) {
            parts.push(`## 👤 User\n`);
            parts.push(userText);
            parts.push('');
          }
        }

        // Model response: <model-response> with .markdown.markdown-main-panel
        const modelResponse = container.querySelector('model-response');
        if (modelResponse) {
          const markdownEl = modelResponse.querySelector('.markdown.markdown-main-panel');
          if (markdownEl) {
            parts.push(`## 🤖 Gemini\n`);
            parts.push(Markdown.elementToMarkdown(markdownEl));
            parts.push('');
          }
        }
      });
    } else {
      // Fallback: try older DOM structure with conversation-turn
      const turns = document.querySelectorAll('conversation-turn, .conversation-turn');
      if (turns.length > 0) {
        turns.forEach(turn => {
          const hasUserQuery = !!turn.querySelector('user-query, .user-query, .query-text');
          const roleLabel = hasUserQuery ? '👤 User' : '🤖 Gemini';
          const contentEl = turn.querySelector(
            '.markdown.markdown-main-panel, .query-text, model-response .markdown'
          ) || turn;
          const content = Markdown.elementToMarkdown(contentEl);
          if (content.trim()) {
            parts.push(`## ${roleLabel}\n`);
            parts.push(content);
            parts.push('');
          }
        });
      } else {
        // Last resort: grab main content
        const main = document.querySelector('#chat-history, main, [role="main"]') || document.body;
        parts.push(Markdown.elementToMarkdown(main));
      }
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
