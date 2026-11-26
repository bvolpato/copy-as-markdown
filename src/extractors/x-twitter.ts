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
    '*://www.x.com/*',
    '*://twitter.com/*',
    '*://www.twitter.com/*',
    '*://mobile.twitter.com/*',
    '*://mobile.x.com/*',
    '*://pro.x.com/*',
  ],
  // Keep the inline button off settings, login, and unrelated application
  // routes. Feed, profile, search, status, article, list, bookmark, and community pages expose extractable posts.
  pathnameRegex: /^\/(?:[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?|[^/]+\/articles\/\d+|i\/(?:web\/)?status\/\d+(?:\/(?:photo|video)\/\d+)?|i\/(?:lists\/[^/]+|bookmarks|communities\/[^/]+)|(?!(?:settings|messages|notifications|compose|login|logout|i)(?:\/|$))[^/]+(?:\/(?:with_replies|media|likes|highlights))?)\/?$/,
  buttonPlacement: 'anchor',
  anchor: {
    // Profile: after the More (...) button in the action bar
    // Post: append to the engagement bar (reply/retweet/like/bookmark/share)
    // Scoped to article to avoid matching the left sidebar nav
    selector: [
      '[data-testid="userActions"]',                                 // profile: More ... button
      'article[data-testid="tweet"]:first-of-type [role="group"]',   // post: engagement bar
      'article [data-testid="caret"]',                               // post: ... scoped to article
    ].join(', '),
    position: 'overlay',
    style: 'icon',
    css: {
      // Match X's circular bordered button style without hardcoding light-mode colors
      minWidth: '36px',
      minHeight: '36px',
      width: '36px',
      height: '36px',
      border: '1px solid currentColor',
      borderRadius: '9999px',
      background: 'transparent',
      padding: '0',
      color: 'inherit',
      opacity: '1',
    },
  },

  async extract() {
    const url = Utils.getCanonicalUrl();
    const pathname = window.location.pathname;
    const statusMatch = pathname.match(/^\/(?:[^/]+\/status|i\/(?:web\/)?status)\/(\d+)/);
    const isSinglePost = Boolean(statusMatch);
    const isArticle = /^\/[^/]+\/articles\/\d+/.test(pathname);
    const isSearch = /^\/search(?:\/|$)/.test(pathname);
    const isProfile = isProfilePath(pathname);

    const metadata = {
      source: 'X (Twitter)',
      type: isArticle ? 'article' : isSinglePost ? 'post' : isSearch ? 'search' : isProfile ? 'profile/timeline' : 'timeline',
      url,
      extracted_at: new Date().toISOString(),
    };

    const parts: string[] = isArticle
      ? extractXArticle()
      : isSinglePost
        ? extractSinglePost(statusMatch![1])
        : isSearch
          ? extractSearch()
          : extractTimeline();
    return Markdown.buildPageMarkdown(metadata, parts.join('\n'));
  },
});

function extractXArticle(): string[] {
  const title = clean(
    document.querySelector('[data-testid="twitter-article-title"], article h1, h1')?.textContent || '',
  ) || Utils.getPageTitle();
  const bodyEl = document.querySelector('[data-testid="twitterArticleRichTextView"]');
  if (!bodyEl) {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    if (tweets.length > 0) return extractSinglePost('');
    return [`# ${title}\n`, '*No article content found.*'];
  }
  const authorEl = document.querySelector('[data-testid="User-Name"]');
  const author = clean(authorEl?.querySelector('span span')?.textContent || '');
  const handleEl = authorEl?.querySelector<HTMLAnchorElement>('a[href^="/"]');
  const handle = (handleEl?.getAttribute('href') || '').replace(/^\//, '').split(/[/?#]/)[0];
  const timeEl = document.querySelector('article time, time[datetime]');
  const date = timeEl?.getAttribute('datetime')
    ? Utils.formatDate(timeEl.getAttribute('datetime')!)
    : clean(timeEl?.textContent || '');

  const parts: string[] = [`# ${title}\n`];
  if (author) parts.push(`**Author:** ${author}${handle ? ` (@${handle})` : ''}`);
  if (date) parts.push(`**Date:** ${date}`);
  const cleaned = Utils.removeNoise(bodyEl, ['script', 'style', 'button', '[data-cam-instance]']);
  parts.push('', Markdown.elementToMarkdown(cleaned), '');
  return parts;
}

function extractSinglePost(statusId: string): string[] {
  const parts: string[] = [];
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  if (articles.length === 0) {
    if (document.querySelector('[data-testid="twitterArticleRichTextView"]')) {
      return extractXArticle();
    }
    return ['*No tweet content found.*'];
  }

  let focalIndex = 0;
  if (statusId) {
    const foundIndex = articles.findIndex((article) => {
      const timeLinks = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
      return timeLinks.some((link) => {
        if (link.closest('[data-testid="quoteTweet"]')) return false;
        return new RegExp(`/status/${statusId}(?:/|$|\\?)`).test(link.getAttribute('href') || '');
      });
    });
    if (foundIndex >= 0) focalIndex = foundIndex;
  }

  const main = parseTweetArticle(articles[focalIndex]);
  parts.push(`# Post by ${main.author || 'Unknown author'}\n`);
  if (main.handle) parts.push(`**@${main.handle}**`);
  if (main.date) parts.push(`**Date:** ${main.date}`);
  parts.push('', main.text, '');
  if (main.articleBody) parts.push(main.articleBody, '');
  if (main.quote) parts.push(...formatQuote(main.quote), '');
  if (main.stats) parts.push(`${main.stats}\n`);
  if (main.media.length) parts.push('## Media\n', ...main.media.map((item) => `- ${item}`), '');

  if (focalIndex > 0) {
    parts.push('## Parent Posts\n');
    for (let i = 0; i < focalIndex; i++) {
      appendReplyItem(parts, parseTweetArticle(articles[i]));
    }
  }

  const remaining = articles.slice(focalIndex + 1);
  if (remaining.length > 0) {
    const threadItems: TweetData[] = [];
    const replyItems: TweetData[] = [];
    let inSelfThread = Boolean(main.handle);
    for (const article of remaining) {
      const parsed = parseTweetArticle(article);
      if (inSelfThread && parsed.handle && parsed.handle.toLowerCase() === main.handle.toLowerCase()) {
        threadItems.push(parsed);
      } else {
        inSelfThread = false;
        replyItems.push(parsed);
      }
    }
    if (threadItems.length > 0) {
      parts.push('## Thread\n');
      threadItems.forEach((item) => appendReplyItem(parts, item));
    }
    if (replyItems.length > 0) {
      parts.push('## Replies\n');
      replyItems.forEach((item) => appendReplyItem(parts, item));
    }
  }
  return parts;
}

function appendReplyItem(parts: string[], r: TweetData): void {
  parts.push(`**${r.author || 'Unknown author'}**${r.handle ? ` (@${r.handle})` : ''}${r.date ? ` · ${r.date}` : ''}:\n`);
  if (r.text) {
    parts.push(...r.text.split(/\r?\n/).map((line) => `> ${line}`), '');
  }
  if (r.quote) {
    parts.push(...formatQuote(r.quote).map((line) => `> ${line}`), '');
  }
  if (r.stats) parts.push(`> ${r.stats}\n`);
  if (r.media.length) parts.push(`**Media:** ${r.media.join(', ')}\n`);
}

function formatQuote(quote: { author: string; handle: string; text: string }): string[] {
  const header = quote.author || quote.handle
    ? `> **Quoted ${quote.author || `@${quote.handle}`}${quote.author && quote.handle ? ` (@${quote.handle})` : ''}:**`
    : '> **Quoted Post:**';
  return [header, ...quote.text.split(/\r?\n/).map((line) => `> ${line}`)];
}

function extractTimeline(): string[] {
  const parts: string[] = [];
  const pathname = window.location.pathname;
  const isProfile = isProfilePath(pathname);

  if (isProfile) {
    const nameEl = document.querySelector('[data-testid="UserName"]');
    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    const profileName = nameEl?.querySelector('span span')?.textContent?.trim() || '';
    const handle = pathname.match(/^\/([^/]+)/)?.[1] || '';

    parts.push(`# ${profileName || handle}'s Timeline\n`);
    if (profileName) parts.push(`**Name:** ${profileName}`);
    if (handle) parts.push(`**Handle:** @${handle}`);
    if (bioEl) parts.push(`**Bio:** ${bioEl.textContent!.trim()}`);

    const followLinks = document.querySelectorAll('a[href*="/followers"], a[href*="/following"]');
    followLinks.forEach((link) => { const t = link.textContent!.trim(); if (t) parts.push(`**${t}**`); });
    parts.push('');
  } else {
    parts.push(`# ${timelineTitle(pathname)}\n`);
  }

  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  if (tweets.length > 0) {
    parts.push('## Posts\n');
    tweets.forEach((tweet, i) => {
      const d = parseTweetArticle(tweet);
      parts.push(`### ${i + 1}. ${d.author}${d.handle ? ` (@${d.handle})` : ''}${d.date ? ` · ${d.date}` : ''}\n`);
      if (d.text) parts.push(d.text);
      if (d.quote) parts.push('', ...formatQuote(d.quote));
      if (d.stats) parts.push(`\n${d.stats}`);
      if (d.media.length) parts.push(`\n**Media:** ${d.media.join(', ')}`);
      parts.push('');
    });
  }
  return parts;
}

function timelineTitle(pathname: string): string {
  if (/^\/home(?:\/|$)/i.test(pathname)) return 'Home Timeline';
  if (/^\/explore(?:\/|$)/i.test(pathname)) return 'Explore';
  if (/^\/i\/bookmarks(?:\/|$)/i.test(pathname)) return 'Bookmarks';
  if (/^\/i\/lists\//i.test(pathname)) return 'List Timeline';
  if (/^\/i\/communities\//i.test(pathname)) return 'Community Timeline';
  return 'X Timeline';
}

function extractSearch(): string[] {
  const query = new URL(window.location.href).searchParams.get('q') || '';
  const parts: string[] = [`# X search${query ? `: ${query}` : ''}\n`];
  const tweets = document.querySelectorAll('article[data-testid="tweet"]');
  if (tweets.length === 0) {
    parts.push('*No loaded posts found. Scroll search results, then try again.*');
    return parts;
  }
  parts.push(`**Posts loaded:** ${tweets.length}\n`);
  Array.from(tweets).forEach((tweet, index) => {
    const data = parseTweetArticle(tweet);
    parts.push(`## ${index + 1}. ${data.author || 'Unknown author'}${data.handle ? ` (@${data.handle})` : ''}`);
    if (data.date) parts.push(`**Date:** ${data.date}`);
    if (data.text) parts.push('', data.text);
    if (data.quote) parts.push('', ...formatQuote(data.quote));
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
  articleBody: string;
  quote: { author: string; handle: string; text: string } | null;
  stats: string;
  media: string[];
}

function parseTweetArticle(article: Element): TweetData {
  const quoteContainer = article.querySelector('[data-testid="quoteTweet"]')
    || Array.from(article.querySelectorAll('[role="link"]')).find((el) => el.querySelector('[data-testid="User-Name"]'))
    || null;
  const userNameEls = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
  const authorEl = userNameEls.find((el) => !quoteContainer?.contains(el)) || userNameEls[0] || null;
  const spans = authorEl?.querySelectorAll('span span') || [];
  const author = clean(spans[0]?.textContent || '');

  const handleEl = authorEl?.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
  const handle = (handleEl?.getAttribute('href') || '').replace(/^\//, '').split(/[/?#]/)[0];

  const timeEl = Array.from(article.querySelectorAll('time'))
    .find((el) => !quoteContainer?.contains(el)) || article.querySelector('time');
  const date = timeEl?.getAttribute('datetime')
    ? Utils.formatDate(timeEl.getAttribute('datetime')!)
    : clean(timeEl?.textContent || '');

  const tweetTextEls = Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
  const mainTextEl = tweetTextEls.find((el) => !quoteContainer?.contains(el)) || null;
  const text = mainTextEl ? tweetTextToMarkdown(mainTextEl) : '';

  const richArticleEl = article.querySelector('[data-testid="twitterArticleRichTextView"]');
  const articleBody = richArticleEl
    ? Markdown.elementToMarkdown(Utils.removeNoise(richArticleEl, ['script', 'style', 'button', '[data-cam-instance]'])).trim()
    : '';

  let quote: TweetData['quote'] = null;
  const quoteTextEl = quoteContainer?.querySelector('[data-testid="tweetText"]')
    || (tweetTextEls.length > 1 ? tweetTextEls[1] : null);
  const quoteMedia = quoteContainer ? extractTweetMedia(quoteContainer) : [];
  const hasQuoteText = quoteTextEl && quoteTextEl !== mainTextEl;
  if (hasQuoteText || quoteMedia.length > 0) {
    const quoteScope = quoteContainer || quoteTextEl?.closest('[role="link"]') || quoteTextEl?.parentElement;
    const qUserEl = quoteScope?.querySelector('[data-testid="User-Name"]')
      || (userNameEls.length > 1 ? userNameEls[1] : null);
    const qAuthor = clean(qUserEl?.querySelector('span span')?.textContent || '');
    const qHandleEl = qUserEl?.querySelector<HTMLAnchorElement>('a[href^="/"]');
    const qHandle = (qHandleEl?.getAttribute('href') || '').replace(/^\//, '').split(/[/?#]/)[0]
      || Array.from(qUserEl?.querySelectorAll('span') || [])
        .map((span) => clean(span.textContent || '').match(/^@(\w+)$/)?.[1] || '').find(Boolean) || '';
    const qText = [hasQuoteText ? tweetTextToMarkdown(quoteTextEl) : '', ...quoteMedia].filter(Boolean).join('\n');
    if (qText) quote = { author: qAuthor, handle: qHandle, text: qText };
  }

  const statsMap: Record<string, string> = {};
  article.querySelectorAll('[role="group"] button, [role="group"] a, [role="group"] span[aria-label], a[href*="/analytics"]').forEach((node) => {
    const label = node.getAttribute('aria-label') || '';
    const match = label.match(/(\d[\d,.]*\s*[kmb]?)\s*(repl(?:ies|y)|retweets?|reposts?|likes?|bookmarks?|views?)/i);
    if (!match) return;
    const kind = match[2].toLowerCase();
    const key = kind.startsWith('repl') ? 'replies'
      : (kind.startsWith('retweet') || kind.startsWith('repost')) ? 'reposts'
      : kind.startsWith('like') ? 'likes'
      : kind.startsWith('bookmark') ? 'bookmarks' : 'views';
    statsMap[key] = match[1].replace(/\s+/g, '');
  });

  const sp: string[] = [];
  if (statsMap.replies) sp.push(`Replies: ${statsMap.replies}`);
  if (statsMap.reposts) sp.push(`Reposts: ${statsMap.reposts}`);
  if (statsMap.likes) sp.push(`Likes: ${statsMap.likes}`);
  if (statsMap.views) sp.push(`Views: ${statsMap.views}`);
  if (statsMap.bookmarks) sp.push(`Bookmarks: ${statsMap.bookmarks}`);

  const media = extractTweetMedia(article, quoteContainer);
  return { author, handle, date, text, articleBody, quote, stats: sp.join(' · '), media };
}

/** X renders emoji as images, and line breaks as newline characters. */
function tweetTextToMarkdown(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll<HTMLImageElement>('img[src*="/emoji/"], img[src*="/hashflags/"]').forEach((image) => image.replaceWith(image.alt));
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const lineBreakNodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.includes('\n')) lineBreakNodes.push(walker.currentNode as Text);
  }
  lineBreakNodes.forEach((node) => node.replaceWith(
    ...node.data.split('\n').flatMap((line, index) => index ? [document.createElement('br'), line] : [line]),
  ));
  return Markdown.elementToMarkdown(clone).trim() || clean(clone.textContent || '');
}

function extractTweetMedia(article: Element, quote: Element | null = null): string[] {
  const media: string[] = [];
  article.querySelectorAll<HTMLImageElement>('img[alt][src]').forEach((element) => {
    if (quote?.contains(element)) return;
    const label = clean(element.alt) || 'X media';
    if (/profile picture|avatar|emoji|icon/i.test(label)) return;
    const raw = element.currentSrc || element.src;
    if (/\/(?:emoji|profile_images|hashflags)\//.test(raw)) return;
    const src = safeHttpUrl(raw || '');
    const value = src ? `[${escapeLabel(label)}](${src})` : label;
    if (!media.includes(value)) media.push(value);
  });
  article.querySelectorAll<HTMLVideoElement>('video[poster]').forEach((element) => {
    if (quote?.contains(element)) return;
    const src = safeHttpUrl(element.poster || '');
    const value = src ? `[X video](${src})` : 'X video';
    if (!media.includes(value)) media.push(value);
  });
  return media;
}

function isProfilePath(pathname: string): boolean {
  return /^\/[^/]+(?:\/(?:with_replies|media|likes|highlights))?\/?$/.test(pathname)
    && !/^\/(?:home|explore|search|settings|messages|notifications|i|compose|login|logout)\b/i.test(pathname);
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
