/**
 * WhatsApp Web extractor.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_MESSAGES = 500;

register({
  name: 'WhatsApp',
  matches: ['*://web.whatsapp.com/*'],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#main header [data-testid="chat-header-actions"], #main header',
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const chatName =
      document.querySelector('header [data-testid="conversation-info-header"] span[title]')?.getAttribute('title') ||
      document.querySelector('#main header span[title]')?.getAttribute('title') ||
      'WhatsApp Chat';

    const metadata: Record<string, string | number> = {
      source: 'WhatsApp Web',
      chat: chatName,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# WhatsApp: ${chatName}\n`];

    const messages = limitCollection(document.querySelectorAll(
      '[data-testid="msg-container"], [data-id][role="row"], .message-in, .message-out',
    ), MAX_MESSAGES);

    if (messages.items.length === 0) {
      parts.push('*No messages found. Make sure a chat is open.*');
    } else {
      let lastDate = '';
      messages.items.forEach((msg) => {
        const dateEl = msg.querySelector('[data-testid="msg-date"], [data-testid="date"], time[datetime]');
        if (dateEl) {
          const date = dateEl.getAttribute('datetime') || dateEl.textContent?.trim() || '';
          if (date !== lastDate) { parts.push(`\n### ${date}\n`); lastDate = date; }
        }

        const preamble = msg.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
        const parsed = preamble.match(/^\[([^\]]+)]\s*([^:]+):/);
        const sender = msg.querySelector('[data-testid="msg-author"] span, [data-testid="msg-author"], [data-testid="author"]')
          ?.textContent?.trim() || parsed?.[2]?.trim() || '';
        const time = msg.querySelector('[data-testid="msg-time"], time')?.textContent?.trim()
          || parsed?.[1]?.trim() || '';
        const bodyElement = msg.querySelector('[data-testid="msg-text"], .selectable-text, [data-testid="conversation-panel-messages"] [dir="auto"]');
        const body = bodyElement ? Markdown.elementToMarkdown(bodyElement).trim() : '';
        const quote = msg.querySelector('[data-testid="quoted-message-text"], [data-testid="quoted-message"], [aria-label*="Quoted message"]')
          ?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const attachment = attachmentLabel(msg);
        const reactions = Array.from(msg.querySelectorAll('[data-testid*="reaction"], [aria-label*="reaction" i]'))
          .map((reaction) => reaction.getAttribute('aria-label') || reaction.textContent?.trim() || '')
          .filter(Boolean);

        if (body || attachment || quote) {
          const s = sender ? `**${sender}**` : '**You**';
          const t = time ? ` (${time})` : '';
          parts.push(`${s}${t}:`);
          if (quote) parts.push(`> Replying to: ${quote}`);
          if (body) parts.push(body);
          if (attachment) parts.push(`📎 *[${attachment}]*`);
          if (reactions.length) parts.push(`Reactions: ${[...new Set(reactions)].join(', ')}`);
          parts.push('');
        }
      });
    }

    metadata.messages = messages.items.length;
    const output = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'WhatsApp rendered chat DOM',
      total: messages.total,
      included: messages.items.length,
      truncated: messages.truncated || output.truncated,
      complete: messages.items.length > 0 && !messages.truncated && !output.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

function attachmentLabel(message: Element): string {
  if (message.querySelector('[data-testid*="document"], [data-icon="document"]')) return 'Document';
  if (message.querySelector('[data-testid*="audio"], audio')) return 'Audio';
  if (message.querySelector('video, [data-testid*="video"]')) return 'Video';
  if (message.querySelector('img[src^="blob:"], img[src*="mmg.whatsapp.net"]')) return 'Image';
  if (message.querySelector('[data-testid*="sticker"]')) return 'Sticker';
  return '';
}
