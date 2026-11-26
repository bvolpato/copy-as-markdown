/**
 * Stack Overflow and Stack Exchange extractor.
 * Extracts question, answers (with vote counts), and comments.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import { restoreMathSource } from '../core/math-source';
import * as Utils from '../core/utils';

register({
  name: 'Stack Overflow',
  matches: [
    '*://*.stackoverflow.com/questions/*',
    '*://*.stackoverflow.com/q/*',
    '*://*.superuser.com/questions/*',
    '*://*.superuser.com/q/*',
    '*://*.serverfault.com/questions/*',
    '*://*.serverfault.com/q/*',
    '*://*.askubuntu.com/questions/*',
    '*://*.askubuntu.com/q/*',
    '*://*.stackexchange.com/questions/*',
    '*://*.stackexchange.com/q/*',
    '*://mathoverflow.net/questions/*',
    '*://mathoverflow.net/q/*',
    '*://stackapps.com/questions/*',
    '*://stackapps.com/q/*',
    '*://stackoverflowteams.com/c/*/questions/*',
    '*://stackoverflowteams.com/c/*/q/*',
  ],
  pathnameRegex: /^(?:\/c\/[^/]+)?\/(?:questions|q)\/\d+(?:\/|$)/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#question-header + .d-flex',            // question action bar
      '#question-header',                       // question header
      '.question-header',                       // alt question header
    ].join(', '),
    position: 'append',
    style: 'icon',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim()
      || 'Stack Overflow';

    const titleEl = document.querySelector('#question-header h1 a, #question-header h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const metadata: Record<string, string> = {
      source: siteName,
      title,
      url,
    };

    // Tags scoped to question container so sidebar tags do not leak
    const tagEls = document.querySelectorAll(
      '#question .post-tag, .question .post-tag, .post-taglist .post-tag, .post-taglist .js-post-tag-list-item a',
    );
    const tags = [...new Set(
      Array.from(tagEls).map((el) => el.textContent?.trim()).filter((t): t is string => Boolean(t)),
    )];
    if (tags.length > 0) metadata.tags = tags.join(', ');

    // Vote count
    const voteEl = document.querySelector('.question .js-vote-count, .question [itemprop="upvoteCount"]');
    const votes = voteEl?.textContent?.trim() || '';

    const parts: string[] = [`# ${title}\n`];
    if (tags.length > 0) parts.push(`**Tags:** ${tags.join(', ')}`);
    if (votes) parts.push(`**Votes:** ${votes}`);
    parts.push('');

    // Question body
    const questionEl = document.querySelector('#question, .question');
    const questionBody = document.querySelector('.question .s-prose, .question .post-text, #question .js-post-body');
    if (questionBody) {
      parts.push('## Question\n');
      parts.push(postToMarkdown(questionBody));
      parts.push('');
    }

    // Question comments
    const qComments = extractComments(questionEl);
    if (qComments.length > 0) {
      parts.push('### Comments\n');
      for (const comment of qComments) {
        parts.push(`${quoteMarkdown(comment)}\n`);
      }
      parts.push('');
    }

    // Answers
    const answers = document.querySelectorAll('.answer, #answers .answer');
    if (answers.length > 0) {
      parts.push(`## Answers (${answers.length})\n`);

      answers.forEach((answer, i) => {
        const answerVotes = answer.querySelector('.js-vote-count, [itemprop="upvoteCount"]')?.textContent?.trim() || '0';
        const isAccepted = answer.classList.contains('accepted-answer') || !!answer.querySelector('.js-accepted-answer-indicator:not(.d-none)');
        const { author, date } = extractPostSignature(answer);

        const prefix = isAccepted ? '✅ ' : '';
        parts.push(`### ${prefix}Answer ${i + 1} (${answerVotes} votes) by ${author}\n`);
        if (date) parts.push(`*${date}*\n`);

        const body = answer.querySelector('.s-prose, .post-text, .js-post-body');
        if (body) {
          parts.push(postToMarkdown(body));
          parts.push('');
        }

        // Answer comments
        const aComments = extractComments(answer);
        if (aComments.length > 0) {
          parts.push('**Comments:**\n');
          for (const comment of aComments) {
            parts.push(`${quoteMarkdown(comment)}\n`);
          }
          parts.push('');
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function extractComments(container: ParentNode | null): string[] {
  if (!container) return [];
  const copyEls = container.querySelectorAll('.comment-copy');
  const commentEls = copyEls.length > 0 ? copyEls : container.querySelectorAll('.comment-body');
  const results: string[] = [];
  commentEls.forEach((el) => {
    const md = postToMarkdown(el).trim();
    if (md) results.push(md);
  });
  return results;
}

function postToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  restoreMathSource(clone);
  return Markdown.elementToMarkdown(clone);
}

function quoteMarkdown(markdown: string): string {
  return markdown.split('\n').map((line) => `> ${line}`).join('\n');
}

function extractPostSignature(post: Element): { author: string; date: string } {
  const signatures = Array.from(post.querySelectorAll('.post-signature'));
  const ownerSig = post.querySelector('.post-signature.owner')
    || (signatures.length > 0 ? signatures[signatures.length - 1] : null);
  const scope: ParentNode = ownerSig || post;

  // The avatar link precedes the name link, and community wiki posts start with a revision link.
  const names = [
    ...scope.querySelectorAll('.user-details a[href*="/users/"]'),
    ...scope.querySelectorAll('.user-details a:not([href*="/revisions"], [id^="history-"]), .user-details [itemprop="name"], .user-info a'),
  ].map((el) => (el.getAttribute('content') || el.textContent || '').trim());
  // A deleted user is plain text before the reputation block.
  const deletedName = Array.from(scope.querySelector('.user-details')?.childNodes || [])
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent?.trim())
    .find(Boolean);
  const author = names.find(Boolean) || deletedName || 'Anonymous';
  const dateEl = scope.querySelector('.user-action-time .relativetime, .relativetime');
  const date = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';
  return { author, date };
}
