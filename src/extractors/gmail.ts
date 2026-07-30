/**
 * Gmail thread extractor.
 * Uses Gmail's authenticated print view so collapsed messages are included.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import { addExtractionMetadata, limitMarkdown } from '../core/context';

type GmailMessage = {
  sender: string;
  recipients: string;
  date: string;
  body: string;
  attachments: string[];
};

register({
  name: 'Gmail',
  matches: ['*://mail.google.com/mail/*'],

  async extract() {
    const threadId = getThreadId();
    const liveTitle = getLiveThreadTitle();
    const metadata: Record<string, string> = {
      source: 'Gmail',
      url: window.location.href,
      type: 'Gmail Thread',
    };
    if (threadId) metadata.thread_id = threadId;

    if (!threadId) {
      metadata.title = liveTitle || 'Gmail';
      addExtractionMetadata(metadata, {
        contentSource: 'Gmail live page',
        total: 0,
        included: 0,
        complete: false,
      });
      return Markdown.buildPageMarkdown(
        metadata,
        '# Gmail\n\n*Open a Gmail thread before copying.*',
      );
    }

    try {
      const printView = await fetchPrintView(threadId);
      const parsed = parsePrintView(printView);
      if (parsed.messages.length > 0) {
        metadata.title = liveTitle || parsed.title || 'Gmail Thread';
        metadata.messages = String(parsed.messages.length);
        addExtractionMetadata(metadata, {
          contentSource: 'Gmail authenticated print view',
          total: parsed.messages.length,
          included: parsed.messages.length,
          complete: true,
        });
        addParticipantMetadata(metadata, parsed.messages);
        return buildThreadMarkdown(metadata, parsed.messages);
      }
    } catch (error) {
      console.warn('[Copy as Markdown] Gmail print view failed', error);
    }

    const messages = extractLiveMessages();
    metadata.title = liveTitle || 'Gmail Thread';
    metadata.messages = String(messages.length);
    addExtractionMetadata(metadata, {
      contentSource: 'Gmail live thread view',
      total: messages.length,
      included: messages.length,
      complete: false,
    });
    addParticipantMetadata(metadata, messages);

    if (messages.length === 0) {
      return Markdown.buildPageMarkdown(
        metadata,
        `# ${metadata.title}\n\n*Could not find messages in this Gmail thread. Wait for the thread to finish loading and try again.*`,
      );
    }

    return buildThreadMarkdown(metadata, messages);
  },
});

function getThreadId(): string {
  const hash = decodeHash(window.location.hash).replace(/^#/, '');
  const segments = hash.split('/').filter(Boolean);
  if (segments.length < 2) return '';
  const candidate = segments[segments.length - 1];
  if (!/^[A-Za-z0-9_-]{12,}$/.test(candidate)) return '';
  return candidate;
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function getLiveThreadTitle(): string {
  return (
    document.querySelector('h2.hP, h2[data-thread-perm-id], [role="main"] h2')?.textContent?.trim()
    || ''
  );
}

function getPrintViewUrl(threadId: string): string {
  const accountPath = window.location.pathname.match(/^\/mail\/u\/[^/]+\//)?.[0] || '/mail/u/0/';
  const url = new URL(accountPath, window.location.origin);
  url.searchParams.set('ui', '2');
  url.searchParams.set('view', 'pt');
  url.searchParams.set('search', 'all');
  url.searchParams.set('th', threadId);
  return url.href;
}

async function fetchPrintView(threadId: string): Promise<string> {
  const response = await fetch(getPrintViewUrl(threadId), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`Gmail print request returned ${response.status}`);

  const html = await response.text();
  if (!html.trim()) throw new Error('Gmail print request returned an empty response');
  if (
    response.url.includes('ServiceLogin')
    || /accounts\.google\.com/i.test(html)
    || /<title>\s*sign in/i.test(html)
  ) {
    throw new Error('Gmail print request redirected to sign-in');
  }
  return html;
}

function parsePrintView(html: string): { title: string; messages: GmailMessage[] } {
  const parsed = Markdown.parseHtmlDocument(html);
  const title = parsed.title.replace(/^Gmail\s*-\s*/i, '').trim();
  const root = parsed.querySelector('.maincontent, .bodycontainer');
  if (!root) return { title, messages: [] };

  const messages = Array.from(root.querySelectorAll<HTMLTableElement>('table.message'))
    .map(parsePrintMessage)
    .filter((message) => Boolean(message.body || message.sender || message.recipients));
  return { title, messages };
}

function parsePrintMessage(table: HTMLTableElement): GmailMessage {
  const rows = Array.from(table.rows).filter((row) => row.closest('table') === table);
  const bodyRow = rows[rows.length - 1];
  const headerRows = rows.slice(0, -1);
  const headerRoot = table.ownerDocument.createElement('div');
  headerRows.forEach((row) => headerRoot.appendChild(row.cloneNode(true)));

  const senderCell = headerRows
    .flatMap((row) => Array.from(row.cells))
    .find((cell) => cell.getAttribute('align')?.toLowerCase() !== 'right' && cell.textContent?.trim());
  const sender = normalizeText(senderCell?.textContent || '');
  const date = normalizeText(
    headerRoot.querySelector('td[align="right"][title]')?.getAttribute('title')
    || headerRoot.querySelector('td[align="right"]')?.textContent
    || '',
  );
  const recipients = normalizeText(
    headerRows.slice(1).map((row) => row.textContent || '').join(' '),
  );
  const bodyCell = bodyRow
    ? Array.from(bodyRow.cells).find((cell) => cell.colSpan > 1) || bodyRow.cells[bodyRow.cells.length - 1]
    : null;
  const body = bodyCell ? messageBodyToMarkdown(bodyCell) : '';
  const attachments = bodyCell ? collectAttachments(bodyCell) : [];

  return { sender, recipients, date, body, attachments };
}

function extractLiveMessages(): GmailMessage[] {
  const roots = new Set<HTMLElement>();
  document.querySelectorAll<HTMLElement>('.adn.ads, [data-message-id]')
    .forEach((element) => {
      const root = element.closest<HTMLElement>('.adn.ads') || element;
      if (root.querySelector('.a3s, .ii.gt')) roots.add(root);
    });

  return Array.from(roots).map((root) => {
    const senderElement = root.querySelector<HTMLElement>('.gD[email], .gD[data-hovercard-id], .gD');
    const senderName = senderElement?.getAttribute('name') || senderElement?.textContent?.trim() || '';
    const senderEmail = senderElement?.getAttribute('email') || senderElement?.getAttribute('data-hovercard-id') || '';
    const sender = senderEmail && !senderName.includes(senderEmail)
      ? `${senderName} <${senderEmail}>`.trim()
      : senderName || senderEmail;
    const recipients = normalizeText(
      root.querySelector('.g2, .hb, [data-tooltip^="Show details"]')?.textContent || '',
    );
    const dateElement = root.querySelector<HTMLElement>('.g3[title], .g3, time');
    const date = dateElement?.getAttribute('title')
      || dateElement?.getAttribute('datetime')
      || dateElement?.textContent?.trim()
      || '';
    const bodyElement = root.querySelector<HTMLElement>('.a3s, .ii.gt');
    const body = bodyElement ? messageBodyToMarkdown(bodyElement) : '';
    const attachments = collectAttachments(root);
    return { sender, recipients, date, body, attachments };
  });
}

function messageBodyToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(
    'script, style, noscript, [data-tooltip="Show trimmed content"], [data-tooltip="Hide expanded content"], .yj6qo, .ajR',
  ).forEach((node) => node.remove());
  unwrapSingleCellTables(clone);
  return Markdown.elementToMarkdown(clone).trim();
}

function unwrapSingleCellTables(root: ParentNode): void {
  let changed = true;
  while (changed) {
    changed = false;
    root.querySelectorAll('table').forEach((table) => {
      const rows = Array.from(table.rows).filter((row) => row.closest('table') === table);
      const cells = rows.flatMap((row) => Array.from(row.cells));
      if (cells.length !== 1) return;
      const fragment = table.ownerDocument.createDocumentFragment();
      Array.from(cells[0].childNodes).forEach((child) => fragment.appendChild(child.cloneNode(true)));
      table.replaceWith(fragment);
      changed = true;
    });
  }
}

function collectAttachments(root: ParentNode): string[] {
  const names = new Set<string>();
  root.querySelectorAll<HTMLElement>(
    'a[href*="view=att"], a[href*="disp=att"], [download_url], .aQH .aV3, [data-tooltip^="Download"]',
  ).forEach((element) => {
    const value = element.getAttribute('download')
      || element.getAttribute('aria-label')
      || element.getAttribute('data-tooltip')
      || element.textContent
      || '';
    const name = normalizeText(value.replace(/^Download attachment\s*/i, ''));
    if (name) names.add(name);
  });
  return Array.from(names);
}

function addParticipantMetadata(metadata: Record<string, string>, messages: GmailMessage[]): void {
  const participants = new Set<string>();
  messages.forEach((message) => {
    if (message.sender) participants.add(message.sender);
  });
  if (participants.size > 0) metadata.participants = Array.from(participants).join(', ');
}

function buildThreadMarkdown(metadata: Record<string, string>, messages: GmailMessage[]): string {
  const title = metadata.title || 'Gmail Thread';
  const parts = [`# ${title}`, '', `**Messages:** ${messages.length}`];

  messages.forEach((message, index) => {
    parts.push('', `## Message ${index + 1}${message.sender ? `: ${message.sender}` : ''}`, '');
    if (message.sender) parts.push(`**From:** ${message.sender}`);
    if (message.recipients) parts.push(`**Recipients:** ${message.recipients}`);
    if (message.date) parts.push(`**Date:** ${message.date}`);
    if (message.attachments.length > 0) {
      parts.push(`**Attachments:** ${message.attachments.join(', ')}`);
    }
    if (message.body) parts.push('', message.body);
  });

  const limited = limitMarkdown(parts.join('\n'));
  if (limited.truncated) {
    metadata.truncated = 'true';
    metadata.complete = 'false';
  }
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function normalizeText(value: string): string {
  return Markdown.normalizeWhitespace(value).trim();
}
