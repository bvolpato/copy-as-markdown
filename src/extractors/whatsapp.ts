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
    const main = document.querySelector('#main');
    const chatName =
      document.querySelector('#main header [data-testid="conversation-info-header"] span[title]')?.getAttribute('title') ||
      document.querySelector('header [data-testid="conversation-info-header"] span[title]')?.getAttribute('title') ||
      document.querySelector('#main header span[title]')?.getAttribute('title') ||
      'WhatsApp Chat';

    const metadata: Record<string, string | number> = {
      source: 'WhatsApp Web',
      chat: chatName,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [`# WhatsApp: ${chatName}\n`];
    const messageElements = main ? collectWhatsAppMessages(main) : [];
    const messages = limitCollection(messageElements, MAX_MESSAGES);

    if (messages.items.length === 0) {
      parts.push('*No messages found. Make sure a chat is open.*');
    } else {
      let lastDate = '';
      messages.items.forEach((msg) => {
        const dateEl = msg.querySelector('[data-testid="msg-date"], [data-testid="date"], time[datetime]');
        if (dateEl) {
          const date = dateEl.getAttribute('datetime') || dateEl.textContent?.trim() || '';
          if (date && date !== lastDate) { parts.push(`\n### ${date}\n`); lastDate = date; }
        }

        const preamble = msg.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') || '';
        const parsed = preamble.match(/^\[([^\]]+)]\s*([^:]+):/);
        const explicitSender = msg.querySelector('[data-testid="msg-author"] span, [data-testid="msg-author"], [data-testid="author"]')
          ?.textContent?.trim() || parsed?.[2]?.trim() || '';
        const sender = explicitSender || fallbackSender(msg, chatName);
        const time = msg.querySelector('[data-testid="msg-time"], time')?.textContent?.trim()
          || parsed?.[1]?.trim() || '';
        const bodyElement = findWhatsAppBodyElement(msg);
        const body = bodyElement ? Markdown.elementToMarkdown(bodyElement).trim() : '';
        const quote = msg.querySelector('[data-testid="quoted-message-text"], [data-testid="quoted-message"], .quoted-mention, [aria-label*="Quoted message"]')
          ?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const attachment = attachmentLabel(msg);
        const reactions = Array.from(msg.querySelectorAll('[data-testid*="reaction"], [aria-label*="reaction" i]'))
          .map((reaction) => (reaction.getAttribute('aria-label') || reaction.textContent || '').trim())
          .filter((label) => label && !/^(?:react|add reaction|open reactions?)\b/i.test(label));

        if (body || attachment || quote) {
          const s = `**${sender}**`;
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
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

const QUOTED_SELECTOR = '.quoted-mention, [data-testid="quoted-message"], [data-testid="quoted-message-text"], [aria-label*="Quoted message"]';

function collectWhatsAppMessages(main: Element): Element[] {
  const candidates = Array.from(main.querySelectorAll(
    '[data-testid="msg-container"], [data-id][role="row"], .message-in, .message-out',
  ));
  const canonical: Element[] = [];
  const seen = new Set<Element>();
  for (const element of candidates) {
    const root = element.closest('.message-in, .message-out')
      || element.closest('[data-testid="msg-container"]')
      || element;
    if (!main.contains(root) || seen.has(root)) continue;
    seen.add(root);
    canonical.push(root);
  }
  return canonical.filter((element) =>
    !canonical.some((other) => other !== element && other.contains(element)),
  );
}

function fallbackSender(message: Element, chatName: string): string {
  if (message.matches('.message-out') || message.closest('.message-out')) return 'You';
  if (message.matches('.message-in') || message.closest('.message-in')) return chatName || 'Contact';
  return chatName || 'Contact';
}

function findWhatsAppBodyElement(message: Element): Element | null {
  const candidates = Array.from(message.querySelectorAll(
    '[data-testid="msg-text"], .selectable-text, [data-testid="conversation-panel-messages"] [dir="auto"]',
  ));
  return candidates.find((element) => !element.closest(QUOTED_SELECTOR)) || null;
}

function attachmentLabel(message: Element): string {
  if (message.querySelector('[data-testid*="document"], [data-icon="document"]')) return 'Document';
  if (message.querySelector('[data-testid*="audio"], audio')) return 'Audio';
  if (message.querySelector('video, [data-testid*="video"]')) return 'Video';
  const mediaImg = Array.from(message.querySelectorAll<HTMLImageElement>(
    'img[src^="blob:"], img[src*="mmg.whatsapp.net"]',
  )).find((img) =>
    !img.closest('[data-testid*="avatar"], [data-testid*="profile"], [aria-label*="profile" i]')
    && !/(?:avatar|profile)/i.test(img.alt || ''),
  );
  if (mediaImg) return 'Image';
  if (message.querySelector('[data-testid*="sticker"]')) return 'Sticker';
  return '';
}
