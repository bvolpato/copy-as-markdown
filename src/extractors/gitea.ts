/**
 * Codeberg, Gitea, and Forgejo extractor.
 * Matches codeberg.org by URL and any self-hosted Gitea/Forgejo instance via detect().
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitMarkdown } from '../core/context';
import type { PageMetadata } from '../core/types';

function isGiteaOrForgejo(contextDocument: Document = document): boolean {
  const generator = contextDocument.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
  if (/gitea|forgejo/i.test(generator)) return true;
  const appName = contextDocument.querySelector('meta[name="application-name"]')?.getAttribute('content') || '';
  if (/gitea|forgejo|codeberg/i.test(appName)) return true;
  return Boolean(contextDocument.querySelector('#repo-files-table, .repository.file.list, .repository.view.issue'));
}

export const giteaExtractor = register({
  name: 'Codeberg / Gitea',
  matches: [
    '*://codeberg.org/*/*',
  ],
  pathnameRegex: /^\/(?!explore|user|org|admin|api|assets|notifications|milestones|issues|pulls)[^/]+\/[^/]+/i,
  detect: isGiteaOrForgejo,
  buttonPlacement: 'anchor',
  anchor: {
    selector: '.repo-header .repo-buttons, .issue-title-header, .repo-title',
    position: 'after',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const path = window.location.pathname;
    const isIssueOrPr = /\/(?:issues|pulls)\/\d+/.test(path);
    const isBlob = /\/src\/(?:branch|tag|commit)\//.test(path) && Boolean(document.querySelector('.file-view .lines-code, .code-view, .file-content'));

    const repoTitle = Markdown.normalizeWhitespace(
      document.querySelector('.repo-title, h1 .title, h1')?.textContent || Utils.getPageTitle(),
    );

    const metadata: PageMetadata = {
      source: window.location.hostname === 'codeberg.org' ? 'Codeberg' : 'Gitea / Forgejo',
      title: repoTitle,
      url: Utils.getCanonicalUrl(),
    };

    const parts: string[] = [];

    if (isIssueOrPr) {
      const issueTitle = Markdown.normalizeWhitespace(
        document.querySelector('#issue-title-display, .issue-title .index, h1')?.textContent || repoTitle,
      );
      metadata.title = issueTitle;
      parts.push(`# ${issueTitle}`);

      const state = Markdown.normalizeWhitespace(document.querySelector('.issue-state-label')?.textContent || '');
      if (state) parts.push(`**State:** ${state}`);

      const comments = Array.from(document.querySelectorAll('.timeline-item.comment, .comment-container'));
      let count = 0;
      for (const comment of comments) {
        const bodyEl = comment.querySelector('.render-content.markup, .markdown');
        if (!bodyEl) continue;
        const author = Markdown.normalizeWhitespace(comment.querySelector('.comment-header-left a.author, .author')?.textContent || '') || 'Unknown';
        const timeEl = comment.querySelector('relative-time, time[datetime]');
        const timestamp = timeEl?.getAttribute('datetime') || Markdown.normalizeWhitespace(timeEl?.textContent || '');
        const body = Markdown.elementToMarkdown(Utils.removeNoise(bodyEl, [...Utils.NOISE_SELECTORS, 'button', '.code-copy']));
        if (!body) continue;
        count += 1;
        parts.push(`\n${count === 1 ? '##' : '###'} ${author}${timestamp ? ` (${timestamp})` : ''}\n\n${body}`);
      }
    } else if (isBlob) {
      const fileName = Markdown.normalizeWhitespace(
        document.querySelector('.file-header .file-info, .repo-path')?.textContent || path.split('/').pop() || 'file',
      );
      metadata.title = fileName;
      parts.push(`# ${fileName}`);

      const codeLines = Array.from(document.querySelectorAll('.lines-code .code-inner, .file-view td.lines-code pre'));
      if (codeLines.length > 0) {
        const ext = (path.split('.').pop() || '').toLowerCase();
        const code = codeLines.map((line) => line.textContent || '').join('\n');
        parts.push('\n' + Markdown.fencedCodeToMarkdown(code, ext));
      } else {
        const rendered = document.querySelector('.file-view .markup, .file-content');
        if (rendered) parts.push('\n' + Markdown.elementToMarkdown(rendered));
      }
    } else {
      parts.push(`# ${repoTitle}`);
      const description = Markdown.normalizeWhitespace(document.querySelector('#repo-desc .description, .repo-description')?.textContent || '');
      if (description) parts.push(`\n> ${description}`);

      const fileRows = Array.from(document.querySelectorAll('#repo-files-table tbody tr, .repo-file-list .entry'));
      const fileLines: string[] = [];
      for (const row of fileRows) {
        const link = row.querySelector<HTMLAnchorElement>('td.name a, a.muted');
        if (!link) continue;
        const name = Markdown.normalizeWhitespace(link.textContent || '');
        if (!name || name === '..') continue;
        const href = link.href;
        fileLines.push(href ? `- [${Markdown.escapeMarkdownLinkText(name)}](${href})` : `- ${name}`);
      }
      if (fileLines.length > 0) {
        parts.push('\n## Files\n\n' + fileLines.join('\n'));
      }

      const readme = document.querySelector('#readme .markup, .file-view.markup, .readme .markdown');
      if (readme) {
        const cleaned = Utils.removeNoise(readme, [...Utils.NOISE_SELECTORS, '.anchor', 'button']);
        const readmeMd = Markdown.elementToMarkdown(cleaned);
        if (readmeMd) parts.push('\n## README\n\n' + readmeMd);
      }
    }

    const limited = limitMarkdown(parts.join('\n'));
    addExtractionMetadata(metadata, {
      contentSource: 'rendered Gitea/Forgejo page',
      truncated: limited.truncated,
      complete: !limited.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limited.markdown);
  },
});
