/** Bitbucket Cloud repositories, source files, issues, pull requests, and diffs. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_ITEMS = 500;
const MAX_COMMENTS = 250;

type Route = {
  repository: string;
  kind: 'repository' | 'tree' | 'blob' | 'issue' | 'pull_request' | 'diff' | 'other';
  id?: string;
  refAndPath?: string;
};

register({
  name: 'Bitbucket',
  matches: ['*://bitbucket.org/*/*'],

  async extract() {
    const route = parseRoute(window.location.pathname);
    const title = cleanTitle(Utils.getPageTitle()) || route.repository || 'Bitbucket';
    const metadata: Record<string, string | number> = {
      source: 'Bitbucket',
      title,
      url: Utils.getCanonicalUrl(),
    };
    if (route.repository) metadata.repository = route.repository;

    if (route.kind === 'blob') return extractBlob(metadata, route, title);
    if (route.kind === 'tree' || route.kind === 'repository') return extractRepository(metadata, route, title);
    if (route.kind === 'issue' || route.kind === 'pull_request' || route.kind === 'diff') {
      return extractWorkItem(metadata, route, title);
    }

    metadata.type = 'Bitbucket page';
    const main = document.querySelector('main, [role="main"], #content');
    const body = main ? Markdown.elementToMarkdown(clean(main)) : '*Could not extract page content.*';
    return finish(metadata, body, 1, main ? 1 : 0, true);
  },
});

function parseRoute(pathname: string): Route {
  const segments = decodePath(pathname).split('/').filter(Boolean);
  const repository = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : '';
  const rest = segments.slice(2);
  if (!repository) return { repository, kind: 'other' };
  if (!rest.length) return { repository, kind: 'repository' };
  if (rest[0] === 'issues' && /^\d+$/.test(rest[1] || '')) {
    return { repository, kind: 'issue', id: rest[1] };
  }
  if (rest[0] === 'pull-requests' && /^\d+$/.test(rest[1] || '')) {
    const kind = rest.includes('diff') || rest.includes('commits') ? 'diff' : 'pull_request';
    return { repository, kind, id: rest[1] };
  }
  if (rest[0] === 'src') {
    const refAndPath = rest.slice(1).join('/');
    const looksDirectory = pathname.endsWith('/') || Boolean(document.querySelector(
      '[data-testid="source-browser-directory"], [data-testid="file-tree"], table[data-qa="source-table"]',
    ));
    return { repository, kind: looksDirectory ? 'tree' : 'blob', refAndPath };
  }
  return { repository, kind: 'other' };
}

function extractRepository(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  metadata.type = route.kind === 'tree' ? 'Directory' : 'Repository';
  if (route.refAndPath) metadata.ref_and_path = route.refAndPath;
  const rows = selectFirst([
    '[data-testid="source-browser-directory"] [data-testid="source-item"]',
    '[data-testid="file-tree"] [role="treeitem"]',
    'table[data-qa="source-table"] tbody tr',
    '.source-list tr',
  ]);
  const limited = limitCollection(rows, MAX_ITEMS);
  const entries = limited.items.map((row) => {
    const link = row.querySelector<HTMLAnchorElement>('a[href*="/src/"]');
    const name = link?.textContent?.trim() || row.textContent?.trim().split('\n')[0]?.trim() || '';
    if (!name) return '';
    const href = link?.href || '';
    const isDirectory = row.getAttribute('data-type') === 'directory'
      || Boolean(row.querySelector('[data-testid*="folder"], [aria-label*="folder" i]'));
    return href
      ? `- [${escapeLinkText(name)}](${href}) (${isDirectory ? 'directory' : 'file'})`
      : `- ${name} (${isDirectory ? 'directory' : 'file'})`;
  }).filter(Boolean);

  const parts = [`# ${route.repository || title}`];
  if (entries.length) parts.push('', '## Files', '', ...entries);
  const readme = document.querySelector('[data-testid="readme"], .readme, article.markdown-body');
  if (readme) parts.push('', '## README', '', Markdown.elementToMarkdown(clean(readme)));
  if (!entries.length && !readme) parts.push('', '*No repository content found in rendered page.*');

  const incomplete = limited.truncated || hasPagination();
  metadata.entry_count = entries.length;
  metadata.completeness = incomplete ? 'visible_only' : 'complete_rendered_listing';
  return finish(metadata, parts.join('\n'), limited.total, entries.length, incomplete);
}

function extractBlob(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  metadata.type = 'Code';
  metadata.ref_and_path = route.refAndPath || '';
  const code = document.querySelector(
    '[data-testid="source-code"] pre, [data-qa="source-code"] pre, .source-code pre, .file-source pre, table.highlight',
  );
  const content = code?.textContent?.replace(/^\n/, '').replace(/\n$/, '') || '';
  const fileName = route.refAndPath?.split('/').pop() || title;
  const pageTruncated = Boolean(document.querySelector(
    '[data-testid*="truncated"], [data-qa*="truncated"], .file-source .too-large, button[data-qa="load-full-file"]',
  ));
  metadata.line_count = content ? content.split('\n').length : 0;
  metadata.character_count = content.length;
  metadata.completeness = pageTruncated ? 'visible_only' : 'complete_rendered_file';
  const body = content
    ? `# ${route.repository}/${fileName}\n\n## File Contents\n\n${fence(content, language(fileName))}${pageTruncated ? '\n\n*File is not fully rendered by Bitbucket.*' : ''}`
    : `# ${route.repository}/${fileName}\n\n*No file content found in rendered page.*`;
  return finish(metadata, body, 1, content ? 1 : 0, pageTruncated || !content);
}

function extractWorkItem(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  const isPullRequest = route.kind !== 'issue';
  metadata.type = route.kind === 'diff' ? 'Pull Request Diff' : (isPullRequest ? 'Pull Request' : 'Issue');
  if (route.id) metadata.number = route.id;
  const state = text('[data-testid="issue-status"], [data-testid="pull-request-status"], [data-qa="status"], .issue-status');
  const author = text('[data-testid="author-name"], [data-qa="author"], .author-name');
  const created = attr('time[datetime]', 'datetime');
  if (state) metadata.state = state;
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const parts = [`# ${isPullRequest ? 'Pull Request' : 'Issue'} #${route.id || ''}: ${title}`];
  if (state) parts.push('', `**Status:** ${state}`);
  if (author) parts.push(`**Author:** ${author}`);
  if (created) parts.push(`**Created:** ${created}`);
  if (isPullRequest) appendBranches(parts, metadata);

  const description = document.querySelector(
    '[data-testid="issue-description"], [data-testid="pull-request-description"], [data-qa="description"], .issue-description, .description-content',
  );
  if (description) parts.push('', '## Description', '', Markdown.elementToMarkdown(clean(description)));

  const diffElements = selectFirst([
    '[data-testid="diff-file"]',
    '[data-qa="diff-file"]',
    '.diff-container .file',
  ]);
  if (route.kind === 'diff' || diffElements.length) appendDiffs(parts, metadata, diffElements);

  const comments = selectFirst([
    '[data-testid="comment"]',
    '[data-qa="comment"]',
    '.comment-thread .comment',
    '.activity-item[data-type="comment"]',
  ]);
  const limited = limitCollection(comments, MAX_COMMENTS);
  const seen = new Set<string>();
  let captured = 0;
  for (const comment of limited.items) {
    const body = comment.querySelector(
      '[data-testid="comment-content"], [data-qa="comment-content"], .comment-content, .ak-renderer-document',
    ) || comment;
    const markdown = Markdown.elementToMarkdown(clean(body));
    const key = normalize(markdown);
    if (!key || seen.has(key) || (description && normalize(description.textContent || '') === normalize(body.textContent || ''))) continue;
    seen.add(key);
    if (!captured) parts.push('', '## Comments');
    const commentAuthor = comment.querySelector('[data-testid="author-name"], [data-qa="author"], .author')?.textContent?.trim() || 'Comment';
    const commentTime = comment.querySelector('time')?.getAttribute('datetime') || '';
    parts.push('', `### ${commentAuthor}${commentTime ? ` (${commentTime})` : ''}`, '', markdown);
    captured += 1;
  }

  metadata.comment_count = captured;
  const incomplete = limited.truncated || hasPagination();
  metadata.completeness = incomplete ? 'visible_only' : 'complete_rendered_thread';
  return finish(metadata, parts.join('\n'), limited.total, captured, incomplete);
}

function appendBranches(parts: string[], metadata: Record<string, string | number>): void {
  const source = text('[data-testid="source-branch"], [data-qa="source-branch"]');
  const destination = text('[data-testid="destination-branch"], [data-qa="destination-branch"]');
  if (source) {
    metadata.source_branch = source;
    parts.push(`**Source:** \`${source}\``);
  }
  if (destination) {
    metadata.target_branch = destination;
    parts.push(`**Target:** \`${destination}\``);
  }
}

function appendDiffs(parts: string[], metadata: Record<string, string | number>, diffs: Element[]): void {
  const limited = limitCollection(diffs, MAX_ITEMS);
  let captured = 0;
  for (const diff of limited.items) {
    const path = diff.querySelector('[data-testid="file-path"], [data-qa="file-path"], .file-path')?.textContent?.trim() || 'File';
    const body = diff.querySelector('[data-testid="diff-content"], [data-qa="diff-content"], .diff-content, table');
    const content = body?.textContent?.trim() || '';
    if (!content) continue;
    if (!captured) parts.push('', '## Changes');
    parts.push('', `### ${path}`, '', fence(content, 'diff'));
    captured += 1;
  }
  metadata.diff_file_count = captured;
  if (limited.truncated) metadata.completeness = 'visible_only';
}

function finish(
  metadata: Record<string, string | number>,
  body: string,
  total: number,
  included: number,
  incomplete: boolean,
): string {
  const limited = limitMarkdown(body);
  const truncated = incomplete || limited.truncated;
  if (limited.truncated) metadata.completeness = 'truncated_by_limit';
  addExtractionMetadata(metadata, {
    contentSource: 'Bitbucket rendered page DOM',
    total,
    included,
    truncated,
    complete: !truncated,
  });
  return Markdown.buildPageMarkdown(metadata, limited.markdown);
}

function clean(element: Element): Element {
  return Utils.removeNoise(element, [
    ...Utils.NOISE_SELECTORS,
    'button', '[data-testid*="actions"]', '[data-qa*="actions"]', '.comment-actions',
  ]);
}

function selectFirst(selectors: string[]): Element[] {
  for (const selector of selectors) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length) return found;
  }
  return [];
}

function hasPagination(): boolean {
  return Boolean(document.querySelector(
    '[data-testid*="pagination"], [data-qa*="load-more"], button[aria-label*="more" i], .pagination',
  ));
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function attr(selector: string, name: string): string {
  return document.querySelector(selector)?.getAttribute(name)?.trim() || '';
}

function fence(content: string, languageName: string): string {
  const longest = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length));
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${languageName}\n${content}\n${ticks}`;
}

function language(fileName: string): string {
  return fileName.includes('.') ? fileName.split('.').pop()?.replace(/[^a-z0-9_+-]/gi, '') || '' : '';
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanTitle(title: string): string {
  return title.replace(/\s*[·|\-]\s*Bitbucket\s*$/i, '').trim();
}

function escapeLinkText(value: string): string {
  return Markdown.escapeMarkdownLinkText(value);
}

function decodePath(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}
