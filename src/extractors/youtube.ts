/**
 * YouTube extractor.
 * Reserved inline anchor hook: next to the like/dislike/share buttons below the video.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'YouTube',
  matches: [
    '*://www.youtube.com/watch*',
    '*://youtube.com/watch*',
    '*://m.youtube.com/watch*',
  ],
  anchor: {
    selector: [
      '#top-level-buttons-computed',                    // primary action row
      'ytd-menu-renderer.ytd-watch-metadata',           // watch metadata menu
      '#actions-inner',                                  // inner actions container
      '#actions',                                        // outer actions container
      'ytd-watch-metadata #actions',                     // scoped to watch metadata
      '#above-the-fold #top-row',                        // above-the-fold row
    ].join(', '),
    position: 'append',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();

    const title =
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim() ||
      document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim() ||
      Utils.getMeta('title') || Utils.getPageTitle();

    const channelEl =
      (document.querySelector('ytd-channel-name yt-formatted-string a') ||
       document.querySelector('#channel-name a')) as HTMLAnchorElement | null;
    const channel = channelEl?.textContent?.trim() || '';
    const channelUrl = channelEl?.href || '';

    const viewsEl =
      document.querySelector('ytd-watch-info-text .bold')?.textContent?.trim() ||
      document.querySelector('.view-count')?.textContent?.trim() ||
      Utils.getMeta('interactionCount') || '';

    const dateEl =
      document.querySelector('ytd-watch-info-text span:nth-child(3)')?.textContent?.trim() ||
      document.querySelector('.date')?.textContent?.trim() ||
      Utils.getMeta('datePublished') || '';

    const likesLabel =
      document.querySelector('ytd-menu-renderer like-button-view-model button')?.getAttribute('aria-label') ||
      document.querySelector('#top-level-buttons-computed ytd-toggle-button-renderer:first-child')?.getAttribute('aria-label') || '';
    const likes = likesLabel.match(/[\d,]+/)?.[0] || '';

    const metadata = {
      source: 'YouTube', title, channel, channel_url: channelUrl,
      views: viewsEl, date: dateEl, likes, url,
    };

    const parts: string[] = [`# ${title}\n`];
    parts.push(`**Channel:** [${channel}](${channelUrl})`);
    if (viewsEl) parts.push(`**Views:** ${viewsEl}`);
    if (dateEl) parts.push(`**Date:** ${dateEl}`);
    if (likes) parts.push(`**Likes:** ${likes}`);
    parts.push('');

    const descEl =
      document.querySelector('ytd-text-inline-expander > yt-attributed-string') ||
      document.querySelector('#description-inline-expander') ||
      document.querySelector('#description');

    if (descEl) {
      parts.push('## Description\n');
      parts.push((descEl.textContent || '').trim());
      parts.push('');

      const descText = descEl.textContent || '';
      const timestamps = descText.match(/\d{1,2}:\d{2}(?::\d{2})?\s+.+/g);
      if (timestamps && timestamps.length >= 3) {
        parts.push('## Chapters\n');
        timestamps.forEach((ts) => parts.push(`- ${ts.trim()}`));
        parts.push('');
      }
    }

    const comments = document.querySelectorAll('ytd-comment-thread-renderer');
    if (comments.length > 0) {
      parts.push('## Comments\n');
      let count = 0;
      comments.forEach((comment) => {
        if (count >= 20) return;
        const a = comment.querySelector('#author-text')?.textContent?.trim() || 'Anonymous';
        const b = comment.querySelector('#content-text')?.textContent?.trim() || '';
        const l = comment.querySelector('#vote-count-middle')?.textContent?.trim() || '';
        if (b) {
          parts.push(`**${a}**${l ? ` (${l} likes)` : ''}:\n`);
          parts.push(`> ${b}\n`);
          count++;
        }
      });
    }

    const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer .segment-text');
    if (transcriptItems.length > 0) {
      parts.push('## Transcript\n');
      transcriptItems.forEach((item) => {
        const time = (item as HTMLElement).parentElement?.querySelector('.segment-timestamp')?.textContent?.trim() || '';
        const text = item.textContent!.trim();
        if (text) parts.push(time ? `[${time}] ${text}` : text);
      });
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});
