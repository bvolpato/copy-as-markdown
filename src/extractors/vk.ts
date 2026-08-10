/**
 * VK extractor for wall posts, video pages, profiles, and loaded feeds.
 * VK serves several DOM generations at once, so selectors stay semantic and
 * post selection is scoped to the route id whenever one is available.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const COMMENT_LIMIT = 30;
const MEDIA_LIMIT = 20;

interface VkPost {
  id: string;
  title: string;
  body: string;
  author: string;
  timestamp: string;
  likes: string;
  comments: string;
  shares: string;
  views: string;
  media: string[];
}

interface VkComment {
  author: string;
  body: string;
  timestamp: string;
  likes: string;
  reply: boolean;
}

register({
  name: 'VK',
  matches: [
    '*://vk.com/*',
    '*://www.vk.com/*',
    '*://m.vk.com/*',
    '*://vk.ru/*',
    '*://www.vk.ru/*',
  ],
  pathnameRegex: /^\/(?:$|wall-?\d+_\d+(?:\/|$)|[^/]+\/wall-?\d+_\d+(?:\/|$)|feed(?:\/|$)|id\d+(?:\/|$)|club\d+(?:\/|$)|public\d+(?:\/|$)|video(?:-?\d+_\d+|\/\d+)(?:\/|$)|@[^/]+(?:\/|$)|groups(?:\/|$))$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '.post_info .post_actions',
      '.post_actions',
      '.PostBottomAction',
      '.vkitPostActions',
      '.wall_post .like_btn',
      '[data-testid="post-actions"]',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = parseRoute();
    const active = findActivePost(route.id);
    const domPost = extractDomPost(active, route.id);
    const embeddedPost = route.id ? findEmbeddedPost(route.id) : null;
    const post = mergePosts(embeddedPost, domPost);
    const comments = extractComments(active || document);
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const kind = route.kind === 'video' ? 'video' : route.id ? 'wall post' : route.kind === 'profile' ? 'profile' : 'feed';
    const title = post.title || (post.author ? `VK ${kind} by ${post.author}` : Utils.getPageTitle() || `VK ${kind}`);

    const metadata: Record<string, string | number | undefined> = {
      source: 'VK',
      type: kind,
      title,
      author: post.author,
      published_at: post.timestamp,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      views: post.views,
      url,
      post_id: post.id,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: post.media.length,
      completeness: route.id
        ? 'post fields plus comments currently loaded in page'
        : 'active visible feed item only',
    };

    const parts: string[] = [`# ${title}`, ''];
    if (post.author) parts.push(`**Author:** ${post.author}`);
    if (post.timestamp) parts.push(`**Published:** ${post.timestamp}`);
    if (post.body) parts.push('', post.body);

    const engagement = [
      ['Likes', post.likes], ['Comments', post.comments], ['Shares', post.shares], ['Views', post.views],
    ].filter(([, value]) => value).map(([label, value]) => `- **${label}:** ${value}`);
    if (engagement.length) parts.push('', '## Engagement', '', ...engagement);
    if (post.media.length) parts.push('', '## Media', '', ...post.media.map((item) => `- ${item}`));
    if (limitedComments.items.length) {
      parts.push('', `## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const knownCommentTotal = parseCount(post.comments);
    addExtractionMetadata(metadata, {
      contentSource: [embeddedPost && 'VK page data', active && 'visible VK DOM']
        .filter(Boolean).join(' + ') || 'VK page metadata',
      total: knownCommentTotal ?? comments.length,
      included: limitedComments.items.length,
      truncated: limitedComments.truncated || limitedBody.truncated
        || (knownCommentTotal !== null && knownCommentTotal > limitedComments.items.length),
      complete: Boolean(route.id) && knownCommentTotal !== null
        && knownCommentTotal <= comments.length && !limitedBody.truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limitedBody.markdown);
  },
});

function parseRoute(): { id: string; kind: 'post' | 'video' | 'profile' | 'feed' } {
  const path = window.location.pathname;
  const wall = path.match(/\/wall(-?\d+_\d+)/);
  if (wall) return { id: wall[1], kind: 'post' };
  const video = path.match(/\/video(?:-?\d+_\d+|\/\d+)/);
  if (video) return { id: video[0].replace(/^\/video/, '').replace(/^\//, ''), kind: 'video' };
  if (/^\/(?:id\d+|club\d+|public\d+|@[^/]+)/.test(path)) return { id: '', kind: 'profile' };
  return { id: '', kind: 'feed' };
}

function emptyPost(id = ''): VkPost {
  return { id, title: '', body: '', author: '', timestamp: '', likes: '', comments: '', shares: '', views: '', media: [] };
}

function findActivePost(id: string): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '[data-post-id]', '[data-post]', '.post', '.feed_row', '.wall_post',
    'article', '[id^="post-"]', '[id^="wpt"]',
  ].join(', ')));
  if (id) {
    const normalized = id.replace(/^wall/, '');
    const match = candidates.find((candidate) => {
      const values = [
        candidate.getAttribute('data-post-id') || '', candidate.getAttribute('data-post') || '', candidate.id,
      ];
      return values.some((value) => value.includes(id) || value.includes(normalized))
        || Array.from(candidate.querySelectorAll<HTMLAnchorElement>('a[href]')).some((link) => link.href.includes(`wall${id}`));
    });
    if (match) return match;
    if (candidates.length === 1) return candidates[0];
  }
  return mostVisible(candidates) || document.querySelector('main') || null;
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

function extractDomPost(scope: Element | null, id: string): VkPost {
  const post = emptyPost(id);
  if (!scope) {
    post.title = clean(Utils.getMeta('title') || Utils.getPageTitle());
    post.body = clean(Utils.getMeta('description'));
    return post;
  }
  post.title = text(scope, ['h1', '[data-testid="post-title"]', '.post_title']);
  post.author = text(scope, [
    '.post_author', '.post_author_link', '.post_info .author',
    '[data-testid="post-author"]', 'a[href*="/id"]', 'a[href*="/club"]',
  ]);
  post.body = text(scope, [
    '.wall_post_text', '.post_text', '[data-testid="post-text"]',
    '.wall_post_text_content', '[class*="PostText"]',
  ]);
  post.timestamp = attr(scope, ['time[datetime]'], 'datetime') || text(scope, ['.rel_date', '.post_date', 'time']);
  post.likes = count(scope, /like|нрав/i);
  post.comments = count(scope, /comment|коммент/i);
  post.shares = count(scope, /share|подел/i);
  post.views = count(scope, /view|просмотр/i);
  post.media = extractMedia(scope);
  return post;
}

function extractComments(scope: ParentNode): VkComment[] {
  const nodes = scope.querySelectorAll<HTMLElement>([
    '.reply', '.Comment', '[data-testid="comment"]', '[data-comment-id]',
    '.reply_wrap', '.reply_replies .reply',
  ].join(', '));
  const comments: VkComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    const body = text(node, ['.reply_text', '.comment_text', '[data-testid="comment-text"]', '[class*="CommentText"]', 'p']);
    if (!body) return;
    const author = text(node, ['.reply_author', '.comment_author', '[data-testid="comment-author"]', 'a[href*="id"]', 'a[href*="club"]']);
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author: author || 'Anonymous',
      body,
      timestamp: attr(node, ['time[datetime]'], 'datetime') || text(node, ['.rel_date', '.reply_date', 'time']),
      likes: count(node, /like|нрав/i),
      reply: Boolean(node.closest('.reply_replies')),
    });
  });
  return comments;
}

function appendComment(parts: string[], comment: VkComment): void {
  const details = [comment.timestamp, comment.likes ? `${comment.likes} likes` : ''].filter(Boolean).join(' · ');
  parts.push(`${comment.reply ? '↳ ' : ''}**${comment.author}**${details ? ` (${details})` : ''}`);
  parts.push(...comment.body.split(/\n+/).map((line) => `> ${line}`), '');
}

function extractMedia(scope: ParentNode): string[] {
  const media: string[] = [];
  scope.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach((image) => {
    const alt = clean(image.alt) || 'VK image';
    if (/avatar|profile|logo|icon/i.test(alt)) return;
    const src = safeHttpUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '');
    const value = src ? `[${escapeLabel(alt)}](${src})` : alt;
    if (!media.includes(value)) media.push(value);
  });
  scope.querySelectorAll<HTMLVideoElement>('video[src], video[poster]').forEach((video) => {
    const src = safeHttpUrl(video.currentSrc || video.src || video.poster || '');
    if (src && !media.includes(src)) media.push(`[VK video](${src})`);
  });
  return media.slice(0, MEDIA_LIMIT);
}

function findEmbeddedPost(id: string): VkPost | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[type="application/ld+json"], script[id*="initial" i], script[id*="state" i]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* VK may include non-JSON scripts */ }
  }
  for (const payload of payloads) {
    const record = findObject(payload, (candidate) => {
      const candidateId = stringValue(candidate.id || candidate.post_id || candidate.postId);
      return candidateId === id || candidateId.endsWith(`_${id.split('_').pop() || ''}`);
    });
    if (record) return mapEmbeddedPost(record, id);
    const ld = findObject(payload, (candidate) =>
      ['SocialMediaPosting', 'VideoObject', 'Article'].includes(stringValue(candidate['@type']))
      && (stringValue(candidate.url).includes(id) || stringValue(candidate.mainEntityOfPage).includes(id)),
    );
    if (ld) return mapLdPost(ld, id);
  }
  return null;
}

function mapEmbeddedPost(record: Record<string, unknown>, id: string): VkPost {
  const post = emptyPost(id);
  const author = isRecord(record.author) ? record.author : isRecord(record.owner) ? record.owner : {};
  post.title = stringValue(record.title || record.name || record.headline);
  post.body = stringValue(record.text || record.body || record.description || record.caption);
  post.author = stringValue(author.name || author.nickname || record.author_name || record.owner_name);
  post.timestamp = formatTimestamp(record.datePublished || record.date || record.dateCreated || record.time);
  post.likes = nestedCount(record, ['likes', 'count'], ['like_count'], ['likes_count']);
  post.comments = nestedCount(record, ['comments', 'count'], ['comment_count'], ['comments_count']);
  post.shares = nestedCount(record, ['reposts', 'count'], ['share_count'], ['shares_count']);
  post.views = nestedCount(record, ['views', 'count'], ['views_count'], ['view_count']);
  const image = stringValue(record.image || record.image_url || record.thumbnailUrl);
  const imageUrl = safeHttpUrl(image);
  if (imageUrl) post.media.push(`[VK image](${imageUrl})`);
  return post;
}

function mapLdPost(record: Record<string, unknown>, id: string): VkPost {
  const post = emptyPost(id);
  const author = isRecord(record.author) ? record.author : {};
  post.title = stringValue(record.headline || record.name || record.caption);
  post.body = stringValue(record.description || record.caption);
  post.author = stringValue(author.name || author.alternateName);
  post.timestamp = stringValue(record.datePublished || record.uploadDate);
  const image = stringValue(record.contentUrl || record.thumbnailUrl || record.image);
  const imageUrl = safeHttpUrl(image);
  if (imageUrl) post.media.push(`[VK image](${imageUrl})`);
  return post;
}

function mergePosts(primary: VkPost | null, fallback: VkPost): VkPost {
  if (!primary) return fallback;
  return {
    id: primary.id || fallback.id,
    title: primary.title || fallback.title,
    body: primary.body || fallback.body,
    author: primary.author || fallback.author,
    timestamp: primary.timestamp || fallback.timestamp,
    likes: primary.likes || fallback.likes,
    comments: primary.comments || fallback.comments,
    shares: primary.shares || fallback.shares,
    views: primary.views || fallback.views,
    media: unique([...primary.media, ...fallback.media]).slice(0, MEDIA_LIMIT),
  };
}

function count(scope: ParentNode, label: RegExp): string {
  for (const node of scope.querySelectorAll<HTMLElement>('[aria-label], button, a, span')) {
    const combined = `${node.getAttribute('aria-label') || ''} ${clean(node.textContent || '')}`.trim();
    if (!label.test(combined)) continue;
    const match = combined.match(/[\d,.]+\s*[kmb]?/i);
    if (match) return match[0];
  }
  return '';
}

function nestedCount(record: Record<string, unknown>, ...paths: string[][]): string {
  for (const path of paths) {
    let value: unknown = record;
    for (const key of path) value = isRecord(value) ? value[key] : undefined;
    if (typeof value === 'number' || typeof value === 'string') return String(value);
  }
  return '';
}

function findObject(root: unknown, predicate: (record: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 30_000) {
    const current = stack.pop()!;
    if (!isRecord(current.value) && !Array.isArray(current.value)) continue;
    if (isRecord(current.value) && predicate(current.value)) return current.value;
    if (current.depth >= 15) continue;
    Object.values(current.value).forEach((value) => {
      if (value && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    });
  }
  return null;
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
function stringValue(value: unknown): string { return typeof value === 'string' ? clean(value) : ''; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
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
