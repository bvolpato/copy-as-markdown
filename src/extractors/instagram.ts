/**
 * Instagram extractor for posts, reels, profiles, legacy IGTV, and the active feed item.
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
  pathnameRegex: /^\/(?:|(?:[^/]+\/)?(?:p|reel|reels|tv)\/[^/]+\/?|(?!(?:explore|direct|accounts|stories|reels|reel|p|tv|legal|about|developer|directory|api|graphql|challenge|session)(?:\/|$))[A-Za-z0-9._]{1,30}\/?)$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      'article section',
      'article header [role="button"]',
      'main article',
      'main header section',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const pathname = window.location.pathname;
    const route = pathname.match(/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/([^/]+)/);
    const rawRouteType = route?.[1] || (pathname === '/' ? 'feed' : 'profile');
    const routeType = rawRouteType === 'reels' ? 'reel' : rawRouteType;
    const shortcode = route?.[2] || '';
    const article = findActiveContainer(shortcode, routeType);
    const domPost = extractDomPost(article, shortcode, routeType);
    const embeddedPost = shortcode ? findEmbeddedPost(shortcode) : null;
    const post = mergePosts(embeddedPost, domPost);
    const comments = article ? extractComments(article, post) : [];
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const labelKind = routeType === 'reel' ? 'reel' : routeType === 'profile' ? 'profile' : 'post';
    const title = post.author
      ? `Instagram ${labelKind} by @${post.author}`
      : `Instagram ${labelKind}`;

    const metadata: Record<string, string | number | undefined> = {
      source: 'Instagram',
      type: routeType === 'feed'
        ? 'active feed item'
        : routeType === 'reel'
          ? 'reel'
          : routeType === 'tv'
            ? 'IGTV video'
            : routeType === 'profile'
              ? 'profile'
              : 'post',
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
        : routeType === 'profile'
          ? 'visible profile metadata and loaded posts'
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
    if (post.media.length) parts.push('## Media', '', ...post.media.map((item) => `- ${item}`), '');
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

function findActiveContainer(shortcode: string, routeType: string): Element | null {
  const articles = Array.from(document.querySelectorAll('main article, article'));
  if (shortcode && articles.length) {
    const match = articles.find((article) =>
      article.querySelector(`a[href*="/p/${shortcode}"], a[href*="/reel/${shortcode}"], a[href*="/reels/${shortcode}"], a[href*="/tv/${shortcode}"]`),
    );
    if (match) return match;
    if (articles.length === 1) return articles[0];
  }
  const visibleArticle = mostVisible(articles);
  if (visibleArticle) return visibleArticle;

  if (routeType === 'reel' || routeType === 'profile' || shortcode) {
    return document.querySelector('[role="dialog"] section, main section, main');
  }
  return null;
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

function extractDomPost(container: Element | null, shortcode: string, routeType: string): InstagramPost {
  const post = emptyPost(shortcode);
  if (routeType === 'profile') {
    const pathUser = window.location.pathname.replace(/^\/|\/$/g, '');
    if (pathUser) post.author = pathUser;
  }
  if (!container) {
    post.caption = clean(Utils.getMeta('description'));
    return post;
  }

  const authorLink = container.querySelector<HTMLAnchorElement>('header a[href^="/"], a[href^="/"][role="link"]');
  post.author = post.author
    || clean(authorLink?.getAttribute('href')?.split('/').filter(Boolean)[0] || authorLink?.textContent || '').replace(/^@/, '');
  post.authorName = attr(container, ['header img[alt]'], 'alt').replace(/['’]s profile picture.*$/i, '').trim()
    || (routeType === 'profile' ? text(container, ['header h1', 'header span']) : '');
  post.caption = multilineText(container.querySelector('h1'))
    || multilineText(container.querySelector('[data-testid="post-caption"]'))
    || (routeType === 'profile' ? clean(Utils.getMeta('description')) : '');
  post.timestamp = attr(container, ['time[datetime]'], 'datetime') || text(container, ['time']);
  post.likes = engagementFromDom(container, /likes?/i, ['section button', 'a[href$="/liked_by/"]', '[data-testid="like-count"]']);
  post.comments = engagementFromDom(container, /comments?/i, ['a[href*="comments"]', 'button', '[data-testid="comment-count"]']);
  post.views = engagementFromDom(container, /views?|plays?/i, ['span', 'div']);

  const seenMedia = new Set<string>();
  container.querySelectorAll<HTMLImageElement>('img[src], img[alt]').forEach((image) => {
    const alt = clean(image.alt);
    if (alt && /profile picture|avatar|emoji|icon/i.test(alt)) return;
    const src = safeHttpUrl(image.currentSrc || image.src || '');
    if (!alt && !src) return;
    const key = src || alt;
    if (seenMedia.has(key)) return;
    seenMedia.add(key);
    post.media.push(src ? `[${escapeLabel(alt || 'Instagram image')}](${src})` : alt);
  });
  container.querySelectorAll('figcaption').forEach((caption) => {
    const value = clean(caption.textContent || '');
    if (value && !seenMedia.has(value)) {
      seenMedia.add(value);
      post.media.push(value);
    }
  });
  return post;
}

function findEmbeddedPost(shortcode: string): InstagramPost | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"], script[type="application/ld+json"]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000 || !raw.includes(shortcode)) continue;
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

  const appendEmbeddedMedia = (entry: Record<string, unknown>) => {
    const alt = stringValue(entry.accessibility_caption || entry.accessibilityCaption || entry.alt);
    const candidates = getNestedArray(entry, ['image_versions2', 'candidates']);
    const firstCandidate = candidates.length && isRecord(candidates[0]) ? candidates[0] : {};
    const imgUrl = safeHttpUrl(stringValue(entry.display_url || firstCandidate.url));
    if (imgUrl) {
      post.media.push(`[${escapeLabel(alt || 'Instagram media')}](${imgUrl})`);
    } else if (alt) {
      post.media.push(alt);
    }
  };

  appendEmbeddedMedia(record);
  const carousel = Array.isArray(record.carousel_media) ? record.carousel_media : [];
  const sidecar = getNestedArray(record, ['edge_sidecar_to_children', 'edges'])
    .map((edge) => isRecord(edge) && isRecord(edge.node) ? edge.node : edge);
  [...carousel, ...sidecar].forEach((entry) => {
    if (isRecord(entry)) appendEmbeddedMedia(entry);
  });
  post.media = unique(post.media);
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
  const thumbnail = safeHttpUrl(stringValue(record.thumbnailUrl));
  if (thumbnail) post.media.push(`[Thumbnail](${thumbnail})`);
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

function extractComments(scope: Element, post: InstagramPost): InstagramComment[] {
  const allowListItems = scope.matches('article, [role="dialog"]')
    || Boolean(scope.querySelector('[data-testid="post-comments"], [aria-label*="Comments" i]'));
  const selector = allowListItems ? '[data-testid="comment"], ul li' : '[data-testid="comment"]';
  const nodes = scope.querySelectorAll(selector);
  const comments: InstagramComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    if (node.closest('nav, header, footer')) return;
    // A list item can contain nested replies, which are separate comments.
    const own = (query: string) => Array.from(node.querySelectorAll(query))
      .filter((element) => element.closest('[data-testid="comment"], li') === node);
    const timeEl = own('time')[0];
    const authorLink = own('h3 a[href^="/"]')[0] || own('a[href^="/"]').find((link) => clean(link.textContent || ''));
    const author = clean(authorLink?.textContent || '').replace(/^@/, '');
    const candidates = own('span')
      .map((span) => multilineText(span))
      .filter((value) => value && value !== author);
    const body = candidates.sort((a, b) => b.length - a.length)[0] || '';
    if (!author || !body || (!timeEl && !node.matches('[data-testid="comment"]'))) return;
    if (author === post.author && clean(body) === clean(post.caption)) return;
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
      const match = combined.match(/\d[\d,.]*(?:\s*[kmb]\b)?/i);
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

/** Captions and comments use br elements, which textContent drops. */
function multilineText(element: Element | null): string {
  if (!element) return '';
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('br').forEach((lineBreak) => lineBreak.replaceWith('\n'));
  return (clone.textContent || '').split('\n').map(clean).join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  if (!value) return '';
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
function countValue(value: unknown): string {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}
function formatTimestamp(value: unknown): string {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value))) {
    const num = Number(value);
    const ms = num < 1e12 ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  return stringValue(value);
}
function parseCount(value: string): number | null {
  const match = value.trim().toLowerCase().replace(/,/g, '').match(/([\d.]+)\s*([kmb])?/);
  if (!match) return null;
  const multiplier = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : match[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}
