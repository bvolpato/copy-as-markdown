/**
 * Reddit extractor for posts, subreddit feeds, user pages, and search.
 * Only content represented by the loaded DOM is exported. Reddit virtualizes
 * long feeds, so this avoids claiming history that was not loaded.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const COMMENT_LIMIT = 30;
const MEDIA_LIMIT = 20;

interface RedditPost {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  body: string;
  timestamp: string;
  score: string;
  comments: string;
  media: string[];
}

interface RedditComment {
  author: string;
  body: string;
  timestamp: string;
  score: string;
  depth: number;
}

register({
  name: 'Reddit',
  matches: [
    '*://www.reddit.com/*',
    '*://reddit.com/*',
    '*://old.reddit.com/*',
    '*://new.reddit.com/*',
  ],
  pathnameRegex: /^\/(?:r\/[^/]+(?:\/|$)|comments\/[^/]+(?:\/|$)|user\/[^/]+(?:\/|$)|search(?:\/|$))/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      'shreddit-post [slot="post-actions"]',
      'shreddit-post [slot="action-row"]',
      'shreddit-post .flex',
      '[data-testid="post-actions"]',
      '[data-testid="post-container"] [data-testid="post-actions"]',
      '.Post .flat-list.buttons',
      '.Post .actionBar',
    ].join(', '),
    position: 'overlay',
    style: 'link',
    css: { marginLeft: '8px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' },
    label: 'Copy as Markdown',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = parseRoute();
    const root = findPostRoot(route.id) || findVisiblePost();
    const domPost = extractDomPost(root, route.id);
    const embeddedPost = route.id ? findEmbeddedPost(route.id) : null;
    const post = mergePosts(embeddedPost, domPost);
    const comments = route.id ? extractComments(root || document) : [];
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const kind = route.id ? 'post' : route.kind === 'search' ? 'search results' : 'subreddit feed';
    const title = post.title || Utils.getPageTitle() || `Reddit ${kind}`;

    const metadata: Record<string, string | number | undefined> = {
      source: 'Reddit',
      type: kind,
      title,
      subreddit: post.subreddit,
      author: post.author ? `u/${normalizeAuthor(post.author)}` : '',
      published_at: post.timestamp,
      score: post.score,
      comments: post.comments,
      url,
      post_id: post.id,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: post.media.length,
      completeness: route.id ? 'post fields plus comments currently loaded in page' : 'active visible post only',
    };

    const parts: string[] = [`# ${title}`, ''];
    if (post.subreddit) parts.push(`**Subreddit:** ${post.subreddit}`);
    if (post.author) parts.push(`**Author:** u/${normalizeAuthor(post.author)}`);
    if (post.timestamp) parts.push(`**Published:** ${post.timestamp}`);
    if (post.score) parts.push(`**Score:** ${post.score}`);
    if (post.body) parts.push('', '## Post Content', '', post.body);
    if (post.media.length) parts.push('', '## Media', '', ...post.media.map((item) => `- ${item}`));
    if (limitedComments.items.length) {
      parts.push('', `## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const knownCommentTotal = parseCount(post.comments);
    addExtractionMetadata(metadata, {
      contentSource: [embeddedPost && 'Reddit page data', root && 'visible Reddit DOM']
        .filter(Boolean).join(' + ') || 'Reddit page metadata',
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

function parseRoute(): { id: string; kind: 'post' | 'feed' | 'search' } {
  const path = window.location.pathname;
  const match = path.match(/(?:^|\/)comments\/([^/]+)/) || path.match(/^\/comments\/([^/]+)/);
  if (match) return { id: match[1], kind: 'post' };
  if (/^\/search(?:\/|$)/.test(path)) return { id: '', kind: 'search' };
  return { id: '', kind: 'feed' };
}

function emptyPost(id = ''): RedditPost {
  return { id, title: '', subreddit: '', author: '', body: '', timestamp: '', score: '', comments: '', media: [] };
}

function findPostRoot(id: string): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    'shreddit-post', '[data-testid="post-container"]', 'article[data-testid="post-container"]',
    '[data-post-id]', '.Post', '[data-testid="post"]',
  ].join(', ')));
  if (!id) return null;
  return candidates.find((candidate) => {
    const ids = [candidate.id, candidate.getAttribute('data-post-id') || '', candidate.getAttribute('id') || ''];
    return ids.some((value) => value === id || value.endsWith(`_${id}`) || value.includes(`t3_${id}`))
      || Array.from(candidate.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .some((link) => link.href.includes(`/comments/${id}`));
  }) || (candidates.length === 1 ? candidates[0] : null);
}

function findVisiblePost(): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    'shreddit-post', '[data-testid="post-container"]', 'article[data-testid="post-container"]',
    '[data-post-id]', '.Post', '[data-testid="post"]',
  ].join(', ')));
  return mostVisible(candidates);
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

function extractDomPost(root: Element | null, id: string): RedditPost {
  const post = emptyPost(id);
  if (!root) {
    post.title = clean(Utils.getMeta('title') || Utils.getPageTitle());
    post.body = clean(Utils.getMeta('description'));
    post.subreddit = window.location.pathname.match(/^\/r\/([^/]+)/)?.[1] || '';
    return post;
  }
  post.id = post.id || root.getAttribute('id')?.replace(/^t3_/, '') || root.getAttribute('data-post-id') || '';
  post.title = text(root, [
    'h1', '[data-testid="post-title"]', '[slot="title"]', '.title',
  ]) || clean(root.getAttribute('post-title') || '');
  post.subreddit = root.getAttribute('subreddit-prefixed-name')
    || text(root, ['a[href^="/r/"]', '[data-testid="subreddit-name"]'])
    || window.location.pathname.match(/^\/r\/([^/]+)/)?.[1] || '';
  post.author = root.getAttribute('author') || text(root, [
    '[data-testid="post_author_link"]', '[data-testid="post-author"]', '.author',
    'a[href*="/user/"]', '.Post__author',
  ]);
  post.score = root.getAttribute('score') || text(root, [
    '[data-testid="post-score"]', '[data-testid="post-vote-count"]', '.score', '.likes',
  ]) || count(root, /point|score|upvote/i);
  post.comments = root.getAttribute('comment-count') || text(root, [
    '[data-testid="comment-count"]', '[data-testid="post-comment-count"]', '.comments',
  ]) || count(root, /comment/i);
  post.timestamp = attr(root, ['time[datetime]'], 'datetime') || text(root, ['time', '[data-testid="post_timestamp"]']);
  const bodyEl = root.querySelector(
    '[slot="text-body"], [data-testid="post-content"], [data-testid="post-selftext"], .RichTextJSON-root, .expando .md, .usertext-body',
  );
  if (bodyEl) {
    const cleaned = Utils.removeNoise(bodyEl, ['script', 'style', 'button', 'svg', '[aria-hidden="true"]']);
    post.body = Markdown.elementToMarkdown(cleaned).trim();
  }
  if (!post.body) post.body = clean(Utils.getMeta('description'));
  post.media = extractMedia(root);
  return post;
}

function extractComments(scope: ParentNode): RedditComment[] {
  const nodes = scope.querySelectorAll<HTMLElement>([
    'shreddit-comment', '.Comment', '[data-testid="comment"]', '[data-testid="comment-tree-item"]',
  ].join(', '));
  const comments: RedditComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    const bodyEl = node.querySelector('[slot="comment"], [data-testid="comment-body"], .md, [data-testid="comment-content"]');
    if (!bodyEl) return;
    const body = Markdown.elementToMarkdown(Utils.removeNoise(bodyEl, ['script', 'style', 'button', 'svg'])).trim();
    if (!body) return;
    const author = (node.getAttribute('author') || text(node, [
      '[data-testid="comment_author_link"]', '[data-testid="comment-author"]', '.author', 'a[href*="/user/"]',
    ])).trim();
    const score = node.getAttribute('score') || text(node, ['[data-testid="comment-score"]', '.score']);
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author: author || 'Anonymous',
      body,
      timestamp: attr(node, ['time[datetime]'], 'datetime') || text(node, ['time']),
      score,
      depth: Math.min(Number.parseInt(node.getAttribute('depth') || '0', 10) || 0, 3),
    });
  });
  return comments;
}

function appendComment(parts: string[], comment: RedditComment): void {
  const indent = '> '.repeat(comment.depth);
  const details = [comment.timestamp, comment.score ? `${comment.score} points` : ''].filter(Boolean).join(' · ');
  parts.push(`${indent}**${comment.author}**${details ? ` (${details})` : ''}:`);
  const lines = comment.body.split(/\n+/).map((line) => `${indent}> ${line}`);
  parts.push(...lines, '');
}

function extractMedia(scope: ParentNode): string[] {
  const media: string[] = [];
  scope.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach((image) => {
    const alt = clean(image.alt) || 'Reddit image';
    if (/avatar|profile|icon|emoji|logo/i.test(alt)) return;
    const src = safeHttpUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '');
    const value = src ? `[${escapeLabel(alt)}](${src})` : alt;
    if (!media.includes(value)) media.push(value);
  });
  scope.querySelectorAll<HTMLVideoElement>('video[src], video[poster]').forEach((video) => {
    const src = safeHttpUrl(video.currentSrc || video.src || video.poster || '');
    if (src && !media.includes(src)) media.push(`[Reddit video](${src})`);
  });
  return media.slice(0, MEDIA_LIMIT);
}

function findEmbeddedPost(id: string): RedditPost | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[type="application/ld+json"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* non-JSON script */ }
  }
  for (const payload of payloads) {
    const record = findObject(payload, (candidate) => {
      const candidateId = stringValue(candidate.id || candidate.postId || candidate.name);
      return candidateId === id || candidateId.includes(`t3_${id}`);
    });
    if (record) return mapEmbeddedPost(record, id);
    const ld = findObject(payload, (candidate) =>
      ['DiscussionForumPosting', 'SocialMediaPosting', 'Article'].includes(stringValue(candidate['@type']))
      && (stringValue(candidate.url).includes(`/comments/${id}`) || stringValue(candidate.mainEntityOfPage).includes(id)),
    );
    if (ld) return mapLdPost(ld, id);
  }
  return null;
}

function mapEmbeddedPost(record: Record<string, unknown>, id: string): RedditPost {
  const post = emptyPost(id);
  const author = isRecord(record.author) ? record.author : {};
  post.title = stringValue(record.title || record.name || record.headline);
  post.subreddit = stringValue(record.subreddit || record.communityName || record.subredditName);
  post.author = stringValue(author.name || author.username || record.authorName);
  post.body = stringValue(record.selftext || record.body || record.text || record.description);
  post.timestamp = formatTimestamp(record.created_utc || record.created || record.datePublished);
  post.score = nestedCount(record, ['score'], ['ups'], ['likes']);
  post.comments = nestedCount(record, ['num_comments'], ['comments', 'count']);
  const image = stringValue(record.url_overridden_by_dest || record.thumbnail || record.image || record.thumbnailUrl);
  const imageUrl = safeHttpUrl(image);
  if (imageUrl && !/self|default/i.test(imageUrl)) {
    post.media.push(`[Reddit media](${imageUrl})`);
  }
  return post;
}

function mapLdPost(record: Record<string, unknown>, id: string): RedditPost {
  const post = emptyPost(id);
  const author = isRecord(record.author) ? record.author : {};
  post.title = stringValue(record.headline || record.name);
  post.body = stringValue(record.articleBody || record.description);
  post.author = stringValue(author.name || author.alternateName);
  post.timestamp = stringValue(record.datePublished || record.dateCreated);
  const image = stringValue(record.image || record.thumbnailUrl);
  const imageUrl = safeHttpUrl(image);
  if (imageUrl) post.media.push(`[Reddit image](${imageUrl})`);
  return post;
}

function mergePosts(primary: RedditPost | null, fallback: RedditPost): RedditPost {
  if (!primary) return fallback;
  return {
    id: primary.id || fallback.id,
    title: primary.title || fallback.title,
    subreddit: primary.subreddit || fallback.subreddit,
    author: primary.author || fallback.author,
    body: primary.body || fallback.body,
    timestamp: primary.timestamp || fallback.timestamp,
    score: primary.score || fallback.score,
    comments: primary.comments || fallback.comments,
    media: [...new Set([...primary.media, ...fallback.media])].slice(0, MEDIA_LIMIT),
  };
}

function count(scope: ParentNode, label: RegExp): string {
  for (const node of scope.querySelectorAll<HTMLElement>('[aria-label], button, a, span')) {
    const combined = `${node.getAttribute('aria-label') || ''} ${clean(node.textContent || '')}`;
    if (!label.test(combined)) continue;
    const match = combined.match(/[\d,.]+\s*[kmb]?/i);
    if (match) return match[0];
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

function normalizeAuthor(value: string): string { return value.replace(/^u\//, '').trim(); }
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
function stringValue(value: unknown): string { return typeof value === 'string' ? clean(value) : ''; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function nestedCount(record: Record<string, unknown>, ...paths: string[][]): string {
  for (const path of paths) {
    let value: unknown = record;
    for (const key of path) value = isRecord(value) ? value[key] : undefined;
    if (typeof value === 'number' || typeof value === 'string') return String(value);
  }
  return '';
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
