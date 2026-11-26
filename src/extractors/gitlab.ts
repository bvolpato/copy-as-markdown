/** GitLab repositories, files, issues, work items, epics, merge requests, commits, snippets, wikis, releases, and diffs. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

const MAX_ITEMS = 500;
const MAX_COMMENTS = 250;
const MAX_CHARS = 500_000;

const GITLAB_NON_REPO_RE = /^\/(?:explore|users|help|admin|dashboard|search|profile|oauth|api|assets|uploads)(?:\/|$)/i;
const GITLAB_PATH_RE = /^\/(?!(?:explore|users|help|admin|dashboard|search|profile|oauth|api|assets|uploads)(?:\/|$))[^/]+\/[^/]+/i;

type Route = {
  project: string;
  kind:
    | 'repository'
    | 'tree'
    | 'blob'
    | 'issue'
    | 'work_item'
    | 'epic'
    | 'merge_request'
    | 'diff'
    | 'commit'
    | 'snippet'
    | 'wiki'
    | 'release'
    | 'compare'
    | 'other';
  id?: string;
  refAndPath?: string;
};

register({
  name: 'GitLab',
  matches: ['*://gitlab.com/*'],
  pathnameRegex: GITLAB_PATH_RE,
  detect: (contextDocument) => isSelfHostedGitLab(contextDocument),

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
    if (
      route.kind === 'issue'
      || route.kind === 'work_item'
      || route.kind === 'epic'
      || route.kind === 'merge_request'
      || route.kind === 'diff'
    ) {
      return extractWorkItem(metadata, route, title);
    }
    if (route.kind === 'commit') return extractCommit(metadata, route, title);
    if (route.kind === 'snippet') return extractSnippet(metadata, route, title);
    if (route.kind === 'wiki') return extractWiki(metadata, route, title);
    if (route.kind === 'release') return extractReleases(metadata, route, title);
    if (route.kind === 'compare') return extractCompare(metadata, route, title);

    metadata.type = 'GitLab page';
    metadata.completeness = 'visible_only';
    metadata.truncated = 'false';
    const main = document.querySelector('main, [role="main"], .content-wrapper');
    const body = main ? Markdown.elementToMarkdown(clean(main)) : '*Could not extract page content.*';
    return finish(metadata, body, 1, main ? 1 : 0, true);
  },
});

function isSelfHostedGitLab(contextDocument?: Document): boolean {
  const doc = contextDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.querySelector !== 'function') return false;
  const pathname = doc.location?.pathname || '';
  if (pathname && (pathname === '/' || GITLAB_NON_REPO_RE.test(pathname) || !/^\/[^/]+\/[^/]+/.test(pathname))) {
    return false;
  }
  return Boolean(doc.querySelector(
    'meta[property="og:site_name"][content="GitLab"], meta[name="project_path"], body[data-page^="projects:"], body[data-page^="groups:"]',
  ));
}

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
  match = rest.match(/^work_items\/(\d+)/);
  if (match) return { project, kind: 'work_item', id: match[1] };
  match = rest.match(/^epics\/(\d+)/);
  if (match) return { project, kind: 'epic', id: match[1] };
  match = rest.match(/^merge_requests\/(\d+)(?:\/(diffs|commits))?/);
  if (match) {
    return { project, kind: match[2] === 'diffs' ? 'diff' : 'merge_request', id: match[1] };
  }
  match = rest.match(/^commit\/([0-9a-f]{7,64})/i);
  if (match) return { project, kind: 'commit', id: match[1] };
  match = rest.match(/^snippets\/(\d+)/);
  if (match) return { project, kind: 'snippet', id: match[1] };
  match = rest.match(/^wikis(?:\/(.+))?/);
  if (match) return { project, kind: 'wiki', refAndPath: match[1] || '' };
  match = rest.match(/^releases(?:\/(.+))?/);
  if (match) return { project, kind: 'release', refAndPath: match[1] || '' };
  match = rest.match(/^compare(?:\/(.+))?/);
  if (match) return { project, kind: 'compare', refAndPath: match[1] || '' };
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
      'a[data-testid="file-name-link"], a.tree-item-link, a[data-testid="tree-item-link"], a.tree-item-file-name, a[href*="/-/blob/"], a[href*="/-/tree/"]',
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
  const content = extractBlobChunks() || extractCodeText(code);
  const pageTruncated = Boolean(document.querySelector(
    '[data-testid*="truncated"], .file-content .too-long, .blob-viewer[data-truncated="true"], .js-load-blob',
  ));
  const truncated = pageTruncated;
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
  const isMergeRequest = route.kind === 'merge_request' || route.kind === 'diff';
  const kindLabel = route.kind === 'epic'
    ? 'Epic'
    : route.kind === 'work_item'
      ? 'Work Item'
      : isMergeRequest
        ? 'Merge Request'
        : 'Issue';
  metadata.type = route.kind === 'diff' ? 'Merge Request Diff' : kindLabel;
  if (route.id) metadata.number = route.id;

  const headerScope = document.querySelector(
    '.detail-page-header, .issuable-meta, [data-testid="issuable-header"], [data-testid="work-item-header"], [data-testid="work-item-created-updated"]',
  );
  const state = firstText('[data-testid="issuable-state"], [data-testid="work-item-state"], .issuable-status-box, .status-box, .badge-state');
  const author = firstTextInScope(headerScope, '[data-testid="author-link"], .author-link, .issuable-meta .author, .author');
  const created = firstAttrInScope(headerScope, 'time[datetime], [data-testid="created-at"] time', 'datetime');
  if (state) metadata.state = state;
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const parts = [`# ${kindLabel} #${route.id || ''}: ${title}`];
  if (state) parts.push('', `**Status:** ${state}`);
  if (author) parts.push(`**Author:** ${author}`);
  if (created) parts.push(`**Created:** ${created}`);

  const description = document.querySelector(
    '[data-testid="description-content"], [data-testid="work-item-description"], .description .md, .issuable-description .md, .detail-page-description .md',
  );
  if (description) parts.push('', '## Description', '', Markdown.elementToMarkdown(clean(description)));

  if (isMergeRequest) appendMergeRequestMetadata(parts, metadata);
  const diffElements = limitCollection(uniqueElements([
    '[data-testid="rd-diff-file"]',
    '[data-testid="diff-file"]',
    '.diff-file',
    '.merge-request-diffs .file-holder',
  ]), MAX_ITEMS);
  if (route.kind === 'diff' || diffElements.items.length) appendDiffs(parts, metadata, diffElements.items);

  const notes = uniqueElements([
    '[data-testid="note-wrapper"]',
    '[data-testid="work-item-note-wrapper"]',
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
    const noteAuthor = note.querySelector('.author, [data-testid="author-link"], [data-testid="author-name"], .author-name-link')
      ?.textContent?.trim() || 'Comment';
    const noteTime = note.querySelector('time')?.getAttribute('datetime') || '';
    // Different people can post the same text, so only repeated renderings are duplicates.
    const key = normalize(markdown) && `${noteAuthor}|${noteTime}|${normalize(markdown)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (captured === 0) parts.push('', '## Comments');
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

function extractCommit(metadata: PageMetadata, route: Route, title: string): string {
  metadata.type = 'Commit';
  if (route.id) metadata.commit = route.id;
  const commitTitle = firstText('.commit-box .commit-title, [data-testid="commit-title"], h1') || title;
  const commitDesc = document.querySelector('.commit-box .commit-description, [data-testid="commit-description"]')?.textContent?.trim() || '';
  const headerScope = document.querySelector('.commit-box, .header-main-content, .commit-header');
  const author = firstTextInScope(headerScope, '.commit-author-link, [data-testid="author-link"], .author');
  const created = firstAttrInScope(headerScope, 'time[datetime]', 'datetime');
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const parts = [`# Commit ${route.id?.slice(0, 12) || ''}: ${commitTitle}`];
  if (author) parts.push('', `**Author:** ${author}`);
  if (created) parts.push(`**Date:** ${created}`);
  if (commitDesc) parts.push('', commitDesc);

  const diffs = limitCollection(uniqueElements(['[data-testid="rd-diff-file"]', '[data-testid="diff-file"]', '.diff-file', '.file-holder']), MAX_ITEMS);
  appendDiffs(parts, metadata, diffs.items);
  return finish(metadata, parts.join('\n'), diffs.total, diffs.items.length, diffs.truncated);
}

function extractSnippet(metadata: PageMetadata, route: Route, title: string): string {
  metadata.type = 'Snippet';
  if (route.id) metadata.number = route.id;
  const snippetTitle = firstText('[data-testid="snippet-title"], .snippet-header h1, h1') || title;
  metadata.title = snippetTitle;
  const parts = [`# ${snippetTitle}`];

  const desc = document.querySelector('[data-testid="snippet-description"], .snippet-header .description');
  if (desc) parts.push('', Markdown.elementToMarkdown(clean(desc)));

  const files = uniqueElements(['[data-testid="snippet-file"]', '.snippet-file-content', '.file-holder']);
  for (const file of files) {
    const name = file.querySelector('.file-title-name, [data-testid="file-name"], strong')?.textContent?.trim() || 'snippet';
    const code = file.querySelector('pre, table.code, .blob-content');
    const content = extractCodeText(code);
    if (!content) continue;
    parts.push('', `## ${name}`, '', fence(content, language(name)));
  }

  return finish(metadata, parts.join('\n'), files.length || 1, files.length, false);
}

function extractWiki(metadata: PageMetadata, _route: Route, title: string): string {
  metadata.type = 'Wiki';
  const wikiTitle = firstText('[data-testid="wiki-page-title"], .wiki-page-header h1, h1') || title;
  metadata.title = wikiTitle;
  const content = document.querySelector('[data-testid="wiki-page-content"], .js-wiki-page-content, .wiki.md, .md');
  const body = content
    ? `# ${wikiTitle}\n\n${Markdown.elementToMarkdown(clean(content))}`
    : `# ${wikiTitle}\n\n*No wiki content found in rendered page.*`;
  return finish(metadata, body, 1, content ? 1 : 0, !content);
}

function extractReleases(metadata: PageMetadata, _route: Route, title: string): string {
  metadata.type = 'Releases';
  const blocks = uniqueElements(['[data-testid="release-block"]', '.release-block', 'section.card']);
  const parts = [`# ${title}`];
  let captured = 0;
  for (const block of blocks) {
    const heading = block.querySelector('h2, h1, [data-testid="release-name"], .card-header a')?.textContent?.trim() || '';
    const desc = block.querySelector('[data-testid="release-description"], .md, .card-body');
    if (!heading && !desc) continue;
    if (heading) parts.push('', `## ${heading}`);
    if (desc) parts.push('', Markdown.elementToMarkdown(clean(desc)));
    captured += 1;
  }
  if (captured === 0) {
    const main = document.querySelector('main, [role="main"], .content-wrapper');
    if (main) parts.push('', Markdown.elementToMarkdown(clean(main)));
  }
  return finish(metadata, parts.join('\n'), captured || 1, captured, hasLoadMore());
}

function extractCompare(metadata: PageMetadata, route: Route, title: string): string {
  metadata.type = 'Compare';
  if (route.refAndPath) metadata.ref_and_path = route.refAndPath;
  const parts = [`# ${title}`];
  const diffs = limitCollection(uniqueElements(['[data-testid="rd-diff-file"]', '[data-testid="diff-file"]', '.diff-file', '.file-holder']), MAX_ITEMS);
  appendDiffs(parts, metadata, diffs.items);
  if (diffs.items.length === 0) {
    const main = document.querySelector('main, [role="main"], .content-wrapper');
    if (main) parts.push('', Markdown.elementToMarkdown(clean(main)));
  }
  return finish(metadata, parts.join('\n'), diffs.total || 1, diffs.items.length, diffs.truncated);
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
    const path = diff.querySelector('[data-testid="file-path"], .file-title-name, .file-path, .rd-diff-file-link')?.textContent?.trim() || 'File';
    const code = diff.querySelector('table.diff-table, .diff-content, [data-testid="diff-content"]');
    const text = extractDiffText(diff) || extractCodeText(code);
    if (!text) continue;
    parts.push('', `### ${path}`, '', fence(text, 'diff'));
    rendered += 1;
  }
  metadata.diff_file_count = String(rendered);
}

/** The source viewer renders one code element per chunk and overlays a highlighted copy of visible chunks. */
function extractBlobChunks(): string {
  const chunks = document.querySelectorAll('.blob-viewer pre > code[data-testid="content"]');
  return Array.from(chunks, (chunk) => chunk.textContent || '').join('\n').replace(/\n$/, '');
}

/** Diff markers come from attributes or classes, so the cell text alone does not show them. */
function extractDiffText(diff: Element): string {
  const lines: string[] = [];
  let contextRow: Element | null = null;
  for (const cell of diff.querySelectorAll('.rd-hunk-header-content, .rd-line-content, .line_content')) {
    const text = (cell.textContent || '').replace(/\r?\n$/, '');
    if (cell.matches('.rd-hunk-header-content, .match')) {
      lines.push(text.trim());
      continue;
    }
    if (cell.matches('.parallel.empty-cell, .empty-cell')) continue;
    const change = cell.getAttribute('data-change');
    if (change === 'added' || cell.matches('.new')) {
      lines.push(`+${text}`);
    } else if (change === 'removed' || cell.matches('.old')) {
      lines.push(`-${text}`);
    } else {
      // Split views repeat unchanged lines on both sides.
      const row = cell.closest('tr, .diff-grid-row, .diff-tr');
      if (row && row === contextRow) continue;
      contextRow = row;
      lines.push(` ${text}`);
    }
  }
  return lines.join('\n');
}

function extractCodeText(element: Element | null): string {
  if (!element) return '';
  if (element.matches('table.code, table.diff-table') || element.querySelector('table.code, table.diff-table')) {
    const table = element.matches('table') ? element : element.querySelector('table');
    if (table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const lines: string[] = [];
      for (const row of rows) {
        const lineCells = row.querySelectorAll('.line_content, .blob-content, td.code');
        if (lineCells.length > 0) {
          lines.push(Array.from(lineCells).map((cell) => (cell.textContent || '').replace(/\r?\n$/, '')).join(' '));
        } else {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length > 0) {
            const last = cells[cells.length - 1];
            lines.push((last.textContent || '').replace(/\r?\n$/, ''));
          }
        }
      }
      if (lines.length > 0) return lines.join('\n').replace(/^\n/, '').replace(/\n$/, '');
    }
  }
  return element.textContent?.replace(/^\n/, '').replace(/\n$/, '') || '';
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
      if (seen.has(element)) return;
      let ancestor = element.parentElement;
      while (ancestor) {
        if (seen.has(ancestor)) return;
        ancestor = ancestor.parentElement;
      }
      seen.add(element);
      result.push(element);
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
    '[data-testid="load-more"], [data-testid*="load-more"], .js-load-more, .load-more, button[aria-label*="load more" i], [data-testid*="pagination"]',
  ));
}

function firstText(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function firstTextInScope(scope: ParentNode | null, selector: string): string {
  if (scope) {
    const scoped = scope.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
    if (scoped) return scoped;
  }
  for (const el of document.querySelectorAll(selector)) {
    if (!el.closest('.note, [data-testid="note-wrapper"], [data-testid="work-item-note-wrapper"], .timeline-entry')) {
      const value = el.textContent?.replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
  }
  return '';
}

function firstAttrInScope(scope: ParentNode | null, selector: string, attribute: string): string {
  if (scope) {
    const scoped = scope.querySelector(selector)?.getAttribute(attribute)?.trim();
    if (scoped) return scoped;
  }
  for (const el of document.querySelectorAll(selector)) {
    if (!el.closest('.note, [data-testid="note-wrapper"], [data-testid="work-item-note-wrapper"], .timeline-entry')) {
      const value = el.getAttribute(attribute)?.trim();
      if (value) return value;
    }
  }
  return '';
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
  const runs = Array.from(content.matchAll(/`+/g), (match) => match[0].length);
  const longest = Math.max(0, Utils.safeMax(runs));
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
  return Markdown.escapeMarkdownLinkText(value);
}
