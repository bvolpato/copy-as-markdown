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
  return withPreservedCode(value, (prose) => prose.replace(/\\/g, '\\\\'))
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
  // Keep headers, every body row, and footers without collecting nested tables.
  const trElements = [
    ...tableEl.querySelectorAll(':scope > thead > tr'),
    ...tableEl.querySelectorAll(':scope > tr, :scope > tbody > tr'),
    ...tableEl.querySelectorAll(':scope > tfoot > tr'),
  ];

  if (trElements.length === 0) return '';

  let maxCols = 0;
  const allRowCells: string[][] = [];
  const groupSizes = new Map<Element | null, number>();
  for (const tr of trElements) {
    groupSizes.set(tr.parentElement, (groupSizes.get(tr.parentElement) || 0) + 1);
  }
  let previousGroup: Element | null = null;
  let groupRow = 0;
  let rowSpans: number[] = [];

  for (const tr of trElements) {
    if (tr.parentElement !== previousGroup) {
      rowSpans = [];
      groupRow = 0;
      previousGroup = tr.parentElement;
    }
    const occupied = rowSpans.map((remaining) => remaining > 0);
    rowSpans = rowSpans.map((remaining) => Math.max(0, remaining - 1));
    const values: string[] = occupied.map(() => '');
    const cells = Array.from(tr.querySelectorAll(':scope > th, :scope > td'));
    let column = 0;
    for (const cell of cells) {
      const tableCell = cell as HTMLTableCellElement;
      // HTML caps colspan at 1000. Never allocate rows from a declared rowspan.
      const columnSpan = Math.min(1000, Math.max(1, tableCell.colSpan));
      while (occupied.slice(column, column + columnSpan).some(Boolean)) {
        column += 1;
        while (occupied[column]) column += 1;
      }
      const groupRemaining = (groupSizes.get(tr.parentElement) || 1) - groupRow;
      const rowSpan = tableCell.rowSpan === 0
        ? groupRemaining
        : Math.min(groupRemaining, Math.max(1, tableCell.rowSpan));
      const md = cellToMarkdown(cell);
      for (let offset = 0; offset < columnSpan; offset += 1) {
        values[column + offset] = offset === 0 ? escapeMarkdownTableCell(md) : '';
        occupied[column + offset] = true;
        rowSpans[column + offset] = rowSpan - 1;
      }
      column += columnSpan;
    }
    maxCols = Math.max(maxCols, values.length);
    allRowCells.push(values);
    groupRow += 1;
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
        const text = normalizeMarkdownWhitespace(childrenToMarkdown(el));
        const fullHref = safeMarkdownLinkUrl(href || '', el.ownerDocument?.baseURI);
        if (text && fullHref) {
          parts.push(`[${text}](${fullHref})`);
        } else {
          parts.push(text);
        }
      } else if (tag === 'STRONG' || tag === 'B') {
        parts.push(nodeToMarkdown(el));
      } else if (tag === 'EM' || tag === 'I') {
        parts.push(nodeToMarkdown(el));
      } else if (tag === 'IMG') {
        parts.push(elementToMarkdown(el).trim());
      } else if (tag === 'CODE') {
        parts.push(nodeToMarkdown(el));
      } else if (tag === 'PRE') {
        parts.push(inlineCodeToMarkdown(el.textContent || ''));
      } else if (tag === 'UL' || tag === 'OL') {
        // Flatten list items inline
        const items = Array.from(el.querySelectorAll('li'));
        const listText = items
          .map((li) => cellToMarkdown(li))
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

  return normalizeMarkdownWhitespace(parts.join(''));
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
        text += nodeToMarkdown(node);
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).tagName !== 'UL' &&
        (node as Element).tagName !== 'OL'
      ) {
        // Recursively convert inline elements (links, bold, etc.)
        text += nodeToMarkdown(node);
      }
    });
    const hasCodeBlock = Array.from(li.querySelectorAll('pre'))
      .some((pre) => pre.closest('li') === li);
    text = hasCodeBlock ? cleanMarkdown(text) : normalizeMarkdownWhitespace(text);
    if (text) {
      const continuation = prefix + ' '.repeat(bullet.length + 1);
      const content = text.split('\n')
        .map((line, index) => index && line ? continuation + line : line)
        .join('\n');
      lines.push(`${prefix}${bullet} ${content}`);
    }

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

  if (el.hasAttribute('data-cam-instance')) return '';
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
      return inlineCodeToMarkdown(el.textContent || '');
    }

    case 'PRE': {
      const codeEl = el.querySelector('code');
      const code = codeEl
        ? codeEl.textContent || ''
        : el.textContent || '';
      const lang = codeEl
        ? (codeEl.className.match(/language-([\w.+#-]+)/) || ['', ''])[1]
        : '';
      return `\n${fencedCodeToMarkdown(code, lang)}\n`;
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
      const alt = escapeMarkdownLinkText(normalizeWhitespace(el.getAttribute('alt') || ''));
      const src = el.getAttribute('src') || '';
      const fullSrc = safeMarkdownLinkUrl(src, el.ownerDocument?.baseURI, false);
      return fullSrc ? `![${alt}](${fullSrc})` : alt;
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

function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const match of value.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
}

export function fencedCodeToMarkdown(code: string, language = ''): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(code) + 1));
  const ending = code && !code.endsWith('\n') ? '\n' : '';
  return `${fence}${language.replace(/[^\w.+#-]/g, '')}\n${code}${ending}${fence}`;
}

/** Encode a literal code span with CommonMark delimiters and padding. */
export function inlineCodeToMarkdown(text: string): string {
  const inner = text.replace(/\r\n?|\n/g, ' ');
  if (!inner) return '';
  const delimiter = '`'.repeat(longestBacktickRun(inner) + 1);
  const padding = /^`|`$/.test(inner) || (/^ .* $/.test(inner) && /[^ ]/.test(inner)) ? ' ' : '';
  return `${delimiter}${padding}${inner}${padding}${delimiter}`;
}

/** Keep Markdown code literal while applying prose-only cleanup. */
function withPreservedCode(value: string, transform: (prose: string) => string): string {
  let prefix = 'COPYASMARKDOWNCODE';
  while (value.includes(prefix)) prefix += 'X';
  const literals: string[] = [];
  const protect = (literal: string): string => `${prefix}${literals.push(literal) - 1}TOKEN`;
  const protectInlineParagraph = (prose: string): string => {
    const runs = Array.from(prose.matchAll(/`+/g));
    const next = new Map<number, number>();
    const closings = runs.map(() => -1);
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const length = runs[index][0].length;
      closings[index] = next.get(length) ?? -1;
      next.set(length, index);
    }
    const parts: string[] = [];
    let position = 0;
    for (let index = 0; index < runs.length; index += 1) {
      const start = runs[index].index!;
      let slashes = 0;
      while (prose[start - slashes - 1] === '\\') slashes += 1;
      const closing = closings[index];
      if (slashes % 2 || closing < 0) continue;
      const end = runs[closing].index! + runs[closing][0].length;
      parts.push(prose.slice(position, start), protect(prose.slice(start, end)));
      position = end;
      index = closing;
    }
    return parts.join('') + prose.slice(position);
  };
  const protectInline = (prose: string): string => prose
    .split(/(\n(?:[ \t]*> ?)*[ \t]*\n)/)
    .map((part, index) => index % 2 ? part : protectInlineParagraph(part))
    .join('');

  const parts: string[] = [];
  let proseStart = 0;
  let fenceStart = -1;
  let fence = '';
  let quoteDepth = 0;
  for (const line of value.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue;
    const match = line[0].replace(/\r?\n$/, '').match(/^((?:[ \t]*> ?)*[ \t]*)((?:[-+*]|\d+[.)]) +)?(`{3,}|~{3,})(.*)$/);
    if (!match) continue;
    const depth = (match[1].match(/>/g) || []).length;
    if (fenceStart < 0) {
      if (match[3][0] === '`' && match[4].includes('`')) continue;
      parts.push(protectInline(value.slice(proseStart, line.index)));
      fenceStart = line.index!;
      fence = match[3];
      quoteDepth = depth;
    } else if (
      depth === quoteDepth && !match[2] && match[3][0] === fence[0]
      && match[3].length >= fence.length && /^[ \t]*$/.test(match[4])
    ) {
      const end = line.index! + line[0].replace(/\n$/, '').length;
      parts.push(protect(value.slice(fenceStart, end)));
      proseStart = end;
      fenceStart = -1;
    }
  }
  parts.push(fenceStart < 0 ? protectInline(value.slice(proseStart)) : protect(value.slice(fenceStart)));
  return transform(parts.join('')).replace(new RegExp(`${prefix}(\\d+)TOKEN`, 'g'), (_, index: string) => literals[Number(index)]);
}

function normalizeMarkdownWhitespace(value: string): string {
  return withPreservedCode(value, normalizeWhitespace);
}

/**
 * Post-process Markdown: collapse excessive blank lines, fix spacing, trim.
 */
export function cleanMarkdown(md: string): string {
  return withPreservedCode(md, (prose) => normalizeUnicodeText(prose)
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
    .trim());
}

function safeMarkdownLinkUrl(value: string, baseUrl?: string, allowMailto = true): string {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl);
    if (!/^https?:$/.test(url.protocol) && !(allowMailto && url.protocol === 'mailto:')) return '';
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29');
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
