/**
 * X (Twitter) extractor.
 * Anchor: icon button in the tweet action bar (next to Grok / share / bookmark).
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
  anchor: {
    // Profile: after the More (•••) button in the action bar
    // Post: append to the engagement bar (reply/retweet/like/bookmark/share)
    // Scoped to article to avoid matching the left sidebar nav
    selector: [
      '[data-testid="userActions"]',                                 // profile: More ••• button
      'article[data-testid="tweet"]:first-of-type [role="group"]',   // post: engagement bar
      'article [data-testid="caret"]',                               // post: ••• scoped to article
      'header[role="banner"] nav',                                   // fallback: banner nav
    ].join(', '),
    position: 'after',
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
    const isSinglePost = /\/status\/\d+/.test(url);
    const isProfile = /^https?:\/\/(x|twitter)\.com\/[^/]+\/?$/.test(url);

    const metadata = {
      source: 'X (Twitter)',
      type: isSinglePost ? 'post' : isProfile ? 'profile/timeline' : 'page',
      url,
      extracted_at: new Date().toISOString(),
    };

    const parts: string[] = isSinglePost ? extractSinglePost() : extractTimeline();
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
  const handle = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');

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
      parts.push('');
    });
  }
  return parts;
}

interface TweetData {
  author: string;
  handle: string;
  date: string;
  text: string;
  stats: string;
}

function parseTweetArticle(article: Element): TweetData {
  const authorEl = article.querySelector('[data-testid="User-Name"]');
  const spans = authorEl?.querySelectorAll('span span') || [];
  const author = spans[0]?.textContent?.trim() || '';

  const handleEl = authorEl?.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
  const handle = (handleEl?.getAttribute('href') || '').replace(/^\//, '');

  const timeEl = article.querySelector('time');
  const date = timeEl?.getAttribute('datetime')
    ? Utils.formatDate(timeEl.getAttribute('datetime')!)
    : timeEl?.textContent?.trim() || '';

  const textEl = article.querySelector('[data-testid="tweetText"]');
  const text = textEl?.textContent?.trim() || '';

  const statsMap: Record<string, string> = {};
  article.querySelectorAll('[role="group"] button').forEach((btn) => {
    const label = btn.getAttribute('aria-label') || '';
    const match = label.match(/(\d[\d,]*)\s+(repl|retweet|like|bookmark|view)/i);
    if (match) statsMap[match[2].toLowerCase()] = match[1];
  });

  const sp: string[] = [];
  if (statsMap.repl) sp.push(`💬 ${statsMap.repl}`);
  if (statsMap.retweet) sp.push(`🔁 ${statsMap.retweet}`);
  if (statsMap.like) sp.push(`❤️ ${statsMap.like}`);
  if (statsMap.view) sp.push(`👁️ ${statsMap.view}`);
  if (statsMap.bookmark) sp.push(`🔖 ${statsMap.bookmark}`);

  return { author, handle, date, text, stats: sp.join(' · ') };
}
