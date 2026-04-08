/**
 * GitHub extractor.
 * Covers: issues, pull requests, repo pages, and README files.
 * Anchor: icon button in the repo header action bar.
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

    const metadata: Record<string, string> = {
      source: 'GitHub',
      url,
    };

    if (isIssue || isPR) {
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

function extractRepo(metadata: Record<string, string>): string {
  const repoName = document.querySelector('[itemprop="name"] a, .AppHeader-context-item-label')?.textContent?.trim()
    || window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  metadata.title = repoName;
  metadata.type = 'Repository';

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

  parts.push('');

  // README
  const readmeEl = document.querySelector('#readme .markdown-body, article.markdown-body');
  if (readmeEl) {
    parts.push('## README\n');
    const cleaned = Utils.removeNoise(readmeEl, ['.anchor', '.octicon']);
    parts.push(Markdown.elementToMarkdown(cleaned));
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractCodePage(metadata: Record<string, string>): string {
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
