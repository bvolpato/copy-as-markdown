/**
 * OpenAPI / Swagger UI / Redoc / Scalar API documentation extractor.
 * Detects rendered interactive OpenAPI viewers on any host.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function detectOpenApiViewer(contextDocument: Document = document): 'swagger' | 'redoc' | 'scalar' | null {
  if (contextDocument.querySelector('.swagger-ui .opblock, #swagger-ui .swagger-ui, .swagger-ui .information-container')) {
    return 'swagger';
  }
  if (contextDocument.querySelector('.redoc-wrap .api-content, redoc .api-content, [data-section-id].redoc-wrap')) {
    return 'redoc';
  }
  if (contextDocument.querySelector('.scalar-api-reference, [data-scalar-app], .scalar-app')) {
    return 'scalar';
  }
  return null;
}

export const openapiDocsExtractor = register({
  name: 'OpenAPI Docs',
  matches: [],
  detect: (contextDocument) => detectOpenApiViewer(contextDocument) !== null,

  async extract() {
    const viewer = detectOpenApiViewer(document) || 'swagger';
    let title = '';
    const parts: string[] = [];

    if (viewer === 'swagger') {
      const infoTitle = Markdown.normalizeWhitespace(
        document.querySelector('.swagger-ui .info .title')?.textContent || '',
      );
      title = infoTitle || Utils.getPageTitle();
      parts.push(`# ${title}`);

      const baseUrl = Markdown.normalizeWhitespace(
        document.querySelector('.swagger-ui .info .base-url, .swagger-ui .servers select option:checked')?.textContent || '',
      );
      if (baseUrl) parts.push(`**Base URL:** \`${baseUrl}\``);

      const descEl = document.querySelector('.swagger-ui .info .description');
      if (descEl) {
        const desc = Markdown.elementToMarkdown(descEl);
        if (desc) parts.push('\n' + desc);
      }

      const opblocks = Array.from(document.querySelectorAll('.swagger-ui .opblock'));
      if (opblocks.length > 0) {
        parts.push('\n## Endpoints');
        for (const op of opblocks) {
          const method = Markdown.normalizeWhitespace(op.querySelector('.opblock-summary-method')?.textContent || '').toUpperCase();
          const path = Markdown.normalizeWhitespace(op.querySelector('.opblock-summary-path, .opblock-summary-path__deprecated')?.textContent || '');
          const summary = Markdown.normalizeWhitespace(op.querySelector('.opblock-summary-description')?.textContent || '');
          if (!method && !path) continue;
          parts.push(`\n### \`${method} ${path}\`${summary ? ` - ${summary}` : ''}`);
          const bodyEl = op.querySelector('.opblock-body');
          if (bodyEl) {
            const cleaned = Utils.removeNoise(bodyEl, [...Utils.NOISE_SELECTORS, 'button', '.try-out', '.copy-to-clipboard']);
            const body = Markdown.elementToMarkdown(cleaned);
            if (body) parts.push(body);
          }
        }
      }
    } else if (viewer === 'redoc') {
      const root = document.querySelector('.redoc-wrap .api-content, redoc .api-content') || document.body;
      title = Markdown.normalizeWhitespace(root.querySelector('h1')?.textContent || Utils.getPageTitle());
      const cleaned = Utils.removeNoise(root, [
        ...Utils.NOISE_SELECTORS,
        'button',
        '.menu-content',
        '.search-input',
      ]);
      parts.push(Markdown.elementToMarkdown(cleaned));
    } else {
      const root = document.querySelector('.scalar-api-reference main, .scalar-api-reference, .scalar-app') || document.body;
      title = Markdown.normalizeWhitespace(root.querySelector('h1')?.textContent || Utils.getPageTitle());
      const cleaned = Utils.removeNoise(root, [
        ...Utils.NOISE_SELECTORS,
        'aside',
        'button',
        '.sidebar',
      ]);
      parts.push(Markdown.elementToMarkdown(cleaned));
    }

    const metadata: PageMetadata = {
      source: `OpenAPI (${viewer})`,
      title: title || Utils.getPageTitle(),
      url: Utils.getCanonicalUrl(),
    };

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: `rendered ${viewer} OpenAPI documentation`,
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
