/**
 * Pinterest extractor for pins, pin feeds, ideas, and search results.
 *
 * Pinterest renders most content through a virtualized React tree. Prefer the
 * active pin DOM, then fall back to the bounded JSON-LD/PWS payloads which are
 * present before the page finishes hydrating.
 */

import { addExtractionMetadata, limitCollection, limitMarkdown } from '../core/context';
import * as Markdown from '../core/markdown';
import { register } from '../core/registry';
import * as Utils from '../core/utils';

const COMMENT_LIMIT = 30;
const MEDIA_LIMIT = 20;

interface PinterestPin {
  id: string;
  title: string;
  description: string;
  author: string;
  timestamp: string;
  saves: string;
  comments: string;
  reactions: string;
  media: string[];
}

interface PinterestComment {
  author: string;
  body: string;
  timestamp: string;
  reactions: string;
}

register({
  name: 'Pinterest',
  matches: [
    '*://www.pinterest.com/*',
    '*://pinterest.com/*',
    '*://*.pinterest.com/*',
  ],
  pathnameRegex: /^\/(?:pin\/[^/]+|ideas(?:\/|$)|search\/(?:pins|boards|ideas)(?:\/|$)|[^/]+\/saved(?:\/|$))\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    selector: [
      '[data-test-id="pin-action-buttons"]',
      '[data-test-id="pin-action-menu"]',
      '[data-test-id="pin"] [aria-label*="Share" i]',
      '[data-test-id="pin"]',
      '[data-test-id="pinWrapper"]',
    ].join(', '),
    position: 'overlay',
    style: 'icon',
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const route = parseRoute();
    const root = findPinRoot(route.id) || (route.id ? document.documentElement : findVisiblePin());
    const domPin = extractDomPin(root, route.id);
    const embeddedPin = route.id ? findEmbeddedPin(route.id) : null;
    const pin = mergePins(embeddedPin, domPin);
    const comments = extractComments(root || document);
    const limitedComments = limitCollection(comments, COMMENT_LIMIT);
    const type = route.id ? 'pin' : route.kind === 'search' ? 'search results' : 'pin feed';
    const title = pin.title || Utils.getPageTitle() || `Pinterest ${type}`;

    const metadata: Record<string, string | number | undefined> = {
      source: 'Pinterest',
      type,
      title,
      author: pin.author,
      published_at: pin.timestamp,
      saves: pin.saves,
      comments: pin.comments,
      reactions: pin.reactions,
      url,
      pin_id: pin.id,
      comments_found: comments.length,
      comments_included: limitedComments.items.length,
      media_items: pin.media.length,
      completeness: route.id
        ? 'pin fields plus comments currently loaded in page'
        : 'active visible feed pin only',
    };

    const parts: string[] = [`# ${title}`, ''];
    if (pin.author) parts.push(`**Author:** ${pin.author}`);
    if (pin.timestamp) parts.push(`**Published:** ${pin.timestamp}`);
    if (pin.description) parts.push('', pin.description);

    const engagement = [
      ['Saves', pin.saves], ['Comments', pin.comments], ['Reactions', pin.reactions],
    ].filter(([, value]) => value).map(([label, value]) => `- **${label}:** ${value}`);
    if (engagement.length) parts.push('', '## Engagement', '', ...engagement);
    if (pin.media.length) parts.push('', '## Media', '', ...pin.media.map((item) => `- ${item}`));
    if (limitedComments.items.length) {
      parts.push('', `## Comments (${limitedComments.items.length} loaded)`, '');
      limitedComments.items.forEach((comment) => appendComment(parts, comment));
    }

    const limitedBody = limitMarkdown(parts.join('\n'), 110_000);
    const knownCommentTotal = parseCount(pin.comments);
    addExtractionMetadata(metadata, {
      contentSource: [embeddedPin && 'Pinterest page data', root && 'visible Pinterest DOM']
        .filter(Boolean).join(' + ') || 'Pinterest page metadata',
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

function parseRoute(): { id: string; kind: 'pin' | 'search' | 'feed' } {
  const path = window.location.pathname;
  const pin = path.match(/^\/pin\/([^/]+)/);
  if (pin) return { id: pin[1], kind: 'pin' };
  if (/^\/search\//.test(path)) return { id: '', kind: 'search' };
  return { id: '', kind: 'feed' };
}

function emptyPin(id = ''): PinterestPin {
  return {
    id, title: '', description: '', author: '', timestamp: '', saves: '', comments: '',
    reactions: '', media: [],
  };
}

function findPinRoot(id: string): Element | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>([
    '[data-test-id="pin"]', '[data-test-id="pinWrapper"]', '[data-test-id="pin-closeup"]',
    'article', '[data-test-id="pinGrid"] > *',
  ].join(', ')));
  if (!id) return mostVisible(candidates);
  return candidates.find((candidate) => Array.from(candidate.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .some((link) => /\/pin\//.test(link.pathname) && link.pathname.includes(`/${id}`))) || null;
}

function findVisiblePin(): Element | null {
  return mostVisible(Array.from(document.querySelectorAll<HTMLElement>(
    '[data-test-id="pin"], [data-test-id="pinWrapper"], article',
  )));
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

function extractDomPin(scope: Element | null, id: string): PinterestPin {
  const pin = emptyPin(id);
  if (!scope) {
    pin.title = clean(Utils.getMeta('title') || Utils.getPageTitle());
    pin.description = clean(Utils.getMeta('description'));
    return pin;
  }
  pin.title = text(scope, [
    '[data-test-id="pin-title"]', '[data-test-id="pinTitle"]',
    'h1', '[data-test-id="pin-description"] h1',
  ]);
  pin.description = text(scope, [
    '[data-test-id="pin-description"]', '[data-test-id="pinDescription"]',
    '[data-test-id="closeupDescription"]', '[data-test-id="pinDescriptionText"]',
  ]);
  pin.author = text(scope, [
    '[data-test-id="creator-profile-name"]', '[data-test-id="pin-creator-name"]',
    'a[href^="/"][href$="/"]', '[data-test-id="creatorName"]',
  ]).replace(/^@/, '');
  pin.timestamp = attr(scope, ['time[datetime]'], 'datetime') || text(scope, ['time']);
  pin.saves = count(scope, /save|saved/i);
  pin.comments = count(scope, /comment/i);
  pin.reactions = count(scope, /reaction|like/i);
  pin.media = extractMedia(scope);
  return pin;
}

function extractComments(scope: ParentNode): PinterestComment[] {
  const nodes = scope.querySelectorAll<HTMLElement>([
    '[data-test-id="comment"]', '[data-test-id="comment-item"]',
    '[data-test-id="commentThread"]', '[role="comment"]',
  ].join(', '));
  const comments: PinterestComment[] = [];
  const seen = new Set<string>();
  nodes.forEach((node) => {
    const author = text(node, [
      '[data-test-id="comment-author"]', '[data-test-id="commenter-name"]',
      'a[href^="/"]', '[data-test-id="user-name"]',
    ]).replace(/^@/, '');
    const body = text(node, [
      '[data-test-id="comment-text"]', '[data-test-id="comment-body"]',
      '[data-test-id="commentContent"]', 'p', '[dir="auto"]',
    ]);
    if (!body) return;
    const key = `${author}\n${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push({
      author: author || 'Anonymous',
      body,
      timestamp: attr(node, ['time[datetime]'], 'datetime') || text(node, ['time']),
      reactions: count(node, /reaction|like/i),
    });
  });
  return comments;
}

function appendComment(parts: string[], comment: PinterestComment): void {
  const details = [comment.timestamp, comment.reactions ? `${comment.reactions} reactions` : '']
    .filter(Boolean).join(' · ');
  parts.push(`**${comment.author}**${details ? ` (${details})` : ''}`);
  parts.push(...comment.body.split(/\n+/).map((line) => `> ${line}`), '');
}

function extractMedia(scope: ParentNode): string[] {
  const media: string[] = [];
  scope.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach((image) => {
    const alt = clean(image.alt).replace(/\b(pin|image)\b/gi, '').trim() || 'Pinterest image';
    const src = safeHttpUrl(image.currentSrc || image.src || image.getAttribute('data-src') || '');
    const value = src ? `[${escapeLabel(alt)}](${src})` : alt;
    if (value && !media.includes(value) && !/profile|avatar|logo|icon/i.test(image.alt)) media.push(value);
  });
  return media.slice(0, MEDIA_LIMIT);
}

function findEmbeddedPin(id: string): PinterestPin | null {
  const payloads: unknown[] = [];
  for (const script of document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"], script[type="application/json"], script[id*="PWS" i], script[id*="initial" i]',
  )) {
    const raw = script.textContent || '';
    if (!raw || raw.length > 8_000_000) continue;
    try { payloads.push(JSON.parse(raw)); } catch { /* hydration payload may not be JSON */ }
  }
  for (const payload of payloads) {
    const record = findObject(payload, (candidate) => {
      const candidateId = stringValue(candidate.id || candidate.pin_id || candidate.pinId);
      const candidateUrl = stringValue(candidate.url || candidate.link);
      return candidateId === id || candidateUrl.includes(`/pin/${id}`);
    });
    if (record) return mapEmbeddedPin(record, id);
    const ld = findObject(payload, (candidate) =>
      ['ImageObject', 'VideoObject', 'Article', 'SocialMediaPosting'].includes(stringValue(candidate['@type']))
      && stringValue(candidate.url).includes(`/pin/${id}`),
    );
    if (ld) return mapLdPin(ld, id);
  }
  return null;
}

function mapEmbeddedPin(record: Record<string, unknown>, id: string): PinterestPin {
  const pin = emptyPin(id);
  const creator = isRecord(record.creator) ? record.creator
    : isRecord(record.author) ? record.author : isRecord(record.user) ? record.user : {};
  pin.title = stringValue(record.title || record.grid_title || record.name);
  pin.description = stringValue(record.description || record.caption || record.closeup_description);
  pin.author = stringValue(creator.name || creator.username || record.username);
  pin.timestamp = formatTimestamp(record.datePublished || record.created_at || record.createdAt);
  pin.saves = nestedCount(record, ['aggregated_pin_data', 'aggregated_stats', 'saves'], ['save_count'], ['repin_count']);
  pin.comments = nestedCount(record, ['comment_count'], ['aggregated_pin_data', 'comment_count']);
  pin.reactions = nestedCount(record, ['reaction_count'], ['like_count']);
  const directImage = stringValue(record.image || record.image_url || record.url_image);
  const directImageUrl = safeHttpUrl(directImage);
  if (directImageUrl) pin.media.push(`[Pinterest image](${directImageUrl})`);
  const images = [record.images, record.image_signature, record.story_pin_data]
    .filter((value) => value && typeof value === 'object');
  images.forEach((value) => collectMediaUrls(value, pin.media));
  pin.media = unique(pin.media).slice(0, MEDIA_LIMIT);
  return pin;
}

function mapLdPin(record: Record<string, unknown>, id: string): PinterestPin {
  const pin = emptyPin(id);
  const author = isRecord(record.author) ? record.author : {};
  pin.title = stringValue(record.headline || record.name || record.caption);
  pin.description = stringValue(record.description || record.caption);
  pin.author = stringValue(author.name || author.alternateName);
  pin.timestamp = stringValue(record.datePublished || record.uploadDate);
  const image = stringValue(record.contentUrl || record.thumbnailUrl || record.image);
  const imageUrl = safeHttpUrl(image);
  if (imageUrl) pin.media.push(`[Pinterest image](${imageUrl})`);
  return pin;
}

function collectMediaUrls(root: unknown, result: string[]): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited++ < 2_000 && result.length < MEDIA_LIMIT) {
    const current = stack.pop()!;
    if (typeof current.value === 'string' && /^https?:\/\//i.test(current.value)
      && /\.(?:jpe?g|png|gif|webp)(?:\?|$)/i.test(current.value)) {
      result.push(`[Pinterest image](${current.value})`);
      continue;
    }
    if ((!isRecord(current.value) && !Array.isArray(current.value)) || current.depth >= 8) continue;
    Object.values(current.value).forEach((value) => {
      if (value && typeof value === 'object') stack.push({ value, depth: current.depth + 1 });
    });
  }
}

function mergePins(primary: PinterestPin | null, fallback: PinterestPin): PinterestPin {
  if (!primary) return fallback;
  return {
    id: primary.id || fallback.id,
    title: primary.title || fallback.title,
    description: primary.description || fallback.description,
    author: primary.author || fallback.author,
    timestamp: primary.timestamp || fallback.timestamp,
    saves: primary.saves || fallback.saves,
    comments: primary.comments || fallback.comments,
    reactions: primary.reactions || fallback.reactions,
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
