/**
 * Facebook extractor for post, reel, video, permalink, and active-feed routes.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const COMMENT_LIMIT = 30;

interface FacebookPost {
  id: string;
  author: string;
  body: string;
  timestamp: string;
  reactions: string;
  comments: string;
  shares: string;
  views: string;
  media: string[];
}

interface FacebookComment {
  author: string;
  body: string;
  timestamp: string;
  reactions: string;
  reply: boolean;
}

register({
  name: 'Facebook',
  matches: [
    '*://www.facebook.com/',
    '*://www.facebook.com/*/posts/*',
    '*://www.facebook.com/groups/*/posts/*',
    '*://www.facebook.com/reel/*',
    '*://www.facebook.com/*/videos/*',
    '*://www.facebook.com/watch/?v=*',
    '*://www.facebook.com/permalink.php?*',
    '*://www.facebook.com/story.php?*',
    '*://www.facebook.com/share/p/*',
    '*://www.facebook.com/share/r/*',
    '*://facebook.com/*',
    '*://web.facebook.com/*',
    '*://mbasic.facebook.com/*',
    '*://m.facebook.com/',
    '*://m.facebook.com/*/posts/*',
    '*://m.facebook.com/groups/*/posts/*',
    '*://m.facebook.com/reel/*',
    '*://m.facebook.com/*/videos/*',
    '*://m.facebook.com/watch/?v=*',
    '*://m.facebook.com/permalink.php?*',
    '*://m.facebook.com/story.php?*',
    '*://m.facebook.com/share/p/*',
    '*://m.facebook.com/share/r/*',
  ],
  pathnameRegex: /^\/(?:$|reel\/[^/]+\/?|(?:[^/]+\/)?posts\/[^/]+\/?|groups\/[^/]+\/posts\/[^/]+\/?|(?:[^/]+\/)?videos?\/[^/]+\/?|watch\/?|(?:permalink|story|photo)\.php|share\/[pr]\/[^/]+\/?|events\/[^/]+\/?|(?!(?:settings|messages|notifications|marketplace|gaming|friends|groups|events|pages|reels|share|login|logout|help|privacy)(?:\/|$))[^/]+\/?)$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[role="article"] [aria-label*="Share" i]',
      '[role="article"] [aria-label*="Like" i]',
      '[role="article"] [role="toolbar"]',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const postId = getPostId();
    const isFeed = window.location.pathname === '/';
    const article = findActiveArticle(postId);
    const domPost = extractDomPost(article, postId, !isFeed);
    const embeddedPost = postId ? findEmbeddedPost(postId) : null;
    const post = mergePosts(embeddedPost, domPost);
    const comments = extractComments(article || document, post);
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const kind = /\/reel\//.test(window.location.pathname) ? 'reel'
      : /\/videos?\//.test(window.location.pathname) || /^\/watch\/?$/.test(window.location.pathname) ? 'video'
      : isFeed ? 'active feed item' : 'post';
    const title = post.author ? `Facebook ${kind} by ${post.author}`
      : clean(Utils.getMeta('title') || Utils.getPageTitle()) || `Facebook ${kind}`;

    const metadata: Record<string, string | number | undefined> = {
      source: 'Facebook',
      type: kind,
      title,
      author: post.author,
      published_at: post.timestamp,
      reactions: post.reactions,
      comments: post.comments,
      shares: post.shares,
      views: post.views,
      url,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: post.media.length,
      completeness: isFeed
        ? 'active visible feed item only'
        : 'post fields plus comments currently loaded in page',
    };

    const parts: string[] = [`# ${title}`, ''];
    if (post.author) parts.push(`**Author:** ${post.author}`);
    if (post.timestamp) parts.push(`**Published:** ${post.timestamp}`);
    parts.push('');
    if (post.body) parts.push(post.body, '');

    const engagement = [
      ['Reactions', post.reactions], ['Comments', post.comments],
      ['Shares', post.shares], ['Views', post.views],
    ].filter(([, value]) => value).map(([label, value]) => `- **${label}:** ${value}`);
    if (engagement.length) parts.push('## Engagement', '', ...engagement, '');
    if (post.media.length) parts.push('## Media', '', ...post.media.map((item) => `- ${item}`), '');
    if (limitedComments.items.length) {
      parts.push(`## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const knownCommentTotal = parseCount(post.comments);
    const truncated = limitedComments.truncated || limitedBody.truncated
      || (knownCommentTotal !== null && knownCommentTotal > limitedComments.items.length);
    const sources = [embeddedPost && 'Facebook embedded page data', article && 'visible Facebook DOM']
      .filter(Boolean).join(' + ') || 'Facebook Open Graph metadata';
    addExtractionMetadata(metadata, {
      contentSource: sources,
      total: knownCommentTotal ?? comments.length,
      included: limitedComments.items.length,
      truncated,
      complete: !isFeed && knownCommentTotal !== null
        && knownCommentTotal <= comments.length && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limitedBody.markdown);
  },
});

function emptyPost(id = ''): FacebookPost {
  return {
    id, author: '', body: '', timestamp: '', reactions: '', comments: '', shares: '',
    views: '', media: [],
  };
}

function getPostId(): string {
  const path = window.location.pathname;
  return path.match(/\/(?:posts|reel|videos?|share\/[pr])\/([^/?]+)/)?.[1]
    || new URL(window.location.href).searchParams.get('story_fbid')
    || new URL(window.location.href).searchParams.get('fbid')
    || new URL(window.location.href).searchParams.get('id')
    || new URL(window.location.href).searchParams.get('v')
    || '';
}

function findActiveArticle(postId: string): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '[role="article"]', '[data-testid="post-container"]', '[data-pagelet^="FeedUnit_"]',
  ].join(', ')));
  const articles = Array.from(new Set(candidates.map((article) =>
    article.closest('[role="article"]') || article.closest('[data-testid="post-container"]') || article,
  ))).filter((article) => !article.parentElement?.closest('[role="article"]'));
  if (postId) {
    const matching = articles.find((article) => article.querySelector(`a[href*="${cssEscape(postId)}"]`));
    if (matching) return matching;
    if (articles.length === 1) return articles[0];
  }
  return mostVisible(articles) || document.querySelector('[role="main"] [role="article"]') || null;
}

function mostVisible(elements: Element[]): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const area = width * height;
    if (area > bestArea) { best = element; bestArea = area; }
  }
  return best || elements[0] || null;
}

function extractDomPost(article: Element | null, id: string, allowMetadata: boolean): FacebookPost {
  const post = emptyPost(id);
  if (!article) {
    if (allowMetadata) post.body = clean(Utils.getMeta('description'));
    return post;
  }
  post.author = text(article, [
    'header h2 strong', 'header h3 strong', 'h2 a strong', 'h3 a strong',
    '[data-ad-rendering-role="profile_name"]', 'strong a[href]',
  ]);
  post.body = text(article, [
    '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]',
    '[data-testid="post_message"]', '[data-ad-rendering-role="story_message"]',
  ]) || longestOwnText(article, 'div[dir="auto"]');
  if (!post.body && allowMetadata) post.body = clean(Utils.getMeta('description'));
  post.timestamp = attr(article, ['time[datetime]'], 'datetime')
    || timestampFromAbbr(article) || text(article, ['time', 'abbr']);
  post.reactions = engagement(article, /reactions?|likes?/i);
  post.comments = engagement(article, /comments?/i);
  post.shares = engagement(article, /shares?/i);
  post.views = engagement(article, /views?|plays?/i);
  post.media = extractMedia(article);
  return post;
}

function findEmbeddedPost(postId: string): FacebookPost | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[type="application/ld+json"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 10_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* ignore non-JSON state */ }
  }

  for (const payload of payloads) {
    const record = findObject(payload, (candidate) => {
      const ids = [candidate.id, candidate.post_id, candidate.story_fbid, candidate.videoId]
        .filter((value) => typeof value === 'string' || typeof value === 'number')
        .map(String);
      const matchesId = ids.some((id) => id === postId || id.endsWith(`_${postId}`));
      return matchesId && Boolean(candidate.message || candidate.actors || candidate.feedback || candidate.author);
    });
    if (record) return mapEmbeddedRecord(record, postId);

    const ld = findObject(payload, (candidate) =>
      ['VideoObject', 'SocialMediaPosting'].includes(stringValue(candidate['@type']))
      && (stringValue(candidate.url).includes(postId) || stringValue(candidate.mainEntityOfPage).includes(postId)),
    );
    if (ld) return mapLdRecord(ld, postId);
  }
  return null;
}

function mapEmbeddedRecord(record: Record<string, unknown>, id: string): FacebookPost {
  const post = emptyPost(id);
  const actors = Array.isArray(record.actors) ? record.actors : [];
  const firstActor = actors.length && isRecord(actors[0]) ? actors[0] : {};
  const author = isRecord(record.author) ? record.author : isRecord(record.owner) ? record.owner : firstActor;
  const message = record.message;
  const feedback = isRecord(record.feedback) ? record.feedback : {};
  post.author = stringValue(author.name || author.username);
  post.body = isRecord(message) ? stringValue(message.text) : stringValue(message)
    || nestedString(record, ['comet_sections', 'content', 'story', 'message', 'text']);
  post.timestamp = formatTimestamp(record.creation_time || record.publish_time || record.datePublished);
  post.reactions = nestedCount(feedback, ['reaction_count', 'count'], ['reactors', 'count'], ['reaction_count']);
  post.comments = nestedCount(feedback, ['comment_count', 'total_count'], ['comment_count'], ['total_comment_count']);
  post.shares = nestedCount(feedback, ['share_count', 'count'], ['share_count']);
  post.views = nestedCount(record, ['view_count'], ['play_count']);
  post.media = collectAccessibilityText(record).slice(0, 20);
  return post;
}

function mapLdRecord(record: Record<string, unknown>, id: string): FacebookPost {
  const post = emptyPost(id);
  const author = isRecord(record.author) ? record.author : {};
  post.author = stringValue(author.name);
  post.body = stringValue(record.caption || record.description || record.headline);
  post.timestamp = stringValue(record.uploadDate || record.datePublished);
  const thumbnail = stringValue(record.thumbnailUrl);
  if (thumbnail) post.media.push(`Thumbnail: ${thumbnail}`);
  return post;
}

function mergePosts(primary: FacebookPost | null, fallback: FacebookPost): FacebookPost {
  if (!primary) return fallback;
  return {
    id: primary.id || fallback.id,
    author: primary.author || fallback.author,
    body: primary.body || fallback.body,
    timestamp: primary.timestamp || fallback.timestamp,
    reactions: primary.reactions || fallback.reactions,
    comments: primary.comments || fallback.comments,
    shares: primary.shares || fallback.shares,
    views: primary.views || fallback.views,
    media: unique([...primary.media, ...fallback.media]),
  };
}

function extractComments(scope: ParentNode, post: FacebookPost): FacebookComment[] {
  const nodes = scope.querySelectorAll('[role="article"]');
  const comments: FacebookComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    const label = node.getAttribute('aria-label') || '';
    const parentArticle = node.parentElement?.closest('[role="article"]') || null;
    if (node === scope || (!/comment|reply/i.test(label) && !parentArticle)) return;
    const author = text(node, ['h3 a', 'h4 a', 'strong a', 'a[role="link"] strong', 'strong']);
    const body = text(node, [
      '[data-ad-preview="message"]', '[data-ad-comet-preview="message"]',
      '[data-testid="comment_text"]', '[data-ad-rendering-role="comment_message"]',
    ]) || longestOwnText(node, 'div[dir="auto"]');
    if (!body || (author === post.author && body === post.body)) return;
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author: author || 'Anonymous',
      body,
      timestamp: attr(node, ['time[datetime]'], 'datetime') || timestampFromAbbr(node) || text(node, ['time', 'abbr']),
      reactions: engagement(node, /reactions?|likes?/i),
      reply: /reply/i.test(label) || (scope instanceof Element && Boolean(parentArticle) && parentArticle !== scope),
    });
  });
  return comments;
}

function extractMedia(scope: ParentNode): string[] {
  const media: string[] = [];
  scope.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach((image) => {
    const alt = clean(image.alt) || 'Facebook image';
    if (/profile picture|avatar|emoji|sticker|logo|icon/i.test(alt)) return;
    const src = safeHttpUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '');
    const value = src ? `[${escapeLabel(alt)}](${src})` : alt;
    if (!media.includes(value)) media.push(value);
  });
  scope.querySelectorAll('figcaption').forEach((caption) => {
    const value = clean(caption.textContent || '');
    if (value) media.push(value);
  });
  scope.querySelectorAll('video[aria-label]').forEach((video) => {
    const value = clean(video.getAttribute('aria-label') || '');
    const src = safeHttpUrl(video.getAttribute('src') || video.getAttribute('poster') || '');
    if (value || src) media.push(src ? `[${escapeLabel(value || 'Facebook video')}](${src})` : value);
  });
  return unique(media).slice(0, 20);
}

function appendComment(parts: string[], comment: FacebookComment): void {
  const details = [comment.timestamp, comment.reactions ? `${comment.reactions} reactions` : ''].filter(Boolean).join(' · ');
  parts.push(`${comment.reply ? '↳ ' : ''}**${comment.author}**${details ? ` (${details})` : ''}`);
  parts.push(...comment.body.split(/\n+/).map((line) => `> ${line}`), '');
}

function engagement(scope: ParentNode, label: RegExp): string {
  for (const node of scope.querySelectorAll('[aria-label], button, a, span')) {
    const combined = `${node.getAttribute('aria-label') || ''} ${clean(node.textContent || '')}`.trim();
    if (!label.test(combined)) continue;
    const match = combined.match(/[\d,.]+\s*[kmb]?/i);
    if (match) return match[0];
  }
  return '';
}

function longestOwnText(scope: Element, selector: string): string {
  let longest = '';
  scope.querySelectorAll(selector).forEach((node) => {
    const closestArticle = node.closest('[role="article"]');
    if (closestArticle && closestArticle !== scope) return;
    if (node.closest('button, [role="button"], header')) return;
    const value = clean(node.textContent || '');
    if (value.length > longest.length) longest = value;
  });
  return longest;
}

function timestampFromAbbr(scope: ParentNode): string {
  const abbr = scope.querySelector('abbr[data-utime]');
  const value = abbr?.getAttribute('data-utime') || '';
  return value ? formatTimestamp(value) : '';
}

function findObject(root: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 35_000) {
    const current = stack.pop()!;
    if (!isRecord(current.value) && !Array.isArray(current.value)) continue;
    if (isRecord(current.value) && predicate(current.value)) return current.value;
    if (current.depth >= 16) continue;
    Object.values(current.value).forEach((value) => {
      if (value && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    });
  }
  return null;
}

function collectAccessibilityText(root: unknown): string[] {
  const result: string[] = [];
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 5_000 && result.length < 20) {
    const current = stack.pop()!;
    if (isRecord(current.value)) {
      for (const key of ['accessibility_caption', 'accessibilityCaption', 'alt_text', 'alt']) {
        const value = stringValue(current.value[key]);
        if (value) result.push(value);
      }
      for (const key of ['image', 'image_url', 'src', 'thumbnailUrl', 'contentUrl']) {
        const value = stringValue(current.value[key]);
        if (/^https?:\/\//i.test(value) && /\.(?:jpe?g|png|gif|webp|mp4)(?:\?|$)/i.test(value)) {
          result.push(`[Facebook media](${value})`);
        }
      }
    }
    if ((!isRecord(current.value) && !Array.isArray(current.value)) || current.depth >= 10) continue;
    Object.values(current.value).forEach((value) => {
      if (value && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    });
  }
  return unique(result);
}

function nestedString(record: Record<string, unknown>, path: string[]): string {
  let value: unknown = record;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return stringValue(value);
}
function nestedCount(record: Record<string, unknown>, ...paths: string[][]): string {
  for (const path of paths) {
    let value: unknown = record;
    for (const key of path) value = isRecord(value) ? value[key] : undefined;
    if (typeof value === 'number' || typeof value === 'string') return String(value);
  }
  return '';
}
function text(scope: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const value = clean(scope.querySelector(selector)?.textContent || '');
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
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
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
function clean(value: string): string { return Markdown.normalizeWhitespace(value); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function stringValue(value: unknown): string { return typeof value === 'string' ? clean(value) : ''; }
function formatTimestamp(value: unknown): string {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const number = Number(value);
    return new Date(number < 1e12 ? number * 1000 : number).toISOString();
  }
  return stringValue(value);
}
function parseCount(value: string): number | null {
  const match = value.trim().toLowerCase().replace(/,/g, '').match(/([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}
