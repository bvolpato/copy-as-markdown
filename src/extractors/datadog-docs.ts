/** Datadog Documentation extractor with source Markdown preferred over rendered HTML. */

import { limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

register({
  name: 'Datadog Documentation',
  matches: [
    '*://docs.datadoghq.com/*',
  ],
  buttonPlacement: 'anchor',
  anchor: {
    selector: '#pagetitle, #mainContent h1',
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px', marginBottom: '8px' },
  },

  async extract() {
    const markdownUrl = buildMarkdownUrl(window.location.href);
    if (markdownUrl) {
      try {
        return await fetchSourceMarkdown(markdownUrl);
      } catch (error) {
        console.warn('[Copy as Markdown] Datadog Docs Markdown fetch failed; using rendered DOM', error);
      }
    }

    return extractRenderedDocumentation();
  },
});

function buildMarkdownUrl(href: string): string | null {
  const url = new URL(href);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname) return null;

  url.pathname = pathname.endsWith('.md') ? pathname : `${pathname}.md`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function fetchSourceMarkdown(url: string): Promise<string> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'text/markdown, text/plain;q=0.9' },
  });
  if (!response.ok) {
    throw new Error(`Datadog Docs Markdown request returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text.trim()) throw new Error('Datadog Docs Markdown request returned an empty response');
  if (/text\/html/i.test(contentType) || /^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) {
    throw new Error('Datadog Docs Markdown request returned HTML');
  }

  return limitMarkdown(text.trim()).markdown;
}

function extractRenderedDocumentation(): string {
  const title = document.querySelector('#pagetitle, #mainContent h1, article h1')
    ?.textContent?.trim()
    || Utils.getPageTitle().replace(/\s*\|\s*Datadog\s*Documentation\s*$/i, '').trim();
  const content = document.querySelector('#mainContent, .mainContent-wrapper, article, main')
    || document.body;
  const cleaned = Utils.removeNoise(content, [
    ...Utils.NOISE_SELECTORS,
    '#breadcrumbs',
    '.site-region-container',
    '.docs-feedback',
    '.feedback-section',
    '.js-feedback',
    '[data-nosnippet]',
    '.code-toolbar',
    '.copy-button',
  ]);
  const body = Markdown.elementToMarkdown(cleaned).trim();
  const markdown = body || `# ${title}\n\n*Documentation content is not available in the rendered page.*`;

  return Markdown.buildPageMarkdown({
    source: 'Datadog Documentation',
    title,
    url: Utils.getCanonicalUrl(),
  }, limitMarkdown(markdown).markdown);
}
