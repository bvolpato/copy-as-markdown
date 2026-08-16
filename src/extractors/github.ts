/**
 * GitHub extractor.
 * Covers: issues, pull requests, pull request patches, commits, repo pages, and README files.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'GitHub',
  matches: [
    '*://github.com/*/*',
    '*://www.github.com/*/*',
  ],

  async extract() {
    const url = Utils.getCanonicalUrl();
    const path = window.location.pathname;

    // Detect page type
    const isIssue = /\/issues\/\d+/.test(path);
    const isPR = /\/pull\/\d+/.test(path);
    const isRepo = /^\/[^/]+\/[^/]+\/?$/.test(path);
    const isCode = /^\/[^/]+\/[^/]+\/(?:blob|tree)\//.test(path);
    const changesRoute = parseChangesRoute(path);

    const metadata: Record<string, string> = {
      source: 'GitHub',
      url,
    };

    if (changesRoute) {
      metadata.url = window.location.href;
      return extractChanges(metadata, changesRoute);
    } else if (isIssue || isPR) {
      return extractIssueOrPR(metadata, isPR);
    } else if (isRepo) {
      return extractRepo(metadata);
    } else if (isCode) {
      return extractCodePage(metadata);
    }

    // Generic fallback
    const title = Utils.getPageTitle();
    metadata.title = title;
    const main = document.querySelector('main, [role="main"], .container-lg');
    const body = main
      ? Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS))
      : '*Could not extract page content.*';
    return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
  },
});

type ChangesRoute = {
  owner: string;
  repo: string;
  pullNumber?: string;
  commitSha?: string;
};

type PatchCommit = {
  sha: string;
  author: string;
  date: string;
  subject: string;
};

type PatchDetails = {
  commits: PatchCommit[];
  files: string[];
  additions: number;
  deletions: number;
};

type GitHubRefInfo = {
  name?: string;
  currentOid?: string;
};

type GitHubTreeItem = {
  name: string;
  path: string;
  contentType: string;
};

type GitHubTreeRoute = {
  path?: string;
  refInfo?: GitHubRefInfo;
  tree?: {
    items?: GitHubTreeItem[];
    totalCount?: number;
  };
};

type GitHubBlob = {
  displayName?: string;
  displayUrl?: string;
  rawBlobUrl?: string;
  language?: string;
  truncated?: boolean;
  headerInfo?: {
    blobSize?: string;
    lineInfo?: {
      truncatedLoc?: string;
    };
  };
};

type GitHubEmbeddedPayload = {
  codeViewRepoRoute?: GitHubTreeRoute;
  codeViewTreeRoute?: GitHubTreeRoute;
  codeViewLayoutRoute?: {
    path?: string;
    refInfo?: GitHubRefInfo;
    repo?: {
      ownerLogin?: string;
      name?: string;
      defaultBranch?: string;
      public?: boolean;
      private?: boolean;
      isFork?: boolean;
    };
  };
  codeViewBlobLayoutRoute?: {
    path?: string;
    refInfo?: GitHubRefInfo;
    blob?: GitHubBlob;
  };
  'codeViewBlobLayoutRoute.StyledBlob'?: {
    rawLines?: string[];
  };
};

type GitHubBlobCandidate = {
  identity: { owner: string; repo: string };
  ref: string;
  path: string;
};

function parseChangesRoute(path: string): ChangesRoute | null {
  const pullMatch = path.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/([0-9a-f]{7,40}))?\/?$/i,
  );
  if (pullMatch) {
    return {
      owner: pullMatch[1],
      repo: pullMatch[2],
      pullNumber: pullMatch[3],
      commitSha: pullMatch[4],
    };
  }

  const pullCommitMatch = path.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/commits\/([0-9a-f]{7,40})\/?$/i,
  );
  if (pullCommitMatch) {
    return {
      owner: pullCommitMatch[1],
      repo: pullCommitMatch[2],
      pullNumber: pullCommitMatch[3],
      commitSha: pullCommitMatch[4],
    };
  }

  const commitMatch = path.match(
    /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})\/?$/i,
  );
  if (!commitMatch) return null;
  return {
    owner: commitMatch[1],
    repo: commitMatch[2],
    commitSha: commitMatch[3],
  };
}

async function extractChanges(
  metadata: Record<string, string>,
  route: ChangesRoute,
): Promise<string> {
  const repository = `${route.owner}/${route.repo}`;
  const patchPath = route.commitSha
    ? `/${route.owner}/${route.repo}/commit/${route.commitSha}.patch`
    : `/${route.owner}/${route.repo}/pull/${route.pullNumber}.patch`;
  const patchUrl = new URL(patchPath, window.location.origin).href;
  const apiPath = route.commitSha
    ? `/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/commits/${route.commitSha}`
    : `/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/pulls/${route.pullNumber}`;
  const patchApiUrl = new URL(apiPath, 'https://api.github.com').href;
  const title = document.querySelector('.js-issue-title, .gh-header-title .markdown-title')
    ?.textContent?.trim() || Utils.getPageTitle();
  const state = document.querySelector('.State, [title^="Status:"]')?.textContent?.trim() || '';
  const base = document.querySelector('.gh-header-meta .commit-ref:not(.head-ref)')?.getAttribute('title') || '';
  const head = document.querySelector('.gh-header-meta .head-ref')?.getAttribute('title') || '';
  const statusActor = document.querySelector('.gh-header-meta .author')?.textContent?.trim() || '';
  const statusDate = document.querySelector('.gh-header-meta relative-time')
    ?.getAttribute('datetime') || '';

  metadata.type = route.commitSha ? 'GitHub Commit Patch' : 'GitHub Pull Request Patch';
  metadata.title = title;
  metadata.repository = repository;
  if (route.pullNumber) metadata.pull_request = route.pullNumber;
  if (route.commitSha) metadata.commit = route.commitSha;
  if (state) metadata.state = state;
  if (base) metadata.base = base;
  if (head) metadata.head = head;
  if (statusActor) metadata.status_actor = statusActor;
  if (statusDate) metadata.status_date = statusDate;
  metadata.patch_url = patchUrl;
  metadata.patch_api_url = patchApiUrl;

  let patch: string;
  try {
    const response = await fetch(patchApiUrl, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github.patch' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    patch = await response.text();
    if (!patch.includes('diff --git ')) throw new Error('response did not contain a Git patch');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Markdown.buildPageMarkdown(
      metadata,
      `# ${title}\n\n*Could not fetch canonical GitHub patch: ${message}*`,
    );
  }

  const details = parsePatchDetails(patch);
  metadata.commits = String(details.commits.length);
  metadata.changed_files = String(details.files.length);
  metadata.additions = String(details.additions);
  metadata.deletions = String(details.deletions);
  metadata.patch_bytes = String(new TextEncoder().encode(patch).length);
  if (details.commits.length > 0) {
    metadata.commit_shas = details.commits.map((commit) => commit.sha).join(', ');
    metadata.authors = [...new Set(details.commits.map((commit) => commit.author).filter(Boolean))].join(', ');
  }

  const heading = route.pullNumber
    ? `# Pull Request #${route.pullNumber}${route.commitSha ? ' Commit' : ' Changes'}: ${title}`
    : `# Commit ${route.commitSha?.slice(0, 12)}: ${details.commits[0]?.subject || title}`;
  const parts = [heading, ''];
  parts.push(`**Repository:** ${repository}`);
  if (state) parts.push(`**Status:** ${state}`);
  if (base) parts.push(`**Base:** \`${base}\``);
  if (head) parts.push(`**Head:** \`${head}\``);
  if (statusActor) parts.push(`**Status actor:** ${statusActor}`);
  if (statusDate) parts.push(`**Status date:** ${statusDate}`);
  parts.push(`**Patch source:** ${patchUrl}`);
  parts.push(`**Summary:** ${details.commits.length} commit(s), ${details.files.length} file(s), +${details.additions}, -${details.deletions}`);

  if (details.commits.length > 0) {
    parts.push('', '## Commits', '', '| SHA | Author | Date | Subject |', '| --- | --- | --- | --- |');
    for (const commit of details.commits) {
      parts.push(`| \`${commit.sha}\` | ${escapeTableCell(commit.author)} | ${escapeTableCell(commit.date)} | ${escapeTableCell(commit.subject)} |`);
    }
  }

  if (details.files.length > 0) {
    parts.push('', '## Files Changed', '');
    parts.push(...details.files.map((file) => `- \`${file}\``));
  }

  const context = Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  return `${context}\n\n## Patch\n\n${fencePatch(patch)}`;
}

function parsePatchDetails(patch: string): PatchDetails {
  const commits: PatchCommit[] = [];
  const boundaries = [...patch.matchAll(/^From ([0-9a-f]{40}) Mon Sep 17 00:00:00 2001$/gm)];
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    const start = (boundary.index || 0) + boundary[0].length + 1;
    const end = boundaries[index + 1]?.index ?? patch.length;
    const headers = patch.slice(start, end).split(/^---\n/m, 1)[0];
    commits.push({
      sha: boundary[1],
      author: headers.match(/^From: (.+)$/m)?.[1]?.trim() || '',
      date: headers.match(/^Date: (.+)$/m)?.[1]?.trim() || '',
      subject: headers.match(/^Subject: (?:\[PATCH[^\]]*\]\s*)?(.+)$/m)?.[1]?.trim() || '',
    });
  }

  const files = [...new Set(
    [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]),
  )];
  let additions = 0;
  let deletions = 0;
  let insideDiff = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      insideDiff = true;
      continue;
    }
    if (!insideDiff) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) additions += 1;
    if (line.startsWith('-')) deletions += 1;
  }

  return { commits, files, additions, deletions };
}

function fencePatch(patch: string): string {
  const longestRun = Math.max(0, ...[...patch.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(4, longestRun + 1));
  return `${fence}diff\n${patch}${patch.endsWith('\n') ? '' : '\n'}${fence}`;
}

function escapeTableCell(value: string): string {
  return Markdown.escapeMarkdownTableCell(value.replace(/\s+/g, ' '));
}

function extractIssueOrPR(metadata: Record<string, string>, isPR: boolean): string {
  const type = isPR ? 'Pull Request' : 'Issue';
  metadata.type = type;

  const titleEl = document.querySelector('.js-issue-title, .gh-header-title .markdown-title');
  const title = titleEl?.textContent?.trim() || Utils.getPageTitle();
  metadata.title = title;

  const numberEl = document.querySelector('.gh-header-title .f1-light');
  const number = numberEl?.textContent?.trim() || '';

  // State (open/closed/merged)
  const stateEl = document.querySelector('.State, [title="Status: Open"], [title="Status: Closed"], [title="Status: Merged"]');
  const state = stateEl?.textContent?.trim() || '';
  if (state) metadata.state = state;

  // Author and date
  const authorEl = document.querySelector('.gh-header-meta .author, .gh-header-meta a.Link--secondary');
  const author = authorEl?.textContent?.trim() || '';
  if (author) metadata.author = author;

  const timeEl = document.querySelector('.gh-header-meta relative-time');
  const date = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  if (date) metadata.created = date;

  // Labels
  const labelEls = document.querySelectorAll('.js-issue-labels .IssueLabel, .sidebar-labels .IssueLabel');
  const labels = Array.from(labelEls).map((el) => el.textContent?.trim()).filter(Boolean);
  if (labels.length > 0) metadata.labels = labels.join(', ');

  const parts: string[] = [`# ${type} ${number}: ${title}\n`];
  if (state) parts.push(`**Status:** ${state}`);
  if (author) parts.push(`**Author:** @${author}`);
  if (date) parts.push(`**Created:** ${date}`);
  if (labels.length > 0) parts.push(`**Labels:** ${labels.join(', ')}`);
  parts.push('');

  // Body
  const bodyEl = document.querySelector('.comment-body, .js-comment-body, .markdown-body');
  if (bodyEl) {
    parts.push('## Description\n');
    parts.push(Markdown.elementToMarkdown(bodyEl));
    parts.push('');
  }

  // Comments
  const comments = document.querySelectorAll('.timeline-comment:not(:first-of-type) .comment-body, .js-timeline-item .comment-body');
  if (comments.length > 1) {
    parts.push('## Comments\n');
    const seen = new Set<string>();
    comments.forEach((comment, i) => {
      if (i === 0) return; // skip first (it's the body)
      const text = comment.textContent?.trim() || '';
      if (seen.has(text) || !text) return;
      seen.add(text);

      const container = comment.closest('.timeline-comment, .js-timeline-item');
      const commentAuthor = container?.querySelector('.author, a.Link--secondary')?.textContent?.trim() || '';
      const commentTime = container?.querySelector('relative-time')?.getAttribute('datetime') || '';

      parts.push(`### ${commentAuthor}${commentTime ? ` (${commentTime})` : ''}\n`);
      parts.push(Markdown.elementToMarkdown(comment));
      parts.push('');
    });
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

async function extractRepo(metadata: Record<string, string>): Promise<string> {
  const payload = getEmbeddedPayload();
  const treeRoute = payload?.codeViewRepoRoute;
  const identity = getRepositoryIdentity(payload);
  const repoName = identity ? `${identity.owner}/${identity.repo}` : (
    document.querySelector('[itemprop="name"] a, .AppHeader-context-item-label')?.textContent?.trim()
    || window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
  );
  metadata.title = repoName;
  metadata.type = 'Repository';
  if (identity) metadata.repository = repoName;

  addRepositoryMetadata(metadata, payload, treeRoute);

  const parts: string[] = [`# ${repoName}\n`];

  // Description
  const descEl = document.querySelector('.f4.my-3, [itemprop="about"], .BorderGrid-cell p.f4');
  const desc = descEl?.textContent?.trim();
  if (desc) {
    parts.push(`> ${desc}\n`);
    metadata.description = desc;
  }

  // Stats
  const statsEls = document.querySelectorAll('.BorderGrid-cell .h4, .about-margin .Counter, a[href$="/stargazers"], a[href$="/forks"]');
  const stats: string[] = [];
  statsEls.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) stats.push(text);
  });

  // Topics
  const topicEls = document.querySelectorAll('.topic-tag');
  const topics = Array.from(topicEls).map((el) => el.textContent?.trim()).filter(Boolean);
  if (topics.length > 0) parts.push(`**Topics:** ${topics.join(', ')}\n`);

  // Languages
  const langEls = document.querySelectorAll('.BorderGrid-cell [aria-label] .color-fg-default, .repository-lang-stats-graph + ol li a span');
  const langs = Array.from(langEls).map((el) => el.textContent?.trim()).filter(Boolean);
  if (langs.length > 0) parts.push(`**Languages:** ${langs.join(', ')}\n`);

  const items = await resolveDirectoryItems(identity, treeRoute, '');
  appendDirectoryListing(parts, metadata, items, identity, treeRoute?.refInfo?.name, '/');

  // README
  const readmeEl = document.querySelector('#readme .markdown-body, article.markdown-body');
  if (readmeEl) {
    parts.push('## README\n');
    const cleaned = Utils.removeNoise(readmeEl, ['.anchor', '.octicon']);
    parts.push(Markdown.elementToMarkdown(cleaned));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

async function extractCodePage(metadata: Record<string, string>): Promise<string> {
  const payload = getEmbeddedPayload();
  if (window.location.pathname.includes('/blob/')) {
    return extractBlobPage(metadata, payload);
  }

  const treeRoute = payload?.codeViewTreeRoute;
  if (treeRoute) return extractDirectoryPage(metadata, payload, treeRoute);

  return extractLegacyCodePage(metadata);
}

async function extractDirectoryPage(
  metadata: Record<string, string>,
  payload: GitHubEmbeddedPayload | null,
  treeRoute: GitHubTreeRoute,
): Promise<string> {
  const identity = getRepositoryIdentity(payload);
  const repository = identity ? `${identity.owner}/${identity.repo}` : window.location.pathname.split('/').slice(1, 3).join('/');
  const directory = treeRoute.path || '/';
  metadata.title = `${repository}/${directory}`;
  metadata.type = 'Directory';
  metadata.repository = repository;
  metadata.path = directory;
  addRepositoryMetadata(metadata, payload, treeRoute);

  const parts = [`# ${repository}/${directory}`, ''];
  const items = await resolveDirectoryItems(identity, treeRoute, directory);
  appendDirectoryListing(parts, metadata, items, identity, treeRoute.refInfo?.name, directory);

  const readmeEl = document.querySelector('#readme .markdown-body, article.markdown-body');
  if (readmeEl) {
    parts.push('', '## README', '', Markdown.elementToMarkdown(readmeEl));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

async function extractBlobPage(
  metadata: Record<string, string>,
  payload: GitHubEmbeddedPayload | null,
): Promise<string> {
  const candidates = getBlobCandidates(payload);
  const location = candidates[0];
  const identity = location?.identity || getRepositoryIdentity(payload);
  const repository = identity ? `${identity.owner}/${identity.repo}` : window.location.pathname.split('/').slice(1, 3).join('/');
  const blobRoute = payload?.codeViewBlobLayoutRoute;
  const blob = blobRoute?.blob;
  let path = location?.path || blobRoute?.path || payload?.codeViewLayoutRoute?.path || '';
  const refInfo = blobRoute?.refInfo || payload?.codeViewLayoutRoute?.refInfo;
  let ref = location?.ref || refInfo?.name || '';
  let fileName = path.split('/').pop() || blob?.displayName || 'file';
  const rawLines = payload?.['codeViewBlobLayoutRoute.StyledBlob']?.rawLines;
  const expectedLines = Number(blob?.headerInfo?.lineInfo?.truncatedLoc || 0);

  let content = Array.isArray(rawLines) ? rawLines.join('\n') : '';
  let source = Array.isArray(rawLines) ? 'GitHub page data' : '';
  if (!Array.isArray(rawLines) || blob?.truncated || (expectedLines > 0 && rawLines.length < expectedLines)) {
    const fetched = await fetchFirstRawFile(candidates);
    if (fetched) {
      content = fetched.content;
      source = fetched.source;
      path = fetched.candidate.path;
      ref = fetched.candidate.ref;
      fileName = path.split('/').pop() || fileName;
    }
  }

  if (!source) {
    metadata.title = `${repository}/${path || fileName}`;
    metadata.type = 'Code';
    metadata.repository = repository;
    metadata.path = path || fileName;
    if (ref) metadata.branch = ref;
    return Markdown.buildPageMarkdown(
      metadata,
      `# ${repository}/${path || fileName}\n\n*Could not fetch full GitHub file content.*`,
    );
  }

  metadata.title = `${repository}/${path || fileName}`;
  metadata.type = 'Code';
  metadata.repository = repository;
  metadata.path = path || fileName;
  if (ref) metadata.branch = ref;
  if (refInfo?.currentOid) metadata.commit = refInfo.currentOid;
  if (blob?.language) metadata.language = blob.language;
  if (blob?.headerInfo?.blobSize) metadata.size = blob.headerInfo.blobSize;
  metadata.lines = String(countLines(content, rawLines));
  metadata.bytes = String(new TextEncoder().encode(content).length);
  metadata.content_source = source;
  if (blob?.rawBlobUrl || blob?.displayUrl) metadata.raw_url = blob.rawBlobUrl || blob.displayUrl || '';
  else if (location) metadata.raw_url = githubRawUrl(location);

  const context = Markdown.buildPageMarkdown(
    metadata,
    `# ${repository}/${path || fileName}\n\n**Full file content from ${source}.**`,
  );
  return `${context}\n\n## File Contents\n\n${fenceContent(content, languageFence(fileName))}`;
}

function extractLegacyCodePage(metadata: Record<string, string>): string {
  const title = Utils.getPageTitle();
  metadata.title = title;
  metadata.type = 'Code';

  const parts: string[] = [`# ${title}\n`];

  // File content
  const codeEl = document.querySelector('.blob-code-content, .highlight, .Box-body pre');
  if (codeEl) {
    const fileName = document.querySelector('.final-path, .breadcrumb .final-path')?.textContent?.trim() || 'file';
    const ext = fileName.split('.').pop() || '';
    parts.push(`\`\`\`${ext}\n${codeEl.textContent?.trim()}\n\`\`\`\n`);
  }

  // README on tree pages
  const readmeEl = document.querySelector('#readme .markdown-body');
  if (readmeEl) {
    parts.push('## README\n');
    parts.push(Markdown.elementToMarkdown(readmeEl));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function getEmbeddedPayload(): GitHubEmbeddedPayload | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"][data-target="react-app.embeddedData"]',
  );
  const payloads: GitHubEmbeddedPayload[] = [];
  for (const script of scripts) {
    if (!script.textContent) continue;
    try {
      const parsed = JSON.parse(script.textContent) as { payload?: GitHubEmbeddedPayload };
      if (parsed.payload) payloads.push(parsed.payload);
    } catch {
      // Ignore stale or partially replaced GitHub SPA payloads.
    }
  }

  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    if (payloadMatchesCurrentRoute(payloads[index])) return payloads[index];
  }
  return null;
}

function payloadMatchesCurrentRoute(payload: GitHubEmbeddedPayload): boolean {
  const pathname = decodePathname(window.location.pathname);
  const repo = payload.codeViewLayoutRoute?.repo;
  if (!repo?.ownerLogin || !repo.name) return false;

  const prefix = `/${repo.ownerLogin}/${repo.name}`;
  if (pathname === prefix || pathname === `${prefix}/`) return Boolean(payload.codeViewRepoRoute);

  const blobRoute = payload.codeViewBlobLayoutRoute;
  const blobRef = blobRoute?.refInfo?.name;
  if (blobRoute?.path && blobRef) {
    if (pathname === `${prefix}/blob/${blobRef}/${blobRoute.path}`) return true;
  }

  const treeRoute = payload.codeViewTreeRoute;
  const treeRef = treeRoute?.refInfo?.name;
  if (treeRoute?.path && treeRef) {
    if (pathname === `${prefix}/tree/${treeRef}/${treeRoute.path}`) return true;
  }

  return false;
}

function getBlobCandidates(payload: GitHubEmbeddedPayload | null): GitHubBlobCandidate[] {
  const match = decodePathname(window.location.pathname).match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!match) return [];
  const [, owner, repo, remainder] = match;
  const segments = remainder.split('/').filter(Boolean);
  if (segments.length < 2) return [];

  const candidates: GitHubBlobCandidate[] = [];
  const blobRoute = payload?.codeViewBlobLayoutRoute;
  if (blobRoute?.refInfo?.name && blobRoute.path) {
    candidates.push({
      identity: { owner, repo },
      ref: blobRoute.refInfo.name,
      path: blobRoute.path,
    });
  }

  for (let split = 1; split < segments.length; split += 1) {
    const candidate = {
      identity: { owner, repo },
      ref: segments.slice(0, split).join('/'),
      path: segments.slice(split).join('/'),
    };
    if (!candidates.some((item) => item.ref === candidate.ref && item.path === candidate.path)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function decodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function getRepositoryIdentity(payload: GitHubEmbeddedPayload | null): { owner: string; repo: string } | null {
  const repo = payload?.codeViewLayoutRoute?.repo;
  if (repo?.ownerLogin && repo.name) return { owner: repo.ownerLogin, repo: repo.name };
  const [owner, name] = window.location.pathname.split('/').filter(Boolean);
  return owner && name ? { owner, repo: name } : null;
}

function addRepositoryMetadata(
  metadata: Record<string, string>,
  payload: GitHubEmbeddedPayload | null,
  route?: GitHubTreeRoute,
): void {
  const repo = payload?.codeViewLayoutRoute?.repo;
  const refInfo = route?.refInfo || payload?.codeViewLayoutRoute?.refInfo;
  if (repo?.defaultBranch) metadata.default_branch = repo.defaultBranch;
  if (refInfo?.name) metadata.branch = refInfo.name;
  if (refInfo?.currentOid) metadata.commit = refInfo.currentOid;
  if (repo?.private === true) metadata.visibility = 'private';
  else if (repo?.public === true) metadata.visibility = 'public';
  if (repo?.isFork !== undefined) metadata.fork = String(repo.isFork);
}

async function fetchDirectoryItems(
  identity: { owner: string; repo: string } | null,
  path: string,
  ref?: string,
): Promise<GitHubTreeItem[]> {
  if (!identity) return [];
  const apiUrl = githubContentsApiUrl(identity, path, ref);
  try {
    const response = await fetch(apiUrl, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return [];
    const entries = await response.json() as Array<{ name?: string; path?: string; type?: string }>;
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry): entry is { name: string; path: string; type?: string } => Boolean(entry.name && entry.path))
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        contentType: entry.type === 'dir' ? 'directory' : (entry.type || 'file'),
      }));
  } catch {
    return [];
  }
}

async function resolveDirectoryItems(
  identity: { owner: string; repo: string } | null,
  route: GitHubTreeRoute | undefined,
  path: string,
): Promise<GitHubTreeItem[]> {
  const embedded = route?.tree?.items || [];
  const total = route?.tree?.totalCount;
  if (embedded.length > 0 && (total === undefined || embedded.length >= total)) return embedded;
  const fetched = await fetchDirectoryItems(identity, path, route?.refInfo?.name);
  return fetched.length > 0 ? fetched : embedded;
}

async function fetchRawFile(
  identity: { owner: string; repo: string } | null,
  path: string,
  ref?: string,
): Promise<string | null> {
  if (!identity || !path) return null;
  try {
    const response = await fetch(githubContentsApiUrl(identity, path, ref), {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github.raw+json' },
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function fetchFirstRawFile(
  candidates: GitHubBlobCandidate[],
): Promise<{ candidate: GitHubBlobCandidate; content: string; source: string } | null> {
  for (const candidate of candidates) {
    const content = await fetchRawDownload(candidate);
    if (content !== null) return { candidate, content, source: 'GitHub authenticated raw file' };
  }
  for (const candidate of candidates) {
    const content = await fetchRawFile(candidate.identity, candidate.path, candidate.ref);
    if (content !== null) return { candidate, content, source: 'GitHub raw content API' };
  }
  return null;
}

async function fetchRawDownload(candidate: GitHubBlobCandidate): Promise<string | null> {
  try {
    const response = await fetch(githubRawUrl(candidate), {
      credentials: 'same-origin',
      headers: { Accept: 'text/plain' },
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

function githubRawUrl(candidate: GitHubBlobCandidate): string {
  const ref = candidate.ref.split('/').map(encodeURIComponent).join('/');
  const path = candidate.path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(candidate.identity.owner)}/${encodeURIComponent(candidate.identity.repo)}/raw/refs/heads/${ref}/${path}`;
}

function githubContentsApiUrl(
  identity: { owner: string; repo: string },
  path: string,
  ref?: string,
): string {
  const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const suffix = encodedPath ? `/contents/${encodedPath}` : '/contents';
  const url = new URL(
    `/repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}${suffix}`,
    'https://api.github.com',
  );
  if (ref) url.searchParams.set('ref', ref);
  return url.href;
}

function appendDirectoryListing(
  parts: string[],
  metadata: Record<string, string>,
  items: GitHubTreeItem[],
  identity: { owner: string; repo: string } | null,
  ref: string | undefined,
  directory: string,
): void {
  const directories = items.filter((item) => item.contentType === 'directory').length;
  const files = items.length - directories;
  metadata.directory = directory || '/';
  metadata.entries = String(items.length);
  metadata.directories = String(directories);
  metadata.files = String(files);

  parts.push('', '## Directory Contents', '');
  if (items.length === 0) {
    parts.push('*No directory entries found.*');
    return;
  }

  parts.push('| Type | Name | Path |', '| --- | --- | --- |');
  for (const item of items) {
    const type = item.contentType === 'directory' ? 'Directory' : capitalize(item.contentType);
    const name = identity && ref
      ? `[${escapeTableCell(item.name)}](${githubItemUrl(identity, ref, item)})`
      : escapeTableCell(item.name);
    parts.push(`| ${type} | ${name} | \`${item.path}\` |`);
  }
}

function githubItemUrl(
  identity: { owner: string; repo: string },
  ref: string,
  item: GitHubTreeItem,
): string {
  const kind = item.contentType === 'directory' ? 'tree' : 'blob';
  const encodedPath = item.path.split('/').map(encodeURIComponent).join('/');
  return `https://github.com/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/${kind}/${encodeURIComponent(ref)}/${encodedPath}`;
}

function countLines(content: string, rawLines?: string[]): number {
  if (rawLines) return rawLines.length;
  if (!content) return 0;
  const lines = content.split(/\r?\n/).length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

function languageFence(fileName: string): string {
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'jsx',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'bash',
    ts: 'typescript',
    tsx: 'tsx',
    yml: 'yaml',
  };
  return aliases[extension] || extension;
}

function fenceContent(content: string, language: string): string {
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : 'File';
}
