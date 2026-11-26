/**
 * YouTube extractor for watch, Shorts, live, clip, and embed routes.
 * Uses rendered page metadata first, then ytInitialPlayerResponse, JSON-LD, and Open Graph fallbacks.
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
    '*://www.youtube.com/clip/*',
    '*://youtube.com/watch*',
    '*://youtube.com/shorts/*',
    '*://youtube.com/live/*',
    '*://youtube.com/embed/*',
    '*://youtube.com/clip/*',
    '*://m.youtube.com/watch*',
    '*://m.youtube.com/shorts/*',
    '*://m.youtube.com/live/*',
    '*://m.youtube.com/embed/*',
    '*://m.youtube.com/clip/*',
    '*://music.youtube.com/watch*',
    '*://www.youtube-nocookie.com/embed/*',
    '*://youtu.be/*',
  ],
  pathnameRegex: /^\/(?:(?:watch|shorts|live|embed|clip)(?:\/|$)|(?!(?:watch|shorts|live|embed|clip)[^/])[A-Za-z0-9_-]+\/?$)/,
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
    const route = routeKind(window.location.pathname);
    const videoId = videoIdFromUrl(window.location.href);
    const canonicalUrl = Utils.getCanonicalUrl();
    const canonicalId = videoIdFromUrl(canonicalUrl);
    const url = videoId && canonicalId && canonicalId !== videoId ? window.location.href : canonicalUrl;
    // In-app navigation keeps the head metadata and JSON-LD of the first video.
    const headId = document.querySelector('meta[itemprop="identifier"], meta[itemprop="videoId"]')?.getAttribute('content')
      || videoIdFromUrl(Utils.getMeta('url'));
    const staleHead = Boolean(videoId && headId && headId !== videoId);
    const ld = staleHead ? null : firstJsonLd();
    const playerVideo = readPlayerVideoDetails(videoId);
    // YouTube keeps earlier watch, Shorts, and channel pages in the DOM with the hidden attribute.
    const scope: ParentNode = (route === 'short'
      ? document.querySelector('ytd-reel-video-renderer[is-active]') || document.querySelector('ytd-shorts:not([hidden])')
      : document.querySelector('ytd-watch-flexy:not([hidden])')) || document;

    const title = firstText([
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.ytd-video-primary-info-renderer',
      '.ytShortsVideoTitleViewModelShortsVideoTitle',
      'h1.title',
      'h1',
    ], false, 'content', scope) || stringValue(playerVideo?.title) || stringValue(ld?.name)
      || (staleHead ? '' : Utils.getMeta('title')) || document.title.replace(/\s+-\s+YouTube$/, '');

    const channelLinks = Array.from((scope.querySelector('#owner') || scope).querySelectorAll<HTMLAnchorElement>(
      'ytd-channel-name yt-formatted-string a, #channel-name a, #owner a, a.ytd-channel-name, ytd-reel-player-header-renderer a[href^="/@"], '
      + '.ytReelChannelBarViewModelChannelName a',
    ));
    // The first owner link wraps the avatar and has no text.
    const channelEl = channelLinks.find((link) => link.textContent?.trim()) || channelLinks[0];
    const channel = channelEl?.textContent?.trim() ||
      stringValue(playerVideo?.author) ||
      stringValue(asRecord(ld?.author)?.name) ||
      stringValue(ld?.author);
    const channelUrl = safeHttpUrl(channelEl?.href || stringValue(asRecord(ld?.author)?.url));

    const views = firstText([
      '#view-count',
      'ytd-watch-info-text .bold',
      '.view-count',
      'ytd-video-view-count-renderer',
    ], false, 'content', scope) || stringValue(playerVideo?.viewCount) || stringValue(ld?.interactionCount) || interactionCount(ld);
    const date = firstText([
      '#date-text',
      ...(staleHead ? [] : ['meta[itemprop="datePublished"]', 'meta[itemprop="uploadDate"]']),
      'time[datetime]',
      'ytd-watch-info-text span:nth-child(3)',
      'ytd-watch-info-text yt-formatted-string',
    ], true, 'content', scope) || stringValue(ld?.datePublished) || (staleHead ? '' : Utils.getMeta('datePublished'));
    const duration = firstText([
      ...(staleHead ? [] : ['meta[itemprop="duration"]']),
      // An ad shows its own duration, and thumbnails belong to other videos.
      '.ytp-time-duration:not(.ad-showing *)',
    ], true, 'content', scope) || stringValue(ld?.duration);
    const likes = extractLikes(scope);
    const description = extractDescription(scope, playerVideo, videoId);
    const headImage = Utils.getMeta('image');
    const thumbnail = (!videoId || headImage.includes(`/${videoId}/`) ? headImage : '') || stringValue(ld?.thumbnailUrl);

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
      parts.push('## Description', '', description, '');
      const timestamps = description.match(/(?:^|\n|\s)(\d{1,2}:\d{2}(?::\d{2})?)\s+([^\n]+)/g) || [];
      if (timestamps.length >= 3) {
        parts.push('## Chapters', '', ...timestamps.map((value) => `- ${value.trim()}`), '');
      }
    }

    // The Shorts comment panel is outside the active reel.
    const panelScope = (route === 'short' && document.querySelector('ytd-shorts:not([hidden])')) || scope;
    const comments = Array.from(panelScope.querySelectorAll('ytd-comment-thread-renderer'));
    if (comments.length) {
      parts.push('## Comments', '');
      comments.forEach((comment) => {
        const author = comment.querySelector('#author-text')?.textContent?.trim() || 'Anonymous';
        const body = comment.querySelector('#content-text')?.textContent?.trim() || '';
        const score = comment.querySelector('#vote-count-middle')?.textContent?.trim() || '';
        if (body) {
          parts.push(`**${author}**${score ? ` (${score} likes)` : ''}:`);
          parts.push(...body.split(/\r?\n/).map((line) => `> ${line}`), '');
        }
      });
    }

    const transcript = extractTranscript(panelScope);
    if (transcript.length) {
      parts.push('## Transcript', '', ...transcript, '');
    }

    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

type JsonLd = Record<string, unknown>;

function routeKind(pathname: string): string {
  if (pathname.startsWith('/shorts/')) return 'short';
  if (pathname.startsWith('/live/')) return 'live';
  if (pathname.startsWith('/embed/')) return 'embed';
  if (pathname.startsWith('/clip/')) return 'clip';
  return 'watch';
}

function videoIdFromUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    const pathId = /(?:^|\.)youtu\.be$/i.test(url.hostname)
      ? url.pathname.match(/^\/([\w-]+)/)
      : url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/);
    return url.searchParams.get('v') || pathId?.[1] || '';
  } catch {
    return '';
  }
}

function readPlayerVideoDetails(videoId: string): JsonLd | null {
  try {
    const win = window as unknown as { ytInitialPlayerResponse?: unknown };
    const player = document.querySelector('#movie_player') as { getPlayerResponse?: () => unknown } | null;
    // The initial response stays in place after in-app navigation, so the ID must match.
    for (const response of [player?.getPlayerResponse?.(), win.ytInitialPlayerResponse]) {
      const details = asRecord(asRecord(response)?.videoDetails);
      const detailsId = stringValue(details?.videoId);
      if (details && (!videoId || !detailsId || detailsId === videoId)) return details;
    }
  } catch {
    // Ignore restricted window globals.
  }
  return null;
}

function extractLikes(scope: ParentNode): string {
  const selectors = [
    'like-button-view-model button',
    'segmented-like-dislike-button-view-model button',
    'ytd-menu-renderer like-button-view-model button',
    '#top-level-buttons-computed ytd-toggle-button-renderer:first-child button',
    '#top-level-buttons-computed ytd-toggle-button-renderer:first-child',
  ];
  for (const selector of selectors) {
    const el = scope.querySelector(selector);
    if (!el) continue;
    const aria = el.getAttribute('aria-label') || '';
    const ariaMatch = aria.match(/along with\s+(\d[\d,.]*(?:\s*(?:thousand|million|billion|[KMB])\b)?)/i)
      || aria.match(/(\d[\d,.]*(?:\s*(?:thousand|million|billion|[KMB]))?)\s*likes?/i)
      || aria.match(/(\d[\d,.]*(?:\s*(?:thousand|million|billion|[KMB])\b)?)/i);
    if (ariaMatch) return ariaMatch[1].trim();
    const labelText = el.querySelector('.yt-spec-button-shape-next__button-text-content')?.textContent?.trim()
      || el.textContent?.trim() || '';
    const textMatch = labelText.match(/^[\d,.]+(?:\s*[KMB])?$/i);
    if (textMatch) return textMatch[0].trim();
  }
  return '';
}

/** Read the live nodes. Cloning runs YouTube's element constructors, which drop the text. */
function attributedText(element: Element | null): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '');
    } else if (node instanceof Element && !node.hasAttribute('hidden')) {
      const label = node instanceof HTMLAnchorElement ? Markdown.normalizeWhitespace(node.textContent || '') : '';
      // A timestamp or a hashtag needs no URL, and the chapter list reads plain timestamps.
      const target = node instanceof HTMLAnchorElement && !/^(?:#|\d+(?::\d{2})+$)/.test(label) ? linkTarget(node.href) : '';
      if (!target) node.childNodes.forEach(visit);
      else parts.push(/^https?:/i.test(label) || !label ? target : `[${Markdown.escapeMarkdownLinkText(label)}](${target})`);
    }
  };
  if (element) visit(element);
  return parts.join('').trim();
}

function linkTarget(href: string): string {
  try {
    const url = new URL(href);
    const target = url.pathname === '/redirect' ? url.searchParams.get('q') || '' : href;
    return safeHttpUrl(target).replace(/\(/g, '%28').replace(/\)/g, '%29');
  } catch {
    return '';
  }
}

function extractDescription(scope: ParentNode, playerVideo: JsonLd | null, videoId: string): string {
  const playerDescription = stringValue(playerVideo?.shortDescription);
  if (playerDescription && videoId && stringValue(playerVideo?.videoId) === videoId) return playerDescription;
  const selectors = [
    'ytd-text-inline-expander > yt-attributed-string',
    '#description-inline-expander',
    '#description',
  ];
  let domDescription = attributedText(scope.querySelector('#description-inline-expander #expanded yt-attributed-string'));
  if (!domDescription) {
    domDescription = attributedText(scope.querySelector('#description-inline-expander #snippet-text'));
    // A collapsed description shows only its first lines.
    if (domDescription && scope.querySelector('#description-inline-expander #ellipsis:not([hidden])')) domDescription += ' …';
  }
  for (const selector of domDescription ? [] : selectors) {
    const el = scope.querySelector(selector);
    if (!el) continue;
    const cleaned = Utils.removeNoise(el, [
      'script', 'style', '#expand', '#collapse', 'tp-yt-paper-button', 'button',
    ]);
    const text = Markdown.elementToMarkdown(cleaned).trim();
    if (text) {
      domDescription = text;
      break;
    }
  }
  if (playerDescription && playerDescription.length > domDescription.length) {
    return playerDescription;
  }
  return domDescription;
}

function extractTranscript(scope: ParentNode): string[] {
  const lines: string[] = [];
  const legacySegments = Array.from(scope.querySelectorAll('ytd-transcript-segment-renderer'));
  if (legacySegments.length) {
    legacySegments.forEach((segment) => {
      const time = segment.querySelector('.segment-timestamp')?.textContent?.trim() || '';
      const text = segment.querySelector('.segment-text')?.textContent?.trim() || '';
      if (text) lines.push(time ? `[${time}] ${text}` : text);
    });
    return lines;
  }

  const modernSegments = Array.from(scope.querySelectorAll('transcript-segment-view-model'));
  modernSegments.forEach((segment) => {
    const time = segment.querySelector('.ytwTranscriptSegmentViewModelTimestamp, [class*="Timestamp"]')?.textContent?.trim() || '';
    const text = segment.querySelector('.yt-core-attributed-string, yt-formatted-string, [class*="SegmentText"]')?.textContent?.trim() || '';
    if (text) lines.push(time ? `[${time}] ${text}` : text);
  });
  return lines;
}

function firstText(
  selectors: string[],
  attributeMode = false,
  attribute = 'content',
  scope: ParentNode = document,
): string {
  for (const selector of selectors) {
    const element = scope.querySelector(selector)
      || (scope !== document && selector.startsWith('meta') ? document.querySelector(selector) : null);
    if (!element) continue;
    const value = attributeMode
      ? element.getAttribute(attribute) || element.getAttribute('datetime') || element.textContent || ''
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
  if (!value) return '';
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
