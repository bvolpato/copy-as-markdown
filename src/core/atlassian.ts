/** Shared conversion helpers for Atlassian REST payloads. */

import * as Markdown from './markdown';

type JsonObject = Record<string, unknown>;

export async function fetchAtlassianJson(url: string): Promise<JsonObject> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Atlassian request returned ${response.status}`);

  const value: unknown = await response.json();
  const object = asObject(value);
  if (!object) throw new Error('Atlassian request returned invalid JSON');
  return object;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script, style, noscript, template').forEach((element) => element.remove());
  return Markdown.elementToMarkdown(parsed.body).trim();
}

export function adfToMarkdown(value: unknown): string {
  const document = asObject(value);
  if (!document) return '';
  return normalizeMarkdown(renderNode(document, 0));
}

function renderNode(node: JsonObject, depth: number): string {
  const type = stringValue(node.type);
  const content = objectArray(node.content);
  const attrs = asObject(node.attrs) || {};

  switch (type) {
    case 'doc':
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join('\n\n');
    case 'paragraph':
      return renderInlineChildren(content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, numberValue(attrs.level) || 1));
      return `${'#'.repeat(level)} ${renderInlineChildren(content)}`.trim();
    }
    case 'text':
      return renderText(stringValue(node.text), objectArray(node.marks));
    case 'hardBreak':
      return '  \n';
    case 'bulletList':
      return renderList(content, false, numberValue(attrs.order) || 1, depth);
    case 'orderedList':
      return renderList(content, true, numberValue(attrs.order) || 1, depth);
    case 'listItem':
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join('\n');
    case 'taskList':
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join('\n');
    case 'taskItem': {
      const checked = attrs.state === 'DONE' ? 'x' : ' ';
      return `- [${checked}] ${content.map((child) => renderNode(child, depth + 1)).join('\n')}`;
    }
    case 'codeBlock': {
      const language = stringValue(attrs.language).replace(/[^\w.+-]/g, '');
      const code = content.map((child) => stringValue(child.text)).join('');
      const fence = code.includes('```') ? '````' : '```';
      return `${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}`;
    }
    case 'blockquote':
    case 'panel': {
      const inner = content.map((child) => renderNode(child, depth)).filter(Boolean).join('\n\n');
      return inner.split('\n').map((line) => `> ${line}`).join('\n');
    }
    case 'rule':
      return '---';
    case 'table':
      return renderTable(content);
    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join(' ');
    case 'mention':
      return stringValue(attrs.text) || stringValue(attrs.displayName) || '@mention';
    case 'emoji':
      return stringValue(attrs.text) || stringValue(attrs.shortName);
    case 'status':
      return stringValue(attrs.text);
    case 'date':
      return formatDate(stringValue(attrs.timestamp));
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard': {
      const url = safeUrl(stringValue(attrs.url));
      return url ? `[${url}](${url})` : '';
    }
    case 'media': {
      const label = stringValue(attrs.alt) || stringValue(attrs.filename) || 'Attachment';
      const url = safeUrl(stringValue(attrs.url));
      return url ? `[${escapeLinkLabel(label)}](${url})` : escapeMarkdown(label);
    }
    case 'mediaSingle':
    case 'mediaGroup':
    case 'expand':
    case 'nestedExpand':
    case 'decisionList':
    case 'decisionItem':
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join('\n\n');
    default:
      return content.map((child) => renderNode(child, depth)).filter(Boolean).join('');
  }
}

function renderInlineChildren(content: JsonObject[]): string {
  return content.map((child) => renderNode(child, 0)).join('');
}

function renderText(value: string, marks: JsonObject[]): string {
  const codeMark = marks.some((mark) => mark.type === 'code');
  let rendered = codeMark
    ? `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
    : escapeMarkdown(value);

  for (const mark of marks) {
    const type = stringValue(mark.type);
    const attrs = asObject(mark.attrs) || {};
    if (type === 'strong') rendered = `**${rendered}**`;
    else if (type === 'em') rendered = `*${rendered}*`;
    else if (type === 'strike') rendered = `~~${rendered}~~`;
    else if (type === 'link') {
      const href = safeUrl(stringValue(attrs.href));
      if (href) rendered = `[${rendered}](${href})`;
    }
  }
  return rendered;
}

function renderList(items: JsonObject[], ordered: boolean, start: number, depth: number): string {
  return items.map((item, index) => {
    const blocks = objectArray(item.content);
    const rendered = blocks.map((child) => renderNode(child, depth + 1)).filter(Boolean).join('\n');
    const marker = ordered ? `${start + index}.` : '-';
    const indent = '  '.repeat(depth);
    const lines = rendered.split('\n');
    return `${indent}${marker} ${lines[0] || ''}${lines.slice(1)
      .map((line) => `\n${indent}  ${line}`)
      .join('')}`;
  }).join('\n');
}

function renderTable(rows: JsonObject[]): string {
  const values = rows.map((row) => objectArray(row.content).map((cell) => {
    const value = objectArray(cell.content)
      .map((child) => renderNode(child, 0))
      .join(' ')
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\s*\n\s*/g, '<br>')
      .trim();
    return value;
  }));
  if (values.length === 0) return '';
  const width = Math.max(...values.map((row) => row.length));
  const normalized = values.map((row) => [...row, ...Array(width - row.length).fill('')]);
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]<>])/g, '\\$1');
}

function escapeLinkLabel(value: string): string {
  return value.replace(/([\\\[\]])/g, '\\$1');
}

function safeUrl(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    return /^(?:https?|mailto):$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function formatDate(timestamp: string): string {
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return timestamp;
  return new Date(numeric).toISOString().slice(0, 10);
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(asObject).filter((item): item is JsonObject => item !== null)
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
