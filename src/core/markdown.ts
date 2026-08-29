/**
 * Core Markdown conversion utilities.
 * Converts HTML structures (headings, tables, lists, links, images, code blocks)
 * into clean, well-structured Markdown — optimized for LLM context sharing.
 */

import { PageMetadata } from './types';

/**
 * Collapse whitespace sequences into single spaces, trim.
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return '';
  return normalizeUnicodeText(text).replace(/[\s\n\r]+/g, ' ').trim();
}

export function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, '\\$1');
}

export function escapeMarkdownTableCell(value: string, lineBreak = ' '): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, lineBreak)
    .trim();
}

const ASCII_PUNCTUATION = new Map<string, string>([
  ['\u00AB', '"'], ['\u00BB', '"'],
  ['\u2018', "'"], ['\u2019', "'"], ['\u201A', "'"], ['\u201B', "'"],
  ['\u201C', '"'], ['\u201D', '"'], ['\u201E', '"'], ['\u201F', '"'],
  ['\u2032', "'"], ['\u2033', '"'], ['\u2035', "'"], ['\u2036', '"'],
  ['\u2039', "'"], ['\u203A', "'"], ['\u275B', "'"], ['\u275C', "'"],
  ['\u275D', '"'], ['\u275E', '"'], ['\u2E42', '"'],
  ['\u301D', '"'], ['\u301E', '"'], ['\u301F', '"'],
  ['\u2026', '...'], ['\u2212', '-'],
]);

const UNICODE_SEPARATOR = /\p{Separator}/u;
const UNICODE_LINE_SEPARATOR = /[\p{Line_Separator}\p{Paragraph_Separator}]/u;
const UNICODE_DASH = /\p{Dash_Punctuation}/u;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const CONTROL_OR_PRIVATE_USE = /[\p{Control}\p{Private_Use}\p{Surrogate}]/u;
const LETTER_OR_MARK = /[\p{Letter}\p{Mark}]/u;
const LATIN = /\p{Script=Latin}/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * Normalize compatibility characters and remove common invisible watermark
 * channels without transliterating ordinary non-ASCII language text.
 */
export function normalizeUnicodeText(text: string): string {
  if (!text) return '';

  const characters = Array.from(text.normalize('NFKC'));
  const output: string[] = [];

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const codePoint = character.codePointAt(0) || 0;

    if (character === '\n' || character === '\r') {
      output.push(character);
      continue;
    }
    if (character === '\t') {
      output.push(character);
      continue;
    }
    if (UNICODE_LINE_SEPARATOR.test(character)) {
      output.push('\n');
      continue;
    }
    if (UNICODE_SEPARATOR.test(character) || isVisualBlank(codePoint)) {
      output.push(' ');
      continue;
    }
    if (character === '\u200C' || character === '\u200D') {
      if (isMeaningfulJoiner(characters[index - 1], characters[index + 1])) {
        output.push(character);
      }
      continue;
    }
    if (
      DEFAULT_IGNORABLE.test(character)
      || CONTROL_OR_PRIVATE_USE.test(character)
      || isNonCharacter(codePoint)
    ) {
      continue;
    }

    const punctuation = ASCII_PUNCTUATION.get(character);
    if (punctuation !== undefined) {
      output.push(punctuation);
    } else if (UNICODE_DASH.test(character)) {
      output.push('-');
    } else {
      output.push(character);
    }
  }

  return output.join('');
}

function isMeaningfulJoiner(previous: string | undefined, next: string | undefined): boolean {
  if (!previous || !next) return false;
  if (EXTENDED_PICTOGRAPHIC.test(previous) && EXTENDED_PICTOGRAPHIC.test(next)) return true;
  return LETTER_OR_MARK.test(previous)
    && LETTER_OR_MARK.test(next)
    && !LATIN.test(previous)
    && !LATIN.test(next);
}

function isVisualBlank(codePoint: number): boolean {
  return codePoint === 0x115f
    || codePoint === 0x1160
    || codePoint === 0x2800
    || codePoint === 0x3164
    || codePoint === 0xffa0;
}

function isNonCharacter(codePoint: number): boolean {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef)
    || (codePoint & 0xffff) === 0xfffe
    || (codePoint & 0xffff) === 0xffff;
}

/**
 * Convert an HTML table element to Markdown table.
 * Recursively converts cell contents to preserve links and formatting.
 */
export function tableToMarkdown(tableEl: Element): string {
  // Collect all rows (from thead + tbody, or directly from table)
  const trElements: Element[] = [];
  const thead = tableEl.querySelector('thead');
  const tbodies = tableEl.querySelectorAll('tbody');

  if (thead) {
    thead.querySelectorAll(':scope > tr').forEach((tr) => trElements.push(tr));
  }
  if (tbodies.length > 0) {
    tbodies.forEach((tbody) =>
      tbody.querySelectorAll(':scope > tr').forEach((tr) => trElements.push(tr)),
    );
  }
  if (trElements.length === 0) {
    tableEl.querySelectorAll(':scope > tr').forEach((tr) => trElements.push(tr));
  }

  if (trElements.length === 0) return '';

  // Determine column count from widest row
  let maxCols = 0;
  const allRowCells: string[][] = [];

  for (const tr of trElements) {
    const cells = Array.from(tr.querySelectorAll(':scope > th, :scope > td'));
    const values = cells.map((cell) => {
      // Recursively convert cell contents to Markdown, then flatten to single line
      const md = cellToMarkdown(cell);
      return escapeMarkdownTableCell(md.replace(/\n/g, ' ').replace(/\s+/g, ' '));
    });
    maxCols = Math.max(maxCols, values.length);
    allRowCells.push(values);
  }

  if (maxCols === 0) return '';

  // Pad all rows to maxCols
  for (const row of allRowCells) {
    while (row.length < maxCols) row.push('');
  }

  // Build the table: first row is header, then separator, then rest
  const lines: string[] = [];
  lines.push('| ' + allRowCells[0].join(' | ') + ' |');
  lines.push('| ' + allRowCells[0].map(() => '---').join(' | ') + ' |');

  for (let i = 1; i < allRowCells.length; i++) {
    // Skip rows that are exact duplicates of the header (Wikipedia renders headers twice)
    if (allRowCells[i].join('|') === allRowCells[0].join('|')) continue;
    // Skip completely empty rows
    if (allRowCells[i].every((c) => !c)) continue;
    lines.push('| ' + allRowCells[i].join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * Convert the inner content of a table cell to inline Markdown.
 * Handles links, bold, italic, line breaks, and nested text.
 */
function cellToMarkdown(cell: Element): string {
  const parts: string[] = [];
  cell.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      parts.push(normalizeWhitespace(text));
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tag = el.tagName;

      if (tag === 'BR') {
        parts.push('; ');
      } else if (tag === 'A') {
        const href = el.getAttribute('href');
        const text = normalizeWhitespace(el.textContent || '');
        const fullHref = safeMarkdownLinkUrl(href || '', el.ownerDocument?.baseURI);
        if (text && fullHref) {
          parts.push(`[${text}](${fullHref})`);
        } else {
          parts.push(text);
        }
      } else if (tag === 'STRONG' || tag === 'B') {
        const text = normalizeWhitespace(el.textContent || '');
        if (text) parts.push(`**${text}**`);
      } else if (tag === 'EM' || tag === 'I') {
        const text = normalizeWhitespace(el.textContent || '');
        if (text) parts.push(`*${text}*`);
      } else if (tag === 'IMG') {
        // skip images in tables
      } else if (tag === 'UL' || tag === 'OL') {
        // Flatten list items inline
        const items = Array.from(el.querySelectorAll('li'));
        const listText = items
          .map((li) => normalizeWhitespace(li.textContent || ''))
          .filter(Boolean)
          .join('; ');
        if (listText) parts.push(listText);
      } else if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') {
        // skip
      } else {
        // Recurse into child element
        parts.push(cellToMarkdown(el));
      }
    }
  });

  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Convert an HTML list (ul/ol) to Markdown.
 */
export function listToMarkdown(listEl: Element, indent = 0): string {
  const items = Array.from(listEl.children).filter(
    (el) => el.tagName === 'LI',
  );
  const isOrdered = listEl.tagName === 'OL';
  const prefix = ' '.repeat(indent);
  const lines: string[] = [];

  items.forEach((li, index) => {
    const bullet = isOrdered ? `${index + 1}.` : '-';
    const childLists = li.querySelectorAll(':scope > ul, :scope > ol');

    let text = '';
    li.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).tagName !== 'UL' &&
        (node as Element).tagName !== 'OL'
      ) {
        // Recursively convert inline elements (links, bold, etc.)
        text += nodeToMarkdown(node);
      }
    });
    text = normalizeWhitespace(text);
    if (text) lines.push(`${prefix}${bullet} ${text}`);

    childLists.forEach((subList) => {
      lines.push(listToMarkdown(subList, indent + 2));
    });
  });

  return lines.join('\n');
}

interface ConversionContext {
  preserveWhitespace?: boolean;
}

/**
 * Convert a DOM node tree to Markdown string.
 */
export function nodeToMarkdown(
  node: Node,
  context: ConversionContext = {},
): string {
  if (!node) return '';

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || '';
    if (context.preserveWhitespace) return text;
    // Preserve at least leading/trailing single space for adjacent inline elements
    const raw = text.replace(/[\s\n\r]+/g, ' ');
    return raw;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const el = node as HTMLElement;
  const tag = el.tagName;

  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return '';
  const style = el.style;
  if (
    style &&
    (style.display === 'none' || style.visibility === 'hidden')
  )
    return '';

  const noiseTags = [
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'NAV', 'FOOTER',
  ];
  if (noiseTags.includes(tag)) return '';

  switch (tag) {
    case 'H1': return `\n# ${childrenToMarkdown(el, context).trim()}\n`;
    case 'H2': return `\n## ${childrenToMarkdown(el, context).trim()}\n`;
    case 'H3': return `\n### ${childrenToMarkdown(el, context).trim()}\n`;
    case 'H4': return `\n#### ${childrenToMarkdown(el, context).trim()}\n`;
    case 'H5': return `\n##### ${childrenToMarkdown(el, context).trim()}\n`;
    case 'H6': return `\n###### ${childrenToMarkdown(el, context).trim()}\n`;

    case 'P':
      return `\n${childrenToMarkdown(el, context).trim()}\n`;

    case 'BR':
      return '\n';

    case 'HR':
      return '\n---\n';

    case 'STRONG':
    case 'B': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `**${inner}**` : '';
    }

    case 'EM':
    case 'I': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `*${inner}*` : '';
    }

    case 'SUP': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `^(${inner})` : '';
    }

    case 'SUB': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `_(${inner})` : '';
    }

    case 'DEL':
    case 'S':
    case 'STRIKE': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `~~${inner}~~` : '';
    }

    case 'CODE': {
      if (
        el.parentElement &&
        el.parentElement.tagName === 'PRE'
      ) {
        return el.textContent || '';
      }
      const inner = (el.textContent || '').trim();
      return inner ? `\`${inner}\`` : '';
    }

    case 'PRE': {
      const codeEl = el.querySelector('code');
      const code = codeEl
        ? codeEl.textContent || ''
        : el.textContent || '';
      const lang = codeEl
        ? (codeEl.className.match(/language-([\w.+-]+)/) || ['', ''])[1]
        : '';
      return `\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n`;
    }

    case 'A': {
      const href = el.getAttribute('href');
      const text = childrenToMarkdown(el, context).trim();
      if (!text && !href) return '';
      if (!href) return text;
      // Skip internal anchor-only links (e.g. [1], [2] footnotes)
      if (href.startsWith('#')) return text;
      const fullHref = safeMarkdownLinkUrl(href, el.ownerDocument?.baseURI);
      if (!fullHref) return text;
      return text ? `[${text}](${fullHref})` : fullHref;
    }

    case 'IMG': {
      const alt = el.getAttribute('alt') || '';
      const src = el.getAttribute('src') || '';
      if (!src) return '';
      let fullSrc = src;
      try {
        fullSrc = new URL(src, el.ownerDocument?.baseURI).href;
      } catch {
        /* keep original */
      }
      return `![${normalizeWhitespace(alt)}](${fullSrc})`;
    }

    case 'BLOCKQUOTE': {
      const inner = childrenToMarkdown(el, context).trim();
      return (
        '\n' +
        inner
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') +
        '\n'
      );
    }

    case 'TABLE':
      return '\n' + tableToMarkdown(el) + '\n';

    case 'UL':
    case 'OL':
      return '\n' + listToMarkdown(el) + '\n';

    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'MAIN':
    case 'ASIDE':
    case 'FIGURE': {
      const inner = childrenToMarkdown(el, context);
      // Add line breaks around block-level wrappers for clean separation
      return `\n${inner}\n`;
    }

    case 'FIGCAPTION': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `\n*${inner}*\n` : '';
    }

    case 'SPAN':
    case 'LABEL':
    case 'SMALL':
    case 'ABBR':
    case 'CITE':
    case 'DFN':
    case 'Q':
    case 'TIME':
    case 'MARK':
      return childrenToMarkdown(el, context);

    case 'DD': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `\n: ${inner}\n` : '';
    }

    case 'DT': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner ? `\n**${inner}**\n` : '';
    }

    default:
      return childrenToMarkdown(el, context);
  }
}

/**
 * Convert all children of a node to Markdown.
 */
export function childrenToMarkdown(
  node: Node,
  context: ConversionContext = {},
): string {
  const parts: string[] = [];
  node.childNodes.forEach((child) => {
    parts.push(nodeToMarkdown(child, context));
  });
  return parts.join('');
}

/**
 * Post-process Markdown: collapse excessive blank lines, fix spacing, trim.
 */
export function cleanMarkdown(md: string): string {
  return normalizeUnicodeText(md)
    // Fix link spacing: ensure space before [ if preceded by a word char
    .replace(/(\w)\[/g, '$1 [')
    // Fix link spacing: ensure space after ) if followed by a word char
    .replace(/\)(\w)/g, ') $1')
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove leading/trailing whitespace on lines
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trim();
}

function safeMarkdownLinkUrl(value: string, baseUrl?: string): string {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl);
    return /^(?:https?|mailto):$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

type TrustedHtmlPolicy = {
  createHTML(input: string): unknown;
};

type TrustedTypesFactory = {
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedHtmlPolicy;
};

const TRUSTED_HTML_POLICY_KEY = '__copyAsMarkdownTrustedHtmlPolicy';

export function parseHtmlDocument(html: string): Document {
  const globalWithTrustedTypes = globalThis as typeof globalThis & {
    trustedTypes?: TrustedTypesFactory;
    [TRUSTED_HTML_POLICY_KEY]?: TrustedHtmlPolicy;
  };
  const trustedTypes = globalWithTrustedTypes.trustedTypes;
  let input: string | unknown = html;

  if (trustedTypes) {
    let policy = globalWithTrustedTypes[TRUSTED_HTML_POLICY_KEY];
    if (!policy) {
      policy = trustedTypes.createPolicy('copy-as-markdown-html', {
        createHTML: (value) => value,
      });
      globalWithTrustedTypes[TRUSTED_HTML_POLICY_KEY] = policy;
    }
    input = policy.createHTML(html);
  }

  return new DOMParser().parseFromString(input as string, 'text/html');
}

/**
 * Convert HTML string to Markdown.
 */
export function htmlToMarkdown(html: string): string {
  const doc = parseHtmlDocument(html);
  return cleanMarkdown(nodeToMarkdown(doc.body));
}

/**
 * Convert a DOM element to Markdown.
 */
export function elementToMarkdown(element: Element): string {
  return cleanMarkdown(nodeToMarkdown(element));
}

/**
 * Format useful page context as a YAML-like frontmatter block.
 *
 * Extractors may track diagnostics and collection sizes internally, but those
 * values duplicate visible content and waste agent context. Filter them here
 * so every extractor follows the same compact output contract.
 */
export function formatMetadata(metadata: PageMetadata, bodyMarkdown = ''): string {
  const lines = ['---'];
  const normalizedBody = normalizeContextText(bodyMarkdown);
  const entries = Object.entries(metadata)
    .filter(([key, value]) => shouldIncludeMetadata(key, value, normalizedBody))
    .sort(([left], [right]) => metadataPriority(left) - metadataPriority(right));
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined && value !== '') {
      lines.push(`${key}: ${formatMetadataValue(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Keep ordinary metadata readable while quoting values that could change the
 * meaning or structure of this YAML-like header. JSON-style escaping is valid
 * for YAML double-quoted scalars and keeps every value on one physical line.
 */
function formatMetadataValue(value: string | number): string {
  if (typeof value === 'number') return String(value);

  if (isSafeMetadataPlainValue(value)) return value;

  return `"${escapeMetadataQuotedValue(value)}"`;
}

function isSafeMetadataPlainValue(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  if (isSafeMetadataJsonValue(value)) return true;
  if (/^[.]{3}$|^-{3}$/.test(value)) return false;
  if (/---|\.\.\./.test(value)) return false;
  if (/[\u0000-\u001F\u007F-\u009F\uD800-\uDFFF\u2028\u2029]/u.test(value)) return false;
  if (/[\\"':]/u.test(value)) return false;
  if (/(?:^|\s)#/u.test(value)) return false;
  if (/^[\-?:,[\]{}&*!|>@`]/u.test(value)) return false;
  return true;
}

function isSafeMetadataJsonValue(value: string): boolean {
  if (!/^[{[]/u.test(value)) return false;
  if (/[\u0000-\u001F\u007F-\u009F\uD800-\uDFFF\u2028\u2029]/u.test(value)) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function escapeMetadataQuotedValue(value: string): string {
  let escaped = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    switch (character) {
      case '\\': escaped += '\\\\'; break;
      case '"': escaped += '\\"'; break;
      case '\b': escaped += '\\b'; break;
      case '\f': escaped += '\\f'; break;
      case '\n': escaped += '\\n'; break;
      case '\r': escaped += '\\r'; break;
      case '\t': escaped += '\\t'; break;
      default:
        if (
          codePoint < 0x20
          || (codePoint >= 0x7f && codePoint <= 0x9f)
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)
          || codePoint === 0x2028
          || codePoint === 0x2029
        ) {
          escaped += `\\u${codePoint.toString(16).padStart(4, '0')}`;
        } else {
          escaped += character;
        }
    }
  }
  return escaped;
}

const OMITTED_METADATA_KEYS = new Set([
  'source',
  'content_source',
  'complete',
  'completeness',
  'truncated',
  'scope',
  'route',
  'type',
  'messages',
  'tables',
  'code_blocks',
  'media_items',
  'transcript_segments',
  'rendered_blocks',
  'rendered_database_rows',
  'included_database_rows',
  'reactions',
  'comments',
  'shares',
  'views',
  'likes',
  'lines',
  'bytes',
  'size',
  'entries',
  'directories',
  'files',
  'commits',
  'changed_files',
  'additions',
  'deletions',
  'patch_bytes',
  'patch_url',
  'patch_api_url',
  'raw_url',
  'speaker_notes',
  'output_limits',
  'reading_time',
]);

function shouldIncludeMetadata(
  key: string,
  value: string | number | undefined,
  normalizedBody: string,
): boolean {
  const normalized = key.toLowerCase();
  if (OMITTED_METADATA_KEYS.has(normalized)) return false;
  if (/(?:^|_)(?:count|total|included|found)$/.test(normalized)) return false;
  if (normalized === 'title' || normalized === 'url' || value === undefined) return true;

  const normalizedValue = normalizeContextText(String(value));
  if (normalizedValue.length < 3) return true;
  return !normalizedBody.includes(normalizedValue);
}

function normalizeContextText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function metadataPriority(key: string): number {
  if (key === 'title') return 0;
  if (key === 'url') return 1;
  return 2;
}

/**
 * Build a complete page Markdown with metadata header.
 */
export function buildPageMarkdown(
  metadata: PageMetadata,
  bodyMarkdown: string,
): string {
  const parts: string[] = [];
  if (metadata && Object.keys(metadata).length > 0) {
    parts.push(formatMetadata(metadata, bodyMarkdown));
  }
  parts.push(bodyMarkdown);
  return cleanMarkdown(parts.join('\n\n'));
}
