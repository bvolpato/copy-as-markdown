/**
 * Instagram extractor for posts, reels, legacy IGTV, and the active feed item.
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';
import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';

const COMMENT_LIMIT = 30;

interface InstagramPost {
  shortcode: string;
  author: string;
  authorName: string;
  caption: string;
  timestamp: string;
  likes: string;
  comments: string;
  views: string;
  media: string[];
}

interface InstagramComment {
  author: string;
  body: string;
  timestamp: string;
  likes: string;
  reply: boolean;
}

register({
  name: 'Instagram',
  matches: [
    '*://www.instagram.com/*',
    '*://instagram.com/*',
  ],
  pathnameRegex: /^\/(?:|(?:p|reel|tv)\/[^/]+\/?)$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      'article section',
      'article header [role="button"]',
      'main article',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = window.location.pathname.match(/^\/(p|reel|tv)\/([^/]+)/);
    const routeType = route?.[1] || 'feed';
    const shortcode = route?.[2] || '';
    const article = findActiveArticle(shortcode);
    const domPost = extractDomPost(article, shortcode);
    const embeddedPost = shortcode ? findEmbeddedPost(shortcode) : null;
    const post = mergePosts(embeddedPost, domPost);
    const comments = extractComments(article || document, post);
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const title = post.author ? `Instagram ${routeType === 'reel' ? 'reel' : 'post'} by @${post.author}` : 'Instagram post';

    const metadata: Record<string, string | number | undefined> = {
      source: 'Instagram',
      type: routeType === 'feed' ? 'active feed item' : routeType === 'reel' ? 'reel' : routeType === 'tv' ? 'IGTV video' : 'post',
      title,
      author: post.author ? `@${post.author}` : '',
      author_name: post.authorName,
      published_at: post.timestamp,
      likes: post.likes,
      comments: post.comments,
      views: post.views,
      url,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: post.media.length,
      completeness: shortcode
        ? 'post fields plus comments currently loaded in page'
        : 'active visible feed item only',
    };

    const parts: string[] = [`# ${title}`, ''];
    if (post.authorName) parts.push(`**Name:** ${post.authorName}`);
    if (post.author) parts.push(`**Handle:** @${post.author}`);
    if (post.timestamp) parts.push(`**Published:** ${post.timestamp}`);
    parts.push('');
    if (post.caption) parts.push(post.caption, '');

    const engagement = [
      ['Likes', post.likes], ['Comments', post.comments], ['Views', post.views],
    ].filter(([, value]) => value).map(([label, value]) => `- **${label}:** ${value}`);
    if (engagement.length) parts.push('## Engagement', '', ...engagement, '');
    if (post.media.length) parts.push('## Media', '', ...post.media.map((alt) => `- ${alt}`), '');
    if (limitedComments.items.length) {
      parts.push(`## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const knownCommentTotal = parseCount(post.comments);
    const truncated = limitedComments.truncated || limitedBody.truncated
      || (knownCommentTotal !== null && knownCommentTotal > limitedComments.items.length);
    const sources = [embeddedPost && 'Instagram embedded page data', article && 'visible Instagram DOM']
      .filter(Boolean).join(' + ') || 'Instagram Open Graph metadata';
    addExtractionMetadata(metadata, {
      contentSource: sources,
      total: knownCommentTotal ?? comments.length,
      included: limitedComments.items.length,
      truncated,
      complete: Boolean(shortcode) && knownCommentTotal !== null
        && knownCommentTotal <= comments.length && !truncated,
    });
    return Markdown.buildPageMarkdown(metadata, limitedBody.markdown);
  },
});

function emptyPost(shortcode = ''): InstagramPost {
  return {
    shortcode, author: '', authorName: '', caption: '', timestamp: '', likes: '',
    comments: '', views: '', media: [],
  };
}

function findActiveArticle(shortcode: string): Element | null {
  const articles = Array.from(document.querySelectorAll('main article, article'));
  if (shortcode) {
    const match = articles.find((article) =>
      article.querySelector(`a[href*="/p/${shortcode}"], a[href*="/reel/${shortcode}"], a[href*="/tv/${shortcode}"]`),
    );
    if (match) return match;
    if (articles.length === 1) return articles[0];
  }
  return mostVisible(articles) || document.querySelector('main article') || null;
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

function extractDomPost(article: Element | null, shortcode: string): InstagramPost {
  const post = emptyPost(shortcode);
  if (!article) {
    post.caption = clean(Utils.getMeta('description'));
    return post;
  }

  const authorLink = article.querySelector<HTMLAnchorElement>('header a[href^="/"], a[href^="/"][role="link"]');
  post.author = clean(authorLink?.getAttribute('href')?.split('/').filter(Boolean)[0] || authorLink?.textContent || '').replace(/^@/, '');
  post.authorName = attr(article, ['header img[alt]'], 'alt').replace(/['’]s profile picture.*$/i, '').trim();
  post.caption = text(article, ['h1', '[data-testid="post-caption"]', 'section + div h1']);
  post.timestamp = attr(article, ['time[datetime]'], 'datetime') || text(article, ['time']);
  post.likes = engagementFromDom(article, /likes?/i, ['section button', 'a[href$="/liked_by/"]', '[data-testid="like-count"]']);
  post.comments = engagementFromDom(article, /comments?/i, ['a[href*="comments"]', 'button', '[data-testid="comment-count"]']);
  post.views = engagementFromDom(article, /views?|plays?/i, ['span', 'div']);
  post.media = unique(Array.from(article.querySelectorAll<HTMLImageElement>('img[alt]'))
    .map((image) => clean(image.alt))
    .filter((alt) => alt && !/profile picture|avatar|emoji/i.test(alt))).slice(0, 20);
  article.querySelectorAll('figcaption').forEach((caption) => {
    const value = clean(caption.textContent || '');
    if (value) post.media.push(value);
  });
  post.media = unique(post.media).slice(0, 20);
  return post;
}

function findEmbeddedPost(shortcode: string): InstagramPost | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[type="application/ld+json"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* ignore non-JSON state */ }
  }

  for (const payload of payloads) {
    const record = findObject(payload, (candidate) => {
      const code = stringValue(candidate.shortcode || candidate.code);
      return code === shortcode && Boolean(
        candidate.caption || candidate.owner || candidate.user || candidate.edge_media_to_caption,
      );
    });
    if (record) return mapMediaRecord(record, shortcode);

    const ld = findObject(payload, (candidate) =>
      ['VideoObject', 'ImageObject', 'SocialMediaPosting'].includes(stringValue(candidate['@type']))
      && (stringValue(candidate.url).includes(shortcode) || stringValue(candidate.mainEntityOfPage).includes(shortcode)),
    );
    if (ld) return mapLdRecord(ld, shortcode);
  }
  return null;
}

function mapMediaRecord(record: Record<string, unknown>, shortcode: string): InstagramPost {
  const post = emptyPost(shortcode);
  const owner = isRecord(record.owner) ? record.owner : isRecord(record.user) ? record.user : {};
  const caption = record.caption;
  const edges = getNestedArray(record, ['edge_media_to_caption', 'edges']);
  const firstCaptionNode = edges.length && isRecord(edges[0]) && isRecord(edges[0].node) ? edges[0].node : {};
  post.author = stringValue(owner.username || record.username);
  post.authorName = stringValue(owner.full_name || owner.fullName);
  post.caption = isRecord(caption) ? stringValue(caption.text) : stringValue(caption)
    || stringValue(firstCaptionNode.text) || stringValue(record.description);
  post.timestamp = formatTimestamp(record.taken_at || record.taken_at_timestamp || record.datePublished);
  post.likes = nestedCount(record, ['like_count'], ['edge_media_preview_like', 'count'], ['edge_liked_by', 'count']);
  post.comments = nestedCount(record, ['comment_count'], ['edge_media_to_parent_comment', 'count'], ['edge_media_to_comment', 'count']);
  post.views = nestedCount(record, ['video_view_count'], ['video_play_count'], ['play_count']);
  const directAlt = stringValue(record.accessibility_caption || record.accessibilityCaption || record.alt);
  if (directAlt) post.media.push(directAlt);

  const carousel = Array.isArray(record.carousel_media) ? record.carousel_media : [];
  const sidecar = getNestedArray(record, ['edge_sidecar_to_children', 'edges'])
    .map((edge) => isRecord(edge) && isRecord(edge.node) ? edge.node : edge);
  [...carousel, ...sidecar].forEach((entry) => {
    if (!isRecord(entry)) return;
    const alt = stringValue(entry.accessibility_caption || entry.accessibilityCaption || entry.alt);
    if (alt) post.media.push(alt);
  });
  post.media = unique(post.media).slice(0, 20);
  return post;
}

function mapLdRecord(record: Record<string, unknown>, shortcode: string): InstagramPost {
  const post = emptyPost(shortcode);
  const author = isRecord(record.author) ? record.author : {};
  post.author = stringValue(author.alternateName || author.name).replace(/^@/, '');
  post.authorName = stringValue(author.name);
  post.caption = stringValue(record.caption || record.description || record.headline);
  post.timestamp = stringValue(record.uploadDate || record.datePublished);
  const stats = Array.isArray(record.interactionStatistic) ? record.interactionStatistic : [];
  stats.forEach((entry) => {
    if (!isRecord(entry)) return;
    const kindRecord = isRecord(entry.interactionType) ? entry.interactionType : {};
    const kind = stringValue(kindRecord['@type'] || entry.interactionType);
    const count = countValue(entry.userInteractionCount || entry.interactionCount);
    if (/like/i.test(kind)) post.likes = count;
    else if (/comment/i.test(kind)) post.comments = count;
    else if (/watch|view/i.test(kind)) post.views = count;
  });
  const thumbnail = record.thumbnailUrl;
  if (typeof thumbnail === 'string') post.media.push(`Thumbnail: ${thumbnail}`);
  return post;
}

function mergePosts(primary: InstagramPost | null, fallback: InstagramPost): InstagramPost {
  if (!primary) return fallback;
  return {
    shortcode: primary.shortcode || fallback.shortcode,
    author: primary.author || fallback.author,
    authorName: primary.authorName || fallback.authorName,
    caption: primary.caption || fallback.caption,
    timestamp: primary.timestamp || fallback.timestamp,
    likes: primary.likes || fallback.likes,
    comments: primary.comments || fallback.comments,
    views: primary.views || fallback.views,
    media: unique([...primary.media, ...fallback.media]),
  };
}

function extractComments(scope: ParentNode, post: InstagramPost): InstagramComment[] {
  const nodes = scope.querySelectorAll('[data-testid="comment"], ul li');
  const comments: InstagramComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    const timeEl = node.querySelector('time');
    const authorLink = node.querySelector<HTMLAnchorElement>('h3 a[href^="/"], a[href^="/"]');
    const author = clean(authorLink?.textContent || '').replace(/^@/, '');
    const candidates = Array.from(node.querySelectorAll('span'))
      .map((span) => clean(span.textContent || ''))
      .filter((value) => value && value !== author);
    const body = candidates.sort((a, b) => b.length - a.length)[0] || '';
    if (!author || !body || (!timeEl && !node.matches('[data-testid="comment"]'))) return;
    if (author === post.author && body === post.caption) return;
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author,
      body,
      timestamp: timeEl?.getAttribute('datetime') || clean(timeEl?.textContent || ''),
      likes: text(node, ['button[aria-label*="like" i] + span', '[data-testid="comment-like-count"]']),
      reply: Boolean(node.parentElement?.closest('li')),
    });
  });
  return comments;
}

function appendComment(parts: string[], comment: InstagramComment): void {
  const details = [comment.timestamp, comment.likes ? `${comment.likes} likes` : ''].filter(Boolean).join(' · ');
  parts.push(`${comment.reply ? '↳ ' : ''}**@${comment.author}**${details ? ` (${details})` : ''}`);
  parts.push(...comment.body.split(/\n+/).map((line) => `> ${line}`), '');
}

function engagementFromDom(scope: ParentNode, label: RegExp, selectors: string[]): string {
  for (const selector of selectors) {
    for (const node of scope.querySelectorAll(selector)) {
      const textValue = clean(node.textContent || '');
      const aria = node.getAttribute('aria-label') || '';
      const combined = `${aria} ${textValue}`.trim();
      if (!label.test(combined)) continue;
      const match = combined.match(/[\d,.]+\s*[kmb]?/i);
      if (match) return match[0];
    }
  }
  return '';
}

function findObject(root: unknown, predicate: (value: Record<string, unknown>) => boolean): Record<string, unknown> | null {
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

function getNestedArray(record: Record<string, unknown>, path: string[]): unknown[] {
  let value: unknown = record;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return Array.isArray(value) ? value : [];
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
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10}$/.test(value))) {
    return new Date(Number(value) * 1000).toISOString();
  }
  return stringValue(value);
}
function parseCount(value: string): number | null {
  const match = value.trim().toLowerCase().replace(/,/g, '').match(/([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}
