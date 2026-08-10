/**
 * YouTube extractor for watch, Shorts, live, and embed routes.
 * Uses rendered page metadata first, then JSON-LD and Open Graph fallbacks.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'YouTube',
  matches: [
    '*://www.youtube.com/watch*',
    '*://www.youtube.com/shorts/*',
    '*://www.youtube.com/live/*',
    '*://www.youtube.com/embed/*',
    '*://youtube.com/watch*',
    '*://youtube.com/shorts/*',
    '*://youtube.com/live/*',
    '*://youtube.com/embed/*',
    '*://m.youtube.com/watch*',
    '*://m.youtube.com/shorts/*',
    '*://m.youtube.com/live/*',
    '*://m.youtube.com/embed/*',
  ],
  pathnameRegex: /^\/(?:watch|shorts|live|embed)(?:\/|$)/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '#top-level-buttons-computed',
      'ytd-menu-renderer.ytd-watch-metadata',
      '#actions-inner',
      '#actions',
      'ytd-watch-metadata #top-row',
      '#above-the-fold #top-row',
    ].join(', '),
    position: 'overlay',
    style: 'pill',
    css: { marginLeft: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = routeKind(window.location.pathname);
    const ld = firstJsonLd();

    const title = firstText([
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.ytd-video-primary-info-renderer',
      'h1.title',
      'h1',
    ]) || stringValue(ld?.name) || Utils.getMeta('title') || Utils.getPageTitle();

    const channelEl = document.querySelector<HTMLAnchorElement>(
      'ytd-channel-name yt-formatted-string a, #channel-name a, #owner a, a.ytd-channel-name',
    );
    const channel = channelEl?.textContent?.trim() ||
      stringValue(asRecord(ld?.author)?.name) ||
      stringValue(ld?.author);
    const channelUrl = safeHttpUrl(channelEl?.href || stringValue(asRecord(ld?.author)?.url));

    const views = firstText([
      'ytd-watch-info-text .bold',
      '.view-count',
      'ytd-video-view-count-renderer',
    ]) || stringValue(ld?.interactionCount) || interactionCount(ld);
    const date = firstText([
      'ytd-watch-info-text span:nth-child(3)',
      'ytd-watch-info-text yt-formatted-string',
      'meta[itemprop="datePublished"]',
      'time[datetime]',
    ], true) || stringValue(ld?.datePublished) || Utils.getMeta('datePublished');
    const duration = firstText([
      'meta[itemprop="duration"]',
      '.ytp-time-duration',
      'ytd-thumbnail-overlay-time-status-renderer span',
    ], true) || stringValue(ld?.duration);
    const likes = firstText([
      'ytd-menu-renderer like-button-view-model button',
      '#top-level-buttons-computed ytd-toggle-button-renderer:first-child',
    ], false, 'aria-label').match(/[\d,.]+(?:\s*[KMB])?/i)?.[0] || '';
    const description = firstText([
      'ytd-text-inline-expander > yt-attributed-string',
      '#description-inline-expander',
      '#description',
    ]);
    const thumbnail = Utils.getMeta('image') || stringValue(ld?.thumbnailUrl);

    const metadata: Record<string, string> = {
      source: 'YouTube',
      title,
      url,
      route,
      channel,
      channel_url: channelUrl,
      views,
      date,
      duration,
      likes,
    };

    const parts: string[] = [`# ${title}`, ''];
    if (channel) parts.push(`**Channel:** ${channelUrl ? `[${channel}](${channelUrl})` : channel}`);
    if (views) parts.push(`**Views:** ${views}`);
    if (date) parts.push(`**Date:** ${date}`);
    if (duration) parts.push(`**Duration:** ${duration}`);
    if (likes) parts.push(`**Likes:** ${likes}`);
    if (thumbnail) parts.push(`**Thumbnail:** ${thumbnail}`);
    parts.push('');

    if (description) {
      parts.push('## Description', '', Utils.truncate(description, 20_000), '');
      const timestamps = description.match(/(?:^|\n|\s)(\d{1,2}:\d{2}(?::\d{2})?)\s+([^\n]+)/g) || [];
      if (timestamps.length >= 3) {
        parts.push('## Chapters', '', ...timestamps.slice(0, 100).map((value) => `- ${value.trim()}`), '');
      }
    }

    const comments = Array.from(document.querySelectorAll('ytd-comment-thread-renderer'))
      .slice(0, 20);
    if (comments.length) {
      parts.push('## Comments', '');
      comments.forEach((comment) => {
        const author = comment.querySelector('#author-text')?.textContent?.trim() || 'Anonymous';
        const body = comment.querySelector('#content-text')?.textContent?.trim() || '';
        const score = comment.querySelector('#vote-count-middle')?.textContent?.trim() || '';
        if (body) parts.push(`**${author}**${score ? ` (${score} likes)` : ''}:`, `> ${body}`, '');
      });
    }

    const transcript = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'))
      .slice(0, 500);
    if (transcript.length) {
      parts.push('## Transcript', '');
      transcript.forEach((segment) => {
        const time = segment.querySelector('.segment-timestamp')?.textContent?.trim() || '';
        const text = segment.querySelector('.segment-text')?.textContent?.trim() || '';
        if (text) parts.push(time ? `[${time}] ${text}` : text);
      });
      parts.push('');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonLd = Record<string, unknown>;

function routeKind(pathname: string): string {
  if (pathname.startsWith('/shorts/')) return 'short';
  if (pathname.startsWith('/live/')) return 'live';
  if (pathname.startsWith('/embed/')) return 'embed';
  return 'watch';
}

function firstText(
  selectors: string[],
  attributeMode = false,
  attribute = 'content',
): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const value = attributeMode
      ? element.getAttribute(attribute) || element.textContent || ''
      : attribute !== 'content' && element.hasAttribute(attribute)
        ? element.getAttribute(attribute) || ''
        : element.textContent || '';
    const text = value.trim();
    if (text) return text;
  }
  return '';
}

function firstJsonLd(): JsonLd | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    try {
      const value: unknown = JSON.parse(script.textContent || '');
      const records = Array.isArray(value) ? value : [value];
      const match = records.find((entry) => {
        const record = asRecord(entry);
        const type = stringValue(record?.['@type']);
        return /VideoObject|Movie|TVEpisode/i.test(type) || Boolean(record?.name);
      });
      if (match && asRecord(match)) return asRecord(match);
    } catch {
      // YouTube frequently leaves malformed or partial JSON-LD during navigation.
    }
  }
  return null;
}

function interactionCount(record: JsonLd | null): string {
  const stats = record && asRecord(record.interactionStatistic);
  if (!stats) return '';
  const value = stats.userInteractionCount || stats.interactionCount;
  return stringValue(value);
}

function asRecord(value: unknown): JsonLd | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonLd
    : null;
}

function stringValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(', ');
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
