/** Shared conversion helpers for Atlassian REST payloads. */

import * as Markdown from './markdown';
import { removeSessionCredentials } from './session-urls';
import * as Utils from './utils';

type JsonObject = Record<string, unknown>;

export async function fetchAtlassianJson(url: string): Promise<JsonObject> {
  // A page path or a declared context path can name another host.
  if (new URL(url).origin !== window.location.origin) throw new Error('Atlassian request left the page origin');
  const response = await Utils.fetchWithTimeout(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }, 8000);
  if (!response.ok) throw new Error(`Atlassian request returned ${response.status}`);

  const value: unknown = await response.json();
  const object = asObject(value);
  if (!object) throw new Error('Atlassian request returned invalid JSON');
  return object;
}

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return '';
  const parsed = Markdown.parseHtmlDocument(html);
  parsed.querySelectorAll('script, style, noscript, template').forEach((element) => element.remove());
  prepareAtlassianContent(parsed.body);
  return Markdown.elementToMarkdown(parsed.body).trim();
}

/**
 * Rewrite Atlassian-specific markup in a detached tree before generic conversion.
 * Covers both exported REST HTML and the Cloud page renderer.
 */
export function prepareAtlassianContent(root: Element): void {
  const doc = root.ownerDocument;

  root.querySelectorAll<HTMLElement>('[data-ds--code--code-block]').forEach((block) => {
    block.querySelectorAll('[data-ds--line-number]').forEach((number) => number.remove());
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    const language = block.getAttribute('data-code-lang');
    if (language) code.className = `language-${language}`;
    code.textContent = block.textContent;
    pre.append(code);
    block.replaceWith(pre);
  });

  // Jira renders inline code as teletype text.
  root.querySelectorAll('tt').forEach((teletype) => {
    if (teletype.closest('pre') || teletype.querySelector('a, img, br, p, div, ul, ol, pre, table')) return;
    const code = doc.createElement('code');
    code.textContent = teletype.textContent;
    teletype.replaceWith(code);
  });
  root.querySelectorAll<HTMLElement>('pre[class^="code-"]').forEach((pre) => {
    const language = pre.className.match(/^code-([\w+#-]+)$/)?.[1];
    if (language && language !== 'none') pre.setAttribute('data-language', language);
  });

  root.querySelectorAll('ul.inline-task-list > li').forEach((item) => {
    item.prepend(item.classList.contains('checked') ? '[x] ' : '[ ] ');
  });
  // REST HTML puts a nested task list beside its owner, where list conversion skips it.
  root.querySelectorAll('ul.inline-task-list > ul').forEach((list) => {
    const owner = list.previousElementSibling;
    if (owner?.tagName === 'LI') owner.append(list);
  });
  // Convert nested lists first so that an outer list can adopt them.
  Array.from(root.querySelectorAll<HTMLElement>('[data-task-list-local-id]')).reverse().forEach((list) => {
    const replacement = doc.createElement('ul');
    Array.from(list.children).forEach((child) => {
      const checkbox = child.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!checkbox && replacement.lastElementChild) {
        replacement.lastElementChild.append(child);
        return;
      }
      const item = doc.createElement('li');
      item.append(checkbox ? (checkbox.checked ? '[x] ' : '[ ] ') : '');
      item.append(...(child.querySelector('[data-component="content"]') || child).childNodes);
      replacement.append(item);
    });
    list.replaceWith(replacement);
  });

  root.querySelectorAll<HTMLElement>('[data-emoji-id]').forEach((emoji) => {
    if (emoji.parentElement?.closest('[data-emoji-id]')) return;
    const names = [emoji, ...emoji.querySelectorAll<HTMLElement>('[data-emoji-id], [data-emoji-text]')]
      .map((element) => element.dataset.emojiFallback || element.dataset.emojiText || '')
      .filter(Boolean);
    const text = names.find((name) => !/^:.+:$/.test(name))
      || names[0]
      || emoji.dataset.emojiShortname
      || emoji.getAttribute('alt')
      || '';
    // Some exports escape the fallback character as UTF-16 code units.
    emoji.replaceWith(text.replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16))));
  });

  root.querySelectorAll<HTMLImageElement>('[data-file-name] img[src^="http"]').forEach((image) => {
    if (!image.alt) image.alt = image.closest<HTMLElement>('[data-file-name]')?.dataset.fileName || '';
  });
}

export function adfToMarkdown(value: unknown): string {
  const document = asObject(value);
  if (!document) return '';
  return Markdown.cleanMarkdown(renderNode(document));
}

function renderNode(node: JsonObject): string {
  const type = stringValue(node.type);
  const content = objectArray(node.content);
  const attrs = asObject(node.attrs) || {};

  switch (type) {
    case 'paragraph':
      return renderInlineChildren(content);
    case 'heading': {
      const level = Math.min(6, Math.max(1, numberValue(attrs.level) || 1));
      return `${'#'.repeat(level)} ${renderInlineChildren(content).replace(/\s*\n\s*/g, ' ')}`.trim();
    }
    case 'text':
      return renderText(stringValue(node.text), objectArray(node.marks));
    case 'hardBreak':
      return '  \n';
    case 'bulletList':
      return renderList(content, false, 1);
    case 'orderedList':
      return renderList(content, true, typeof attrs.order === 'number' ? numberValue(attrs.order) : 1);
    case 'taskList':
    case 'decisionList':
      return content.map((child) => {
        const rendered = renderNode(child);
        // A nested task list is a sibling of the item that owns it.
        return child.type === type ? indentLines(rendered, '  ') : rendered;
      }).filter(Boolean).join('\n');
    case 'taskItem':
    case 'blockTaskItem':
      return renderListItem(`- [${attrs.state === 'DONE' ? 'x' : ' '}]`, content, 2);
    case 'decisionItem':
      return renderListItem('-', content);
    case 'codeBlock':
      return Markdown.fencedCodeToMarkdown(codeBlockText(content), stringValue(attrs.language));
    case 'blockquote':
    case 'panel': {
      const inner = renderFlow(content);
      if (!inner) return '';
      const panelType = type === 'panel' ? stringValue(attrs.panelType).toUpperCase() : '';
      const prefix = panelType ? `> **[${panelType}]**\n` : '';
      return prefix + inner.split('\n').map((line) => `> ${line}`).join('\n');
    }
    case 'rule':
      return '---';
    case 'table':
      return renderTable(content);
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
      const data = asObject(attrs.data) || {};
      const url = safeUrl(stringValue(attrs.url) || stringValue(data.url));
      const label = stringValue(data.name);
      return url ? `[${label ? escapeLinkLabel(label) : url}](${url})` : escapeMarkdown(label);
    }
    case 'media':
    case 'mediaInline': {
      const label = stringValue(attrs.alt) || stringValue(attrs.filename) || 'Attachment';
      const url = safeUrl(stringValue(attrs.url));
      return url ? `[${escapeLinkLabel(label)}](${url})` : escapeMarkdown(label);
    }
    case 'expand':
    case 'nestedExpand': {
      const title = stringValue(attrs.title).trim();
      const body = renderFlow(content);
      return title && body ? `**${escapeMarkdown(title)}**\n\n${body}` : (body || (title ? `**${escapeMarkdown(title)}**` : ''));
    }
    default:
      return renderFlow(content);
  }
}

const MARK_DELIMITERS = new Map([['strong', '**'], ['em', '*'], ['strike', '~~']]);

function renderInlineChildren(content: JsonObject[]): string {
  let output = '';
  let previous = '';
  content.forEach((child) => {
    const part = renderNode(child);
    const delimiter = outerDelimiter(child);
    // Adjacent runs with the same mark would otherwise print a literal "****".
    const adjoins = delimiter && delimiter === previous
      && output.endsWith(delimiter) && part.startsWith(delimiter);
    output = adjoins ? output.slice(0, -delimiter.length) + part.slice(delimiter.length) : output + part;
    previous = delimiter;
  });
  return output;
}

function outerDelimiter(node: JsonObject): string {
  const outer = objectArray(node.marks)
    .map((mark) => stringValue(mark.type))
    .filter((type) => MARK_DELIMITERS.has(type) || type === 'link' || type === 'subsup')
    .pop();
  return MARK_DELIMITERS.get(outer || '') || '';
}

const INLINE_NODES = new Set([
  'text', 'hardBreak', 'mention', 'emoji', 'status', 'date', 'inlineCard', 'mediaInline',
  'placeholder', 'inlineExtension',
]);
const LIST_NODES = new Set(['bulletList', 'orderedList', 'taskList', 'decisionList']);
const BLOCK_NODES = new Set([
  ...LIST_NODES, 'paragraph', 'heading', 'listItem', 'taskItem', 'blockTaskItem', 'decisionItem',
  'codeBlock', 'blockquote', 'panel', 'rule', 'table', 'tableRow', 'tableHeader', 'tableCell',
  'media', 'mediaSingle', 'mediaGroup', 'caption', 'expand', 'nestedExpand', 'blockCard', 'embedCard',
  'layoutSection', 'layoutColumn', 'extension', 'bodiedExtension',
]);

/** Join inline siblings into one run, and keep block siblings apart. */
function renderFlow(content: JsonObject[], tight = false): string {
  let output = '';
  let previousType = '';
  let run: JsonObject[] = [];
  const append = (type: string, text: string) => {
    if (!text.trim()) return;
    if (output) {
      const adjoins = tight && (LIST_NODES.has(type) || type === 'codeBlock' || previousType === 'codeBlock');
      output += adjoins ? '\n' : '\n\n';
    }
    output += text;
    previousType = type;
  };
  const flush = () => {
    append('paragraph', renderInlineChildren(run));
    run = [];
  };
  content.forEach((child) => {
    if (isInlineNode(child)) {
      run.push(child);
      return;
    }
    flush();
    append(stringValue(child.type), renderNode(child));
  });
  flush();
  return output;
}

function isInlineNode(node: JsonObject): boolean {
  if (INLINE_NODES.has(stringValue(node.type))) return true;
  return !BLOCK_NODES.has(stringValue(node.type))
    && objectArray(node.content).length > 0
    && objectArray(node.content).every(isInlineNode);
}

function renderText(value: string, marks: JsonObject[]): string {
  const codeMark = marks.some((mark) => mark.type === 'code');
  let rendered = codeMark
    ? Markdown.inlineCodeToMarkdown(value)
    : escapeMarkdown(value);

  for (const mark of marks) {
    const type = stringValue(mark.type);
    const attrs = asObject(mark.attrs) || {};
    const delimiter = MARK_DELIMITERS.get(type);
    if (delimiter) rendered = wrapMark(rendered, delimiter, delimiter);
    else if (type === 'subsup') rendered = wrapMark(rendered, attrs.type === 'sub' ? '_(' : '^(', ')');
    else if (type === 'link') {
      const href = safeUrl(stringValue(attrs.href));
      if (href) rendered = `[${rendered}](${href})`;
    }
  }
  return rendered;
}

/** Keep spaces outside the delimiters, where CommonMark requires them. */
function wrapMark(value: string, open: string, close: string): string {
  const inner = value.trim();
  if (!inner) return value;
  const start = value.indexOf(inner);
  return `${value.slice(0, start)}${open}${inner}${close}${value.slice(start + inner.length)}`;
}

function renderList(items: JsonObject[], ordered: boolean, start: number): string {
  return items
    .map((item, index) => renderListItem(ordered ? `${start + index}.` : '-', objectArray(item.content)))
    .join('\n');
}

function renderListItem(marker: string, content: JsonObject[], indent = marker.length + 1): string {
  const body = renderFlow(content, true);
  if (!body) return marker;
  // Continuation lines must reach the content column to stay inside the item.
  const padded = indentLines(body, ' '.repeat(indent));
  return LIST_NODES.has(stringValue(content[0]?.type))
    ? `${marker}\n${padded}`
    : `${marker} ${padded.trimStart()}`;
}

function indentLines(value: string, padding: string): string {
  return value.split('\n').map((line) => (line ? padding + line : line)).join('\n');
}

function codeBlockText(content: JsonObject[]): string {
  return content.map((child) => stringValue(child.text)).join('');
}

// Spans only add empty cells, so limit the columns that they can create.
const MAX_SPANNED_COLUMNS = 100;

function renderTable(rows: JsonObject[]): string {
  const values: string[][] = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let column = 0;
    objectArray(row.content).forEach((cell) => {
      while (values[rowIndex][column] !== undefined) column += 1;
      const attrs = asObject(cell.attrs) || {};
      const spannable = MAX_SPANNED_COLUMNS - column;
      const columnSpan = Math.max(1, Math.min(spannable, Math.trunc(numberValue(attrs.colspan))));
      const rowSpan = spannable > 0
        ? Math.min(rows.length - rowIndex, Math.max(1, Math.trunc(numberValue(attrs.rowspan))))
        : 1;
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let columnOffset = 0; columnOffset < columnSpan; columnOffset += 1) {
          values[rowIndex + rowOffset][column + columnOffset] = rowOffset || columnOffset ? '' : renderTableCell(cell);
        }
      }
      column += columnSpan;
    });
  });
  if (values.length === 0) return '';
  const width = Utils.safeMax(values.map((row) => row.length));
  if (width <= 0) return '';
  const normalized = values.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? ''));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function renderTableCell(cell: JsonObject): string {
  const rendered = objectArray(cell.content)
    .map((child) => child.type === 'codeBlock'
      ? codeBlockText(objectArray(child.content)).split('\n').map(Markdown.inlineCodeToMarkdown).join('\n')
      : renderNode(child))
    .join(' ');
  // Child Markdown already escapes prose; code backslashes must stay literal.
  const characters: string[] = [];
  for (const character of rendered) characters.push(character === '|' ? '\\|' : character);
  return characters.join('')
    .replace(/\s+/g, (whitespace) => whitespace.includes('\n') ? '<br>' : whitespace)
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
    return /^(?:https?|mailto):$/.test(url.protocol)
      ? removeSessionCredentials(url).replace(/\(/g, '%28').replace(/\)/g, '%29')
      : '';
  } catch {
    return '';
  }
}

function formatDate(timestamp: string): string {
  const trimmed = timestamp.trim();
  if (!trimmed) return '';
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return trimmed;
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? trimmed : date.toISOString().slice(0, 10);
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
