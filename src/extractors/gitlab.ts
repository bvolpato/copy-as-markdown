/** GitLab repositories, files, issues, merge requests, discussions, and diffs. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

const MAX_ITEMS = 500;
const MAX_COMMENTS = 250;
const MAX_CHARS = 500_000;

type Route = {
  project: string;
  kind: 'repository' | 'tree' | 'blob' | 'issue' | 'merge_request' | 'diff' | 'other';
  id?: string;
  refAndPath?: string;
};

register({
  name: 'GitLab',
  matches: ['*://gitlab.com/*'],

  async extract() {
    const route = parseRoute(window.location.pathname);
    const title = cleanTitle(Utils.getPageTitle()) || route.project || 'GitLab';
    const metadata: PageMetadata = {
      source: 'GitLab',
      title,
      url: Utils.getCanonicalUrl(),
    };
    if (route.project) metadata.repository = route.project;

    if (route.kind === 'blob') return extractBlob(metadata, route, title);
    if (route.kind === 'tree' || route.kind === 'repository') {
      return extractRepository(metadata, route, title);
    }
    if (route.kind === 'issue' || route.kind === 'merge_request' || route.kind === 'diff') {
      return extractWorkItem(metadata, route, title);
    }

    metadata.type = 'GitLab page';
    metadata.completeness = 'visible_only';
    metadata.truncated = 'false';
    const main = document.querySelector('main, [role="main"], .content-wrapper');
    const body = main ? Markdown.elementToMarkdown(clean(main)) : '*Could not extract page content.*';
    return finish(metadata, body, 1, main ? 1 : 0, true);
  },
});

function parseRoute(pathname: string): Route {
  const path = decodePath(pathname).replace(/\/+$/, '');
  const marker = path.indexOf('/-/');
  if (marker < 0) {
    return { project: projectFromDom() || path.replace(/^\//, ''), kind: 'repository' };
  }

  const project = path.slice(1, marker);
  const rest = path.slice(marker + 3);
  let match = rest.match(/^issues\/(\d+)/);
  if (match) return { project, kind: 'issue', id: match[1] };
  match = rest.match(/^merge_requests\/(\d+)(?:\/(diffs|commits))?/);
  if (match) {
    return { project, kind: match[2] === 'diffs' ? 'diff' : 'merge_request', id: match[1] };
  }
  match = rest.match(/^blob\/(.+)/);
  if (match) return { project, kind: 'blob', refAndPath: match[1] };
  match = rest.match(/^tree(?:\/(.+))?/);
  if (match) return { project, kind: 'tree', refAndPath: match[1] || '' };
  return { project, kind: 'other' };
}

function extractRepository(
  metadata: PageMetadata,
  route: Route,
  title: string,
): string {
  metadata.type = route.kind === 'tree' ? 'Directory' : 'Repository';
  if (route.refAndPath) metadata.ref_and_path = route.refAndPath;

  const rows = uniqueElements([
    '[data-testid="tree-item"]',
    'table.tree-table tbody tr',
    '.tree-holder .tree-item',
    '.repository-tree-list li',
  ]);
  const totalText = firstText('[data-testid="tree-count"], .tree-count, [data-testid="file-count"]');
  const expected = numberFromText(totalText);
  const limited = limitCollection(rows, MAX_ITEMS);
  const entries = limited.items.map((row) => {
    const link = row.querySelector<HTMLAnchorElement>(
      'a[data-testid="tree-item-link"], a.tree-item-file-name, a[href*="/-/blob/"], a[href*="/-/tree/"]',
    );
    const name = link?.textContent?.trim() || row.textContent?.trim().split('\n')[0]?.trim() || '';
    if (!name) return '';
    const href = link?.href || '';
    const kind = href.includes('/-/tree/') || row.matches('[data-type="tree"], .is-directory') ? 'directory' : 'file';
    return href ? `- [${escapeLinkText(name)}](${href}) (${kind})` : `- ${name} (${kind})`;
  }).filter(Boolean);

  const loadMore = hasLoadMore();
  const truncated = limited.truncated || loadMore || (expected !== null && rows.length < expected);
  metadata.entry_count = String(entries.length);
  if (expected !== null) metadata.total_entry_count = String(expected);
  metadata.completeness = truncated ? 'visible_only' : 'complete_rendered_listing';
  metadata.truncated = String(truncated);

  const heading = route.kind === 'tree' ? `# ${route.project}/${route.refAndPath || ''}` : `# ${route.project || title}`;
  const parts = [heading];
  if (entries.length) parts.push('', '## Files', '', ...entries);

  const readme = document.querySelector('#readme, .readme-holder .md, [data-testid="readme-content"]');
  if (readme) parts.push('', '## README', '', Markdown.elementToMarkdown(clean(readme)));
  if (!entries.length && !readme) parts.push('', '*No repository content found in rendered page.*');
  return finish(metadata, parts.join('\n'), expected ?? limited.total, entries.length, truncated);
}

function extractBlob(metadata: PageMetadata, route: Route, title: string): string {
  metadata.type = 'Code';
  metadata.ref_and_path = route.refAndPath || '';
  const code = document.querySelector(
    '[data-testid="blob-content"] pre, .blob-content pre, .file-content pre, .blob-viewer pre, table.code',
  );
  let content = code?.textContent?.replace(/^\n/, '').replace(/\n$/, '') || '';
  const pageTruncated = Boolean(document.querySelector(
    '[data-testid*="truncated"], .file-content .too-long, .blob-viewer[data-truncated="true"], .js-load-blob',
  ));
  const originalLength = content.length;
  if (content.length > MAX_CHARS) content = content.slice(0, MAX_CHARS);
  const truncated = pageTruncated || originalLength > content.length;
  const fileName = route.refAndPath?.split('/').pop() || title;
  metadata.line_count = String(content ? content.split('\n').length : 0);
  metadata.character_count = String(content.length);
  metadata.completeness = truncated ? 'visible_only' : 'complete_rendered_file';
  metadata.truncated = String(truncated);

  const body = content
    ? `# ${route.project}/${fileName}\n\n## File Contents\n\n${fence(content, language(fileName))}${truncated ? '\n\n*Content truncated or not fully rendered by GitLab.*' : ''}`
    : `# ${route.project}/${fileName}\n\n*No file content found in rendered page.*`;
  return finish(metadata, body, 1, content ? 1 : 0, truncated || !content);
}

function extractWorkItem(metadata: PageMetadata, route: Route, title: string): string {
  const isMergeRequest = route.kind !== 'issue';
  metadata.type = route.kind === 'diff' ? 'Merge Request Diff' : (isMergeRequest ? 'Merge Request' : 'Issue');
  if (route.id) metadata.number = route.id;
  const state = firstText('[data-testid="issuable-state"], .issuable-status-box, .status-box, .badge-state');
  const author = firstText('[data-testid="author-link"], .author-link, .issuable-meta .author');
  const created = firstAttr('time[datetime], [data-testid="created-at"] time', 'datetime');
  if (state) metadata.state = state;
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const parts = [`# ${isMergeRequest ? 'Merge Request' : 'Issue'} #${route.id || ''}: ${title}`];
  if (state) parts.push('', `**Status:** ${state}`);
  if (author) parts.push(`**Author:** ${author}`);
  if (created) parts.push(`**Created:** ${created}`);

  const description = document.querySelector(
    '[data-testid="description-content"], .description .md, .issuable-description .md, .detail-page-description .md',
  );
  if (description) parts.push('', '## Description', '', Markdown.elementToMarkdown(clean(description)));

  if (isMergeRequest) appendMergeRequestMetadata(parts, metadata);
  const diffElements = limitCollection(uniqueElements([
    '[data-testid="diff-file"]',
    '.diff-file',
    '.merge-request-diffs .file-holder',
  ]), MAX_ITEMS);
  if (route.kind === 'diff' || diffElements.items.length) appendDiffs(parts, metadata, diffElements.items);

  const notes = uniqueElements([
    '[data-testid="note-wrapper"]',
    'ul.notes > li.note',
    '.timeline-entry.note',
  ]);
  const seen = new Set<string>();
  const limitedNotes = limitCollection(notes, MAX_COMMENTS);
  let captured = 0;
  for (const note of limitedNotes.items) {
    const content = note.querySelector('.note-text, .note-body .md, [data-testid="note-body"], .md');
    if (!content || description?.contains(content)) continue;
    const markdown = Markdown.elementToMarkdown(clean(content));
    const key = normalize(markdown);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (captured === 0) parts.push('', '## Comments');
    const noteAuthor = note.querySelector('.author, [data-testid="author-link"]')?.textContent?.trim() || 'Comment';
    const noteTime = note.querySelector('time')?.getAttribute('datetime') || '';
    parts.push('', `### ${noteAuthor}${noteTime ? ` (${noteTime})` : ''}`, '', markdown);
    captured += 1;
  }

  const expected = numberFromText(firstText('[data-testid="notes-count"], .notes-count, .js-discussion-count'));
  const truncated = limitedNotes.truncated || diffElements.truncated || hasLoadMore()
    || (expected !== null && captured < expected);
  metadata.comment_count = String(captured);
  if (expected !== null) metadata.total_comment_count = String(expected);
  metadata.completeness = truncated ? 'visible_only' : 'complete_rendered_thread';
  metadata.truncated = String(truncated);
  return finish(metadata, parts.join('\n'), expected ?? limitedNotes.total, captured, truncated);
}

function appendMergeRequestMetadata(parts: string[], metadata: PageMetadata): void {
  const source = firstText('[data-testid="source-branch"], .source-branch');
  const target = firstText('[data-testid="target-branch"], .target-branch');
  if (source) {
    metadata.source_branch = source;
    parts.push(`**Source:** \`${source}\``);
  }
  if (target) {
    metadata.target_branch = target;
    parts.push(`**Target:** \`${target}\``);
  }
}

function appendDiffs(parts: string[], metadata: PageMetadata, diffs: Element[]): void {
  if (!diffs.length) return;
  parts.push('', '## Changes');
  let rendered = 0;
  for (const diff of diffs) {
    const path = diff.querySelector('[data-testid="file-path"], .file-title-name, .file-path')?.textContent?.trim() || 'File';
    const code = diff.querySelector('.diff-content, table.diff-table, [data-testid="diff-content"]');
    const text = code?.textContent?.trim() || '';
    if (!text) continue;
    parts.push('', `### ${path}`, '', fence(text, 'diff'));
    rendered += 1;
  }
  metadata.diff_file_count = String(rendered);
}

function clean(element: Element): Element {
  return Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    'button', '.note-actions', '.award-list', '.js-note-actions', '[data-testid="note-actions"]',
  ]);
}

function uniqueElements(selectors: string[]): Element[] {
  const seen = new Set<Element>();
  const result: Element[] = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((element) => {
      if (!seen.has(element) && !result.some((parent) => parent.contains(element))) {
        seen.add(element);
        result.push(element);
      }
    });
    if (result.length) break;
  }
  return result;
}

function projectFromDom(): string {
  return document.querySelector('meta[name="project_path"]')?.getAttribute('content')
    || document.querySelector('[data-project-full-path]')?.getAttribute('data-project-full-path')
    || '';
}

function hasLoadMore(): boolean {
  return Boolean(document.querySelector(
    '[data-testid="load-more"], .js-load-more, .load-more, button[aria-label*="more" i], [data-testid*="pagination"]',
  ));
}

function firstText(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function firstAttr(selector: string, attribute: string): string {
  return document.querySelector(selector)?.getAttribute(attribute)?.trim() || '';
}

function numberFromText(value: string): number | null {
  const match = value.replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function finish(
  metadata: PageMetadata,
  body: string,
  total: number,
  included: number,
  incomplete: boolean,
): string {
  const limited = limitMarkdown(body, MAX_CHARS);
  const truncated = incomplete || limited.truncated;
  if (limited.truncated) metadata.completeness = 'truncated_by_limit';
  addExtractionMetadata(metadata, {
    contentSource: 'GitLab rendered page DOM',
    total,
    included,
    truncated,
    complete: !truncated,
  });
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function fence(content: string, languageName: string): string {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${languageName}\n${content}\n${ticks}`;
}

function language(fileName: string): string {
  return fileName.includes('.') ? fileName.split('.').pop()?.replace(/[^a-z0-9_+-]/gi, '') || '' : '';
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[·|\-]\s*GitLab\s*$/i, '').trim();
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodePath(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function escapeLinkText(value: string): string {
  return value.replace(/]/g, '\\]');
}
