/**
 * WhatsApp Web extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'WhatsApp',
  matches: ['*://web.whatsapp.com/*'],
  anchor: {
    selector: '#main header [data-testid="chat-header-actions"], #main header',
    position: 'prepend',
    style: 'icon',
  },

  async extract() {
    const chatName =
      document.querySelector('header [data-testid="conversation-info-header"] span[title]')?.getAttribute('title') ||
      document.querySelector('#main header span[title]')?.getAttribute('title') ||
      'WhatsApp Chat';

    const metadata = {
      source: 'WhatsApp Web', chat: chatName,
      exported_at: new Date().toISOString(),
      url: 'https://web.whatsapp.com',
    };

    const parts: string[] = [`# WhatsApp: ${chatName}\n`];

    const messages = document.querySelectorAll(
      '[data-testid="msg-container"], .message-in, .message-out',
    );

    if (messages.length === 0) {
      parts.push('*No messages found. Make sure a chat is open.*');
    } else {
      let lastDate = '';
      messages.forEach((msg) => {
        const dateEl = msg.querySelector('[data-testid="msg-date"]');
        if (dateEl) {
          const date = dateEl.textContent!.trim();
          if (date !== lastDate) { parts.push(`\n### ${date}\n`); lastDate = date; }
        }

        const sender = msg.querySelector('[data-testid="msg-author"] span')?.textContent?.trim() || '';
        const time = msg.querySelector('[data-testid="msg-time"]')?.textContent?.trim() || '';
        const body = msg.querySelector('[data-testid="msg-text"] span')?.textContent?.trim() || '';
        const hasMedia = !!msg.querySelector('img[src*="blob:"]');

        if (body || hasMedia) {
          const s = sender ? `**${sender}**` : '**You**';
          const t = time ? ` (${time})` : '';
          const m = hasMedia ? ' 📎 *[Media]*' : '';
          parts.push(`${s}${t}: ${body}${m}`);
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
