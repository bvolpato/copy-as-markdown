/**
 * GitHub extractor.
 * Covers: issues, pull requests, pull request patches, commits, discussions,
 * wikis, releases, actions, compare views, gists, repo pages, and README files.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import { restoreMathSource } from '../core/math-source';
import * as Utils from '../core/utils';

const NON_REPO_PATH_RE = /^\/(?:settings|orgs|topics|sponsors|marketplace|features|enterprise|pricing|login|signup|explore|notifications|codespaces)(?:\/|$)/i;
const TITLE_SELECTOR = [
  '[data-testid="issue-title"]',
  '.js-issue-title',
  '.gh-header-title .markdown-title',
  'h1 .markdown-title',
  'h1 [class*="markdownTitle"]',
].join(', ');
const GITHUB_PATH_RE = /^\/(?!(?:settings|orgs|topics|sponsors|marketplace|features|enterprise|pricing|login|signup|explore|notifications|codespaces)(?:\/|$))[^/]+/i;

export const githubExtractor = register({
  name: 'GitHub',
  matches: [
    '*://github.com/*/*',
    '*://www.github.com/*/*',
    '*://gist.github.com/*',
  ],
  pathnameRegex: GITHUB_PATH_RE,
  detect: (contextDocument) => isGitHubEnterpriseDocument(contextDocument),

  async extract() {
    const url = Utils.getCanonicalUrl();
    const path = window.location.pathname;

    const metadata: Record<string, string> = {
      source: 'GitHub',
      url,
    };

    if (isGistPage()) {
      return extractGist(metadata);
    }

    const changesRoute = parseChangesRoute(path);
    if (changesRoute) {
      metadata.url = window.location.href;
      return extractChanges(metadata, changesRoute);
    }

    const isPRCommits = /^\/[^/]+\/[^/]+\/pull\/\d+\/commits\/?$/i.test(path);
    const isPRChecks = /^\/[^/]+\/[^/]+\/pull\/\d+\/checks(?:\/|$)/i.test(path);
    const isIssue = /^\/[^/]+\/[^/]+\/issues\/\d+(?:\/|$)/i.test(path);
    const isPR = /^\/[^/]+\/[^/]+\/pull\/\d+(?:\/|$)/i.test(path);
    const isDiscussion = /^\/[^/]+\/[^/]+\/discussions\/\d+(?:\/|$)/i.test(path);
    const isWiki = /^\/[^/]+\/[^/]+\/wiki(?:\/|$)/i.test(path);
    const isReleases = /^\/[^/]+\/[^/]+\/releases(?:\/|$)/i.test(path);
    const isActionRun = /^\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/|$)/i.test(path);
    const isCompare = /^\/[^/]+\/[^/]+\/compare\/.+/i.test(path);
    const isCommitsList = /^\/[^/]+\/[^/]+\/commits(?:\/|$)/i.test(path);
    const isRepo = /^\/[^/]+\/[^/]+\/?$/.test(path);
    const isCode = /^\/[^/]+\/[^/]+\/(?:blob|tree)\//i.test(path);

    if (isPRCommits) return extractPRCommits(metadata);
    if (isPRChecks) return extractPRChecks(metadata);
    if (isIssue || isPR) return extractIssueOrPR(metadata, isPR);
    if (isDiscussion) return extractDiscussion(metadata);
    if (isWiki) return extractWiki(metadata);
    if (isReleases) return extractReleases(metadata);
    if (isActionRun) return extractActionRun(metadata);
    if (isCompare) return extractCompare(metadata);
    if (isCommitsList) return extractCommitsList(metadata);
    if (isRepo) return extractRepo(metadata);
    if (isCode) return extractCodePage(metadata);

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

function isGitHubEnterpriseDocument(contextDocument?: Document): boolean {
  const doc = contextDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.querySelector !== 'function') return false;
  const pathname = doc.location?.pathname || '';
  if (pathname && (pathname === '/' || NON_REPO_PATH_RE.test(pathname))) return false;
  return Boolean(doc.querySelector(
    'meta[name="octolytics-host"], meta[name="github-keyboard-shortcuts"], meta[name="expected-hostname"]',
  ));
}

function isGistPage(): boolean {
  const host = window.location.hostname.toLowerCase();
  if (host === 'gist.github.com' || host.startsWith('gist.')) return true;
  return Boolean(document.querySelector('.gist-content, .gist-detail-container, [data-testid="gist-file"]'));
}

type ChangesRoute = {
  owner: string;
  repo: string;
  pullNumber?: string;
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
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

function getGitHubApiBase(): string {
  const host = window.location.hostname.toLowerCase();
  if (host === 'github.com' || host === 'www.github.com') {
    return 'https://api.github.com';
  }
  return `${window.location.origin}/api/v3`;
}

function parseChangesRoute(path: string): ChangesRoute | null {
  const pullRangeMatch = path.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)\/([0-9a-f]{7,64})\.\.([0-9a-f]{7,64})\/?$/i,
  );
  if (pullRangeMatch) {
    return {
      owner: pullRangeMatch[1],
      repo: pullRangeMatch[2],
      pullNumber: pullRangeMatch[3],
      baseSha: pullRangeMatch[4],
      headSha: pullRangeMatch[5],
    };
  }

  const pullMatch = path.match(
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/([0-9a-f]{7,64}))?\/?$/i,
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
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/commits\/([0-9a-f]{7,64})\/?$/i,
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
    /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,64})\/?$/i,
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
  const isRange = Boolean(route.baseSha && route.headSha);
  const patchPath = isRange
    ? `/${route.owner}/${route.repo}/compare/${route.baseSha}...${route.headSha}.patch`
    : route.commitSha
      ? `/${route.owner}/${route.repo}/commit/${route.commitSha}.patch`
      : `/${route.owner}/${route.repo}/pull/${route.pullNumber}.patch`;
  const patchUrl = new URL(patchPath, window.location.origin).href;
  const apiPath = isRange
    ? `/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/compare/${route.baseSha}...${route.headSha}`
    : route.commitSha
      ? `/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/commits/${route.commitSha}`
      : `/repos/${encodeURIComponent(route.owner)}/${encodeURIComponent(route.repo)}/pulls/${route.pullNumber}`;
  const patchApiUrl = new URL(apiPath.replace(/^\//, ''), `${getGitHubApiBase().replace(/\/$/, '')}/`).href;
  const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim() || Utils.getPageTitle();
  const state = document.querySelector('.State, [title^="Status:"], [data-component="StateLabel"]')?.textContent?.trim() || '';
  const base = document.querySelector('.gh-header-meta .commit-ref:not(.head-ref)')?.getAttribute('title') || '';
  const head = document.querySelector('.gh-header-meta .head-ref')?.getAttribute('title') || '';
  const statusActor = document.querySelector('.gh-header-meta .author')?.textContent?.trim() || '';
  const statusDate = document.querySelector('.gh-header-meta relative-time')
    ?.getAttribute('datetime') || '';

  metadata.type = route.commitSha
    ? 'GitHub Commit Patch'
    : isRange
      ? 'GitHub Commit Range Patch'
      : 'GitHub Pull Request Patch';
  metadata.title = title;
  metadata.repository = repository;
  if (route.pullNumber) metadata.pull_request = route.pullNumber;
  if (route.commitSha) metadata.commit = route.commitSha;
  if (route.baseSha && route.headSha) metadata.commit_range = `${route.baseSha}..${route.headSha}`;
  if (state) metadata.state = state;
  if (base) metadata.base = base;
  if (head) metadata.head = head;
  if (statusActor) metadata.status_actor = statusActor;
  if (statusDate) metadata.status_date = statusDate;
  metadata.patch_url = patchUrl;
  metadata.patch_api_url = patchApiUrl;

  let patch = '';
  let lastError = '';

  // 1. Try GitHub API first (works without auth on public repos and matches canonical format).
  try {
    const response = await Utils.fetchWithTimeout(patchApiUrl, {
      credentials: 'omit',
      headers: { Accept: 'application/vnd.github.patch' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes('diff --git ')) throw new Error('response did not contain a Git patch');
    patch = text;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }

  // 2. Fall back to same-origin .patch URL (supports private repos and bypasses unauthenticated API rate limits).
  if (!patch) {
    try {
      const response = await Utils.fetchWithTimeout(patchUrl, {
        credentials: 'same-origin',
        headers: { Accept: 'text/plain' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (!text.includes('diff --git ')) throw new Error('response did not contain a Git patch');
      patch = text;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  // 3. Fall back to rendered DOM diff when patch fetches fail.
  if (!patch) {
    const domDiff = extractDomDiffs();
    if (domDiff.files.length > 0) {
      const heading = route.pullNumber
        ? `# Pull Request #${route.pullNumber}${route.commitSha ? ' Commit' : ' Changes'}: ${title}`
        : `# Commit ${route.commitSha?.slice(0, 12) || ''}: ${title}`;
      const parts = [heading, ''];
      parts.push(`**Repository:** ${repository}`);
      if (state) parts.push(`**Status:** ${state}`);
      if (base) parts.push(`**Base:** \`${base}\``);
      if (head) parts.push(`**Head:** \`${head}\``);
      parts.push('', '## Files Changed', '');
      for (const file of domDiff.files) {
        parts.push(`### ${file.path}`, '', fencePatch(file.diff), '');
      }
      return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
    }

    return Markdown.buildPageMarkdown(
      metadata,
      `# ${title}\n\n*Could not fetch canonical GitHub patch: ${lastError}*`,
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

function extractDomDiffs(): { files: Array<{ path: string; diff: string }> } {
  const candidates = Array.from(document.querySelectorAll(
    'copilot-diff-entry, .file.js-file, .file[data-tagsearch-path], [data-testid="diff-file"], table[data-diff-anchor]',
  ));
  // Current diff entries wrap the older file container, so keep outermost matches only.
  const containers = candidates.filter((container) => !candidates.some(
    (other) => other !== container && other.contains(container),
  ));
  const files: Array<{ path: string; diff: string }> = [];
  for (const container of containers) {
    const filePath = container.getAttribute('data-file-path')
      || container.getAttribute('data-tagsearch-path')
      || container.getAttribute('aria-label')?.match(/^Diff for: (.+)$/)?.[1]
      || container.querySelector('.file-info a[title], .file-info a, [data-testid="file-path"], h3 a')?.textContent?.trim()
      || '';
    const diff = extractDiffLines(container).join('\n');
    if (filePath || diff) {
      files.push({ path: filePath || 'File', diff: diff || '*Diff content not rendered.*' });
    }
  }
  return { files };
}

function extractDiffLines(container: Element): string[] {
  const lines: string[] = [];
  let contextRow: Element | null = null;
  for (const content of container.querySelectorAll(
    '.blob-code-hunk, .blob-code .blob-code-inner, .diff-text-inner',
  )) {
    const text = (content.textContent || '').replace(/\r?\n$/, '');
    if (content.matches('.blob-code-hunk') || content.closest('.hunk')) {
      lines.push(text.trim());
      continue;
    }
    const marker = diffMarker(content);
    const row = content.closest('tr');
    if (marker === ' ' && row) {
      // Split views repeat unchanged lines on both sides.
      if (row === contextRow) continue;
      contextRow = row;
    }
    lines.push(`${marker}${text}`);
  }
  return lines;
}

function diffMarker(content: Element): string {
  const marker = content.closest('[data-code-marker]')?.getAttribute('data-code-marker');
  if (marker) return marker;
  if (content.closest('.addition, .blob-code-addition')) return '+';
  return content.closest('.deletion, .blob-code-deletion') ? '-' : ' ';
}

function parsePatchDetails(patch: string): PatchDetails {
  const commits: PatchCommit[] = [];
  const boundaries = [...patch.matchAll(/^From ([0-9a-f]{40,64}) Mon Sep 17 00:00:00 2001$/gm)];
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    const start = (boundary.index || 0) + boundary[0].length + 1;
    const end = boundaries[index + 1]?.index ?? patch.length;
    // Mail headers end at the first blank line. Long values fold onto indented lines.
    const headers = patch.slice(start, end).split(/^\r?\n/m, 1)[0].replace(/\r?\n[ \t]+/g, ' ');
    commits.push({
      sha: boundary[1],
      author: decodeMailHeader(headers.match(/^From: (.+)$/m)?.[1]?.trim() || ''),
      date: headers.match(/^Date: (.+)$/m)?.[1]?.trim() || '',
      subject: decodeMailHeader(headers.match(/^Subject: (?:\[PATCH[^\]]*\]\s*)?(.+)$/m)?.[1]?.trim() || ''),
    });
  }

  const files = [...new Set(
    [...patch.matchAll(/^diff --git (?:"a\/(?:[^"\\]|\\.)+"|a\/.+?) (?:"b\/((?:[^"\\]|\\.)+)"|b\/(.+))$/gm)]
      .map((match) => (match[1] !== undefined ? unescapeGitPath(match[1]) : match[2])),
  )];
  let additions = 0;
  let deletions = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  for (const line of patch.split('\n')) {
    if (oldRemaining <= 0 && newRemaining <= 0) {
      // Only hunk bodies hold changed lines. Commit messages can also start with + or -.
      const hunk = line.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
      if (hunk) {
        oldRemaining = Number(hunk[1] ?? 1);
        newRemaining = Number(hunk[2] ?? 1);
      }
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
      newRemaining -= 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
      oldRemaining -= 1;
    } else if (!line.startsWith('\\')) {
      oldRemaining -= 1;
      newRemaining -= 1;
    }
  }

  return { commits, files, additions, deletions };
}

function unescapeGitPath(value: string): string {
  return value.replace(/\\(["\\])/g, '$1');
}

/** Decode RFC 2047 words, which patches use for non-ASCII authors and subjects. */
function decodeMailHeader(value: string): string {
  return value
    .replace(/(=\?[^?\s]+\?[bq]\?[^?\s]*\?=)\s+(?==\?)/gi, '$1')
    .replace(/(?:=\?utf-8\?[bq]\?[^?\s]*\?=)+/gi, (run) => {
      const bytes: number[] = [];
      for (const [, encoding, text] of run.matchAll(/=\?utf-8\?([bq])\?([^?\s]*)\?=/gi)) {
        try {
          const decoded = encoding.toLowerCase() === 'b'
            ? atob(text)
            : text.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_match, hex: string) => (
              String.fromCharCode(Number.parseInt(hex, 16))
            ));
          for (const character of decoded) bytes.push(character.charCodeAt(0));
        } catch {
          return run;
        }
      }
      return new TextDecoder().decode(new Uint8Array(bytes));
    });
}

function fencePatch(patch: string): string {
  const runs = [...patch.matchAll(/`+/g)].map((match) => match[0].length);
  const longestRun = Math.max(0, Utils.safeMax(runs));
  const fence = '`'.repeat(Math.max(4, longestRun + 1));
  return `${fence}diff\n${patch}${patch.endsWith('\n') ? '' : '\n'}${fence}`;
}

function escapeTableCell(value: string): string {
  return Markdown.escapeMarkdownTableCell(value.replace(/\s+/g, ' '));
}

function extractGist(metadata: Record<string, string>): string {
  metadata.type = 'Gist';
  const author = document.querySelector('.gist-header-title a[data-hovercard-type="user"], a[rel="author"], .author a')
    ?.textContent?.trim() || '';
  const gistName = document.querySelector('.gist-header-title strong a, h1 strong a, .gist-blob-name')
    ?.textContent?.trim() || Utils.getPageTitle();
  const description = document.querySelector('[itemprop="about"], .gist-content .repository-meta-content')
    ?.textContent?.trim() || '';
  const title = author ? `${author}/${gistName}` : gistName;
  metadata.title = title;
  if (author) metadata.author = author;
  if (description) metadata.description = description;

  const parts: string[] = [`# ${title}\n`];
  if (description) parts.push(`> ${description}\n`);

  const fileBoxes = Array.from(document.querySelectorAll(
    '.js-gist-file-update-container .file, .file-box .file, .file[id^="file-"]',
  ));
  for (const fileBox of fileBoxes) {
    const fileName = fileBox.querySelector('.gist-blob-name, .file-info a strong, .file-header .file-info a, .file-header strong')
      ?.textContent?.trim() || 'file';
    const markdownBody = fileBox.querySelector('article.markdown-body, .markdown-body');
    if (markdownBody) {
      parts.push(`## ${fileName}\n`);
      parts.push(bodyToMarkdown(markdownBody, ['.anchor', '.octicon']));
      parts.push('');
      continue;
    }

    const lineCells = fileBox.querySelectorAll('table.js-file-line-container td.blob-code-inner, td.blob-code-inner');
    let code = '';
    if (lineCells.length > 0) {
      code = Array.from(lineCells).map(codeCellText).join('\n');
    } else {
      const fallback = fileBox.querySelector('pre, .blob-wrapper');
      code = fallback?.textContent?.replace(/^\n/, '').replace(/\n$/, '') || '';
    }
    parts.push(`## ${fileName}\n`);
    parts.push(code ? fenceContent(code, languageFence(fileName)) : '*Empty file.*');
    parts.push('');
  }

  appendDiscussionComments(parts, null);
  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractDiscussion(metadata: Record<string, string>): string {
  metadata.type = 'Discussion';
  const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim() || Utils.getPageTitle();
  metadata.title = title;
  const number = `#${window.location.pathname.split('/')[4] || ''}`;
  const category = document.querySelector('.gh-header-meta a[href*="/discussions/categories/"], .discussion-category')?.textContent?.trim() || '';
  const answered = Boolean(document.querySelector('.color-fg-success [aria-label*="Answered"], .State--merged, [title="Answered"]'));
  const author = discussionAuthor(document.querySelector('.gh-header-meta, .discussion-header, .timeline-comment'));
  const timeEl = document.querySelector('.gh-header-meta relative-time, .timeline-comment relative-time');
  const date = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

  if (author) metadata.author = author;
  if (date) metadata.created = date;
  if (category) metadata.category = category;

  const parts: string[] = [`# Discussion ${number}: ${title}\n`];
  if (category) parts.push(`**Category:** ${category}`);
  if (answered) parts.push('**Status:** Answered');
  if (author) parts.push(`**Author:** @${author}`);
  if (date) parts.push(`**Created:** ${date}`);
  parts.push('');

  const bodyEl = document.querySelector('.js-discussion .comment-body, .discussion .comment-body, .timeline-comment .comment-body');
  if (bodyEl) {
    parts.push('## Description\n');
    parts.push(bodyToMarkdown(bodyEl));
    parts.push('');
  }

  appendDiscussionComments(parts, bodyEl);
  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractWiki(metadata: Record<string, string>): string {
  metadata.type = 'Wiki';
  const title = document.querySelector('#wiki-wrapper h1, .gh-header-title, h1')?.textContent?.trim() || Utils.getPageTitle();
  metadata.title = title;
  const updatedEl = document.querySelector('#wiki-wrapper .gh-header-meta relative-time, relative-time');
  const updated = updatedEl?.getAttribute('datetime') || updatedEl?.textContent?.trim() || '';
  if (updated) metadata.updated = updated;

  const parts: string[] = [`# ${title}\n`];
  if (updated) parts.push(`**Updated:** ${updated}\n`);

  const wikiBody = document.querySelector('#wiki-body .markdown-body, #wiki-content .markdown-body, .markdown-body');
  if (wikiBody) {
    parts.push(bodyToMarkdown(wikiBody, [...Utils.NOISE_SELECTORS, '.anchor', '.octicon']));
  } else {
    parts.push('*Could not extract wiki content.*');
  }
  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractReleases(metadata: Record<string, string>): string {
  metadata.type = 'Release';
  const identity = getRepositoryIdentity(null);
  const repository = identity ? `${identity.owner}/${identity.repo}` : '';
  if (repository) metadata.repository = repository;

  const releaseNodes = Array.from(document.querySelectorAll(
    'section[aria-labelledby], [data-hpc] .Box, .release-entry, .release',
  )).filter((el) => Boolean(el.querySelector('.markdown-body, h1, h2, a[href*="/releases/tag/"]')));

  const pageHeading = document.querySelector('h1.d-inline, [data-testid="release-title"], main h1')?.textContent?.trim()
    || (repository ? `${repository} Releases` : Utils.getPageTitle());
  metadata.title = pageHeading;

  const parts: string[] = [`# ${pageHeading}\n`];
  if (repository) parts.push(`**Repository:** ${repository}\n`);

  if (releaseNodes.length > 0) {
    const seen = new Set<string>();
    for (const node of releaseNodes) {
      const heading = node.querySelector('h1, h2, a[href*="/releases/tag/"]')?.textContent?.trim() || '';
      const tag = node.querySelector('a[href*="/tree/"], a[href*="/releases/tag/"]')?.textContent?.trim() || '';
      const key = `${heading}|${tag}`;
      if (!heading || seen.has(key)) continue;
      seen.add(key);

      const date = node.querySelector('relative-time')?.getAttribute('datetime') || '';
      const releaseAuthor = discussionAuthor(node);
      parts.push(`## ${heading}\n`);
      const metaLine: string[] = [];
      if (tag && tag !== heading) metaLine.push(`**Tag:** \`${tag}\``);
      if (releaseAuthor) metaLine.push(`**Author:** @${releaseAuthor}`);
      if (date) metaLine.push(`**Published:** ${date}`);
      if (metaLine.length > 0) parts.push(`${metaLine.join(' · ')}\n`);

      const body = node.querySelector('.markdown-body');
      if (body) {
        parts.push(bodyToMarkdown(body, ['.anchor', '.octicon']));
        parts.push('');
      }
    }
  } else {
    const main = document.querySelector('main, [role="main"]');
    if (main) {
      parts.push(Markdown.elementToMarkdown(Utils.removeNoise(main, [...Utils.NOISE_SELECTORS, '.anchor', '.octicon'])));
    }
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractActionRun(metadata: Record<string, string>): string {
  metadata.type = 'Workflow Run';
  const title = document.querySelector('.js-issue-title, h1, [data-testid="workflow-run-title"]')?.textContent?.trim()
    || Utils.getPageTitle();
  metadata.title = title;
  const parts: string[] = [`# ${title}\n`];

  const status = document.querySelector('.State, [data-testid="workflow-run-status"]')?.textContent?.trim() || '';
  if (status) {
    metadata.status = status;
    parts.push(`**Status:** ${status}\n`);
  }

  const jobs = Array.from(document.querySelectorAll('.ActionListItem-label, [data-testid="job-item"], .checks-list-item'));
  if (jobs.length > 0) {
    parts.push('## Jobs\n');
    for (const job of jobs) {
      const label = job.textContent?.replace(/\s+/g, ' ').trim();
      if (label) parts.push(`- ${label}`);
    }
    parts.push('');
  }

  const summary = document.querySelector('.workflow-summary .markdown-body, .js-checks-summary .markdown-body, article.markdown-body');
  if (summary) {
    parts.push('## Summary\n');
    parts.push(bodyToMarkdown(summary, ['.anchor', '.octicon']));
    parts.push('');
  }

  const logLines = Array.from(document.querySelectorAll('.CheckStep-line-content, .js-checks-log-display-container .d-flex'))
    .map((el) => el.textContent || '')
    .filter((line) => line.length > 0);
  if (logLines.length > 0) {
    parts.push('## Logs\n');
    parts.push(fenceContent(logLines.join('\n'), 'text'));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractCompare(metadata: Record<string, string>): string {
  metadata.type = 'Compare';
  const title = document.querySelector('.Subhead-heading, h1')?.textContent?.trim() || Utils.getPageTitle();
  metadata.title = title;
  const parts: string[] = [`# ${title}\n`];

  appendRenderedCommitsList(parts);
  const domDiff = extractDomDiffs();
  if (domDiff.files.length > 0) {
    parts.push('## Files Changed\n');
    for (const file of domDiff.files) {
      parts.push(`### ${file.path}\n`);
      parts.push(fencePatch(file.diff));
      parts.push('');
    }
  } else if (parts.length === 1) {
    const main = document.querySelector('main, [role="main"]');
    if (main) parts.push(Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS)));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractCommitsList(metadata: Record<string, string>): string {
  metadata.type = 'Commits';
  const identity = getRepositoryIdentity(null);
  const repository = identity ? `${identity.owner}/${identity.repo}` : '';
  const title = repository ? `${repository} Commits` : Utils.getPageTitle();
  metadata.title = title;
  if (repository) metadata.repository = repository;

  const parts: string[] = [`# ${title}\n`];
  appendRenderedCommitsList(parts);
  if (parts.length === 1) {
    const main = document.querySelector('main, [role="main"]');
    if (main) parts.push(Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS)));
  }
  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractPRCommits(metadata: Record<string, string>): string {
  metadata.type = 'Pull Request Commits';
  const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim() || Utils.getPageTitle();
  const number = `#${window.location.pathname.split('/')[4] || ''}`;
  metadata.title = title;
  const parts: string[] = [`# Pull Request ${number} Commits: ${title}\n`];
  appendRenderedCommitsList(parts);
  if (parts.length === 1) {
    const main = document.querySelector('main, [role="main"]');
    if (main) parts.push(Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS)));
  }
  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractPRChecks(metadata: Record<string, string>): string {
  metadata.type = 'Pull Request Checks';
  const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim() || Utils.getPageTitle();
  const number = `#${window.location.pathname.split('/')[4] || ''}`;
  metadata.title = title;
  const parts: string[] = [`# Pull Request ${number} Checks: ${title}\n`];

  const checks = Array.from(document.querySelectorAll('.checks-list-item, .ActionListItem-label, [data-testid="check-run-item"]'));
  if (checks.length > 0) {
    parts.push('## Checks\n');
    for (const check of checks) {
      const text = check.textContent?.replace(/\s+/g, ' ').trim();
      if (text) parts.push(`- ${text}`);
    }
    parts.push('');
  }

  const logLines = Array.from(document.querySelectorAll('.CheckStep-line-content'))
    .map((el) => el.textContent || '')
    .filter((line) => line.length > 0);
  if (logLines.length > 0) {
    parts.push('## Logs\n');
    parts.push(fenceContent(logLines.join('\n'), 'text'));
  } else if (parts.length === 1) {
    const main = document.querySelector('main, [role="main"]');
    if (main) parts.push(Markdown.elementToMarkdown(Utils.removeNoise(main, Utils.NOISE_SELECTORS)));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function appendRenderedCommitsList(parts: string[]): void {
  const candidates = Array.from(document.querySelectorAll(
    '[data-testid="commit-row-item"], li.js-commits-list-item, .TimelineItem--condensed .js-details-container',
  ));
  const rows = candidates.filter((row) => !candidates.some((other) => other !== row && other.contains(row)));
  if (rows.length === 0) return;

  const commits: Array<{ sha: string; message: string; author: string; date: string }> = [];
  for (const row of rows) {
    // A title is split into several links when it mentions an issue or a pull request.
    const titleEl = row.querySelector(
      '[data-listview-item-title-container] :is(h2, h3, h4), [data-testid="list-view-item-title-container"] :is(h2, h3, h4), p',
    );
    const msgEl = titleEl ? Utils.removeNoise(titleEl, ['button', '[aria-hidden="true"]'])
      : row.querySelector('[data-testid="list-view-item-title-container"] a, a.markdown-title, .js-navigation-open');
    const message = msgEl?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const commitLink = row.getAttribute('data-commit-link')
      || row.querySelector('a[href*="/commit/"], a[href*="/commits/"]')?.getAttribute('href')
      || '';
    const shaEl = row.querySelector('a[href*="/commit/"] code, [data-testid="commit-row-browse-repo"], a.text-mono, code');
    const sha = commitLink.match(/\/commits?\/([0-9a-f]{7,64})/i)?.[1]?.slice(0, 7)
      || shaEl?.textContent?.trim().match(/[0-9a-f]{7,64}/i)?.[0]
      || '';
    const author = discussionAuthor(row);
    const date = row.querySelector('relative-time')?.getAttribute('datetime') || '';
    if (message || sha) commits.push({ sha, message, author, date });
  }
  if (commits.length === 0) return;

  parts.push('## Commits\n');
  parts.push('| SHA | Message | Author | Date |', '| --- | --- | --- | --- |');
  for (const commit of commits) {
    parts.push(`| ${commit.sha ? `\`${commit.sha}\`` : ''} | ${escapeTableCell(commit.message)} | ${escapeTableCell(commit.author)} | ${escapeTableCell(commit.date)} |`);
  }
  parts.push('');
}

function extractIssueOrPR(metadata: Record<string, string>, isPR: boolean): string {
  const type = isPR ? 'Pull Request' : 'Issue';
  metadata.type = type;

  const title = document.querySelector(TITLE_SELECTOR)?.textContent?.trim() || Utils.getPageTitle();
  metadata.title = title;

  const number = `#${window.location.pathname.split('/')[4]}`;
  const bodyEl = document.querySelector('[data-testid="issue-body-viewer"]')
    || Array.from(document.querySelectorAll('.comment-body, .js-comment-body, .markdown-body'))
      .find((element) => !element.closest('.react-issue-comment'))
    || null;
  const bodyContainer = bodyEl?.closest('[data-testid="issue-body"], .timeline-comment, .js-timeline-item');

  // State (open/closed/merged)
  const stateEl = document.querySelector('[data-testid="header-state"], [data-component="StateLabel"], .State, [title="Status: Open"], [title="Status: Closed"], [title="Status: Merged"]');
  const state = stateEl?.textContent?.trim() || '';
  if (state) metadata.state = state;

  // Author and date
  const author = discussionAuthor(document.querySelector('.gh-header-meta') || bodyContainer);
  if (author) metadata.author = author;

  const timeEl = (document.querySelector('.gh-header-meta') || bodyContainer)?.querySelector('relative-time');
  const date = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
  if (date) metadata.created = date;

  // Labels
  const labelEls = document.querySelectorAll('.js-issue-labels .IssueLabel, .sidebar-labels .IssueLabel, [data-testid="issue-labels"] a');
  const labels = Array.from(labelEls).map((el) => el.textContent?.trim()).filter(Boolean);
  if (labels.length > 0) metadata.labels = labels.join(', ');

  const parts: string[] = [`# ${type} ${number}: ${title}\n`];
  if (state) parts.push(`**Status:** ${state}`);
  if (author) parts.push(`**Author:** @${author}`);
  if (date) parts.push(`**Created:** ${date}`);
  if (labels.length > 0) parts.push(`**Labels:** ${labels.join(', ')}`);
  parts.push('');

  // Body
  if (bodyEl) {
    parts.push('## Description\n');
    parts.push(bodyToMarkdown(bodyEl));
    parts.push('');
  }

  // Comments
  appendDiscussionComments(parts, bodyEl);

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function appendDiscussionComments(parts: string[], bodyEl: Element | null): void {
  const candidates = Array.from(document.querySelectorAll(
    '.react-issue-comment [data-testid="markdown-body"], .timeline-comment .comment-body, .js-timeline-item .comment-body',
  ));
  const comments = candidates.filter((comment) => comment !== bodyEl
    && !bodyEl?.contains(comment)
    && !comment.contains(bodyEl)
    && !candidates.some((other) => other !== comment && other.contains(comment))
    && !isLoadedAnswerPreview(comment))
    .map((element) => ({ element, markdown: bodyToMarkdown(element) }))
    .filter(({ markdown }) => markdown.trim());
  if (comments.length > 0) {
    parts.push('## Comments\n');
    comments.forEach(({ element: comment, markdown }) => {
      // One timeline item can hold a whole review thread, so prefer the single comment.
      const container = answerPreview(comment)
        || comment.closest('.react-issue-comment, .timeline-comment-group, .review-comment, .timeline-comment')
        || comment.closest('.js-timeline-item');
      const commentAuthor = discussionAuthor(container);
      const time = container?.querySelector('relative-time');
      const commentTime = time?.getAttribute('datetime') || time?.textContent?.trim() || '';

      parts.push(`### ${commentAuthor}${commentTime ? ` (${commentTime})` : ''}\n`);
      parts.push(markdown);
      parts.push('');
    });
  }
}

/** A discussion question shows a preview of its answer, which is usually also in the thread. */
function answerPreview(comment: Element): Element | null {
  const preview = comment.closest('.color-bg-success');
  return preview?.querySelector('.js-discussions-goto-answer-button') ? preview : null;
}

function isLoadedAnswerPreview(comment: Element): boolean {
  const href = answerPreview(comment)?.querySelector('.js-discussions-goto-answer-button')?.getAttribute('href') || '';
  return href.startsWith('#') && Boolean(document.getElementById(href.slice(1)));
}

/** Keep code languages, suggested changes, and embedded code lines, which GitHub stores outside the code element. */
function bodyToMarkdown(element: Element, noise: string[] = []): string {
  const clone = Utils.removeNoise(element, noise);
  restoreMathSource(clone);
  for (const wrapper of clone.querySelectorAll('.highlight[class*="highlight-"]')) {
    const pre = wrapper.querySelector('pre');
    const language = wrapper.className.match(/\bhighlight-(?:source|text)-([\w+#.-]+)/)?.[1]
      .replace(/^html-basic$/, 'html');
    if (pre && language && !pre.querySelector('code')) pre.classList.add(`language-${language}`);
  }
  for (const table of clone.querySelectorAll('table')) {
    const cells = Array.from(table.querySelectorAll('td.blob-code-inner, td.blob-code'))
      .filter((cell) => cell.closest('table') === table);
    if (cells.length === 0) continue;
    const isDiff = cells.some((cell) => diffMarker(cell) !== ' ');
    const pre = table.ownerDocument.createElement('pre');
    if (isDiff) pre.className = 'language-diff';
    pre.textContent = cells.map((cell) => {
      const text = codeCellText(cell);
      return isDiff ? `${diffMarker(cell)}${text}` : text;
    }).join('\n');
    table.replaceWith(pre);
  }
  return Markdown.elementToMarkdown(clone);
}

/** GitHub renders an empty source line as a cell that holds only a line break. */
function codeCellText(cell: Element): string {
  return (cell.textContent || '').replace(/\r?\n$/, '');
}

function discussionAuthor(container: ParentNode | null | undefined): string {
  const author = container?.querySelector([
    '.author',
    '[data-testid="issue-body-header-author"]',
    '[data-testid="avatar-link"]',
    '.commit-author',
    'a[data-hovercard-type="user"]:not(.user-mention)',
  ].join(', '))
    || Array.from(container?.querySelectorAll('a.Link--secondary') || [])
      .find((link) => !link.querySelector('relative-time'));
  const text = author?.textContent?.trim() || '';
  if (/\[bot\]$/i.test(text)) return text;
  const href = decodePathname(author?.getAttribute('href') || '');
  const botApp = href.match(/^(?:https?:\/\/[^/]+)?\/apps\/([\w.-]+)\/?$/i)?.[1];
  if (botApp) return `${botApp}[bot]`;
  return href.match(/^(?:https?:\/\/[^/]+)?\/([\w.-]+(?:\[bot\])?)\/?$/i)?.[1]
    || text;
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
  const descEl = document.querySelector('.f4.my-3, [itemprop="about"], .BorderGrid-cell p.f4, [class*="sidebarSection"] > p[class*="description"]');
  const desc = descEl?.textContent?.trim();
  if (desc) {
    parts.push(`> ${desc}\n`);
    metadata.description = desc;
  }

  // Topics
  const topicEls = document.querySelectorAll('.topic-tag, a[class*="TopicTag"]');
  const topics = [...new Set(Array.from(topicEls).map((el) => el.textContent?.trim()).filter(Boolean))];
  if (topics.length > 0) parts.push(`**Topics:** ${topics.join(', ')}\n`);

  // Languages
  const langEls = document.querySelectorAll('.BorderGrid-cell [aria-label] .color-fg-default, .repository-lang-stats-graph + ol li a span, [class*="languageListItem"] [class*="languageName"]');
  const langs = [...new Set(Array.from(langEls).map((el) => el.textContent?.trim()).filter(Boolean))];
  if (langs.length > 0) parts.push(`**Languages:** ${langs.join(', ')}\n`);

  const items = await resolveDirectoryItems(identity, treeRoute, '');
  appendDirectoryListing(parts, metadata, items, identity, treeRoute?.refInfo?.name, '/');

  // README
  const readmeEl = document.querySelector('#readme .markdown-body, article.markdown-body');
  if (readmeEl) {
    parts.push('## README\n');
    parts.push(bodyToMarkdown(readmeEl, ['.anchor', '.octicon']));
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
  const location = directory === '/' ? repository : `${repository}/${directory}`;
  metadata.title = location;
  metadata.type = 'Directory';
  metadata.repository = repository;
  metadata.path = directory;
  addRepositoryMetadata(metadata, payload, treeRoute);

  const parts = [`# ${location}`, ''];
  const items = await resolveDirectoryItems(identity, treeRoute, directory === '/' ? '' : directory);
  appendDirectoryListing(parts, metadata, items, identity, treeRoute.refInfo?.name, directory);

  const readmeEl = document.querySelector('#readme .markdown-body, article.markdown-body');
  if (readmeEl) {
    parts.push('', '## README', '', bodyToMarkdown(readmeEl, ['.anchor', '.octicon']));
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
  let fetchedFullContent = false;
  let partialContent = false;
  if (!Array.isArray(rawLines) || blob?.truncated || (expectedLines > 0 && rawLines.length < expectedLines)) {
    const fetched = await fetchFirstRawFile(candidates, blob?.rawBlobUrl);
    if (fetched) {
      content = fetched.content;
      source = fetched.source;
      path = fetched.candidate.path;
      ref = fetched.candidate.ref;
      fileName = path.split('/').pop() || fileName;
      fetchedFullContent = true;
    } else {
      partialContent = true;
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
  metadata.lines = String(countLines(content, fetchedFullContent ? undefined : rawLines));
  metadata.bytes = String(new TextEncoder().encode(content).length);
  metadata.content_source = source;
  if (blob?.rawBlobUrl || blob?.displayUrl) metadata.raw_url = blob.rawBlobUrl || blob.displayUrl || '';
  else if (location) metadata.raw_url = githubRawUrl(location);

  const heading = `# ${repository}/${path || fileName}`;
  if (content.includes('\0')) {
    const rawUrl = typeof metadata.raw_url === 'string' && metadata.raw_url
      ? `\n\n**Raw file:** ${new URL(metadata.raw_url, window.location.origin).href}` : '';
    return Markdown.buildPageMarkdown(metadata, `${heading}\n\n*Binary file. Content not copied.*${rawUrl}`);
  }

  const context = Markdown.buildPageMarkdown(
    metadata,
    partialContent
      ? `${heading}\n\n**Partial file content from ${source}.** *The full file could not be fetched.*`
      : `${heading}\n\n**Full file content from ${source}.**`,
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
    parts.push(`${fenceContent(codeEl.textContent?.trim() || '', languageFence(fileName))}\n`);
  }

  // README on tree pages
  const readmeEl = document.querySelector('#readme .markdown-body');
  if (readmeEl) {
    parts.push('## README\n');
    parts.push(bodyToMarkdown(readmeEl, ['.anchor', '.octicon']));
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
  const pathname = decodePathname(window.location.pathname).replace(/\/+$/, '').toLowerCase();
  const repo = payload.codeViewLayoutRoute?.repo;
  if (!repo?.ownerLogin || !repo.name) return false;

  const prefix = `/${repo.ownerLogin}/${repo.name}`.toLowerCase();
  if (pathname === prefix) return Boolean(payload.codeViewRepoRoute);

  const blobRoute = payload.codeViewBlobLayoutRoute;
  const blobRef = blobRoute?.refInfo?.name;
  if (blobRoute?.path && blobRef) {
    if (pathname === `${prefix}/blob/${blobRef}/${blobRoute.path}`.toLowerCase()) return true;
  }

  const treeRoute = payload.codeViewTreeRoute;
  const treeRef = treeRoute?.refInfo?.name;
  if (treeRoute && treeRef) {
    const treePath = (treeRoute.path || '').replace(/^\/+|\/+$/g, '');
    const expected = treePath
      ? `${prefix}/tree/${treeRef}/${treePath}`.toLowerCase()
      : `${prefix}/tree/${treeRef}`.toLowerCase();
    if (pathname === expected) return true;
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
    const response = await Utils.fetchWithTimeout(apiUrl, {
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
    const response = await Utils.fetchWithTimeout(githubContentsApiUrl(identity, path, ref), {
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
  embeddedRawUrl?: string,
): Promise<{ candidate: GitHubBlobCandidate; content: string; source: string } | null> {
  if (embeddedRawUrl && candidates[0]) {
    const content = await fetchRawUrl(new URL(embeddedRawUrl, window.location.origin).href);
    if (content !== null) {
      return { candidate: candidates[0], content, source: 'GitHub authenticated raw file' };
    }
  }
  for (const candidate of candidates) {
    const content = await fetchRawUrl(githubRawUrl(candidate));
    if (content !== null) return { candidate, content, source: 'GitHub authenticated raw file' };
    if (!/^[0-9a-f]{7,64}$/i.test(candidate.ref)) {
      const directContent = await fetchRawUrl(githubDirectRawUrl(candidate));
      if (directContent !== null) return { candidate, content: directContent, source: 'GitHub authenticated raw file' };
    }
  }
  for (const candidate of candidates) {
    const content = await fetchRawFile(candidate.identity, candidate.path, candidate.ref);
    if (content !== null) return { candidate, content, source: 'GitHub raw content API' };
  }
  return null;
}

async function fetchRawUrl(url: string): Promise<string | null> {
  try {
    const response = await Utils.fetchWithTimeout(url, {
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
  const refPrefix = /^[0-9a-f]{7,64}$/i.test(candidate.ref) ? `/raw/${ref}` : `/raw/refs/heads/${ref}`;
  return `${window.location.origin}/${encodeURIComponent(candidate.identity.owner)}/${encodeURIComponent(candidate.identity.repo)}${refPrefix}/${path}`;
}

function githubDirectRawUrl(candidate: GitHubBlobCandidate): string {
  const ref = candidate.ref.split('/').map(encodeURIComponent).join('/');
  const path = candidate.path.split('/').map(encodeURIComponent).join('/');
  return `${window.location.origin}/${encodeURIComponent(candidate.identity.owner)}/${encodeURIComponent(candidate.identity.repo)}/raw/${ref}/${path}`;
}

function githubContentsApiUrl(
  identity: { owner: string; repo: string },
  path: string,
  ref?: string,
): string {
  const encodedPath = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const suffix = encodedPath ? `/contents/${encodedPath}` : '/contents';
  const url = new URL(
    `repos/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}${suffix}`,
    `${getGitHubApiBase().replace(/\/$/, '')}/`,
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
  return `${window.location.origin}/${encodeURIComponent(identity.owner)}/${encodeURIComponent(identity.repo)}/${kind}/${encodeURIComponent(ref)}/${encodedPath}`;
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
  const runs = [...content.matchAll(/`+/g)].map((match) => match[0].length);
  const longestRun = Math.max(0, Utils.safeMax(runs));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${language}\n${content}${content.endsWith('\n') ? '' : '\n'}${fence}`;
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : 'File';
}
