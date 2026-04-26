/**
 * Substack extractor.
 * Extracts newsletter posts with title, author, publication, date, likes, and full body.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Substack',
  matches: [
    '*://*.substack.com/p/*',
    '*://*.substack.com/publish/post/*',
  ],
  // Also match custom domains using Substack (detected by meta tag)
  regex: /substack\.com\/p\//,

  async extract() {
    const url = Utils.getCanonicalUrl();

    const titleEl = document.querySelector('.post-title, h1.post-title, article h1');
    const title = titleEl?.textContent?.trim() || Utils.getPageTitle();

    const subtitleEl = document.querySelector('.subtitle, h3.subtitle');
    const subtitle = subtitleEl?.textContent?.trim() || '';

    const authorEl = document.querySelector('.author-name, .post-meta .byline a, a.frontend-pencraft-Text-module__decoration-hover-underline--BEYAn');
    const author = authorEl?.textContent?.trim() || '';

    const publicationEl = document.querySelector('.publication-name, .navbar-title-link');
    const publication = publicationEl?.textContent?.trim() || '';

    const dateEl = document.querySelector('.post-date time, .pencraft time, time[datetime]');
    const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime')?.split('T')[0] || '';

    const likesEl = document.querySelector('.like-count, .post-ufi-button .label');
    const likes = likesEl?.textContent?.trim() || '';

    const commentsCountEl = document.querySelector('.post-ufi-comment-button .label');
    const commentsCount = commentsCountEl?.textContent?.trim() || '';

    const metadata: Record<string, string> = {
      source: 'Substack',
      title,
      url,
    };
    if (author) metadata.author = author;
    if (publication) metadata.publication = publication;
    if (date) metadata.date = date;

    const parts: string[] = [`# ${title}\n`];
    if (subtitle && subtitle !== title) parts.push(`*${subtitle}*\n`);

    const meta: string[] = [];
    if (author) meta.push(`**Author:** ${author}`);
    if (publication) meta.push(`**Publication:** ${publication}`);
    if (date) meta.push(`**Date:** ${date}`);
    if (likes) meta.push(`**Likes:** ${likes}`);
    if (commentsCount) meta.push(`**Comments:** ${commentsCount}`);
    if (meta.length) parts.push(meta.join(' · ') + '\n');

    // Article body
    const bodyEl = document.querySelector('.body.markup, .post-content, .available-content, article .body');
    if (bodyEl) {
      const clone = bodyEl.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.captioned-button-wrap, .subscription-widget, .paywall').forEach(el => el.remove());
      parts.push(Markdown.elementToMarkdown(clone));
    }

    // Paywall detection
    const paywall = document.querySelector('.paywall, .paywall-title, [class*="paywall"]');
    if (paywall) {
      parts.push('\n---\n*⚠️ The rest of this article is behind a paywall.*\n');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
