/** Bitbucket Cloud and Server/Data Center repositories, source files, issues, pull requests, commits, wikis, snippets, and diffs. */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const MAX_ITEMS = 500;
const MAX_COMMENTS = 250;

const BITBUCKET_NON_REPO_RE = /^\/(?:product|account|blog|features|enterprise|pricing|support|dashboard|plans)(?:\/|$)/i;
const BITBUCKET_PATH_RE = /^\/(?!(?:product|account|blog|features|enterprise|pricing|support|dashboard|plans)(?:\/|$))[^/]+\/[^/]+/i;

type Route = {
  repository: string;
  kind:
    | 'repository'
    | 'tree'
    | 'blob'
    | 'issue'
    | 'pull_request'
    | 'pull_request_commits'
    | 'diff'
    | 'commit'
    | 'wiki'
    | 'snippet'
    | 'other';
  id?: string;
  refAndPath?: string;
};

register({
  name: 'Bitbucket',
  matches: ['*://bitbucket.org/*/*'],
  pathnameRegex: BITBUCKET_PATH_RE,
  detect: (contextDocument) => isBitbucketServerDocument(contextDocument),

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
    if (
      route.kind === 'issue'
      || route.kind === 'pull_request'
      || route.kind === 'pull_request_commits'
      || route.kind === 'diff'
    ) {
      return extractWorkItem(metadata, route, title);
    }
    if (route.kind === 'commit') return extractCommit(metadata, route, title);
    if (route.kind === 'wiki') return extractWiki(metadata, route, title);
    if (route.kind === 'snippet') return extractSnippet(metadata, route, title);

    metadata.type = 'Bitbucket page';
    const main = document.querySelector('main, [role="main"], #bitbucket-content, #content');
    const body = main ? Markdown.elementToMarkdown(clean(main)) : '*Could not extract page content.*';
    return finish(metadata, body, 1, main ? 1 : 0, true);
  },
});

function isBitbucketServerDocument(contextDocument?: Document): boolean {
  const doc = contextDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.querySelector !== 'function') return false;
  const pathname = doc.location?.pathname || '';
  if (pathname && BITBUCKET_NON_REPO_RE.test(pathname)) return false;
  if (doc.querySelector('meta[name="application-name"][content="Bitbucket"], #bitbucket-content')) {
    return true;
  }
  return /^\/projects\/[^/]+\/repos\/[^/]+(?:\/|$)/i.test(pathname);
}

function parseRoute(pathname: string): Route {
  const segments = decodePath(pathname).split('/').filter(Boolean);
  let repository = '';
  let rest: string[] = [];

  if (segments[0] === 'projects' && segments[2] === 'repos' && segments[1] && segments[3]) {
    repository = `${segments[1]}/${segments[3]}`;
    rest = segments.slice(4);
  } else if (segments[0] === 'snippets' && segments[1]) {
    return { repository: '', kind: 'snippet', id: segments.slice(1).join('/') };
  } else {
    repository = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : '';
    rest = segments.slice(2);
  }

  if (!repository) return { repository, kind: 'other' };
  if (!rest.length) return { repository, kind: 'repository' };
  if (rest[0] === 'issues' && /^\d+$/.test(rest[1] || '')) {
    return { repository, kind: 'issue', id: rest[1] };
  }
  if (rest[0] === 'pull-requests' && /^\d+$/.test(rest[1] || '')) {
    if (rest.includes('commits')) {
      return { repository, kind: 'pull_request_commits', id: rest[1] };
    }
    const kind = rest.includes('diff') ? 'diff' : 'pull_request';
    return { repository, kind, id: rest[1] };
  }
  if (rest[0] === 'commits' && /^[0-9a-f]{7,64}$/i.test(rest[1] || '')) {
    return { repository, kind: 'commit', id: rest[1] };
  }
  if (rest[0] === 'wiki') {
    return { repository, kind: 'wiki', refAndPath: rest.slice(1).join('/') };
  }
  if (rest[0] === 'snippets') {
    return { repository, kind: 'snippet', id: rest.slice(1).join('/') };
  }
  if (rest[0] === 'src' || rest[0] === 'browse') {
    const refAndPath = rest.slice(1).join('/');
    const looksDirectory = pathname.endsWith('/') || Boolean(document.querySelector(
      '[data-testid="source-browser-directory"], [data-testid="file-tree"], table[data-qa="source-table"], table[data-qa="repository-directory"], table.files-table',
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
    'table[data-qa="repository-directory"] tbody tr',
    'table.files-table tbody tr',
    '.source-list tr',
  ]);
  const limited = limitCollection(rows, MAX_ITEMS);
  const entries = limited.items.map((row) => {
    const link = row.querySelector<HTMLAnchorElement>('a[aria-label^="Directory, "], a[aria-label^="File, "]')
      || row.querySelector<HTMLAnchorElement>('a[href*="/src/"], a[href*="/browse/"]');
    const name = link?.textContent?.trim() || row.textContent?.trim().split('\n')[0]?.trim() || '';
    if (!name) return '';
    const href = link?.href || '';
    const isDirectory = row.getAttribute('data-type') === 'directory'
      || Boolean(row.querySelector('[data-testid*="folder"], [aria-label*="folder" i], a[aria-label^="Directory, "]'));
    return href
      ? `- [${escapeLinkText(name)}](${href}) (${isDirectory ? 'directory' : 'file'})`
      : `- ${name} (${isDirectory ? 'directory' : 'file'})`;
  }).filter(Boolean);

  const parts = [`# ${route.repository || title}`];
  if (entries.length) parts.push('', '## Files', '', ...entries);
  const readme = document.querySelector('[data-testid="readme"], [data-qa="readme-container"], .readme, article.markdown-body');
  if (readme) parts.push('', '## README', '', Markdown.elementToMarkdown(clean(readme)));
  if (!entries.length && !readme) parts.push('', '*No repository content found in rendered page.*');

  const incomplete = limited.truncated || hasPagination();
  metadata.entry_count = entries.length;
  metadata.completeness = incomplete ? 'visible_only' : 'complete_rendered_listing';
  return finish(metadata, parts.join('\n'), limited.total, entries.length, incomplete);
}

async function extractBlob(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): Promise<string> {
  metadata.type = 'Code';
  metadata.ref_and_path = route.refAndPath || '';
  const code = document.querySelector(
    '[data-testid="source-code"] pre, [data-qa="source-code"] pre, .source-code pre, .file-source pre, .source-container pre, table.highlight',
  );
  const content = code?.textContent?.replace(/^\n/, '').replace(/\n$/, '') || await fetchRawSource();
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

/** The cloud source viewer renders only the visible lines, so read the file itself. */
async function fetchRawSource(): Promise<string> {
  const match = window.location.pathname.match(/^\/[^/]+\/[^/]+\/src\//);
  if (window.location.hostname !== 'bitbucket.org' || !match) return '';
  try {
    const response = await Utils.fetchWithTimeout(
      new URL(window.location.pathname.replace('/src/', '/raw/'), window.location.origin).href,
      { credentials: 'same-origin', headers: { Accept: 'text/plain' } },
    );
    if (!response.ok || /^text\/html\b/i.test(response.headers.get('content-type') || '')) return '';
    const text = await response.text();
    return text.includes('\0') ? '' : text.replace(/\n$/, '');
  } catch {
    return '';
  }
}

function extractWorkItem(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  const isPullRequest = route.kind !== 'issue';
  metadata.type = route.kind === 'diff'
    ? 'Pull Request Diff'
    : route.kind === 'pull_request_commits'
      ? 'Pull Request Commits'
      : (isPullRequest ? 'Pull Request' : 'Issue');
  if (route.id) metadata.number = route.id;
  const branchesAndState = Array.from(document.querySelectorAll('[data-qa="pr-branches-and-state-styles"] > *'));
  const state = text('[data-testid="issue-status"], [data-testid="pull-request-status"], [data-qa="status"], .issue-status')
    || (branchesAndState.length > 3 ? normalize(branchesAndState[branchesAndState.length - 1].textContent || '') : '');
  const author = text('[data-testid="author-name"], [data-qa="author"], .author-name, [data-qa="pr-header-author"]');
  const created = Array.from(document.querySelectorAll('time[datetime]'))
    .find((time) => !time.closest('[data-testid="comment"], [data-qa="comment"], [data-qa="pull-request-activity"], .comment'))
    ?.getAttribute('datetime')?.trim()
    || text('[data-testid="pr-header"]').match(/\bCreated (\d{4}-\d{2}-\d{2})\b/)?.[1]
    || '';
  if (state) metadata.state = state;
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const parts = [`# ${isPullRequest ? 'Pull Request' : 'Issue'} #${route.id || ''}: ${title}`];
  if (state) parts.push('', `**Status:** ${state}`);
  if (author) parts.push(`**Author:** ${author}`);
  if (created) parts.push(`**Created:** ${created}`);
  if (isPullRequest) appendBranches(parts, metadata);

  const description = document.querySelector(
    '[data-testid="issue-description"], [data-testid="pull-request-description"], [data-qa="pull-request-description"], [data-qa="description"], .issue-description, .description-content',
  );
  const descriptionMarkdown = description ? Markdown.elementToMarkdown(clean(description)) : '';
  if (descriptionMarkdown) parts.push('', '## Description', '', descriptionMarkdown);

  if (route.kind === 'pull_request_commits') {
    appendCommitsTable(parts);
  }

  const diffElements = selectFirst([
    '[data-testid="diff-file"]',
    '[data-qa="diff-file"]',
    '[data-qa="branch-diff-file"], article[aria-label^="Diff of file "]',
    '.diff-container .file',
  ]);
  const diffsTruncated = (route.kind === 'diff' || diffElements.length > 0)
    ? appendDiffs(parts, metadata, diffElements)
    : false;

  const comments = selectFirst([
    '[data-testid="comment"]',
    '[data-qa="comment"]',
    '.comment-thread .comment',
    '.activity-item[data-type="comment"]',
  ]);
  const limited = limitCollection(comments, MAX_COMMENTS);
  const descriptionText = description ? normalize(clean(description).textContent || '') : '';
  const seen = new Set<string>();
  let captured = 0;
  for (const comment of limited.items) {
    const body = comment.querySelector(
      '[data-testid="comment-content"], [data-qa="comment-content"], .comment-content, .ak-renderer-document',
    ) || comment;
    const cleanedBody = clean(body);
    const markdown = Markdown.elementToMarkdown(cleanedBody);
    const normalizedBody = normalize(markdown);
    if (!normalizedBody || (descriptionText && descriptionText === normalize(cleanedBody.textContent || ''))) continue;

    const commentAuthor = comment.querySelector(
      '[data-testid="author-name"], [data-qa="author"], .author, [data-testid="comment-header"] [role="presentation"]',
    )?.textContent?.trim() || 'Comment';
    const commentTime = comment.querySelector('time')?.getAttribute('datetime') || '';
    const dedupeKey = normalizedBody.length >= 25
      ? normalizedBody
      : `${normalize(commentAuthor)}|${normalize(commentTime)}|${normalizedBody}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    if (!captured) parts.push('', '## Comments');
    parts.push('', `### ${commentAuthor}${commentTime ? ` (${commentTime})` : ''}`, '', markdown);
    captured += 1;
  }

  metadata.comment_count = captured;
  const incomplete = limited.truncated || diffsTruncated || hasPagination();
  metadata.completeness = incomplete ? 'visible_only' : 'complete_rendered_thread';
  return finish(metadata, parts.join('\n'), limited.total, captured, incomplete);
}

function extractCommit(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  metadata.type = 'Commit';
  if (route.id) metadata.commit = route.id;
  const author = text('[data-testid="author-name"], [data-qa="author"], .commit-author');
  const created = attr('time[datetime]', 'datetime');
  if (author) metadata.author = author;
  if (created) metadata.created = created;

  const commitMessage = text('[data-testid="commit-message"], .commit-message, h1') || title;
  const parts = [`# Commit ${route.id?.slice(0, 12) || ''}: ${commitMessage}`];
  if (author) parts.push('', `**Author:** ${author}`);
  if (created) parts.push(`**Date:** ${created}`);

  const diffElements = selectFirst([
    '[data-testid="diff-file"]',
    '[data-qa="diff-file"]',
    '[data-qa="branch-diff-file"], article[aria-label^="Diff of file "]',
    '.diff-container .file',
  ]);
  const diffsTruncated = appendDiffs(parts, metadata, diffElements);
  metadata.completeness = diffsTruncated ? 'visible_only' : 'complete_rendered_diff';
  return finish(metadata, parts.join('\n'), diffElements.length || 1, diffElements.length, diffsTruncated);
}

function extractWiki(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  metadata.type = 'Wiki';
  if (route.refAndPath) metadata.path = route.refAndPath;
  const wikiTitle = text('[data-testid="wiki-title"], .wiki-header h1, h1') || title;
  metadata.title = wikiTitle;
  const content = document.querySelector('[data-testid="wiki-content"], .wiki-content, .ak-renderer-document, article');
  const body = content
    ? `# ${wikiTitle}\n\n${Markdown.elementToMarkdown(clean(content))}`
    : `# ${wikiTitle}\n\n*No wiki content found in rendered page.*`;
  return finish(metadata, body, 1, content ? 1 : 0, !content);
}

function extractSnippet(
  metadata: Record<string, string | number>,
  route: Route,
  title: string,
): string {
  metadata.type = 'Snippet';
  if (route.id) metadata.id = route.id;
  const snippetTitle = text('[data-testid="snippet-title"], h1') || title;
  metadata.title = snippetTitle;
  const parts = [`# ${snippetTitle}`];

  const files = selectFirst(['[data-testid="snippet-file"]', '.snippet-file', '[data-testid="source-code"]']);
  for (const file of files) {
    const fileName = file.querySelector('[data-testid="file-path"], .file-name, h2, h3')?.textContent?.trim() || 'snippet';
    const pre = file.querySelector('pre') || file;
    const content = pre.textContent?.replace(/^\n/, '').replace(/\n$/, '') || '';
    if (!content) continue;
    parts.push('', `## ${fileName}`, '', fence(content, language(fileName)));
  }

  if (parts.length === 1) {
    const main = document.querySelector('main, [role="main"], #content');
    if (main) parts.push('', Markdown.elementToMarkdown(clean(main)));
  }
  return finish(metadata, parts.join('\n'), files.length || 1, files.length, false);
}

function appendCommitsTable(parts: string[]): void {
  const rows = selectFirst([
    '[data-testid="commits-table"] tbody tr',
    'table[data-qa="commits-table"] tbody tr',
    '.commits-table tbody tr',
  ]);
  if (rows.length === 0) return;

  parts.push('', '## Commits', '', '| Commit | Author | Date |', '| --- | --- | --- |');
  for (const row of rows) {
    const message = row.querySelector('a[href*="/commits/"], .commit-message')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const commitAuthor = row.querySelector('[data-testid="author-name"], .author')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const date = row.querySelector('time')?.getAttribute('datetime') || row.querySelector('time')?.textContent?.trim() || '';
    if (!message && !commitAuthor) continue;
    parts.push(`| ${Markdown.escapeMarkdownTableCell(message)} | ${Markdown.escapeMarkdownTableCell(commitAuthor)} | ${Markdown.escapeMarkdownTableCell(date)} |`);
  }
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

function appendDiffs(parts: string[], metadata: Record<string, string | number>, diffs: Element[]): boolean {
  const limited = limitCollection(diffs, MAX_ITEMS);
  let captured = 0;
  for (const diff of limited.items) {
    const path = diff.querySelector('[data-testid="file-path"], [data-qa="file-path"], [data-qa="bk-filepath"], .file-path')?.textContent?.trim() || 'File';
    const body = diff.querySelector('[data-testid="diff-content"], [data-qa="diff-content"], .diff-content, table');
    const content = extractDiffLines(diff) || body?.textContent?.trim() || '';
    if (!content) continue;
    if (!captured) parts.push('', '## Changes');
    parts.push('', `### ${path}`, '', fence(content, 'diff'));
    captured += 1;
  }
  metadata.diff_file_count = captured;
  const pending = document.querySelectorAll('[data-testid="pr-diff-placeholder-wrapper"]').length;
  if (pending > 0) parts.push('', `*${pending} changed files are not rendered yet. Scroll through the diff to load them.*`);
  return limited.truncated || pending > 0;
}

function extractDiffLines(diff: Element): string {
  const lines: string[] = [];
  for (const element of diff.querySelectorAll('[data-qa="code-line"] pre, div')) {
    const text = element.textContent || '';
    if (element.tagName === 'PRE') lines.push(text.replace(/\n$/, ''));
    else if (element.childElementCount === 0 && /^@@ .* @@/.test(text)) lines.push(text);
  }
  return lines.join('\n');
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
    '[data-testid*="pagination"], [data-qa*="load-more"], [data-testid*="load-more"], button[aria-label*="load more" i], .pagination',
  ));
}

function text(selector: string): string {
  return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function attr(selector: string, name: string): string {
  return document.querySelector(selector)?.getAttribute(name)?.trim() || '';
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
