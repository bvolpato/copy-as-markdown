export const SITE_CASES = [
  {
    id: 'youtube-in-app-navigation-drops-previous-video',
    name: 'YouTube',
    url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB',
    head: `<title>New video - YouTube</title><link rel="canonical" href="https://www.youtube.com/watch?v=BBBBBBBBBBB">
      <meta property="og:image" content="https://i.ytimg.com/vi/AAAAAAAAAAA/hq.jpg">
      <script type="application/ld+json">{"@type":"VideoObject","name":"Old video","author":"Old channel"}</script>`,
    html: `<div><meta itemprop="identifier" content="AAAAAAAAAAA"><meta itemprop="datePublished" content="2001-01-01"><meta itemprop="duration" content="PT1M"></div>
      <ytd-shorts hidden><h1 class="ytShortsVideoTitleViewModelShortsVideoTitle">Old short</h1><like-button-view-model><button aria-label="like this video along with 5 other people"></button></like-button-view-model></ytd-shorts>
      <ytd-watch-flexy><h1 class="ytd-watch-metadata"><yt-formatted-string>New video</yt-formatted-string></h1>
      <div id="owner"><a href="/@New"><img alt="New channel"></a><ytd-channel-name id="channel-name"><yt-formatted-string><a href="/@New">New channel</a></yt-formatted-string></ytd-channel-name></div>
      <like-button-view-model><button aria-label="like this video along with 880 thousand other people"></button></like-button-view-model>
      <div id="description-inline-expander"><div id="expanded"><yt-attributed-string></yt-attributed-string></div><span id="snippet-text">New text: <a href="https://www.youtube.com/redirect?q=https%3A%2F%2Fexample.com%2Flong-path">https://example.com/lo...</a>\nSecond line</span></div>
      <span class="ytp-time-duration">9:59</span></ytd-watch-flexy>`,
    afterLoad: (page) => page.evaluate(() => {
      window.ytInitialPlayerResponse = { videoDetails: { videoId: 'AAAAAAAAAAA', author: 'Old channel', shortDescription: 'A longer description of the previous video. '.repeat(3) } };
    }),
    expected: ['# New video', '**Channel:** [New channel](https://www.youtube.com/@New)', '**Duration:** 9:59', '**Likes:** 880 thousand', 'New text: https://example.com/long-path\nSecond line'],
    excluded: ['AAAAAAAAAAA', 'Old', '2001', 'PT1M', 'previous video'],
  },
  {
    id: 'old-reddit-score-title-and-deleted-author',
    name: 'Reddit',
    url: 'https://old.reddit.com/r/markdown/comments/abc123/thread/',
    html: `<div class="content"><div class="thing link" data-fullname="t3_abc123" data-subreddit-prefixed="r/markdown">
      <div class="midcol unvoted"><div class="score dislikes">1234</div><div class="score unvoted">1235</div><div class="score likes">1236</div></div>
      <div class="entry"><p class="title"><a class="title">Old title</a> <span class="domain">(<a href="/r/markdown/">self.markdown</a>)</span></p></div></div>
      <div class="thing comment" data-fullname="t1_a"><div class="entry likes"><p><a class="author">reader</a><span class="score dislikes">9 points</span><span class="score unvoted">10 points</span><span class="score likes">11 points</span></p>
        <div class="md"><p>First paragraph.</p><pre><code>line 1\n\nline 3</code></pre></div></div></div>
      <div class="thing comment" data-fullname="t1_b"><div class="entry"><em>[deleted]</em><div class="md"><p>Ask <a href="/user/innocent">/u/innocent</a>.</p></div></div></div></div>`,
    expected: ['# Old title\n', '**Subreddit:** r/markdown', '**Score:** 1235', '**reader** (11 points)', '> First paragraph.\n>\n> ```\n> line 1\n> \n> line 3\n> ```', '**Anonymous**:'],
    excluded: ['self.markdown', '**/u/innocent**'],
  },
  {
    id: 'reddit-keeps-repeated-replies-and-skips-empty-media',
    name: 'Reddit',
    url: 'https://www.reddit.com/r/markdown/comments/abc123/thread/',
    html: `<script type="application/json">{"post":{"id":"t3_abc123","title":"T","selftext":"Body","author":"op"}}</script>
      <main><shreddit-post id="t3_abc123" author="op"><h1 slot="title">T</h1></shreddit-post>
      <shreddit-comment author="a" depth="0" thingid="t1_1"><div slot="comment">One</div><shreddit-comment author="op" depth="1" thingid="t1_2"><div slot="comment">Thanks!</div></shreddit-comment></shreddit-comment>
      <shreddit-comment author="b" depth="0" thingid="t1_3"><div slot="comment">Two</div><shreddit-comment author="op" depth="1" thingid="t1_4"><div slot="comment">Thanks!</div></shreddit-comment></shreddit-comment></main>`,
    occurrences: { 'Thanks!': 2 },
    excluded: ['Reddit media'],
  },
  {
    id: 'x-quote-without-text-emoji-and-line-breaks',
    name: 'X (Twitter)',
    url: 'https://x.com/alice/status/1234567890',
    html: `<main><article data-testid="tweet"><div data-testid="Tweet-User-Avatar"><img alt="" src="https://pbs.twimg.com/profile_images/1/a.jpg"></div>
      <div data-testid="User-Name"><a href="/alice"><span><span>Alice</span></span></a></div>
      <div role="link"><div data-testid="User-Name"><div><span><span>Bob</span></span></div><div><span>@bob</span><time datetime="2020-06-01T12:00:00Z">Jun 1, 2020</time></div></div><div data-testid="tweetText"><span>Rules:\n1. First </span><img alt="😂" src="https://abs-0.twimg.com/emoji/v2/svg/1f602.svg"></div></div>
      <a href="/alice/status/1234567890"><time datetime="2026-08-08T12:00:00Z">Aug 8</time></a><div role="group"></div></article></main>`,
    expected: ['**Date:** August 8, 2026', '> **Quoted Bob (@bob):**\n> Rules:\n> 1. First 😂'],
    excluded: ['2020', 'twimg.com'],
  },
  {
    id: 'bluesky-thread-text-author-and-hidden-screens',
    name: 'Bluesky',
    url: 'https://bsky.app/profile/alice.example/post/3l6',
    head: '<title>(2) Post by @alice.example — Bluesky</title><link rel="canonical" href="https://bsky.app/profile/other.example"><meta property="og:title" content="Other (@other.example)">',
    html: `<div aria-hidden="true"><div data-testid="feedItem-by-other.example"><a href="/profile/other.example">Other</a><div data-testid="postText">Hidden feed post</div></div></div>
      <div data-testid="postThreadItem-by-alice.example"><a href="/profile/alice.example" aria-label="Avatar"><div data-testid="userAvatarImage"></div></a>
      <a href="/profile/alice.example"><div dir="auto">Alice</div><div dir="auto">@alice.example</div></a>
      <div data-word-wrap="1">Hi <div><a href="/profile/bob.example">@bob.example</a></div> there\nSecond line</div></div>`,
    expected: ['# Post by @alice.example', 'url: "https://bsky.app/profile/alice.example/post/3l6"', '## Alice @alice.example', 'Hi [@bob.example](https://bsky.app/profile/bob.example) there\nSecond line'],
    excluded: ['Hidden feed post', 'Other', '(2)'],
  },
  {
    id: 'mastodon-5-status-markup',
    name: 'Mastodon',
    url: 'https://social.example/@alice/1',
    html: `<div id="mastodon"><main><article data-variant="page" class="_comp_status__root"><header><span class="display-name"><strong class="display-name__html">Alice</strong></span><time datetime="2026-01-01T00:00:00Z"></time><p class="_comp_status_header__handle">@alice</p></header><div class="_comp_status_content__text"><p>Root post</p></div></article>
      <article data-variant="thread" class="_comp_status__root"><header><strong class="display-name__html">Bob</strong></header><div class="_comp_status_content__text"><p>Reply post</p></div></article>
      <article data-variant="thread"><span>Carol</span><span>&lt;p&gt;Off-screen &lt;strong&gt;reply&lt;/strong&gt;&lt;/p&gt;</span></article></main></div>`,
    expected: ['## Alice @alice (2026-01-01T00:00:00Z)\n\nRoot post', '### Bob\n\nReply post', '### Carol\n\nOff-screen **reply**'],
  },
  {
    id: 'arxiv-html-math-and-author-notes',
    name: 'arXiv',
    url: 'https://arxiv.org/html/1706.03762v7',
    html: `<article class="ltx_document"><h1 class="ltx_title ltx_title_document">Paper</h1><div class="ltx_authors"><span class="ltx_personname">Ann Author<span class="ltx_note"><sup>1</sup>footnotemark: 1</span></span></div>
      <p>A stack of <math alttext="N=6" display="inline"><semantics><mi>N</mi><annotation encoding="application/x-tex">N=6</annotation></semantics></math> layers.</p>
      <table class="ltx_equation ltx_eqn_table"><tr><td></td><td><math alttext="\\frac{Q}{\\sqrt{d_{k}}}" display="block"><mi>Q</mi></math></td><td>(1)</td></tr></table></article>`,
    expected: ['**Authors:** Ann Author\n', 'A stack of $N=6$ layers.', '$$\\frac{Q}{\\sqrt{d_{k}}}$$ (1)'],
    excluded: ['footnotemark', '| --- |'],
  },
  {
    id: 'arxiv-abstract-keeps-the-visited-version',
    name: 'arXiv',
    url: 'https://arxiv.org/abs/1706.03762v3',
    head: '<title>Paper</title><link rel="canonical" href="https://arxiv.org/abs/1706.03762">',
    html: '<h1 class="title">Paper</h1><blockquote class="abstract">Text.</blockquote>',
    expected: ['url: "https://arxiv.org/abs/1706.03762v3"', 'https://arxiv.org/pdf/1706.03762v3'],
  },
  {
    id: 'polymarket-lists-every-loaded-outcome-and-the-rules-tab',
    name: 'Polymarket',
    url: 'https://polymarket.com/event/fed',
    head: `<title>Fed</title><script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What are the current odds for Fed?","acceptedAnswer":{"text":"\\"25 bps\\" at 60%, followed by \\"No change\\" at 30%."}},{"@type":"Question","name":"How will Fed be resolved?","acceptedAnswer":{"text":"See the Rules section."}}]}</script>`,
    html: `<main><h1>Fed</h1>${[['25 bps', '60%'], ['No change', '30%'], ['50+ bps', '&lt;1%']].map(([name, odds]) => `<div data-scroll-anchor="event-detail-accordion-item-${name}"><p>${name}</p><p>$1 Vol.</p><p>${odds}</p></div>`).join('')}
      <div role="tabpanel" id="r-panel-rules"><span>Resolves to Yes if X.</span><span>Resolves to Yes if X.</span></div></main>`,
    expected: ['| 25 bps | 60% |', '| No change | 30% |', '| 50+ bps | <1% |', 'Resolves to Yes if X.'],
    excluded: ['See the Rules section.'],
  },
  {
    id: 'kalshi-outcome-names-and-prices',
    name: 'Kalshi',
    url: 'https://kalshi.com/markets/kxfed/fed',
    html: `<main><h1>Fed</h1><div data-tile-group=""><div><button>Above 4.00%</button><span>95%</span><button data-testid="price-pill">Yes 97¢</button><button data-testid="price-pill">No 4¢</button></div>
      <div><button>Above 4.25%</button><span>&lt;1%</span><button data-testid="price-pill">Yes 1¢</button></div></div><p>Rules</p></main>`,
    expected: ['| Above 4.00% | 95% | 97¢ | 4¢ |', '| Above 4.25% | <1% | 1¢ |  |', 'Rules'],
  },
  {
    id: 'weather-current-reading-and-hourly-rows',
    name: 'Weather.com',
    url: 'https://weather.com/weather/hourbyhour/l/x',
    html: `<main><h1>City Hourly Forecast</h1><section data-testid="current-conditions"><span data-testid="TemperatureValue">48<span>°</span></span><span data-testid="TemperatureValue">46<span>°</span></span><p>Cloudy</p></section>
      <section><div><div><p>Thursday</p></div><div><div class="@container/hourlyItem"><p>11 pm</p><svg><title>Night</title></svg><span data-testid="TemperatureValue">46<span>°</span></span><span><span>16</span><span>mph</span></span></div></div>
      <div><p>Friday</p></div><div><div class="@container/hourlyItem"><p>12 am</p><span data-testid="TemperatureValue">45<span>°</span></span></div></div></div></section></main>`,
    expected: ['**Temperature:** 46°', '**Conditions:** Cloudy'],
    ordered: ['### Thursday', '- 11 pm 46° 16 mph', '### Friday', '- 12 am 45°'],
    excluded: ['48°', 'Night'],
  },
  {
    id: 'news-paywall-markers-on-visible-content',
    name: 'News (Generic)',
    url: 'https://www.wired.com/story/x/',
    html: `<aside class="paywall-bar"><div></div></aside><main><article><h1>Story</h1><p class="paywall">A visible paragraph.</p><div class="recirc-most-popular-wrapper"><p>Other story</p></div></article></main>`,
    expected: ['A visible paragraph.'],
    excluded: ['Paywall detected', 'Other story'],
  },
  {
    id: 'news-visible-paywall-prompt',
    name: 'News (Generic)',
    url: 'https://www.wired.com/story/y/',
    html: '<main><article><h1>Story</h1><p>Teaser.</p><div class="paywall">Subscribe to read the rest.</div></article></main>',
    expected: ['Paywall detected'],
  },
  {
    id: 'substack-subscriber-marker-is-not-a-paywall',
    name: 'Substack',
    url: 'https://demo.substack.com/p/x',
    html: '<h1 class="post-title">Post</h1><div class="body markup"><p>Free part.</p><div class="paywall-jump"></div><p>Paid part.</p></div>',
    expected: ['Paid part.'],
    excluded: ['behind a paywall'],
  },
  ...[
    ['Yahoo Search', 'https://search.yahoo.com/search?p=x', '<div id="web"><div class="algo"><h3><a href="https://checker.example/report?url=https://other.example/">Checker</a></h3></div></div>'],
    ['Yandex Search', 'https://yandex.com/search/?text=x', '<div class="serp-item"><h2><a href="https://checker.example/report?url=https://other.example/">Checker</a></h2></div>'],
  ].map(([name, url, html]) => ({
    id: `${name.toLowerCase().replace(' ', '-')}-keeps-destination-query`,
    name, url, html, expected: ['**URL:** https://checker.example/report?url=https://other.example/'],
  })),
  {
    id: 'baidu-nested-containers-count-once',
    name: 'Baidu Search',
    url: 'https://www.baidu.com/s?wd=x',
    html: '<div id="content_left"><div class="result c-container" mu="https://example.com/a"><div class="c-container"><h3><a href="http://www.baidu.com/link?url=abc">Title</a></h3></div></div></div>',
    expected: ['**URL:** https://example.com/a'],
    excluded: ['### 2.'],
  },
  {
    id: 'google-people-also-ask-is-not-an-organic-result',
    name: 'Google Search',
    url: 'https://www.google.com/search?q=x',
    html: `<div class="M8OgIe"><style>.x{color:red}</style><p>Overview text.</p></div><div class="MjjYud"><div class="related-question-pair" data-q="Why?"><div class="g"><a href="https://paa.example/"><h3>PAA page</h3></a></div></div></div>
      <div class="MjjYud"><div class="tF2Cxc"><a href="https://example.com/"><h3>Organic</h3></a></div></div>`,
    expected: ['Overview text.', '### 1. Organic', '- Why?'],
    excluded: ['PAA page', 'color:red'],
  },
  {
    id: 'brave-title-excludes-site-name',
    name: 'Brave Search',
    url: 'https://search.brave.com/search?q=x',
    html: '<div class="snippet" data-type="web"><a class="l1" href="https://example.com/a"><cite>example.com</cite><div class="title search-snippet-title">Real title</div></a></div>',
    expected: ['### 1. Real title\n'],
  },
  {
    id: 'facebook-engagement-ignores-message-text',
    name: 'Facebook',
    url: 'https://www.facebook.com/acme/posts/12345/',
    html: `<main role="main"><div role="article"><strong><a href="/acme">Alice</a></strong><a href="/acme/posts/12345/">1h</a><div data-ad-preview="message"><span>I like these 3 ideas</span></div>
      <span>View 5 more comments</span><span>Write a comment…</span>
      <div role="article" aria-label="Comment by Bob"><strong>Bob</strong><div><div dir="auto">First comment line</div><div dir="auto">Second</div></div></div></div></main>`,
    expected: ['> First comment line\n> Second'],
    excluded: ['## Engagement'],
  },
  {
    id: 'instagram-caption-line-breaks-and-reply-owners',
    name: 'Instagram',
    url: 'https://www.instagram.com/p/ABC123/',
    html: `<main><article><header><a href="/alice/">alice</a></header><a href="/p/ABC123/">x</a><h1>Line one<br>Line two</h1>
      <ul><li><ul><li><h3><a href="/carol/">carol</a></h3><span>ok</span><time datetime="2026-01-02T00:00:00Z"></time></li><li><h3><a href="/dave/">dave</a></h3><span>A much longer reply</span><time datetime="2026-01-03T00:00:00Z"></time></li></ul></li></ul></article></main>`,
    expected: ['Line one\nLine two', '## Comments (2 loaded)'],
    occurrences: { 'A much longer reply': 1 },
  },
  {
    id: 'vk-modal-post-id-is-not-a-prefix-match',
    name: 'VK',
    url: 'https://vk.com/club1?w=wall-1_2',
    html: '<div class="post" data-post-id="-1_25"><div class="wall_post_text">Wrong post</div></div><div class="post" data-post-id="-1_2"><div class="wall_post_text">Right post</div></div>',
    expected: ['Right post'],
    excluded: ['Wrong post'],
  },
  {
    id: 'tiktok-in-app-navigation-ignores-first-video',
    name: 'TikTok',
    url: 'https://www.tiktok.com/@bob/video/222',
    html: `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{"__DEFAULT_SCOPE__":{"webapp.video-detail":{"itemInfo":{"itemStruct":{"id":"111","desc":"First video","next":"222"}}}}}</script>
      <article data-video-id="222"><img alt="bob" src="https://p16.example/tos-useast5-avt-0068-tx/a.jpeg"><div data-e2e="browse-video-desc">Second video</div></article>`,
    expected: ['Second video'],
    excluded: ['First video', 'TikTok cover', '-avt-'],
  },
  {
    id: 'twitch-live-channel-ignores-listed-clips',
    name: 'Twitch',
    url: 'https://www.twitch.tv/streamer',
    head: '<title>streamer - Twitch</title><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"VideoObject","name":"A clip","description":"Clip text","duration":"PT53S"}]}</script>',
    html: '<a href="/streamer"><h1 class="tw-title">streamer</h1></a><h2 data-a-target="stream-title">Live now</h2><span data-test-selector="title">Recent broadcasts</span>',
    expected: ['# Live now', '**Channel:** [streamer](https://www.twitch.tv/streamer)'],
    excluded: ['Clip text', 'PT53S'],
  },
  {
    id: 'twitch-video-title-is-not-the-shelf-heading',
    name: 'Twitch',
    url: 'https://www.twitch.tv/videos/123',
    head: '<title>The broadcast - Twitch</title>',
    html: '<h1 class="tw-title">streamer</h1><span data-test-selector="title">Recent broadcasts</span>',
    expected: ['# The broadcast\n'],
    excluded: ['Recent broadcasts'],
  },
  {
    id: 'amazon-split-price-and-review-title',
    name: 'Amazon',
    url: 'https://www.amazon.de/dp/B000000001',
    html: `<span id="productTitle">Produkt</span><div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen"> </span><span aria-hidden="true"><span class="a-price-whole">29<span>,</span></span><span class="a-price-fraction">99</span><span class="a-price-symbol">€</span></span></span></div>
      <div data-hook="review"><a data-hook="review-title"><i class="a-icon-star"><span class="a-icon-alt">5,0 von 5 Sternen</span></i><span></span><span>Sehr gut</span></a></div>`,
    expected: ['**Price:** 29,99€', '### 5,0 von 5 Sternen - Sehr gut\n'],
  },
  {
    id: 'medium-section-headings-use-h1',
    name: 'Medium',
    url: 'https://medium.com/@a/story-123',
    html: '<article><section><h1 data-testid="storyTitle">My title</h1><p>Intro.</p><h1>Section heading</h1><p>Body.</p></section></article>',
    expected: ['Section heading'],
    occurrences: { '# My title': 1 },
  },
  {
    id: 'obsidian-section-headings-use-h1',
    name: 'Ghost / Obsidian Publish',
    url: 'https://notes.example/page',
    html: '<div class="publish-renderer"><div class="markdown-preview-view"><div class="page-header">Note</div><h1>Section</h1><p>Text</p></div></div>',
    expected: ['# Note', '# Section'],
    occurrences: { Note: 2 },
  },
  ...[
    ['linkedin-job-description', 'LinkedIn', 'https://www.linkedin.com/jobs/view/1/', '<main><h1>Job</h1><div class="description__text">KEEP_BODY</div><section>DROP_OUTER</section></main>'],
    ['sec-inline-viewer-filing', 'SEC EDGAR', 'https://www.sec.gov/ix?doc=/Archives/edgar/data/1/x.htm', '<div>DROP_OUTER</div><div id="dynamic-xbrl-form"><p>KEEP_BODY</p></div>'],
    ['ghost-post-content', 'Ghost / Obsidian Publish', 'https://blog.example/post', '<article class="gh-article"><section class="gh-content"><p>KEEP_BODY</p></section><section>DROP_OUTER</section></article>'],
    ['semantic-scholar-abstract', 'Semantic Scholar', 'https://www.semanticscholar.org/paper/x', '<h1>Paper</h1><div class="tldr-abstract-replacement">DROP_OUTER<span data-test-id="tldr-abstract-text">Short</span></div><p data-test-id="abstract-text">KEEP_BODY</p>'],
    ['openreview-authors', 'OpenReview', 'https://openreview.net/forum?id=x', '<main><h1>P</h1><div class="forum-authors"><a>KEEP_BODY</a></div><div class="signatures"><a>DROP_OUTER</a></div><div class="note panel"><strong class="note-content-field">Abstract</strong><span>Text</span></div></main>'],
  ].map(([id, name, url, html]) => ({ id: `${id}-excludes-outer-content`, name, url, html, expected: ['KEEP_BODY'], excluded: ['DROP_OUTER'] })),
  {
    id: 'imdb-plot-appears-once',
    name: 'IMDb',
    url: 'https://www.imdb.com/title/tt1/',
    html: '<h1>Film</h1><p data-testid="plot"><span data-testid="plot-xs_to_m">A plot.</span><span data-testid="plot-l">A plot.</span><span data-testid="plot-xl">A plot.</span></p>',
    occurrences: { 'A plot.': 1 },
  },
  {
    id: 'booking-rating-is-not-concatenated',
    name: 'Booking.com',
    url: 'https://www.booking.com/hotel/fr/x.html',
    html: '<h1>Hotel</h1><div data-testid="review-score"><div>Scored 8.5</div><div aria-hidden="true">8.5</div><div>Very Good</div></div>',
    expected: ['**Rating:** Scored 8.5 Very Good'],
  },
];
