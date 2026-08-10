/**
 * TikTok extractor for video/photo permalinks and the active feed item.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const COMMENT_LIMIT = 30;
const CAPTION_LIMIT = 200;

interface TikTokItem {
  id: string;
  author: string;
  displayName: string;
  body: string;
  timestamp: string;
  likes: string;
  comments: string;
  shares: string;
  plays: string;
  mediaAlt: string[];
  captionLanguages: string[];
}

interface Comment {
  author: string;
  body: string;
  timestamp: string;
  likes: string;
  reply: boolean;
}

register({
  name: 'TikTok',
  matches: [
    '*://www.tiktok.com/*',
    '*://tiktok.com/*',
    '*://m.tiktok.com/*',
    '*://vm.tiktok.com/*',
  ],
  pathnameRegex: /^\/(?:$|@[^/]+\/(?:video|photo)\/\d+\/?|embed\/v2\/\d+\/?|player\/v1\/\d+\/?|(?:foryou|following|discover|search|tag|music)(?:\/|$))/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-e2e="browse-share-group"]',
      '[data-e2e="video-share-button"]',
      '[data-e2e="feed-video"] [class*="ActionItemContainer"]',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const routeId = window.location.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1]
      || window.location.pathname.match(/\/(?:embed\/v2|player\/v1)\/(\d+)/)?.[1] || '';
    const active = findActiveVideo(routeId);
    const domItem = extractDomItem(active, routeId);
    const embeddedItem = routeId ? findEmbeddedItem(routeId) : null;
    const item = mergeItems(embeddedItem, domItem);
    const comments = routeId ? extractComments(active || document) : [];
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const captions = limitCollection(extractCaptions(active || document), CAPTION_LIMIT);

    const title = item.author ? `TikTok by @${item.author.replace(/^@/, '')}` : 'TikTok post';
    const metadata: Record<string, string | number | undefined> = {
      source: 'TikTok',
      type: routeId ? (/\/photo\//.test(window.location.pathname) ? 'photo post' : 'video') : 'active feed item',
      title,
      author: item.author ? `@${item.author.replace(/^@/, '')}` : '',
      author_name: item.displayName,
      published_at: item.timestamp,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      plays: item.plays,
      url,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: item.mediaAlt.length,
      transcript_segments: captions.items.length,
      caption_languages: item.captionLanguages.join(', '),
      completeness: routeId
        ? 'post fields plus comments and captions currently loaded in page'
        : 'active visible feed item only',
    };

    const sources = [embeddedItem && 'TikTok embedded page data', active && 'visible TikTok DOM']
      .filter(Boolean).join(' + ') || 'TikTok page metadata';
    const knownCommentTotal = parseCount(item.comments);
    const loadedCommentsComplete = knownCommentTotal !== null && knownCommentTotal <= comments.length;

    const parts: string[] = [`# ${title}`, ''];
    if (item.displayName) parts.push(`**Name:** ${item.displayName}`);
    if (item.author) parts.push(`**Handle:** @${item.author.replace(/^@/, '')}`);
    if (item.timestamp) parts.push(`**Published:** ${item.timestamp}`);
    parts.push('');
    if (item.body) parts.push(item.body, '');

    const engagement = formatEngagement(item);
    if (engagement.length) parts.push('## Engagement', '', ...engagement, '');
    if (item.mediaAlt.length || item.captionLanguages.length) {
      parts.push('## Media', '');
      item.mediaAlt.forEach((alt) => parts.push(`- ${alt}`));
      if (item.captionLanguages.length) {
        parts.push(`- Captions available: ${item.captionLanguages.join(', ')}`);
      }
      parts.push('');
    }
    if (captions.items.length) {
      parts.push('## Transcript / visible captions', '', ...captions.items, '');
    }
    if (limitedComments.items.length) {
      parts.push(`## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const truncated = limitedComments.truncated || captions.truncated || limitedBody.truncated
      || (knownCommentTotal !== null && knownCommentTotal > limitedComments.items.length);
    addExtractionMetadata(metadata, {
      contentSource: sources,
      total: knownCommentTotal ?? comments.length,
      included: limitedComments.items.length,
      truncated,
      complete: routeId.length > 0 && loadedCommentsComplete && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limitedBody.markdown);
  },
});

function emptyItem(id = ''): TikTokItem {
  return {
    id, author: '', displayName: '', body: '', timestamp: '', likes: '', comments: '',
    shares: '', plays: '', mediaAlt: [], captionLanguages: [],
  };
}

function findActiveVideo(routeId: string): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '[data-e2e="feed-item"]', '[data-e2e="browse-video"]', '[data-video-id]',
    '[data-e2e="search-video-card"]', 'main article', 'article',
  ].join(', ')));
  if (routeId) {
    const matching = candidates.find((candidate) =>
      candidate.getAttribute('data-video-id') === routeId
      || candidate.querySelector(`a[href*="/video/${routeId}"], a[href*="/photo/${routeId}"], a[href*="/embed/v2/${routeId}"]`),
    );
    if (matching) return matching;
  }
  return mostVisible(candidates) || document.querySelector('main') || document.body;
}

function mostVisible(elements: Element[]): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    const area = width * height;
    if (area > bestArea) { best = element; bestArea = area; }
  }
  return best || elements[0] || null;
}

function extractDomItem(scope: Element | null, routeId: string): TikTokItem {
  const item = emptyItem(routeId);
  if (!scope) {
    item.author = window.location.pathname.match(/^\/@([^/]+)/)?.[1] || '';
    item.body = clean(Utils.getMeta('description'));
    return item;
  }
  item.author = text(scope, [
    '[data-e2e="video-author-uniqueid"]', '[data-e2e="browse-username"]',
    'a[href^="/@"] strong', 'a[href^="/@"]',
  ]).replace(/^@/, '');
  item.displayName = text(scope, [
    '[data-e2e="video-author-nickname"]', '[data-e2e="browse-nickname"]', '[data-e2e="browser-nickname"]',
  ]);
  item.body = text(scope, [
    '[data-e2e="browse-video-desc"]', '[data-e2e="video-desc"]',
    '[data-e2e="feed-video-desc"]', 'h1[data-e2e="browse-video-desc"]',
  ]) || clean(Utils.getMeta('description'));
  item.timestamp = attr(scope, ['time[datetime]'], 'datetime') || text(scope, ['time']);
  item.likes = text(scope, ['[data-e2e="like-count"]', '[data-e2e="browse-like-count"]']);
  item.comments = text(scope, ['[data-e2e="comment-count"]', '[data-e2e="browse-comment-count"]']);
  item.shares = text(scope, ['[data-e2e="share-count"]', '[data-e2e="browse-share-count"]']);
  item.plays = text(scope, ['[data-e2e="video-views"]', '[data-e2e="video-play-count"]']);
  item.mediaAlt = unique(Array.from(scope.querySelectorAll<HTMLImageElement>('img[src], img[data-src]'))
    .map((image) => {
      const alt = clean(image.alt) || 'TikTok image';
      if (/profile|avatar|logo|icon/i.test(alt)) return '';
      const src = safeHttpUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '');
      return src ? `[${escapeLabel(alt)}](${src})` : alt;
    })
    .filter(Boolean)).slice(0, 20);
  return item;
}

function findEmbeddedItem(routeId: string): TikTokItem | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    '#__UNIVERSAL_DATA_FOR_REHYDRATION__, #SIGI_STATE, script[type="application/ld+json"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* malformed or non-JSON state */ }
  }

  for (const payload of payloads) {
    const direct = directTikTokItem(payload, routeId);
    if (direct) return mapEmbeddedItem(direct, routeId);
    const found = findObject(payload, (record) =>
      String(record.id || record.itemId || '') === routeId
      && Boolean(record.desc || record.author || record.stats),
    );
    if (found) return mapEmbeddedItem(found, routeId);
    const ld = findObject(payload, (record) =>
      ['VideoObject', 'ImageObject', 'SocialMediaPosting'].includes(stringValue(record['@type']))
      && stringValue(record.url || record.mainEntityOfPage).includes(routeId),
    );
    if (ld) return mapLdItem(ld, routeId);
  }
  return null;
}

function directTikTokItem(payload: unknown, routeId: string): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  const itemModule = isRecord(payload.ItemModule) ? payload.ItemModule : null;
  if (itemModule && isRecord(itemModule[routeId])) return itemModule[routeId] as Record<string, unknown>;
  const scope = isRecord(payload.__DEFAULT_SCOPE__) ? payload.__DEFAULT_SCOPE__ : null;
  if (!scope) return null;
  for (const [key, value] of Object.entries(scope)) {
    if (!key.includes('video-detail') || !isRecord(value)) continue;
    const itemInfo = isRecord(value.itemInfo) ? value.itemInfo : null;
    if (itemInfo && isRecord(itemInfo.itemStruct)) return itemInfo.itemStruct;
  }
  return null;
}

function mapEmbeddedItem(record: Record<string, unknown>, routeId: string): TikTokItem {
  const item = emptyItem(routeId);
  const author = isRecord(record.author) ? record.author : {};
  const stats = isRecord(record.stats) ? record.stats : {};
  item.author = stringValue(author.uniqueId) || stringValue(record.authorName);
  item.displayName = stringValue(author.nickname);
  item.body = stringValue(record.desc) || stringValue(record.description);
  item.timestamp = formatTimestamp(record.createTime || record.dateCreated || record.uploadDate);
  item.likes = countValue(stats.diggCount || record.likeCount);
  item.comments = countValue(stats.commentCount || record.commentCount);
  item.shares = countValue(stats.shareCount || record.shareCount);
  item.plays = countValue(stats.playCount || stats.viewCount || record.interactionCount);

  const video = isRecord(record.video) ? record.video : {};
  const coverAlt = stringValue(video.title) || stringValue(record.accessibilityText);
  const cover = stringValue(video.cover || video.coverUrl || video.originCover);
  const coverUrl = safeHttpUrl(cover);
  if (coverUrl) item.mediaAlt.push(`[TikTok cover](${coverUrl})`);
  else if (coverAlt) item.mediaAlt.push(coverAlt);
  const subtitleInfos = Array.isArray(video.subtitleInfos) ? video.subtitleInfos : [];
  item.captionLanguages = unique(subtitleInfos.map((entry) => {
    if (!isRecord(entry)) return '';
    return stringValue(entry.LanguageName || entry.languageName || entry.LanguageCodeName || entry.languageCodeName);
  }).filter(Boolean));
  return item;
}

function mapLdItem(record: Record<string, unknown>, routeId: string): TikTokItem {
  const item = emptyItem(routeId);
  const author = isRecord(record.author) ? record.author : {};
  item.author = stringValue(author.alternateName || author.name).replace(/^@/, '');
  item.displayName = stringValue(author.name);
  item.body = stringValue(record.caption || record.description || record.name);
  item.timestamp = stringValue(record.uploadDate || record.datePublished);
  const thumbnail = stringValue(record.thumbnailUrl);
  const thumbnailUrl = safeHttpUrl(thumbnail);
  if (thumbnailUrl) item.mediaAlt.push(`[Thumbnail](${thumbnailUrl})`);
  const stats = Array.isArray(record.interactionStatistic) ? record.interactionStatistic : [];
  stats.forEach((entry) => {
    if (!isRecord(entry)) return;
    const kindRecord = isRecord(entry.interactionType) ? entry.interactionType : {};
    const kind = stringValue(kindRecord['@type'] || entry.interactionType);
    const count = countValue(entry.userInteractionCount || entry.interactionCount);
    if (/like/i.test(kind)) item.likes = count;
    else if (/comment/i.test(kind)) item.comments = count;
    else if (/share/i.test(kind)) item.shares = count;
    else if (/watch|view/i.test(kind)) item.plays = count;
  });
  return item;
}

function mergeItems(primary: TikTokItem | null, fallback: TikTokItem): TikTokItem {
  if (!primary) return fallback;
  return {
    ...fallback,
    ...primary,
    mediaAlt: unique([...primary.mediaAlt, ...fallback.mediaAlt]),
    captionLanguages: unique([...primary.captionLanguages, ...fallback.captionLanguages]),
    author: primary.author || fallback.author,
    displayName: primary.displayName || fallback.displayName,
    body: primary.body || fallback.body,
    timestamp: primary.timestamp || fallback.timestamp,
    likes: primary.likes || fallback.likes,
    comments: primary.comments || fallback.comments,
    shares: primary.shares || fallback.shares,
    plays: primary.plays || fallback.plays,
  };
}

function extractComments(scope: ParentNode): Comment[] {
  const nodes = scope.querySelectorAll(
    '[data-e2e="comment-item"], [data-e2e="comment-level-1"], [data-e2e="comment-level-2"]',
  );
  const seen = new Set<string>();
  const comments: Comment[] = [];
  nodes.forEach((node) => {
    const author = text(node, ['[data-e2e="comment-username-1"]', '[data-e2e="comment-username-2"]', 'a[href^="/@"]']);
    const body = text(node, [
      '[data-e2e="comment-text-1"]', '[data-e2e="comment-text-2"]', '[data-e2e="comment-text"]',
      '[data-e2e="comment-level-1"]', '[data-e2e="comment-level-2"]', '[class*="CommentText"]', 'p',
    ]);
    if (!body) return;
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author: author || 'Anonymous',
      body,
      timestamp: text(node, ['time', '[data-e2e="comment-time-1"]', '[data-e2e="comment-time-2"]']),
      likes: text(node, ['[data-e2e="comment-like-count"]', '[class*="LikeCount"]']),
      reply: node.matches('[data-e2e="comment-level-2"]') || Boolean(node.closest('[data-e2e="comment-level-2"]')),
    });
  });
  return comments;
}

function extractCaptions(scope: ParentNode): string[] {
  const captions = Array.from(scope.querySelectorAll('[data-e2e="video-subtitle"], [class*="DivSubtitle"]'))
    .map((node) => clean(node.textContent || '')).filter(Boolean);
  scope.querySelectorAll('video').forEach((video) => {
    for (const track of Array.from((video as HTMLVideoElement).textTracks || [])) {
      const cues = track.activeCues || track.cues;
      if (!cues) continue;
      for (const cue of Array.from(cues)) {
        if ('text' in cue && typeof cue.text === 'string') captions.push(clean(cue.text));
      }
    }
  });
  return unique(captions).filter(Boolean);
}

function appendComment(parts: string[], comment: Comment): void {
  const details = [comment.timestamp, comment.likes ? `${comment.likes} likes` : ''].filter(Boolean).join(' · ');
  parts.push(`${comment.reply ? '↳ ' : ''}**${comment.author}**${details ? ` (${details})` : ''}`);
  parts.push(...comment.body.split(/\n+/).map((line) => `> ${line}`), '');
}

function formatEngagement(item: TikTokItem): string[] {
  const values = [
    ['Likes', item.likes], ['Comments', item.comments], ['Shares', item.shares], ['Views', item.plays],
  ];
  return values.filter(([, value]) => value).map(([label, value]) => `- **${label}:** ${value}`);
}

function findObject(
  root: unknown,
  predicate: (record: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 25_000) {
    const current = stack.pop()!;
    if (!isRecord(current.value) && !Array.isArray(current.value)) continue;
    if (isRecord(current.value) && predicate(current.value)) return current.value;
    if (current.depth >= 14) continue;
    Object.values(current.value).forEach((value) => {
      if (value && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    });
  }
  return null;
}

function text(scope: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const own = scope instanceof Element && scope.matches(selector) ? scope : null;
    const value = clean((own || scope.querySelector(selector))?.textContent || '');
    if (value) return value;
  }
  return '';
}

function attr(scope: ParentNode, selectors: string[], name: string): string {
  for (const selector of selectors) {
    const value = scope.querySelector(selector)?.getAttribute(name)?.trim() || '';
    if (value) return value;
  }
  return '';
}

function clean(value: string): string { return Markdown.normalizeWhitespace(value); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function stringValue(value: unknown): string { return typeof value === 'string' ? clean(value) : ''; }
function countValue(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}
function formatTimestamp(value: unknown): string {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const number = Number(value);
    return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  }
  return stringValue(value);
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value, document.baseURI);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
function escapeLabel(value: string): string { return value.replace(/[\\\[\]]/g, '\\$&'); }
function parseCount(value: string): number | null {
  const normalized = value.trim().toLowerCase().replace(/,/g, '');
  const match = normalized.match(/([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}
