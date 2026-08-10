/**
 * X (Twitter) extractor.
 * Reserved inline anchor hook: tweet action bar (next to Grok / share / bookmark).
 */

import { register } from '../core/registry';
import * as Markdown from '../core/markdown';
import * as Utils from '../core/utils';

register({
  name: 'X (Twitter)',
  matches: [
    '*://x.com/*',
    '*://twitter.com/*',
    '*://mobile.twitter.com/*',
    '*://mobile.x.com/*',
  ],
  // Keep the inline button off settings, login, and unrelated application
  // routes. Feed, profile, search, and status pages expose extractable posts.
  pathnameRegex: /^\/(?:[^/]+\/status\/\d+|i\/(?:web\/)?status\/\d+|(?!(?:settings|messages|notifications|compose|login|logout|i)(?:\/|$))[^/]+(?:\/(?:with_replies|media|likes|highlights))?\/?|search(?:\/|$)|home\/?|explore\/?)/,
  buttonPlacement: 'anchor',
  anchor: {
    // Profile: after the More (•••) button in the action bar
    // Post: append to the engagement bar (reply/retweet/like/bookmark/share)
    // Scoped to article to avoid matching the left sidebar nav
    selector: [
      '[data-testid="userActions"]',                                 // profile: More ••• button
      'article[data-testid="tweet"]:first-of-type [role="group"]',   // post: engagement bar
      'article [data-testid="caret"]',                               // post: ••• scoped to article
    ].join(', '),
    position: 'overlay',
    style: 'icon',
    css: {
      // Match X's circular bordered button style
      minWidth: '36px',
      minHeight: '36px',
      width: '36px',
      height: '36px',
      border: '1px solid rgb(207, 217, 222)',
      borderRadius: '9999px',
      background: 'transparent',
      padding: '0',
      color: 'rgb(15, 20, 25)',
      opacity: '1',
    },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const isSinglePost = /\/(?:[^/]+\/status|i\/(?:web\/)?status)\/\d+/.test(url);
    const isSearch = /^\/search(?:\/|$)/.test(window.location.pathname);
    const isProfile = isProfilePath(window.location.pathname);

    const metadata = {
      source: 'X (Twitter)',
      type: isSinglePost ? 'post' : isSearch ? 'search' : isProfile ? 'profile/timeline' : 'timeline',
      url,
      extracted_at: new Date().toISOString(),
    };

    const parts: string[] = isSinglePost ? extractSinglePost() : isSearch ? extractSearch() : extractTimeline();
    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function extractSinglePost(): string[] {
  const parts: string[] = [];
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  if (articles.length === 0) return ['*No tweet content found.*'];

  const main = parseTweetArticle(articles[0]);
  parts.push(`# Post by ${main.author}\n`);
  if (main.handle) parts.push(`**@${main.handle}**`);
  if (main.date) parts.push(`**Date:** ${main.date}`);
  parts.push('', main.text, '');
  if (main.stats) parts.push(`${main.stats}\n`);
  if (main.media.length) parts.push('## Media\n', ...main.media.map((item) => `- ${item}`), '');

  if (articles.length > 1) {
    parts.push('## Replies\n');
    for (let i = 1; i < Math.min(articles.length, 25); i++) {
      const r = parseTweetArticle(articles[i]);
      parts.push(`**${r.author}** (@${r.handle})${r.date ? ` · ${r.date}` : ''}:\n`);
      parts.push(`> ${r.text}\n`);
      if (r.stats) parts.push(`> ${r.stats}\n`);
    }
  }
  return parts;
}

function extractTimeline(): string[] {
  const parts: string[] = [];
  const nameEl = document.querySelector('[data-testid="UserName"]');
  const bioEl = document.querySelector('[data-testid="UserDescription"]');
  const profileName = nameEl?.querySelector('span span')?.textContent?.trim() || '';
  const handle = window.location.pathname.match(/^\/([^/]+)/)?.[1] || '';

  parts.push(`# ${profileName || handle}'s Timeline\n`);
  if (profileName) parts.push(`**Name:** ${profileName}`);
  parts.push(`**Handle:** @${handle}`);
  if (bioEl) parts.push(`**Bio:** ${bioEl.textContent!.trim()}`);

  const followLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
  followLinks.forEach((link) => { const t = link.textContent!.trim(); if (t) parts.push(`**${t}**`); });
  parts.push('');

  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  if (tweets.length > 0) {
    parts.push('## Posts\n');
    tweets.forEach((tweet, i) => {
      if (i >= 25) return;
      const d = parseTweetArticle(tweet);
      parts.push(`### ${i + 1}. ${d.author} (@${d.handle})${d.date ? ` · ${d.date}` : ''}\n`);
      parts.push(d.text);
      if (d.stats) parts.push(`\n${d.stats}`);
      if (d.media.length) parts.push(`\n**Media:** ${d.media.join(', ')}`);
      parts.push('');
    });
  }
  return parts;
}

function extractSearch(): string[] {
  const query = new URL(window.location.href).searchParams.get('q') || '';
  const parts: string[] = [`# X search${query ? `: ${query}` : ''}\n`];
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  if (tweets.length === 0) {
    parts.push('*No loaded posts found. Scroll search results, then try again.*');
    return parts;
  }
  parts.push(`**Posts loaded:** ${Math.min(tweets.length, 25)}\n`);
  Array.from(tweets).slice(0, 25).forEach((tweet, index) => {
    const data = parseTweetArticle(tweet);
    parts.push(`## ${index + 1}. ${data.author || 'Unknown author'}${data.handle ? ` (@${data.handle})` : ''}`);
    if (data.date) parts.push(`**Date:** ${data.date}`);
    if (data.text) parts.push('', data.text);
    if (data.stats) parts.push('', `**Engagement:** ${data.stats}`);
    if (data.media.length) parts.push('', `**Media:** ${data.media.join(', ')}`);
    parts.push('');
  });
  return parts;
}

interface TweetData {
  author: string;
  handle: string;
  date: string;
  text: string;
  stats: string;
  media: string[];
}

function parseTweetArticle(article: Element): TweetData {
  const authorEl = article.querySelector('[data-testid="User-Name"]');
  const spans = authorEl?.querySelectorAll('span span') || [];
  const author = clean(spans[0]?.textContent || '');

  const handleEl = authorEl?.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
  const handle = (handleEl?.getAttribute('href') || '').replace(/^\//, '').split(/[/?#]/)[0];

  const timeEl = article.querySelector('time');
  const date = timeEl?.getAttribute('datetime')
    ? Utils.formatDate(timeEl.getAttribute('datetime')!)
    : clean(timeEl?.textContent || '');

  const textEl = article.querySelector('[data-testid="tweetText"]');
  const text = textEl ? Markdown.elementToMarkdown(textEl).trim() || clean(textEl.textContent || '') : '';

  const statsMap: Record<string, string> = {};
  article.querySelectorAll('[role="group"] button').forEach((btn) => {
    const label = btn.getAttribute('aria-label') || '';
    const match = label.match(/(\d[\d,.]*\s*[kmb]?)\s*(repl(?:ies|y)|retweets?|likes?|bookmarks?|views?)/i);
    if (!match) return;
    const key = match[2].toLowerCase().startsWith('repl') ? 'replies'
      : match[2].toLowerCase().startsWith('retweet') ? 'retweets'
      : match[2].toLowerCase().startsWith('like') ? 'likes'
      : match[2].toLowerCase().startsWith('bookmark') ? 'bookmarks' : 'views';
    statsMap[key] = match[1].replace(/\s+/g, '');
  });

  const sp: string[] = [];
  if (statsMap.replies) sp.push(`Replies: ${statsMap.replies}`);
  if (statsMap.retweets) sp.push(`Reposts: ${statsMap.retweets}`);
  if (statsMap.likes) sp.push(`Likes: ${statsMap.likes}`);
  if (statsMap.views) sp.push(`Views: ${statsMap.views}`);
  if (statsMap.bookmarks) sp.push(`Bookmarks: ${statsMap.bookmarks}`);

  const media = extractTweetMedia(article);
  return { author, handle, date, text, stats: sp.join(' · '), media };
}

function extractTweetMedia(article: Element): string[] {
  const media: string[] = [];
  article.querySelectorAll<HTMLImageElement>('img[alt][src]').forEach((element) => {
    const label = clean(element.alt) || 'X media';
    if (/profile picture|avatar|emoji|icon/i.test(label)) return;
    const raw = element.currentSrc || element.src;
    const src = safeHttpUrl(raw || '');
    const value = src ? `[${escapeLabel(label)}](${src})` : label;
    if (!media.includes(value)) media.push(value);
  });
  article.querySelectorAll<HTMLVideoElement>('video[poster]').forEach((element) => {
    const src = safeHttpUrl(element.poster || '');
    const value = src ? `[X video](${src})` : 'X video';
    if (!media.includes(value)) media.push(value);
  });
  return media.slice(0, 20);
}

function isProfilePath(pathname: string): boolean {
  return /^\/[^/]+(?:\/(?:with_replies|media|likes|highlights))?\/?$/.test(pathname)
    && !/^\/(?:home|explore|search|settings|messages|notifications|i|compose|login|logout)\b/.test(pathname);
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
