/**
 * Gmail thread extractor.
 * Uses Gmail's authenticated print view so collapsed messages are included.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
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

const GMAIL_TWO_SEGMENT_VIEWS = new Set([
  'label',
  'search',
  'category',
  'advanced-search',
  'section',
]);

function getThreadId(): string {
  const rawHash = decodeHash(window.location.hash).replace(/^#/, '');
  const cleanHash = rawHash.split('?')[0];
  const segments = cleanHash.split('/').filter(Boolean);
  if (segments.length < 2) return '';
  if (GMAIL_TWO_SEGMENT_VIEWS.has(segments[0].toLowerCase()) && segments.length < 3) {
    return '';
  }
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

function getGmailIk(): string {
  const globalWindow = window as typeof window & { GLOBALS?: unknown[]; IK?: unknown };
  if (typeof globalWindow.IK === 'string' && /^[a-f0-9]{6,}$/i.test(globalWindow.IK)) {
    return globalWindow.IK;
  }
  if (Array.isArray(globalWindow.GLOBALS)) {
    const candidate = globalWindow.GLOBALS[9];
    if (typeof candidate === 'string' && /^[a-f0-9]{6,}$/i.test(candidate)) {
      return candidate;
    }
  }
  const link = document.querySelector<HTMLElement>('a[href*="ik="], link[href*="ik="]');
  const linkHref = link?.getAttribute('href') || '';
  const linkIk = linkHref.match(/[?&]ik=([a-f0-9]{6,})\b/i)?.[1];
  if (linkIk) return linkIk;

  for (const script of Array.from(document.scripts)) {
    const text = script.textContent || '';
    if (!text.includes('ik')) continue;
    const match = text.match(/(?:["']ik["']\s*[,:]\s*["']|var\s+IK\s*=\s*["']|[?&]ik=)([a-f0-9]{6,})/i);
    if (match?.[1]) return match[1];
  }
  return '';
}

function getGmailPermThreadInfo(): { permthid: string; legacyId: string } {
  const scope = document.querySelector('[role="main"]') || document;
  // With a split pane, list rows before the open thread carry the IDs of other threads.
  const heading = scope.querySelector<HTMLElement>('h2[data-thread-perm-id], h2[data-legacy-thread-id]');
  const permEl = heading || scope.querySelector<HTMLElement>('[data-thread-perm-id]');
  const legacyEl = heading || scope.querySelector<HTMLElement>('[data-legacy-thread-id]');
  return {
    permthid: permEl?.getAttribute('data-thread-perm-id')?.trim() || '',
    legacyId: legacyEl?.getAttribute('data-legacy-thread-id')?.trim() || '',
  };
}

function getPrintViewUrl(threadId: string): string {
  const accountPath = window.location.pathname.match(/^\/mail\/(?:b\/[^/]+\/)?u\/[^/]+\//)?.[0] || '/mail/u/0/';
  const url = new URL(accountPath, window.location.origin);
  url.searchParams.set('ui', '2');
  const ik = getGmailIk();
  if (ik) url.searchParams.set('ik', ik);
  url.searchParams.set('view', 'pt');
  url.searchParams.set('search', 'all');
  const { permthid, legacyId } = getGmailPermThreadInfo();
  if (permthid) {
    url.searchParams.set('permthid', permthid);
  }
  url.searchParams.set('th', legacyId || threadId);
  return url.href;
}

function isGoogleSignInResponse(response: Response, html: string): boolean {
  try {
    const parsedUrl = response.url ? new URL(response.url) : null;
    if (parsedUrl && /(?:^|\.)accounts\.google\.com$/i.test(parsedUrl.hostname)) {
      return true;
    }
  } catch {
    // ignore invalid response URL
  }
  if (response.url.includes('ServiceLogin')) return true;
  if (/<title[^>]*>\s*(?:sign in|google accounts)\b/i.test(html)) return true;
  const hasSignInForm = /<form[^>]+(?:ServiceLogin|accounts\.google\.com)/i.test(html)
    || /name=["'](?:identifier|Passwd)["']/i.test(html);
  if (hasSignInForm) {
    const visibleText = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (visibleText.length < 2000) return true;
  }
  return false;
}

async function fetchPrintView(threadId: string): Promise<string> {
  const response = await Utils.fetchWithTimeout(getPrintViewUrl(threadId), {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`Gmail print request returned ${response.status}`);

  const html = await response.text();
  if (!html.trim()) throw new Error('Gmail print request returned an empty response');
  if (isGoogleSignInResponse(response, html)) {
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
    .filter((table) => !table.parentElement?.closest('table.message'))
    .map(parsePrintMessage)
    .filter((message) => Boolean(message.body || message.sender || message.recipients));
  return { title, messages };
}

function isAttachmentFooterRow(row: HTMLTableRowElement): boolean {
  if (row.querySelector('table.att')) return true;
  const text = normalizeText(row.textContent || '');
  if (/^\d+\s+attachments?\b/i.test(text)) return true;
  const attLinks = row.querySelectorAll('a[href*="view=att"], a[href*="disp=att"]');
  if (attLinks.length === 0) return false;
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('a[href*="view=att"], a[href*="disp=att"], table.att, hr, img').forEach((n) => n.remove());
  const remaining = normalizeText(clone.textContent || '').replace(/^\d+\s+attachments?\s*/i, '').trim();
  return remaining.length < 20;
}

function isHeaderRecipientRow(row: HTMLTableRowElement): boolean {
  if (row.querySelector('p, blockquote, ul, ol, pre, table')) return false;
  const text = normalizeText(row.textContent || '');
  return /^(?:to|cc|bcc|reply-to|draft|mailed-by|signed-by)\b/i.test(text);
}

function parsePrintMessage(table: HTMLTableElement): GmailMessage {
  const rows = Array.from(table.rows).filter((row) => row.closest('table') === table);
  const headerRows: HTMLTableRowElement[] = [];
  const bodyRows: HTMLTableRowElement[] = [];
  const attachmentRows: HTMLTableRowElement[] = [];

  rows.forEach((row, index) => {
    if (index === 0) {
      headerRows.push(row);
    } else if (bodyRows.length === 0 && isHeaderRecipientRow(row) && index < rows.length - 1) {
      headerRows.push(row);
    } else if (isAttachmentFooterRow(row)) {
      attachmentRows.push(row);
    } else {
      bodyRows.push(row);
    }
  });

  if (bodyRows.length === 0 && rows.length > 1) {
    const fallback = rows[rows.length - 1];
    if (!attachmentRows.includes(fallback)) {
      const idx = headerRows.indexOf(fallback);
      if (idx >= 0) headerRows.splice(idx, 1);
      bodyRows.push(fallback);
    }
  }

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
  headerRoot.querySelectorAll('div, br').forEach((line) => line.before(' '));
  const recipients = normalizeText(
    Array.from(headerRoot.children).slice(1).map((row) => row.textContent || '').join(' '),
  );
  const bodyCells = bodyRows
    .map((row) => Array.from(row.cells).find((cell) => cell.colSpan > 1) || row.cells[row.cells.length - 1])
    .filter((cell): cell is HTMLTableCellElement => Boolean(cell));
  const body = bodyCells
    .map((cell) => messageBodyToMarkdown(cell))
    .filter(Boolean)
    .join('\n\n');
  const attachments = Array.from(new Set([
    ...bodyCells.flatMap((cell) => collectAttachments(cell)),
    ...attachmentRows.flatMap((row) => collectAttachments(row)),
  ]));

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
    const recipientElements = Array.from(root.querySelectorAll<HTMLElement>('.g2'));
    const recipients = recipientElements.length > 0
      ? normalizeText(
        recipientElements
          .map((el) => {
            const email = el.getAttribute('email') || '';
            const name = normalizeText(el.textContent || '');
            return email && name && !name.includes(email) ? `${name} <${email}>` : name || email;
          })
          .filter(Boolean)
          .join(', '),
      )
      : normalizeText(root.querySelector('.hb, [data-tooltip^="Show details"]')?.textContent || '');
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
    // A chip names its file in download_url ("type:name:url"). Its text adds a preview label and the size.
    const chip = element.closest('[download_url]');
    const chipName = chip?.getAttribute('download_url')?.match(/^[^:]*:(.+?):https?:/)?.[1] || '';
    if (chip && (chip === element) !== Boolean(chipName)) return;
    const value = chipName
      || element.getAttribute('download')
      || element.getAttribute('aria-label')
      || element.getAttribute('data-tooltip')
      || element.textContent
      || '';
    const name = normalizeText(value.replace(/^Download(?:\s+attachment)?\s*/i, ''));
    if (!name || /^(?:download|all attachments?|save to drive|add to drive)$/i.test(name)) return;
    names.add(name);
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
