/**
 * Twitch extractor for channel, video, and clip pages.
 * Copies the active stream/video metadata and visible about text only.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'Twitch',
  matches: [
    '*://www.twitch.tv/videos/*',
    '*://www.twitch.tv/*/clip/*',
    '*://www.twitch.tv/clip/*',
    '*://www.twitch.tv/*',
    '*://twitch.tv/videos/*',
    '*://twitch.tv/*/clip/*',
    '*://twitch.tv/clip/*',
    '*://twitch.tv/*',
  ],
  pathnameRegex: /^\/(?:videos\/\d+|clip\/[^/?#]+|[A-Za-z0-9_]{2,25}\/clip\/[^/?#]+|(?!(?:directory|search|downloads|settings|subscriptions|inventory|jobs|p|login|signup|friends)(?:\/|$))[A-Za-z0-9_]{2,25}\/?$)/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-a-target="video-share-button"]',
      '[data-a-target="stream-share-button"]',
      '[data-a-target="channel-header"]',
      'h1',
    ].join(', '),
    position: 'after',
    style: 'pill',
    css: { marginTop: '8px' },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = routeKind(window.location.pathname);
    const payload = firstStructuredPayload();
    const title = firstText([
      '[data-a-target="video-title"]',
      '[data-a-target="stream-title"]',
      '[data-test-selector="title"]',
      'h1',
    ]) || stringValue(payload?.name) || Utils.getMeta('title') || Utils.getPageTitle();
    const channel = firstText([
      '[data-a-target="video-info-channel-name"]',
      '[data-a-target="channel-name"]',
      '[data-a-target="streamer-name"]',
      'a[data-a-target="preview-card-channel-link"]',
    ]) || stringValue(asRecord(payload?.author)?.name) || stringValue(payload?.author);
    const game = firstText([
      '[data-a-target="video-game-name"]',
      '[data-a-target="game-link"]',
      '[data-a-target="stream-game-link"]',
    ]) || stringValue(asRecord(payload?.about)?.name);
    const published = firstText([
      'time[datetime]',
      '[data-a-target="video-date"]',
      '[data-a-target="stream-time"]',
    ], true) || stringValue(payload?.uploadDate) || stringValue(payload?.datePublished);
    const duration = firstText([
      '[data-a-target="video-duration"]',
      '[data-a-target="clip-duration"]',
      'meta[itemprop="duration"]',
    ], true) || stringValue(payload?.duration);
    const views = firstText([
      '[data-a-target="video-views"]',
      '[data-a-target="stream-viewer-count"]',
      '[data-a-target="clip-views"]',
    ]) || stringValue(payload?.interactionCount);
    const description = firstText([
      '[data-a-target="video-description"]',
      '[data-a-target="channel-description"]',
      '[data-test-selector="about-panel"]',
    ]) || stringValue(payload?.description) || Utils.getMeta('description');
    const channelUrl = safeHttpUrl(document.querySelector<HTMLAnchorElement>(
      '[data-a-target="video-info-channel-name"] a, [data-a-target="channel-name"] a, a[data-a-target="preview-card-channel-link"]',
    )?.href || stringValue(asRecord(payload?.author)?.url));

    const metadata: Record<string, string> = {
      source: 'Twitch', title, url, route, channel, channel_url: channelUrl,
      game, published, duration, views,
    };
    const parts: string[] = [`# ${title}`, ''];
    if (channel) parts.push(`**Channel:** ${channelUrl ? `[${channel}](${channelUrl})` : channel}`);
    if (game) parts.push(`**Category:** ${game}`);
    if (published) parts.push(`**Published:** ${published}`);
    if (duration) parts.push(`**Duration:** ${duration}`);
    if (views) parts.push(`**Views:** ${views}`);
    parts.push('');
    if (description) parts.push('## Description', '', Utils.truncate(description, 20_000), '');

    if (route === 'channel') {
      const about = extractRows([
        '[data-a-target="channel-about-panel"]',
        '[data-test-selector="about-panel"]',
        '[data-a-target="channel-panels"] [data-a-target="panel-content"]',
      ], 20);
      if (about.length) parts.push('## About', '', ...about.map((line) => `- ${line}`), '');
    }

    const tags = extractRows([
      '[data-a-target="video-tags"] a',
      '[data-a-target="stream-tags"] a',
      '[data-a-target="tag-card"]',
    ], 30);
    if (tags.length) parts.push('## Tags', '', ...tags.map((tag) => `- ${tag}`), '');

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonRecord = Record<string, unknown>;

function routeKind(pathname: string): string {
  if (pathname.startsWith('/videos/')) return 'video';
  if (pathname.startsWith('/clip/') || /\/clip\//.test(pathname)) return 'clip';
  return 'channel';
}

function firstText(selectors: string[], attributeMode = false): string {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const value = attributeMode
      ? element.getAttribute('content') || element.getAttribute('datetime') || element.textContent || ''
      : element.textContent || '';
    const text = value.trim();
    if (text) return text;
  }
  return '';
}

function extractRows(selectors: string[], limit: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 1_000 || seen.has(text)) continue;
      seen.add(text);
      result.push(text);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

function firstStructuredPayload(): JsonRecord | null {
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"], script#__NEXT_DATA__, script[id*="state"], script[id*="State"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const found = findRecord(parsed);
      if (found) return found;
    } catch {
      // Ignore transient state fragments while Twitch navigates between routes.
    }
  }
  return null;
}

function findRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 7 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findRecord(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as JsonRecord;
  const type = stringValue(record['@type']);
  if (/VideoObject|BroadcastEvent|Person/i.test(type) || record.videoId || record.streamTitle || record.channelName) return record;
  for (const child of Object.values(record)) {
    const found = findRecord(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
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
