/**
 * Stack Overflow extractor.
 * Extracts question, answers (with vote counts), and comments.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Stack Overflow',
  matches: [
    '*://stackoverflow.com/questions/*',
    '*://superuser.com/questions/*',
    '*://serverfault.com/questions/*',
    '*://askubuntu.com/questions/*',
    '*://*.stackexchange.com/questions/*',
  ],
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

    const titleEl = document.querySelector('#question-header h1 a, #question-header h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const metadata: Record<string, string> = {
      source: 'Stack Overflow',
      title,
      url,
    };

    // Tags
    const tagEls = document.querySelectorAll('.post-taglist .js-post-tag-list-item a, .post-tag');
    const tags = Array.from(tagEls).map((el) => el.textContent?.trim()).filter(Boolean);
    if (tags.length > 0) metadata.tags = tags.join(', ');

    // Vote count
    const voteEl = document.querySelector('.question .js-vote-count, .question [itemprop="upvoteCount"]');
    const votes = voteEl?.textContent?.trim() || '';

    const parts: string[] = [`# ${title}\n`];
    if (tags.length > 0) parts.push(`**Tags:** ${tags.join(', ')}`);
    if (votes) parts.push(`**Votes:** ${votes}`);
    parts.push('');

    // Question body
    const questionBody = document.querySelector('.question .s-prose, .question .post-text, #question .js-post-body');
    if (questionBody) {
      parts.push('## Question\n');
      parts.push(Markdown.elementToMarkdown(questionBody));
      parts.push('');
    }

    // Question comments
    const qComments = document.querySelectorAll('.question .comment-body, #question .comment-copy');
    if (qComments.length > 0) {
      parts.push('### Comments\n');
      qComments.forEach((c) => {
        const text = c.textContent?.trim();
        if (text) parts.push(`> ${text}\n`);
      });
      parts.push('');
    }

    // Answers
    const answers = document.querySelectorAll('.answer, #answers .answer');
    if (answers.length > 0) {
      parts.push(`## Answers (${answers.length})\n`);

      answers.forEach((answer, i) => {
        const answerVotes = answer.querySelector('.js-vote-count, [itemprop="upvoteCount"]')?.textContent?.trim() || '0';
        const isAccepted = answer.classList.contains('accepted-answer') || !!answer.querySelector('.js-accepted-answer-indicator:not(.d-none)');
        const authorEl = answer.querySelector('.user-details a, .post-signature .user-info a');
        const author = authorEl?.textContent?.trim() || 'Anonymous';
        const dateEl = answer.querySelector('.user-action-time .relativetime, .post-signature .relativetime');
        const date = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';

        const prefix = isAccepted ? '✅ ' : '';
        parts.push(`### ${prefix}Answer ${i + 1} (${answerVotes} votes) by ${author}\n`);
        if (date) parts.push(`*${date}*\n`);

        const body = answer.querySelector('.s-prose, .post-text, .js-post-body');
        if (body) {
          parts.push(Markdown.elementToMarkdown(body));
          parts.push('');
        }

        // Answer comments
        const aComments = answer.querySelectorAll('.comment-body, .comment-copy');
        if (aComments.length > 0) {
          parts.push('**Comments:**\n');
          aComments.forEach((c) => {
            const text = c.textContent?.trim();
            if (text) parts.push(`> ${text}\n`);
          });
          parts.push('');
        }
      });
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
