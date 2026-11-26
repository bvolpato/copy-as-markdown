/**
 * Grafana dashboard & Explore extractor (self-hosted and Grafana Cloud).
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function isGrafanaPage(contextDocument: Document = document): boolean {
  if (contextDocument.querySelector('.grafana-app, [data-testid="data-testid Panel header title"], [data-testid^="data-testid Panel"]')) {
    return true;
  }
  const title = contextDocument.title || '';
  if (/\bgrafana\b/i.test(title) && contextDocument.querySelector('.react-grid-layout, [class*="panel-container"]')) {
    return true;
  }
  return false;
}

function ariaTableToMarkdown(tableEl: Element): string {
  const rowEls = Array.from(tableEl.querySelectorAll('[role="row"]'));
  if (rowEls.length === 0) return '';
  const rows: string[][] = [];
  let maxCols = 0;
  for (const rowEl of rowEls) {
    const cells = Array.from(rowEl.querySelectorAll('[role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]'))
      .map((cell) => Markdown.escapeMarkdownTableCell(Markdown.normalizeWhitespace(cell.textContent || '')));
    if (cells.length > 0 && cells.some(Boolean)) {
      maxCols = Math.max(maxCols, cells.length);
      rows.push(cells);
    }
  }
  if (rows.length === 0 || maxCols === 0) return '';
  for (const row of rows) {
    while (row.length < maxCols) row.push('');
  }
  const lines = [
    '| ' + rows[0].join(' | ') + ' |',
    '| ' + rows[0].map(() => '---').join(' | ') + ' |',
    ...rows.slice(1).map((row) => '| ' + row.join(' | ') + ' |'),
  ];
  return lines.join('\n');
}

export const grafanaExtractor = register({
  name: 'Grafana',
  matches: [],
  detect: isGrafanaPage,

  async extract() {
    const isVisible = Utils.createVisibilityChecker();
    const title = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="data-testid Nav toolbar"] h1, [aria-label="Dashboard title"], .navbar-page-btn, h1')?.textContent
        || Utils.getPageTitle().replace(/\s*-\s*Grafana$/i, ''),
    );
    const timeRange = Markdown.normalizeWhitespace(
      document.querySelector('[data-testid="data-testid TimePicker Open Button"], button[aria-label*="Time range"]')?.textContent || '',
    );

    const metadata: PageMetadata = {
      source: 'Grafana',
      title,
      url: window.location.href,
      timeframe: timeRange || undefined,
    };

    const parts: string[] = [`# ${title}`];
    if (timeRange) parts.push(`**Time Range:** ${timeRange}`);

    const vars = Array.from(document.querySelectorAll('[data-testid="data-testid template variable"], .submenu-item'))
      .filter((el) => isVisible(el))
      .map((el) => {
        const label = Markdown.normalizeWhitespace(el.querySelector('label, .gf-form-label')?.textContent || '');
        const control = el.querySelector('input, button, .variable-link-wrapper');
        const rawVal = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
          ? control.value
          : control?.textContent || '';
        const value = Markdown.normalizeWhitespace(rawVal);
        return label && value ? `${label}=${value}` : '';
      })
      .filter(Boolean);
    if (vars.length > 0) parts.push(`**Variables:** ${vars.join(', ')}`);

    // Match top-level panel containers (never sub-elements like Panel header title / Panel menu / Panel content).
    const panels = Array.from(document.querySelectorAll(
      'section[data-panelid], .panel-container, [data-testid="data-testid Panel container"], [data-testid^="data-testid Panel "][data-panelid]',
    )).filter((el) => isVisible(el));
    const seen = new Set<Element>();
    let panelCount = 0;

    for (const panel of panels) {
      if (seen.has(panel)) continue;
      let nested = false;
      for (const existing of seen) {
        if (existing.contains(panel) || panel.contains(existing)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;
      seen.add(panel);

      const panelTitle = Markdown.normalizeWhitespace(
        panel.querySelector('[data-testid="data-testid Panel header title"], .panel-title-text, h2')?.textContent || '',
      ) || `Panel ${panelCount + 1}`;

      const table = panel.querySelector('table, [role="table"]');
      const statValues = Array.from(panel.querySelectorAll('[data-testid="data-testid stat-panel-value"], .flot-text, .u-legend tr'))
        .filter((el) => isVisible(el))
        .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
        .filter(Boolean);
      const textBody = panel.querySelector('.markdown-html, .panel-content');

      panelCount += 1;
      parts.push(`\n## ${panelTitle}`);
      if (table) {
        const tableMd = table.tagName === 'TABLE'
          ? Markdown.tableToMarkdown(table)
          : ariaTableToMarkdown(table);
        if (tableMd) parts.push(tableMd);
      } else if (statValues.length > 0) {
        parts.push(statValues.map((v) => `- ${v}`).join('\n'));
      } else if (textBody) {
        const cleaned = Utils.removeNoise(textBody, [...Utils.NOISE_SELECTORS, 'button']);
        const body = Markdown.elementToMarkdown(cleaned);
        if (body) parts.push(body);
      }
    }

    // Explore view or single-pane Grafana routes with no dashboard panels.
    if (panelCount === 0) {
      const exploreRoot = document.querySelector('[data-testid="data-testid Explore"], main, .main-view') || document.body;
      if (exploreRoot) {
        const cleaned = Utils.removeNoise(exploreRoot, [...Utils.NOISE_SELECTORS, 'button']);
        const body = Markdown.elementToMarkdown(cleaned);
        if (body) parts.push('\n' + body);
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Grafana dashboard',
      included: panelCount,
      truncated: limited.truncated,
      complete: false,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
