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
  return text.replace(/[\s\n\r]+/g, ' ').trim();
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
      return md.replace(/\n/g, ' ').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
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
        if (text && href && !href.startsWith('javascript:')) {
          let fullHref = href;
          try { fullHref = new URL(href, document.baseURI).href; } catch {}
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
        ? (codeEl.className.match(/language-(\w+)/) || ['', ''])[1]
        : '';
      return `\n\`\`\`${lang}\n${code.trimEnd()}\n\`\`\`\n`;
    }

    case 'A': {
      const href = el.getAttribute('href');
      const text = childrenToMarkdown(el, context).trim();
      if (!text && !href) return '';
      if (!href || href.startsWith('javascript:')) return text;
      // Skip internal anchor-only links (e.g. [1], [2] footnotes)
      if (href.startsWith('#')) return text;
      let fullHref = href;
      try {
        fullHref = new URL(href, document.baseURI).href;
      } catch {
        /* keep original */
      }
      return text ? `[${text}](${fullHref})` : fullHref;
    }

    case 'IMG': {
      const alt = el.getAttribute('alt') || '';
      const src = el.getAttribute('src') || '';
      if (!src) return '';
      let fullSrc = src;
      try {
        fullSrc = new URL(src, document.baseURI).href;
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
  return md
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

/**
 * Convert HTML string to Markdown.
 */
export function htmlToMarkdown(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return cleanMarkdown(nodeToMarkdown(div));
}

/**
 * Convert a DOM element to Markdown.
 */
export function elementToMarkdown(element: Element): string {
  return cleanMarkdown(nodeToMarkdown(element));
}

/**
 * Format metadata as a YAML-like frontmatter block for LLM context.
 */
export function formatMetadata(metadata: PageMetadata): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && value !== undefined && value !== '') {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
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
    parts.push(formatMetadata(metadata));
  }
  parts.push(bodyMarkdown);
  return cleanMarkdown(parts.join('\n\n'));
}
