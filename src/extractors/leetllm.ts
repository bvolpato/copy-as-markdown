/**
 * LeetLLM curriculum and content extractor.
 *
 * LeetLLM is an educational site, not a chat client. Preserve lesson/blog
 * structure, code, references, and practice prompts while excluding its
 * navigation, progress controls, editors, and comment UI.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

register({
  name: 'LeetLLM',
  matches: [
    '*://leetllm.com/*',
    '*://www.leetllm.com/*',
  ],
  pathnameRegex: /^\/(?:learn|blog|practice|glossary|tracks|start)(?:\/|$)|^\/$/i,

  async extract() {
    const route = routeKind(window.location.pathname);
    const root = findContentRoot(route);
    const title = cleanTitle(
      root?.querySelector('h1[itemprop="headline"], h1')?.textContent?.trim()
      || Utils.getMeta('title')
      || Utils.getPageTitle(),
    ) || 'LeetLLM';
    const description = root?.querySelector('[itemprop="description"]')?.textContent?.trim()
      || Utils.getMeta('description');

    const metadata: PageMetadata = {
      source: 'LeetLLM',
      title,
      url: Utils.getCanonicalUrl(),
      route,
    };
    addRouteMetadata(metadata, route, root);

    const parts: string[] = [`# ${title}`];
    if (description && !containsText(root, description)) parts.push('', description);

    if (root) {
      const content = findBodyRoot(root, route);
      const cleaned = clean(content);
      const body = Markdown.elementToMarkdown(cleaned).trim();
      if (body) parts.push('', body);

      const references = extractReferences(root);
      if (references.length) {
        parts.push('', '## References', '', ...references.map((reference) => `- [${reference.title}](${reference.href})`));
        metadata.reference_count = references.length;
      }
    }

    const output = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: `LeetLLM ${route} rendered content DOM`,
      total: root ? 1 : 0,
      included: root && output.markdown.length > 0 ? 1 : 0,
      truncated: output.truncated,
      complete: Boolean(root && output.markdown.length > 0 && !output.truncated),
    });
    return Markdown.buildPageMarkdown(metadata, output.markdown);
  },
});

type RouteKind = 'lesson' | 'blog' | 'practice' | 'glossary' | 'tracks' | 'start' | 'home';

function routeKind(path: string): RouteKind {
  const segment = path.split('/').filter(Boolean)[0]?.toLowerCase();
  switch (segment) {
    case 'learn': return 'lesson';
    case 'blog': return 'blog';
    case 'practice': return 'practice';
    case 'glossary': return 'glossary';
    case 'tracks': return 'tracks';
    case 'start': return 'start';
    default: return 'home';
  }
}

function findContentRoot(route: RouteKind): Element | null {
  const main = document.querySelector('main, [role="main"]');
  if (!main) return document.body;

  if (route === 'lesson' || route === 'blog') {
    return main.querySelector('article[data-reader-article], article[itemtype*="Article"], article') || main;
  }

  if (route === 'practice' && window.location.pathname.split('/').filter(Boolean).length > 1) {
    const heading = main.querySelector('h1');
    const section = heading?.closest('section');
    return section || main;
  }

  return main;
}

function findBodyRoot(root: Element, route: RouteKind): Element {
  if (route === 'lesson' || route === 'blog') {
    return root.querySelector('[itemprop="articleBody"], .reader-prose, .prose') || root;
  }

  if (route === 'practice' && window.location.pathname.split('/').filter(Boolean).length > 1) {
    // Prompt and sample tests are the durable educational content. Avoid
    // copying the live code editor and result panes as page chrome.
    return root.querySelector('.practice-markdown, [data-testid="problem-prompt"], [data-problem-body]') || root;
  }

  return root;
}

function clean(element: Element): Element {
  return Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    '[data-print-hidden]',
    '[data-print-only]',
    '[data-print-code-header]',
    '[data-print-question]',
    '[data-print-references] > *:not([data-print-reference])',
    'button',
    'textarea',
    'input',
    '[contenteditable="true"]',
    '[role="dialog"]',
    '[role="tablist"]',
    '[class*="comment"]',
    '[class*="share"]',
    '[class*="progress"]',
    '[class*="editor"]',
    '[class*="result"]',
  ]);
}

function extractReferences(root: Element): Array<{ title: string; href: string }> {
  const references: Array<{ title: string; href: string }> = [];
  const seen = new Set<string>();
  root.querySelectorAll<HTMLAnchorElement>('[data-print-reference][href], [data-reference-link][href]').forEach((link) => {
    const href = safeHttpUrl(link.href || link.getAttribute('data-reference-url') || '');
    if (!href || seen.has(href)) return;
    const title = normalize(
      link.getAttribute('data-reference-title')
      || link.querySelector('[data-reference-title]')?.textContent
      || link.querySelector('p, strong, h3, h4')?.textContent
      || link.textContent
      || hostname(href),
    );
    seen.add(href);
    references.push({ title: escapeLinkText(title), href });
  });
  return references;
}

function addRouteMetadata(metadata: PageMetadata, route: RouteKind, root: Element | null): void {
  const structured = getStructuredArticleData(root);
  const section = firstText(root, [
    '[data-section]', '[data-testid="article-section"]', '[itemprop="articleSection"]',
  ]) || structured.articleSection || '';
  const difficulty = firstText(root, [
    '[data-difficulty]', '[data-testid="difficulty"]', '[itemprop="educationalLevel"]',
  ]) || structured.educationalLevel || '';
  const category = firstText(root, [
    '[data-category]', '[data-testid="category"]', '[itemprop="genre"]',
  ]) || structured.genre || '';
  const author = firstText(root, ['[itemprop="author"] [itemprop="name"]', '[itemprop="author"]'])
    || structured.author?.name || '';
  const published = firstAttr(root, ['time[itemprop="datePublished"]', 'time[dateTime]'], 'dateTime')
    || structured.datePublished || '';
  const updated = firstAttr(root, ['time[itemprop="dateModified"]'], 'dateTime')
    || structured.dateModified || '';

  if (route === 'lesson' || route === 'blog') metadata.content_type = route === 'lesson' ? 'lesson' : 'blog_post';
  else if (route === 'practice') metadata.content_type = 'practice';
  else metadata.content_type = route;
  if (section) metadata.section = normalize(section);
  if (difficulty) metadata.difficulty = normalize(difficulty);
  if (category) metadata.category = normalize(category);
  if (author) metadata.author = normalize(author);
  if (published) metadata.published = normalize(published);
  if (updated && updated !== published) metadata.updated = normalize(updated);
}

type StructuredArticle = {
  articleSection?: string;
  educationalLevel?: string;
  genre?: string;
  datePublished?: string;
  dateModified?: string;
  author?: { name?: string };
};

function getStructuredArticleData(root: Element | null): StructuredArticle {
  if (!root) return {};
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const value = JSON.parse(script.textContent || '') as StructuredArticle | StructuredArticle[];
      const candidate = Array.isArray(value) ? value.find((item) => item && typeof item === 'object') : value;
      if (candidate && typeof candidate === 'object') return candidate;
    } catch {
      // Ignore malformed or streamed JSON-LD; visible content remains source of truth.
    }
  }
  return {};
}

function firstText(root: Element | null, selectors: string[]): string {
  if (!root) return '';
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    const value = element?.getAttribute('data-section')
      || element?.getAttribute('data-difficulty')
      || element?.getAttribute('data-category')
      || element?.textContent
      || '';
    if (value.trim()) return value.trim();
  }
  return '';
}

function firstAttr(root: Element | null, selectors: string[], attribute: string): string {
  if (!root) return '';
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.getAttribute(attribute) || '';
    if (value.trim()) return value.trim();
  }
  return '';
}

function containsText(root: Element | null, value: string): boolean {
  return Boolean(root && normalize(root.textContent || '').includes(normalize(value)));
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function hostname(value: string): string {
  try { return new URL(value).hostname; } catch { return 'Reference'; }
}

function cleanTitle(value: string): string {
  return value.replace(/\s*[·|\-]\s*LeetLLM\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}
