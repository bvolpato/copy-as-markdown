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
  return withPreservedCode(value, (prose) => prose.replace(/([\\|])/g, '\\$1'), (code) => {
    // Table pipes need an escape; backslashes inside code are already literal.
    const parts: string[] = [];
    for (const character of code) parts.push(character === '|' ? '\\|' : character);
    return parts.join('');
  })
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
const JOINABLE = /[\p{Letter}\p{Mark}\p{Decimal_Number}]/u;
// Joiners between characters of these scripts have no meaning.
const NON_JOINING = /[\p{ASCII}\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const EMOJI_SUFFIX = /[\p{Emoji_Modifier}\uFE0F]/u;

// England, Scotland, and Wales flags spell their region in tag characters.
const SUBDIVISION_FLAGS = new Set(['gbeng', 'gbsct', 'gbwls'].map((region) => (
  `\u{1F3F4}${Array.from(region, (letter) => String.fromCodePoint(0xe0000 + letter.charCodeAt(0))).join('')}\u{E007F}`
)));

// NFKC corrupts these characters. It joins superscripts, fractions, and circled numbers to
// adjacent digits, replaces spacing accents with a space and a combining mark, splits Thai and
// Lao vowels and digraphs, and turns Hangul compatibility letters into conjoining letters.
// Double primes stay intact for the ASCII punctuation table.
const NFKC_SAFE_RUN = new RegExp(`[^${[
  String.raw`\u00AA\u00B2\u00B3\u00B9\u00BA\u02B0-\u02B8\u02E0-\u02E4\u1D2C-\u1D6A\u1D78\u1D9B-\u1DBF`,
  String.raw`\u2070\u2071\u2074-\u208E\u2090-\u209C\u2120\u2122\u2C7C\u2C7D`,
  String.raw`\u00BC-\u00BE\u2150-\u215F\u2189\u2460-\u2473\u24EA\u3251-\u325F\u32B1-\u32BF`,
  String.raw`\u00A8\u00AF\u00B4\u00B8\u02D8-\u02DD\u037A\u0384\u0385\u1FBD\u1FBF-\u1FC1\u1FCD-\u1FCF`,
  String.raw`\u1FDD-\u1FDF\u1FED\u1FEE\u1FFE\u2017\u203E\u309B\u309C\uFFE3`,
  String.raw`\u0E33\u0EB3\u0EDC\u0EDD\u3131-\u318E\u2033\u2036`,
].join('')}]+`, 'gu');

const PURE_PRINTABLE_ASCII = /^[\t\n\r\x20-\x7e]*$/;

// Every character that cleanCharacters can change. Other lines stay as they are.
const NEEDS_CLEANUP = new RegExp([
  String.raw`(?![\t\n\r -])[\p{Separator}\p{Dash_Punctuation}\p{Default_Ignorable_Code_Point}`,
  String.raw`\p{Control}\p{Private_Use}\p{Surrogate}\p{Noncharacter_Code_Point}\u2800`,
  `${Array.from(ASCII_PUNCTUATION.keys()).join('')}]`,
].join(''), 'u');

/**
 * Normalize compatibility characters and remove common invisible watermark
 * channels without transliterating ordinary non-ASCII language text.
 */
export function normalizeUnicodeText(text: string): string {
  if (!text) return '';
  if (PURE_PRINTABLE_ASCII.test(text)) return text;

  return text.replace(NFKC_SAFE_RUN, (run) => run.normalize('NFKC'))
    .split('\n')
    .map((line) => (NEEDS_CLEANUP.test(line) ? cleanCharacters(line) : line))
    .join('\n');
}

function cleanCharacters(text: string): string {
  const characters = Array.from(text);
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
      if (isMeaningfulJoiner(characters, index)) output.push(character);
      continue;
    }
    if (character === '\uFE0E' || character === '\uFE0F') {
      const previous = characters[index - 1] || '';
      if (
        EXTENDED_PICTOGRAPHIC.test(previous)
        || (/[0-9#*]/.test(previous) && characters[index + 1] === '\u20E3')
      ) {
        output.push(character);
      }
      continue;
    }
    if (character === '\u{1F3F4}') {
      const flag = characters.slice(index, index + 7).join('');
      if (SUBDIVISION_FLAGS.has(flag)) {
        output.push(flag);
        index += 6;
        continue;
      }
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

function isMeaningfulJoiner(characters: string[], index: number): boolean {
  const previous = characters[index - 1] || '';
  const next = characters[index + 1] || '';
  if (EXTENDED_PICTOGRAPHIC.test(next)) {
    return EXTENDED_PICTOGRAPHIC.test(previous)
      || (EMOJI_SUFFIX.test(previous) && EXTENDED_PICTOGRAPHIC.test(characters[index - 2] || ''));
  }
  if (!JOINABLE.test(previous) || NON_JOINING.test(previous)) return false;
  // A final zero-width joiner selects a letter form in Arabic and Indic scripts.
  if (!JOINABLE.test(next)) return characters[index] === '\u200D';
  return !NON_JOINING.test(next);
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
  const captionEl = tableEl.querySelector(':scope > caption');
  const caption = captionEl && !isHiddenOrInjectedElement(captionEl)
    ? wrapInlineDelimiter(joinLines(childrenToMarkdown(captionEl, { em: true })), '*')
    : '';
  const codeBlock = findLineNumberedCode(tableEl);
  if (codeBlock) return [caption, nodeToMarkdown(codeBlock).trim()].filter(Boolean).join('\n\n');

  const trElements = tableRows(tableEl);

  if (trElements.length === 0) return caption;

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
    const cells = tableCells(tr);
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
      const md = isHiddenOrInjectedElement(cell) ? '' : cellToMarkdown(cell);
      // Spans that reach past every real cell, such as colspan="100%", add no columns.
      maxCols = Math.max(maxCols, column + 1);
      for (let offset = 0; offset < columnSpan; offset += 1) {
        values[column + offset] = offset === 0 ? escapeMarkdownTableCell(md) : '';
        occupied[column + offset] = true;
        rowSpans[column + offset] = rowSpan - 1;
      }
      column += columnSpan;
    }
    // Hidden rows still consume row spans.
    if (!isHiddenRow(tr)) allRowCells.push(values);
    groupRow += 1;
  }

  if (maxCols === 0 || allRowCells.length === 0) return caption;

  // Give all rows maxCols columns
  for (const row of allRowCells) {
    while (row.length < maxCols) row.push('');
    row.length = maxCols;
  }

  // Build the table: first row is header, then separator, then rest
  const lines: string[] = caption ? [caption, ''] : [];
  lines.push('| ' + allRowCells[0].join(' | ') + ' |');
  lines.push('| ' + allRowCells[0].map(() => '---').join(' | ') + ' |');

  for (let i = 1; i < allRowCells.length; i++) {
    lines.push('| ' + allRowCells[i].join(' | ') + ' |');
  }

  return lines.join('\n');
}

/** Collect headers, every body row, and footers without nested table rows. */
function tableRows(tableEl: Element): Element[] {
  return [
    ...tableEl.querySelectorAll(':scope > thead > tr'),
    ...tableEl.querySelectorAll(':scope > tr, :scope > tbody > tr'),
    ...tableEl.querySelectorAll(':scope > tfoot > tr'),
  ];
}

/** Check a row and its section. */
function isHiddenRow(tr: Element): boolean {
  return isHiddenOrInjectedElement(tr) || (tr.parentElement !== null && isHiddenOrInjectedElement(tr.parentElement));
}

/** Collect the cells that occupy a column. */
function tableCells(tr: Element): Element[] {
  return Array.from(tr.querySelectorAll<HTMLElement>(':scope > th, :scope > td')).filter((cell) => (
    cell.style?.display !== 'none' && !hasHiddenAttribute(cell) && !cell.hasAttribute('data-cam-instance')
  ));
}

/** Find the code in a table that only places line numbers next to a code block. */
function findLineNumberedCode(tableEl: Element): Element | null {
  const rows = tableRows(tableEl);
  if (rows.length !== 1 || isHiddenRow(rows[0])) return null;
  const cells = tableCells(rows[0]);
  const codeCell = cells.pop();
  if (!codeCell || isHiddenOrInjectedElement(codeCell)) return null;
  const blocks = codeCell.querySelectorAll('pre');
  if (blocks.length !== 1 || codeCell.textContent?.trim() !== blocks[0].textContent?.trim()) return null;
  const lineCount = codeText(blocks[0]).trimEnd().split('\n').length;
  return cells.every((cell) => isLineNumberCell(cell, lineCount)) ? blocks[0] : null;
}

/** Other numbers, such as a status code or a sample input, are data. */
function isLineNumberCell(cell: Element, lineCount: number): boolean {
  if (!/^[\s\d]*$/.test(cell.textContent || '')) return false;
  if (LINE_NUMBER_CLASS.test(cell.getAttribute('class') || '')) return true;
  const unmarked = codeText(cell).trim();
  if (!unmarked) return true;
  const numbers = unmarked.split(/\s+/).map(Number);
  return lineCount > 1 && numbers.length === lineCount
    && numbers.every((number, index) => number === numbers[0] + index);
}

function hasHiddenAttribute(el: Element): boolean {
  // Browsers reveal until-found content through search, so it is part of the page text.
  const value = el.getAttribute('hidden');
  return value !== null && value.toLowerCase() !== 'until-found';
}

function isHiddenOrInjectedElement(el: Element): boolean {
  if (el.hasAttribute('data-cam-instance')) return true;
  if (hasHiddenAttribute(el) || el.getAttribute('aria-hidden') === 'true') return true;
  if (el.tagName.toUpperCase() === 'DIALOG' && !el.hasAttribute('open')) return true;
  const style = (el as HTMLElement).style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  return false;
}

const NOISE_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'NAV', 'FOOTER',
]);

function isNoiseElement(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  // A footer inside a quotation names its source.
  return NOISE_TAGS.has(tag) && !(tag === 'FOOTER' && el.closest('blockquote'));
}

const LIST_TAGS = new Set(['UL', 'OL', 'MENU']);

const CELL_BLOCK_TAGS = new Set([
  'DIV', 'P', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'MAIN', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY', 'ADDRESS', 'FORM',
  'FIELDSET', 'LEGEND', 'HGROUP', 'CENTER', 'SEARCH', 'HR', 'LI', 'OPTION', 'TEXT',
]);

const INLINE_DELIMITERS = new Map([
  ['STRONG', '**'], ['B', '**'],
  ['EM', '*'], ['I', '*'],
  ['DEL', '~~'], ['S', '~~'], ['STRIKE', '~~'],
  ['CODE', '`'],
]);

const CELL_INLINE_TAGS = new Set([...INLINE_DELIMITERS.keys(), 'SUP', 'SUB', 'Q', 'RT', 'MATH']);

const BLOCK_CONTENT = 'h1, h2, h3, h4, h5, h6, ul, ol, menu, pre, table, blockquote, dl, hr';

/** Put text from several source lines on one line. */
function joinLines(value: string): string {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).join(' ');
}

function edgeWhitespace(whitespace: string): string {
  if (!whitespace) return '';
  return whitespace.includes('\n') ? '\n' : ' ';
}

function wrapInlineDelimiter(raw: string, delimiter: string): string {
  const inner = raw.trim();
  // Whitespace-only elements still separate words.
  if (!inner) return edgeWhitespace(raw);
  const leading = edgeWhitespace(raw.slice(0, raw.length - raw.trimStart().length));
  const trailing = edgeWhitespace(raw.slice(raw.trimEnd().length));
  // Delimiters cannot span paragraphs.
  const wrapped = inner.split(/\n\s*\n/)
    .map((paragraph) => `${delimiter}${paragraph.trim()}${delimiter}`)
    .join('\n\n');
  return `${leading}${wrapped}${trailing}`;
}

/** Convert inline formatting. Block content keeps its structure instead of delimiters. */
function formattedToMarkdown(el: Element, context: ConversionContext, style: 'strong' | 'em' | 'del', delimiter: string): string {
  if (context[style] || el.querySelector(BLOCK_CONTENT)) {
    return childrenToMarkdown(el, context);
  }
  return wrapInlineDelimiter(childrenToMarkdown(el, { ...context, [style]: true }), delimiter);
}

const LINE_NUMBER_CLASS = /(?:^|[\s_-])(?:line-?num(?:ber)?s?|line-?nos?|gutter|lnt?)(?:$|[\s_-])/i;

const CODE_BLOCK_TAGS = new Set(['DIV', 'P', 'PRE', 'OL', 'UL', 'LI', 'TABLE', 'TR']);

/** Read literal code text, with line breaks for elements that create lines. */
function codeText(root: Element): string {
  const parts: string[] = [];
  let endsLine = true;
  let afterBlock = false;
  const push = (text: string): void => {
    if (!text) return;
    // A newline after a block is the line break that the block makes.
    if (afterBlock && !/^[^\S\n]*\n/.test(text)) parts.push('\n');
    afterBlock = false;
    parts.push(text);
    endsLine = text.endsWith('\n');
  };
  const breakLine = (): void => {
    afterBlock = false;
    push('\n');
  };
  const visit = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        push(child.textContent || '');
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      if (tag === 'BR') {
        if (afterBlock) breakLine();
        breakLine();
        continue;
      }
      if (isHiddenOrInjectedElement(el) || isNoiseElement(el) || tag === 'BUTTON') continue;
      if (
        LINE_NUMBER_CLASS.test(el.getAttribute('class') || '')
        && /^\s*\d[\s\d]*$/.test(el.textContent || '')
      ) continue;
      const isBlock = CODE_BLOCK_TAGS.has(tag) || /^(?:block|flex|table-row)$/.test(el.style?.display || '');
      if (isBlock && !endsLine) breakLine();
      visit(el);
      if (isBlock && !endsLine) afterBlock = true;
    }
  };
  visit(root);
  return parts.join('');
}

function detectCodeLanguage(preEl: Element, codeEl: Element | null): string {
  const candidates = [
    codeEl?.getAttribute('data-language'),
    codeEl?.getAttribute('data-lang'),
    codeEl?.className,
    preEl.getAttribute('data-language'),
    preEl.getAttribute('data-lang'),
    preEl.className,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const prefixed = candidate.match(/\b(?:language|lang)-([\w.+#-]+)/i);
    if (prefixed) return prefixed[1];
  }
  const explicit = codeEl?.getAttribute('data-language')
    || codeEl?.getAttribute('data-lang')
    || preEl.getAttribute('data-language')
    || preEl.getAttribute('data-lang');
  if (explicit && /^[\w.+#-]+$/.test(explicit.trim())) return explicit.trim();

  const syntaxParams = preEl.getAttribute('data-syntaxhighlighter-params') || '';
  const brushMatch = syntaxParams.match(/\bbrush\s*:\s*([\w.+#-]+)/i);
  if (brushMatch) return brushMatch[1];

  // GitHub, Rouge, and VitePress declare the language on a wrapper element.
  for (const wrapper of [preEl.parentElement, preEl.parentElement?.parentElement]) {
    const wrapped = wrapper?.getAttribute('class')?.match(/(?:^|\s)(?:highlight-source|language)-([\w.+#-]+)/);
    if (wrapped && !/^(?:none|text|plaintext|default)$/i.test(wrapped[1])) return wrapped[1];
  }

  return '';
}

const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"], annotation[encoding="TeX"]';

/** Read the TeX source that KaTeX, LaTeXML, or MediaWiki stores with rendered math. */
function mathTexSource(mathEl: Element): string {
  const tex = mathEl.querySelector(TEX_ANNOTATION)?.textContent || mathEl.getAttribute('alttext');
  if (tex?.trim()) return tex;
  try {
    const source = JSON.parse(mathEl.getAttribute('data-mw') || '{}')?.body?.extsrc;
    return typeof source === 'string' ? source : '';
  } catch {
    return '';
  }
}

function texToMarkdown(tex: string, display: boolean, context: ConversionContext): string {
  const source = tex.replace(/\s+/g, ' ').trim().replace(/^\{\\displaystyle (.*)\}$/, '$1').trim();
  if (!source) return '';
  // The code form of inline math keeps its backslashes when table cells are escaped.
  if (context.tableCell) return `$${inlineCodeToMarkdown(source)}$`;
  const delimiter = display ? '$$' : '$';
  return `${delimiter}${source}${delimiter}`;
}

/** Linearize MathML that has no TeX source. */
function mathmlToText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const name = el.localName.toLowerCase();
  if (name === 'annotation' || name === 'annotation-xml' || name === 'mphantom') return '';
  const part = (index: number): string => (el.children[index] ? mathmlToText(el.children[index]).trim() : '');
  const group = (text: string): string => (/^(?:\p{Letter}|[\p{Number}.]*)$/u.test(text) ? text : `(${text})`);
  switch (name) {
    case 'msup':
    case 'mover':
      return `${part(0)}^(${part(1)})`;
    case 'msub':
    case 'munder':
      return `${part(0)}_(${part(1)})`;
    case 'msubsup':
    case 'munderover':
      return `${part(0)}_(${part(1)})^(${part(2)})`;
    case 'mfrac':
      return `${group(part(0))}/${group(part(1))}`;
    case 'mroot':
      return `root(${part(0)}, ${part(1)})`;
    default: {
      const isToken = el.children.length === 0;
      const inner = Array.from(isToken ? el.childNodes : el.children, mathmlToText).join('');
      if (name === 'msqrt') return `sqrt(${inner.trim()})`;
      if (name === 'mtd') return `${inner.trim()} `;
      if (name === 'mtr') return `${inner.trim()}; `;
      if (name === 'mtable') return inner.replace(/; $/, '');
      return isToken && name !== 'mtext' ? inner.trim() : inner;
    }
  }
}

/**
 * Convert the inner content of a table cell to inline Markdown.
 * Handles links, bold, italic, line breaks, and nested text.
 */
function cellToMarkdown(cell: Element): string {
  return cellNodesToMarkdown(cell.childNodes);
}

function cellNodesToMarkdown(nodes: Iterable<Node>): string {
  return withPreservedCode(cellContentToMarkdown(nodes), (prose) => prose
    .split('\n')
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join('; '));
}

/** Convert cell content without trimming it. Newlines stand for line breaks. */
function cellContentToMarkdown(nodes: Iterable<Node>): string {
  return joinSiblings(nodes, (node) => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === 'IMG') return nodeToMarkdown(el, { tableCell: true });
    if (isHiddenOrInjectedElement(el) || isNoiseElement(el)) return '';

    if (tag === 'BR') return '\n';
    if (tag === 'A') return linkToMarkdown(el, { tableCell: true }, false).replace(/\n+/g, ' ');
    if (tag === 'PRE') {
      const lines = codeText(el).split(/\r\n?|\n/);
      while (lines.length > 0 && !lines[lines.length - 1]) lines.pop();
      return ` ${lines.map(inlineCodeToMarkdown).join('<br>')} `;
    }
    if (tag === 'TABLE') {
      const rows = tableRows(el)
        .filter((row) => !isHiddenRow(row))
        .map((row) => tableCells(row)
          .filter((inner) => !isHiddenOrInjectedElement(inner))
          .map(cellToMarkdown)
          .filter(Boolean))
        .filter((row) => row.length > 0);
      const rowSeparator = rows.some((row) => row.length > 1) ? '; ' : ' ';
      const caption = el.querySelector(':scope > caption');
      const captionText = caption && !isHiddenOrInjectedElement(caption) ? ` ${cellToMarkdown(caption)}` : '';
      return `${captionText} ${rows.map((row) => row.join(' ')).join(rowSeparator)} `;
    }
    if (LIST_TAGS.has(tag)) {
      // Flatten direct list items inline without duplicating nested lists.
      const items = listEntries(el).map((entry) => cellNodesToMarkdown(isListItem(entry) ? entry.childNodes : [entry]));
      return ` ${items.filter(Boolean).join('; ')} `;
    }
    if (CELL_BLOCK_TAGS.has(tag)) return ` ${cellContentToMarkdown(el.childNodes)} `;
    if (CELL_INLINE_TAGS.has(tag) && !el.querySelector(BLOCK_CONTENT)) {
      return nodeToMarkdown(el, { tableCell: true }).replace(/\n+/g, ' ');
    }
    // Recurse into other inline elements
    return cellContentToMarkdown(el.childNodes);
  });
}

function isListElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && LIST_TAGS.has((node as Element).tagName.toUpperCase());
}

function isListItem(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toUpperCase() === 'LI';
}

/** Check for an item, or for a link around one item. */
function isItemEntry(node: Node): boolean {
  if (isListItem(node)) return true;
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  const items = el.querySelectorAll('li');
  return el.matches('a[href]:not([href^="#"])') && el.childElementCount === 1
    && items.length === 1 && items[0].parentElement === el && !isHiddenOrInjectedElement(items[0]);
}

/** List content in order, including content outside items and items inside custom wrappers. */
function listEntries(listEl: Element): Node[] {
  return Array.from(listEl.childNodes).flatMap((child): Node[] => {
    if (child.nodeType === Node.TEXT_NODE) return child.textContent?.trim() ? [child] : [];
    if (child.nodeType !== Node.ELEMENT_NODE) return [];
    const el = child as Element;
    if (isHiddenOrInjectedElement(el) || isNoiseElement(el)) return [];
    return isItemEntry(el) || isListElement(el) || !el.querySelector('li') ? [el] : listEntries(el);
  });
}

/** Convert list item content with nested lists in document order. */
function listItemToMarkdown(item: Node): { body: string; hasText: boolean } {
  let body = '';
  let hasText = false;
  let run: Node[] = [];
  const flushRun = (): void => {
    const text = joinSiblings(run, (node) => nodeToMarkdown(node));
    run = [];
    if (!text.trim()) return;
    body += body ? `\n\n${text}` : text;
    hasText = true;
  };
  for (const node of isListItem(item) ? item.childNodes : [item]) {
    if (!isListElement(node)) {
      run.push(node);
      continue;
    }
    flushRun();
    const nested = isHiddenOrInjectedElement(node as Element) ? '' : listToMarkdown(node as Element);
    if (nested) body = body ? `${body.trimEnd()}\n${nested}` : nested;
  }
  flushRun();

  const itemEl = item.nodeType === Node.ELEMENT_NODE ? item as Element : null;
  const owner = itemEl?.closest('li');
  const owns = (selector: string, minimum: number): boolean => Array.from(itemEl?.querySelectorAll(selector) || [])
    .filter((el) => el.closest('li') === owner).length >= minimum;
  const hasBlockContent = owns(`${BLOCK_CONTENT}, menu`, 1) || owns('p', 2);
  return { body: hasBlockContent ? cleanMarkdown(body) : normalizeMarkdownWhitespace(body), hasText };
}

/**
 * Convert an HTML list (ul/ol) to Markdown.
 */
export function listToMarkdown(listEl: Element, indent = 0): string {
  const entries = listEntries(listEl);
  const isOrdered = listEl.tagName.toUpperCase() === 'OL';
  const step = isOrdered && listEl.hasAttribute('reversed') ? -1 : 1;
  const startAttr = Number.parseInt(listEl.getAttribute('start') || '', 10);
  let number = step < 0 ? entries.filter(isItemEntry).length : 1;
  if (Number.isFinite(startAttr)) number = startAttr;
  const prefix = ' '.repeat(indent);
  const lines: string[] = [];
  let childIndent = indent;

  for (const entry of entries) {
    if (isListElement(entry)) {
      const nested = listToMarkdown(entry as Element, childIndent);
      if (nested) lines.push(nested);
      continue;
    }
    let bullet = '-';
    if (isOrdered && isItemEntry(entry)) {
      const value = Number.parseInt((entry as Element).getAttribute('value') || '', 10);
      if (Number.isFinite(value)) number = value;
      bullet = `${number}.`;
      number += step;
    }
    childIndent = indent + bullet.length + 1;

    const { body, hasText } = listItemToMarkdown(entry);
    if (!body) continue;
    const continuation = ' '.repeat(childIndent);
    const content = body.split('\n')
      .map((line, lineIdx) => line && (lineIdx || !hasText) ? continuation + line : line)
      .join('\n');
    lines.push(hasText ? `${prefix}${bullet} ${content}` : content);
  }

  return lines.join('\n');
}

interface ConversionContext {
  preserveWhitespace?: boolean;
  strong?: boolean;
  em?: boolean;
  del?: boolean;
  tableCell?: boolean;
}

/** Check whether a checkbox is the first content of its list item. */
function isTaskCheckbox(el: Element): boolean {
  const item = el.closest('li');
  if (!item || el.getAttribute('type')?.toLowerCase() !== 'checkbox') return false;
  for (let node: Node = el; node !== item; node = node.parentNode!) {
    for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (sibling.textContent?.trim()) return false;
    }
  }
  return true;
}

function linkToMarkdown(el: Element, context: ConversionContext, showBareUrl = true): string {
  const href = el.getAttribute('href') || '';
  const raw = childrenToMarkdown(el, context);
  const text = joinLines(raw);
  // Skip internal anchor-only links (e.g. [1], [2] footnotes)
  const isAnchor = href.startsWith('#');
  const url = isAnchor ? '' : safeMarkdownLinkUrl(href, el.ownerDocument?.baseURI);
  if (!text) return (showBareUrl && url) || (raw && ' ');
  // Permalink markers are not content. Outside headings, number and section signs are text.
  if (
    isAnchor && /^[#\u00B6\u00A7]$/.test(text)
    && (el.closest('h1, h2, h3, h4, h5, h6, dt') || (text === '\u00B6' && !el.closest('sup')))
  ) return '';
  if (!url) return raw;
  return `${raw.startsWith(' ') ? ' ' : ''}[${text}](${url})${raw.endsWith(' ') ? ' ' : ''}`;
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
  // XHTML and SVG elements keep their lowercase names.
  const tag = el.tagName.toUpperCase();

  // MediaWiki hides its formula images from assistive technology. The alt text is the source.
  const formulaImage = tag === 'IMG' && el.className.match(/\bmwe-math-fallback-image-(inline|display)\b/);
  if (formulaImage) return texToMarkdown(el.getAttribute('alt') || '', formulaImage[1] === 'display', context);

  if (isHiddenOrInjectedElement(el)) return '';
  if (isNoiseElement(el)) return '';

  switch (tag) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(tag[1]);
      const inner = joinLines(childrenToMarkdown(el, context));
      return inner ? `\n${'#'.repeat(level)} ${inner}\n` : '';
    }

    case 'P':
      return `\n${childrenToMarkdown(el, context).trim()}\n`;

    case 'BR':
      return '\n';

    case 'HR':
      // Text directly above a rule would become a heading.
      return '\n\n---\n\n';

    case 'STRONG':
    case 'B':
      return formattedToMarkdown(el, context, 'strong', '**');

    case 'EM':
    case 'I':
      return formattedToMarkdown(el, context, 'em', '*');

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
    case 'STRIKE':
      return formattedToMarkdown(el, context, 'del', '~~');

    case 'CODE': {
      if (el.parentElement?.tagName.toUpperCase() === 'PRE') return codeText(el);
      if (el.querySelector('pre')) return childrenToMarkdown(el, context);
      return inlineCodeToMarkdown(codeText(el));
    }

    case 'PRE': {
      const codeEls = el.querySelectorAll('code');
      const hasOwnText = Array.from(el.childNodes)
        .some((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      const singleCode = codeEls.length === 1 && !hasOwnText ? codeEls[0] : null;
      const lang = detectCodeLanguage(el, singleCode || codeEls[0] || null);
      return `\n${fencedCodeToMarkdown(codeText(singleCode || el), lang)}\n`;
    }

    case 'A':
      return linkToMarkdown(el, context);

    case 'IMG': {
      const alt = escapeMarkdownLinkText(normalizeWhitespace(el.getAttribute('alt') || ''));
      const src = resolveImageSource(el);
      const fullSrc = safeMarkdownLinkUrl(src, el.ownerDocument?.baseURI, false);
      return fullSrc ? `![${alt}](${fullSrc})` : alt;
    }

    case 'INPUT': {
      if (!isTaskCheckbox(el)) return '';
      return `[${(el as HTMLInputElement).checked ? 'x' : ' '}] `;
    }

    case 'MATH': {
      const tex = mathTexSource(el);
      return tex ? texToMarkdown(tex, el.getAttribute('display') === 'block', context) : mathmlToText(el).trim();
    }

    case 'BLOCKQUOTE': {
      const inner = cleanMarkdown(childrenToMarkdown(el, context));
      if (!inner) return '';
      return (
        '\n' +
        inner
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n') +
        '\n\n'
      );
    }

    case 'TABLE':
      return '\n' + tableToMarkdown(el) + '\n\n';

    case 'UL':
    case 'OL':
    case 'MENU':
      return '\n' + listToMarkdown(el) + '\n\n';

    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'MAIN':
    case 'ASIDE':
    case 'FIGURE':
    case 'HEADER':
    case 'FOOTER':
    case 'FORM':
    case 'FIELDSET':
    case 'LEGEND':
    case 'DETAILS':
    case 'SUMMARY':
    case 'ADDRESS':
    case 'HGROUP':
    case 'CENTER':
    case 'SEARCH':
    case 'DL':
    case 'LI':
    case 'TR': {
      const inner = childrenToMarkdown(el, context);
      // Add line breaks around block-level wrappers for clean separation
      return `\n${inner}\n`;
    }

    case 'TD':
    case 'TH':
    case 'OPTION':
    case 'TEXT':
      return ` ${childrenToMarkdown(el, context)} `;

    case 'FIGCAPTION': {
      const inner = formattedToMarkdown(el, context, 'em', '*').trim();
      return inner ? `\n${inner}\n` : '';
    }

    case 'Q': {
      const inner = childrenToMarkdown(el, context);
      return inner.trim() ? `"${inner}"` : inner;
    }

    case 'RT': {
      const inner = childrenToMarkdown(el, context).trim();
      return inner && !el.parentElement?.querySelector(':scope > rp') ? `(${inner})` : inner;
    }

    case 'SPAN':
    case 'LABEL':
    case 'SMALL':
    case 'ABBR':
    case 'CITE':
    case 'DFN':
    case 'TIME':
    case 'MARK':
      return childrenToMarkdown(el, context);

    case 'DD': {
      const inner = childrenToMarkdown(el, context).trim();
      if (!inner) return '';
      // A fence must start its own line.
      return /^(?:`{3}|~{3})/.test(inner) ? `\n${inner}\n` : `\n: ${inner}\n`;
    }

    case 'DT': {
      const inner = formattedToMarkdown(el, context, 'strong', '**').trim();
      return inner ? `\n${inner}\n` : '';
    }

    default:
      return childrenToMarkdown(el, context);
  }
}

/** Join sibling output without gluing bare URLs or repeating adjacent delimiters. */
function joinSiblings(nodes: Iterable<Node>, convert: (node: Node) => string): string {
  const parts: string[] = [];
  let last = '';
  let lastDelimiter = '';
  let lastIsUrl = false;
  for (const node of nodes) {
    let markdown = convert(node);
    // Spaces collapse across elements. Four at a line start would also make a code block.
    if (last.endsWith(' ') && markdown.startsWith(' ')) markdown = markdown.replace(/^ +/, '');
    if (!markdown) continue;
    const tag = node.nodeType === Node.ELEMENT_NODE ? (node as Element).tagName.toUpperCase() : '';
    const delimiter = INLINE_DELIMITERS.get(tag) || '';
    const isUrl = tag === 'A' && /^(?:https?|mailto):\S+$/.test(markdown);
    if (
      delimiter && delimiter === lastDelimiter
      && last.endsWith(delimiter) && markdown.startsWith(delimiter)
      && !(delimiter === '`' && (last.endsWith('``') || markdown.startsWith('``')))
      // Bold-italic on both sides would leave an unmatched delimiter.
      && !(delimiter[0] === '*' && last.endsWith(`*${delimiter}`) && markdown.startsWith(`${delimiter}*`))
    ) {
      parts[parts.length - 1] = last.slice(0, -delimiter.length);
      markdown = markdown.slice(delimiter.length);
    } else if (
      last && (isUrl || lastIsUrl)
      && !/[\s([{"']$/.test(last) && !/^(?:\s|[)\]}.,;:!?"']+(?:\s|$))/.test(markdown)
    ) {
      markdown = ` ${markdown}`;
    }
    parts.push(markdown);
    last = markdown;
    lastDelimiter = delimiter;
    lastIsUrl = isUrl;
  }
  return parts.join('');
}

/**
 * Convert all children of a node to Markdown.
 */
export function childrenToMarkdown(
  node: Node,
  context: ConversionContext = {},
): string {
  return joinSiblings(node.childNodes, (child) => nodeToMarkdown(child, context));
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

function markdownLinePrefix(line: string): { position: number; quoteDepth: number } {
  let position = 0;
  let quoteDepth = 0;
  while (position < line.length) {
    while (line[position] === ' ' || line[position] === '\t') position += 1;
    if (line[position] !== '>') break;
    quoteDepth += 1;
    position += 1;
  }
  return { position, quoteDepth };
}

function markdownFence(line: string) {
  let position = 0;
  let quoteDepth = 0;
  let listMarker = false;
  while (position < line.length) {
    const prefix = markdownLinePrefix(line.slice(position));
    position += prefix.position;
    quoteDepth += prefix.quoteDepth;
    // Quotes and more list items can follow a list marker on the same line.
    const marker = line.slice(position, position + 12).match(/^(?:[-+*]|\d{1,9}[.)]) /);
    if (!marker) break;
    position += marker[0].length;
    listMarker = true;
  }
  const start = position;
  const character = line[position];
  if (character !== '`' && character !== '~') return undefined;
  while (line[position] === character) position += 1;
  if (position - start < 3) return undefined;
  return {
    delimiter: line.slice(start, position),
    info: line.slice(position),
    quoteDepth,
    listMarker,
  };
}

/** Keep Markdown code literal while applying prose-only cleanup. */
function withPreservedCode(
  value: string,
  transform: (prose: string) => string,
  transformCode: (code: string) => string = (code) => code,
): string {
  let prefix = 'COPYASMARKDOWNCODE';
  while (value.includes(prefix)) prefix += 'X';
  const literals: string[] = [];
  const protect = (literal: string): string => `${prefix}${literals.push(transformCode(literal)) - 1}TOKEN`;
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
  const protectInline = (prose: string): string => {
    const parts: string[] = [];
    let paragraphStart = 0;
    let lineStart = 0;
    while (lineStart < prose.length) {
      const lineEnd = prose.indexOf('\n', lineStart);
      if (lineEnd < 0) break;
      const line = prose.slice(lineStart, lineEnd);
      if (lineStart > paragraphStart && markdownLinePrefix(line).position === line.length) {
        parts.push(protectInlineParagraph(prose.slice(paragraphStart, lineStart - 1)));
        parts.push(prose.slice(lineStart - 1, lineEnd + 1));
        paragraphStart = lineEnd + 1;
      }
      lineStart = lineEnd + 1;
    }
    parts.push(protectInlineParagraph(prose.slice(paragraphStart)));
    return parts.join('');
  };

  const parts: string[] = [];
  let proseStart = 0;
  let fenceStart = -1;
  let fence = '';
  let quoteDepth = 0;
  let lineStart = 0;
  for (const rawLine of value.split('\n')) {
    const start = lineStart;
    const end = start + rawLine.length;
    lineStart = end + 1;
    const line = end < value.length && rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = markdownFence(line);
    if (!match) continue;
    if (fenceStart < 0) {
      if (match.delimiter[0] === '`' && match.info.includes('`')) continue;
      parts.push(protectInline(value.slice(proseStart, start)));
      fenceStart = start;
      fence = match.delimiter;
      quoteDepth = match.quoteDepth;
    } else if (
      match.quoteDepth === quoteDepth && !match.listMarker && match.delimiter[0] === fence[0]
      && match.delimiter.length >= fence.length && /^[ \t]*$/.test(match.info)
    ) {
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

const WHITESPACE_CHAR_RE = /\s/;

function isAsciiWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 95;
}

function matchLinkSchemeLength(text: string, start: number): number {
  if (text.startsWith('https:', start)) return 6;
  if (text.startsWith('http:', start)) return 5;
  if (text.startsWith('mailto:', start)) return 7;
  return 0;
}

/**
 * Insert spaces around `[label](http(s):...|mailto:...)` links glued to adjacent word
 * characters, without mangling array indexing, query params, `(s)he`, or `H_(2)O`,
 * and in linear O(n) time without backtracking regexes.
 */
function addSpacesAroundMarkdownLinks(text: string): string {
  const len = text.length;
  let out = '';
  let lastCopied = 0;
  let openBracket = -1;
  let i = 0;

  while (i < len) {
    const ch = text[i];
    if (ch === '\n') {
      openBracket = -1;
      i += 1;
      continue;
    }
    if (ch === '[') {
      openBracket = i;
      i += 1;
      continue;
    }
    if (ch === ']') {
      if (openBracket >= 0 && i > openBracket + 1 && text[i + 1] === '(') {
        const urlStart = i + 2;
        const schemeLen = matchLinkSchemeLength(text, urlStart);
        if (schemeLen > 0) {
          let j = urlStart + schemeLen;
          let pendingOpen = -1;
          while (j < len && text[j] !== ')' && !WHITESPACE_CHAR_RE.test(text[j])) {
            if (text[j] === '[') pendingOpen = j;
            else if (text[j] === ']') pendingOpen = -1;
            j += 1;
          }
          if (j < len && text[j] === ')' && j > urlStart + schemeLen) {
            const needBefore = openBracket > 0 && isAsciiWordChar(text[openBracket - 1]);
            const needAfter = j + 1 < len && isAsciiWordChar(text[j + 1]);
            if (needBefore || needAfter) {
              if (needBefore) {
                out += `${text.slice(lastCopied, openBracket)} ${text.slice(openBracket, j + 1)}`;
              } else {
                out += text.slice(lastCopied, j + 1);
              }
              if (needAfter) out += ' ';
              lastCopied = j + 1;
            }
            openBracket = -1;
            i = j + 1;
            continue;
          }
          openBracket = pendingOpen;
          i = j;
          continue;
        }
      }
      openBracket = -1;
      i += 1;
      continue;
    }
    i += 1;
  }

  if (lastCopied === 0) return text;
  return out + text.slice(lastCopied);
}

/**
 * Post-process Markdown: collapse excessive blank lines, fix link spacing, trim.
 */
export function cleanMarkdown(md: string): string {
  return withPreservedCode(md, (prose) => addSpacesAroundMarkdownLinks(normalizeUnicodeText(prose))
    // Remove trailing whitespace on lines
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n')
    .trim());
}

function isPlaceholderImage(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return true;
  // Links never use these URLs, so any lazy source is better.
  if (/^(?:data|blob):/i.test(trimmed)) return true;
  if (/(?:^|\/)(?:blank|spacer|placeholder|pixel|transparent|1x1)\.(?:gif|png|svg|jpe?g|webp)(?:[?#]|$)/i.test(trimmed)) return true;
  if (trimmed.startsWith('about:blank')) return true;
  return false;
}

function pickSrcsetUrl(srcset: string | null): string {
  if (!srcset) return '';
  // Follow the HTML srcset parsing algorithm so commas inside CDN transformation URLs
  // (e.g. `https://cdn.example/w_800,f_auto,q_auto/pic.jpg 800w`) are preserved intact.
  const candidates: Array<{ url: string; weight: number; order: number }> = [];
  const len = srcset.length;
  let i = 0;
  let order = 0;

  while (i < len) {
    while (i < len && (/\s/.test(srcset[i]) || srcset[i] === ',')) i += 1;
    if (i >= len) break;

    const urlStart = i;
    while (i < len && !/\s/.test(srcset[i])) i += 1;
    let rawUrl = srcset.slice(urlStart, i);
    let descriptor = '';

    if (rawUrl.endsWith(',')) {
      rawUrl = rawUrl.replace(/,+$/, '');
    } else {
      while (i < len && /\s/.test(srcset[i])) i += 1;
      const descStart = i;
      while (i < len && srcset[i] !== ',') i += 1;
      descriptor = srcset.slice(descStart, i).trim();
      if (i < len && srcset[i] === ',') i += 1;
    }

    if (!rawUrl || isPlaceholderImage(rawUrl)) continue;
    const descMatch = descriptor.match(/^([0-9]+(?:\.[0-9]+)?)(w|x)$/i);
    const num = descMatch ? Number(descMatch[1]) : 1;
    const unit = descMatch ? descMatch[2].toLowerCase() : '';
    const weight = unit === 'w' ? num : unit === 'x' ? num * 1000 : 1;
    candidates.push({ url: rawUrl, weight, order: order++ });
  }

  if (candidates.length === 0) return '';
  candidates.sort((a, b) => (b.weight - a.weight) || (b.order - a.order));
  return candidates[0].url;
}

function resolveImageSource(el: HTMLElement): string {
  const img = el as HTMLImageElement;
  const directSrc = el.getAttribute('src') || '';
  if (directSrc && !isPlaceholderImage(directSrc)) return directSrc;

  for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'data-actualsrc']) {
    const candidate = el.getAttribute(attr);
    if (candidate && !isPlaceholderImage(candidate)) return candidate;
  }

  const fromSrcset = pickSrcsetUrl(el.getAttribute('srcset') || el.getAttribute('data-srcset'));
  if (fromSrcset) return fromSrcset;

  const picture = el.parentElement?.tagName === 'PICTURE' ? el.parentElement : null;
  if (picture) {
    for (const source of picture.querySelectorAll('source[srcset], source[data-srcset]')) {
      const candidate = pickSrcsetUrl(source.getAttribute('srcset') || source.getAttribute('data-srcset'));
      if (candidate) return candidate;
    }
  }

  if (img.currentSrc && !isPlaceholderImage(img.currentSrc)) return img.currentSrc;
  return directSrc;
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
  defaultPolicy?: TrustedHtmlPolicy | null;
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedHtmlPolicy;
};

const TRUSTED_HTML_POLICY_KEY = '__copyAsMarkdownTrustedHtmlPolicy';

export function parseHtmlDocument(html: string): Document {
  const globalWithTrustedTypes = globalThis as typeof globalThis & {
    trustedTypes?: TrustedTypesFactory;
    [TRUSTED_HTML_POLICY_KEY]?: TrustedHtmlPolicy | null;
  };
  const trustedTypes = globalWithTrustedTypes.trustedTypes;
  let input: string | unknown = html;

  if (trustedTypes) {
    let policy = globalWithTrustedTypes[TRUSTED_HTML_POLICY_KEY];
    if (policy === undefined) {
      try {
        policy = trustedTypes.createPolicy('copy-as-markdown-html', {
          createHTML: (value) => value,
        });
      } catch {
        policy = trustedTypes.defaultPolicy || null;
      }
      globalWithTrustedTypes[TRUSTED_HTML_POLICY_KEY] = policy;
    }
    if (policy) {
      try {
        input = policy.createHTML(html);
      } catch {
        input = html;
      }
    }
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
  if (/^[\-?:,[\]{}&*!|>%@`]/u.test(value)) return false;
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

// Scripts without spaces between words do not count.
const WORD_PAIR = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Number}_]{2}$/u;

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
  return !includesWholeText(normalizedBody, normalizedValue);
}

/** Find text that is not part of a longer word, such as "mit" in "commit". */
function includesWholeText(body: string, value: string): boolean {
  for (let start = body.indexOf(value); start >= 0; start = body.indexOf(value, start + 1)) {
    const end = start + value.length;
    const splitsWord = (index: number): boolean => WORD_PAIR.test(body.slice(index - 1, index + 1));
    if (!(start > 0 && splitsWord(start)) && !splitsWord(end)) return true;
  }
  return false;
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
  const cleanedBody = cleanMarkdown(bodyMarkdown);
  const parts: string[] = [];
  if (metadata && Object.keys(metadata).length > 0) {
    parts.push(formatMetadata(metadata, cleanedBody));
  }
  if (cleanedBody) parts.push(cleanedBody);
  return parts.join('\n\n').trim();
}
