/**
 * LinkedIn extractor.
 * Covers posts and profile pages.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'LinkedIn',
  matches: [
    '*://www.linkedin.com/posts/*',
    '*://www.linkedin.com/feed/update/*',
    '*://www.linkedin.com/pulse/*',
    '*://www.linkedin.com/in/*',
    '*://linkedin.com/posts/*',
    '*://linkedin.com/feed/update/*',
    '*://linkedin.com/in/*',
  ],
  anchor: {
    selector: [
      '.feed-shared-control-menu',                // post action menu
      '.feed-shared-social-action-bar',            // post action bar
      '.social-details-social-activity',           // post social activity bar
      '.pv-top-card__actions',                     // profile actions
      '.pvs-header__actions',                      // profile section header
    ].join(', '),
    position: 'append',
    style: 'icon',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const isProfile = /\/in\//.test(url);
    const isArticle = /\/pulse\//.test(url);

    if (isProfile) return extractProfile(url);
    if (isArticle) return extractArticle(url);
    return extractPost(url);
  },
});

function extractProfile(url: string): string {
  const nameEl = document.querySelector('.text-heading-xlarge, .pv-top-card .text-heading-xlarge, h1');
  const name = nameEl?.textContent?.trim() || Utils.getPageTitle();

  const headlineEl = document.querySelector('.text-body-medium, .pv-top-card .text-body-medium');
  const headline = headlineEl?.textContent?.trim() || '';

  const locationEl = document.querySelector('.text-body-small .t-black--light, .pv-top-card .text-body-small');
  const location = locationEl?.textContent?.trim() || '';

  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Profile',
    name,
    url,
  };
  if (headline) metadata.headline = headline;
  if (location) metadata.location = location;

  const parts: string[] = [`# ${name}\n`];
  if (headline) parts.push(`**${headline}**`);
  if (location) parts.push(`📍 ${location}`);
  parts.push('');

  // About section
  const aboutEl = document.querySelector('#about ~ .display-flex .pv-shared-text-with-see-more span[aria-hidden], .pv-about__summary-text, section.pv-about-section .pv-about__summary-text');
  if (aboutEl) {
    parts.push('## About\n');
    parts.push(aboutEl.textContent?.trim() || '');
    parts.push('');
  }

  // Experience
  const expSection = document.querySelector('#experience');
  if (expSection) {
    parts.push('## Experience\n');
    const expItems = expSection.closest('section')?.querySelectorAll('.pvs-list__paged-list-item, li.pv-entity__position-group-pager') || [];
    expItems.forEach((item) => {
      const role = item.querySelector('.t-bold span[aria-hidden], .pv-entity__summary-info h3')?.textContent?.trim() || '';
      const company = item.querySelector('.t-normal span[aria-hidden], .pv-entity__secondary-title')?.textContent?.trim() || '';
      const period = item.querySelector('.t-black--light span[aria-hidden], .pv-entity__date-range span:nth-child(2)')?.textContent?.trim() || '';
      if (role) {
        parts.push(`### ${role}`);
        if (company) parts.push(`**${company}**`);
        if (period) parts.push(`*${period}*`);
        parts.push('');
      }
    });
  }

  // Education
  const eduSection = document.querySelector('#education');
  if (eduSection) {
    parts.push('## Education\n');
    const eduItems = eduSection.closest('section')?.querySelectorAll('.pvs-list__paged-list-item, li.pv-education-entity') || [];
    eduItems.forEach((item) => {
      const school = item.querySelector('.t-bold span[aria-hidden], .pv-entity__school-name')?.textContent?.trim() || '';
      const degree = item.querySelector('.t-normal span[aria-hidden], .pv-entity__degree-name .pv-entity__comma-item')?.textContent?.trim() || '';
      if (school) {
        parts.push(`- **${school}**${degree ? ` — ${degree}` : ''}`);
      }
    });
    parts.push('');
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractPost(url: string): string {
  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Post',
    url,
  };

  // Author
  const authorEl = document.querySelector('.update-components-actor__title .visually-hidden, .feed-shared-actor__name, .update-components-actor__name .hoverable-link-text');
  const author = authorEl?.textContent?.trim() || '';
  if (author) metadata.author = author;

  const parts: string[] = [];
  if (author) parts.push(`# Post by ${author}\n`);

  // Post text
  const textEl = document.querySelector('.feed-shared-update-v2__description .break-words, .feed-shared-text__text-view, .update-components-text');
  if (textEl) {
    parts.push(textEl.textContent?.trim() || '');
    parts.push('');
  }

  // Reactions
  const reactionsEl = document.querySelector('.social-details-social-counts__reactions-count, .social-details-social-counts__count-value');
  const reactions = reactionsEl?.textContent?.trim() || '';
  if (reactions) parts.push(`**Reactions:** ${reactions}`);

  // Comments
  const commentEls = document.querySelectorAll('.comments-comment-item, .feed-shared-update-v2__comments-container .comments-comment-item');
  if (commentEls.length > 0) {
    parts.push(`\n## Comments (${commentEls.length})\n`);
    commentEls.forEach((comment) => {
      const commentAuthor = comment.querySelector('.comments-post-meta__name-text, .comments-comment-item__inline-show-more-text')?.textContent?.trim() || '';
      const commentText = comment.querySelector('.comments-comment-item__main-content, .comments-comment-texteditor .feed-shared-text')?.textContent?.trim() || '';
      if (commentText) {
        parts.push(`**${commentAuthor}:**`);
        parts.push(`> ${commentText}\n`);
      }
    });
  }

  return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
}

function extractArticle(url: string): string {
  const titleEl = document.querySelector('h1, .article-title');
  const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

  const metadata: Record<string, string> = {
    source: 'LinkedIn',
    type: 'Article',
    title,
    url,
  };

  const authorEl = document.querySelector('.author-info__name, .article-author');
  if (authorEl) metadata.author = authorEl.textContent?.trim() || '';

  const articleBody = document.querySelector('.article-content, .reader-article-content, article');
  const body = articleBody
    ? Markdown.elementToMarkdown(Utils.removeNoise(articleBody, Utils.NOISE_SELECTORS))
    : '*No article content found.*';

  return Markdown.buildPageMarkdown(metadata, `# ${title}\n\n${body}`);
}
