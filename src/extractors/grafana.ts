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

export const grafanaExtractor = register({
  name: 'Grafana',
  matches: [],
  detect: isGrafanaPage,

  async extract() {
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
      .map((el) => {
        const label = Markdown.normalizeWhitespace(el.querySelector('label, .gf-form-label')?.textContent || '');
        const value = Markdown.normalizeWhitespace(el.querySelector('button, input, .variable-link-wrapper')?.textContent || '');
        return label && value ? `${label}=${value}` : '';
      })
      .filter(Boolean);
    if (vars.length > 0) parts.push(`**Variables:** ${vars.join(', ')}`);

    const panels = Array.from(document.querySelectorAll('[data-testid^="data-testid Panel"], section[data-panelid], .panel-container'));
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
        .map((el) => Markdown.normalizeWhitespace(el.textContent || ''))
        .filter(Boolean);
      const textBody = panel.querySelector('.markdown-html, .panel-content');

      panelCount += 1;
      parts.push(`\n## ${panelTitle}`);
      if (table && table.tagName === 'TABLE') {
        const tableMd = Markdown.tableToMarkdown(table);
        if (tableMd) parts.push(tableMd);
      } else if (statValues.length > 0) {
        parts.push(statValues.map((v) => `- ${v}`).join('\n'));
      } else if (textBody) {
        const cleaned = Utils.removeNoise(textBody, [...Utils.NOISE_SELECTORS, 'button']);
        const body = Markdown.elementToMarkdown(cleaned);
        if (body) parts.push(body);
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
