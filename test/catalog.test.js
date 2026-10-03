import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import * as library from '../dist/library/index.js';

await library.loadAllExtractors();
const failures = [];
async function check(name, run) {
  try { await run(); console.log(`✓ ${name}`); }
  catch (error) { failures.push(name); console.error(`✗ ${name}: ${error.message}`); }
}

await check('All catalog URL patterns reject off-host lookalikes', () => {
  for (const extractor of library.getExtractors()) {
    const matcher = library.createExtractorMatcher({ extractors: [extractor] });
    for (const pattern of extractor.matches) {
      const target = pattern.replace('*://', 'https://').replaceAll('*', 'sample');
      const offHost = `https://unrelated.example/${target}`;
      assert.equal(matcher.match({ url: offHost }), null, `${extractor.name}: ${offHost}`);
    }
    assert.equal(matcher.match({ url: 'https://unrelated.example/?next=https://demo.substack.com/p/article' }), null, extractor.name);
  }
});

await check('Subdomain patterns include the base host and arbitrary ports', () => {
  const extractor = library.defineExtractor({ name: 'Pattern', matches: ['*://*.example.test/content/*'], extract: async () => '' });
  const matcher = library.createExtractorMatcher({ extractors: [extractor] });
  for (const url of ['https://example.test/content/a', 'http://one.two.example.test:8080/content/a']) {
    assert.ok(matcher.match({ url }), url);
  }
  for (const url of ['file://example.test/content/a', 'https://example.test/CONTENT/a', 'https://example.test.evil/content/a']) {
    assert.equal(matcher.match({ url }), null, url);
  }
});
await check('X and Hacker News reject unrelated route suffixes', async () => {
  const x = await library.loadExtractor('x-twitter');
  const hn = await library.loadExtractor('hackernews');
  const matcher = library.createExtractorMatcher({ extractors: [x, hn] });
  for (const url of ['https://x.com/author/unsupported', 'https://x.com/search/advanced', 'https://news.ycombinator.com/items']) {
    assert.equal(matcher.match({ url }), null, url);
  }
  assert.equal(matcher.match({ url: 'https://x.com/author/status/123/photo/1' })?.name, 'X (Twitter)');
  assert.equal(matcher.match({ url: 'https://news.ycombinator.com/item?id=123' })?.name, 'Hacker News');
});

const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
const browserCode = fs.readFileSync(new URL('../dist/library/browser.js', import.meta.url), 'utf8');
const userscript = fs.readFileSync(new URL('../dist/userscript/copy-as-markdown.user.js', import.meta.url), 'utf8');
const repeat = (count, make) => Array.from({ length: count }, (_, index) => make(index)).join('');
async function fixture({ url, name, html, resources = {}, expected = [], excluded = [], ui = false, afterLoad }) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const resource = resources[new URL(request.url()).pathname];
      if (request.isNavigationRequest()) request.respond({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>Catalog fixture</title>${html}` });
      else if (resource) request.respond(resource);
      else request.abort();
    });
    await page.goto(url);
    await page.addScriptTag({ content: browserCode });
    if (ui) await page.addScriptTag({ content: userscript });
    if (afterLoad) await afterLoad(page);
    const output = await page.evaluate(async ({ name }) => {
      await CopyAsMarkdown.loadAllExtractors();
      const match = CopyAsMarkdown.createExtractorMatcher().match({ url: location.href, document });
      if (match?.name !== name) throw new Error(`Expected ${name}, got ${match?.name}`);
      return match.extract();
    }, { name });
    for (const value of expected) assert.ok(output.includes(value), `Missing ${JSON.stringify(value)}`);
    for (const value of excluded) assert.ok(!output.includes(value), `Unexpected ${JSON.stringify(value)}`);
  } finally { await context.close(); }
}

try {
  await check('Reddit includes sibling comment threads and excludes sidebar comments', () => fixture({
    name: 'Reddit', url: 'https://www.reddit.com/r/markdown/comments/abc123/thread/',
    html: `<main><shreddit-post data-post-id="t3_abc123" author="poster" score="42" comment-count="2">
      <h1>Thread title</h1><div slot="text-body"><p>Thread body with <strong>formatting</strong>.</p></div>
    </shreddit-post><shreddit-comment author="reader" score="5" depth="0">
      <div slot="comment"><p>Top-level comment</p></div>
      <shreddit-comment author="reply-author" score="2" depth="1"><div slot="comment"><p>Nested reply</p></div></shreddit-comment>
    </shreddit-comment></main><aside><shreddit-comment author="sidebar"><div slot="comment">Unrelated sidebar comment</div></shreddit-comment></aside>`,
    expected: ['# Thread title', 'Thread body with **formatting**.', '**Author:** u/poster', '**Score:** 42',
      '## Comments (2 loaded)', '**reader** (5 points):', '> Top-level comment', '> **reply-author** (2 points):', '> > Nested reply'],
    excluded: ['Unrelated sidebar comment'],
  }));
  await check('Reddit retains comments nested inside the post', () => fixture({
    name: 'Reddit', url: 'https://new.reddit.com/r/markdown/comments/abc123/thread/',
    html: '<div class="Post" data-post-id="t3_abc123"><h1>Classic post</h1><div data-testid="post-selftext"><p>Classic body</p></div><div class="Comment"><a class="author">classic-reader</a><div class="md"><p>Classic comment</p></div></div></div>',
    expected: ['Classic body', '## Comments (1 loaded)', '**classic-reader**:', '> Classic comment'],
  }));
  await check('Old Reddit copies the matching post and threaded comments without adopting deleted parents', () => fixture({
    name: 'Reddit', url: 'https://old.reddit.com/r/markdown/comments/abc123/thread/', ui: true,
    html: `<style>.flat-list { width: 240px; height: 40px; }</style><div class="content" role="main">
      <div class="thing link" data-fullname="t3_other"><a class="title">Unrelated post</a><div class="expando"><div class="md">Unrelated body</div></div></div>
      <div class="thing link" data-fullname="t3_abc123"><div class="entry"><a class="title">Old thread title</a>
        <a class="author">old-poster</a><span class="score">17 points</span><time datetime="2026-09-25T12:00:00Z"></time>
        <div class="expando"><div class="usertext-body"><div class="md"><p>Old post <em>body</em>.</p></div></div></div>
        <ul class="flat-list buttons"><li><a class="comments">2 comments</a></li></ul>
      </div></div><div class="commentarea"><div class="thing comment" data-fullname="t1_parent"><div class="entry">
        <a class="author">old-reader</a><span class="score">4 points</span><div class="usertext-body"><div class="md"><p>Old parent comment</p></div></div>
      </div><div class="child"><div class="thing comment" data-fullname="t1_reply"><div class="entry">
        <a class="author">old-replier</a><span class="score">1 point</span><div class="usertext-body"><div class="md"><p>Old nested reply</p></div></div>
      </div></div></div></div><div class="thing comment" data-fullname="t1_deleted"><div class="entry"><a class="author">[deleted]</a></div>
        <div class="child"><div class="thing comment" data-fullname="t1_survivor"><div class="entry"><a class="author">survivor</a>
          <div class="usertext-body"><div class="md"><p>Reply under deleted parent</p></div></div>
        </div></div></div>
      </div></div></div>`,
    afterLoad: page => page.waitForSelector('.cam-overlay-container #cam-copy-btn', { timeout: 4000 }),
    expected: ['# Old thread title', '**Author:** u/old-poster', '**Score:** 17 points', '**Published:** 2026-09-25T12:00:00Z',
      'Old post *body*.', '## Comments (3 loaded)', '**old-reader** (4 points):', '> Old parent comment',
      '> **old-replier** (1 point):', '> > Old nested reply', '> **survivor**:', '> > Reply under deleted parent'],
    excluded: ['Unrelated post', 'Unrelated body', '**[deleted]**'],
  }));
  await check('Old Reddit feeds copy the visible post instead of hidden entries', () => fixture({
    name: 'Reddit', url: 'https://old.reddit.com/r/markdown/',
    html: '<div class="thing link" style="display:none"><a class="title">Hidden title</a><div class="expando"><div class="md">Hidden body</div></div></div><div class="thing link" data-fullname="t3_visible"><a class="title">Visible title</a><div class="expando"><div class="md"><p>Visible body</p></div></div></div>',
    expected: ['# Visible title', 'Visible body'], excluded: ['Hidden title', 'Hidden body'],
  }));
  await check('DOM detectors honor the supplied document without global browser state', async () => {
    const notion = await library.loadExtractor('notion');
    const wandb = await library.loadExtractor('wandb');
    const mlflow = await library.loadExtractor('mlflow');
    const docs = {
      notion: { location: { href: 'https://custom.example/page' }, querySelector: selector => selector === '.notion-page-content [data-block-id]' ? {} : null },
      wandb: { location: { href: 'https://custom.example/team/project/runs/id' }, title: 'Weights & Biases', querySelector: () => null },
      mlflow: { location: { href: 'https://custom.example/#/experiments/1/runs/id' }, title: 'MLflow', querySelector: () => null },
    };
    for (const [id, extractor] of Object.entries({ notion, wandb, mlflow })) {
      assert.equal(library.createExtractorMatcher({ extractors: [extractor] }).match({ url: docs[id].location.href, document: docs[id] })?.name, extractor.name);
    }
  });

  const csv = repeat(512, row => repeat(55, column => `${column ? ',' : ''}cell-${row}-${column}`) + '\n');
  await check('Google Sheets preserves complete exports beyond 500 rows and 50 columns', () => fixture({
    name: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/d/audit/edit', html: '<main>Sheet</main>',
    resources: { '/spreadsheets/d/audit/export': { contentType: 'text/csv', body: csv } },
    expected: ['cell-511-54', '| BC |'], excluded: ['output_limits'],
  }));

  const table = `<table>${repeat(212, row => `<tr>${repeat(55, column => `<td>cell-${row}-${column}</td>`)}</tr>`)}</table>`;
  await check('Excel preserves every rendered table row and column', () => fixture({
    name: 'Microsoft 365', url: 'https://excel.officeapps.live.com/x/audit', html: `<main>${table}</main>`, expected: ['cell-211-54'],
  }));
  await check('Notion public pages preserve full properties and database views', () => fixture({
    name: 'Notion', url: 'https://team.notion.site/audit-project',
    html: `<main class="notion-page-content"><h1>Project</h1><div data-block-id="a"><p>Project content</p></div>${table}</main>`, expected: ['cell-211-54', 'rendered rows only'],
  }));
  await check('GitLab preserves rendered files beyond 500000 characters', () => fixture({
    name: 'GitLab', url: 'https://gitlab.com/team/project/-/blob/main/large.txt', html: `<main><div class="blob-content"><pre>${'a'.repeat(500_010)}FILE_END</pre></div></main>`, expected: ['FILE_END'], excluded: ['Content truncated'],
  }));
  await check('YouTube preserves all loaded comments and transcript segments', () => fixture({
    name: 'YouTube', url: 'https://www.youtube.com/watch?v=audit',
    html: `<h1>Video</h1>${repeat(25, i => `<ytd-comment-thread-renderer><span id="author-text">Author ${i}</span><div id="content-text">Comment ${i}</div></ytd-comment-thread-renderer>`)}${repeat(505, i => `<ytd-transcript-segment-renderer><span class="segment-text">Transcript ${i}</span></ytd-transcript-segment-renderer>`)}`,
    expected: ['Comment 24', 'Transcript 504'],
  }));
  const tweets = repeat(31, i => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/author"><span><span>Author</span></span></a></div><div data-testid="tweetText">Post ${i}</div>${i === 30 ? repeat(25, image => `<img alt="Photo ${image}" src="https://media.example/photo-${image}.png">`) : ''}</article>`);
  for (const route of ['home', 'search?q=audit', 'author/status/123']) {
    await check(`X preserves all loaded posts on ${route}`, () => fixture({ name: 'X (Twitter)', url: `https://x.com/${route}`, html: tweets, expected: ['Post 30', 'https://media.example/photo-24.png'] }));
  }

  const searches = [
    ['Google Search', 'https://www.google.com/search?q=audit', 'g', 'VwiC3b'],
    ['DuckDuckGo Search', 'https://duckduckgo.com/?q=audit', 'result', 'result__snippet'],
    ['Bing Search', 'https://www.bing.com/search?q=audit', 'b_algo', 'b_caption'],
    ['Yahoo Search', 'https://search.yahoo.com/search?p=audit', 'algo', 'compText'],
    ['Yandex Search', 'https://yandex.com/search?text=audit', 'serp-item', 'OrganicTextContentSpan'],
    ['Baidu Search', 'https://www.baidu.com/s?wd=audit', 'result', 'c-abstract'],
    ['Brave Search', 'https://search.brave.com/search?q=audit', 'snippet', 'snippet-description'],
  ];
  for (const [name, url, resultClass, snippetClass] of searches) {
    await check(`${name} preserves all loaded results and complete snippets`, () => fixture({
      name, url, html: `<main id="${name === 'Yahoo Search' ? 'web' : 'content_left'}">${repeat(30, i => `<div class="${resultClass}"><h2><a href="https://result.example/${i}"><h3 class="result__title">Result ${i}</h3></a></h2><div class="${snippetClass}"><p>${'s'.repeat(650)}SNIPPET_END_${i}</p></div></div>`)}</main>`,
      expected: ['Result 29', 'SNIPPET_END_29'],
    }));
  }
  await check('Live news preserves every update and all paragraphs', () => fixture({
    name: 'News (Generic)', url: 'https://www.cnn.com/live-news/audit', html: `<h1>News</h1>${repeat(51, i => `<div class="live-blog-post"><h2>Update ${i}</h2><p>First ${i}</p><p>Second ${i}</p></div>`)}`, expected: ['Update 50', 'Second 50'],
  }));
  await check('FOX keeps details that share the synopsis', () => fixture({
    name: 'FOX', url: 'https://www.fox.com/shows/audit', html: '<main><h1>Show</h1><div class="details"><p data-testid="description">Synopsis</p><p>Additional episode detail</p></div></main>', expected: ['Synopsis', 'Additional episode detail'],
  }));
  await check('Current PyPI headers preserve package version and summary', () => fixture({
    name: 'PyPI', url: 'https://pypi.org/project/requests/', html: '<h1 class="project-header__name">requests 2.34.2</h1><p class="project-header__summary">Python HTTP for Humans.</p><div class="project-description"><p>Package README</p></div>',
    expected: ['# requests 2.34.2', 'Python HTTP for Humans.', 'Package README'],
  }));
  await check('npm reads the version rather than a repository link and retains sidebar fields', () => fixture({
    name: 'NPM', url: 'https://www.npmjs.com/package/tsx', html: '<main id="top"><h1 class="flex"><span>tsx</span></h1><span>4.7.0 • </span><div class="fdbf4038"><a class="f2874b88" aria-labelledby="repository" href="https://github.com/privatenumber/tsx">Git repository</a><h3>License</h3><p class="f2874b88">MIT</p><h3>Total Files</h3><p class="f2874b88">35</p></div><div id="readme"><p>Package README</p></div></main>', ui: true,
    afterLoad: page => page.waitForSelector('#cam-copy-btn'),
    expected: ['**Version:** 4.7.0', 'MIT', 'Total Files', '35', 'Package README'], excluded: ['**Version:** Git repository'],
  }));
  await check('Netflix retains public title metadata, every loaded episode, and trailer details', () => fixture({
    name: 'Netflix', url: 'https://www.netflix.com/title/80057281', html: '<style>button { width: 100%; } [data-uia="metadata"] { display: flex; flex-direction: column; }</style><h1>Stranger Things</h1><div data-uia="metadata"><h2>Stranger Things</h2><span>5 Seasons</span><div data-uia="title-info-synopsis-talent">A small town uncovers a mystery.</div><div data-uia="info-creators">Creators: The Duffer Brothers</div></div><div data-uia="episodes"><li data-uia="episode-card"><p data-uia="episode-title">Chapter One</p><p>First episode description</p></li><li data-uia="episode-card"><p data-uia="episode-title">Chapter Two</p><p>Second episode description</p></li></div><div data-uia="trailers"><button data-uia="video-card-container"><p>2m 15s</p><p>Franchise Trailer</p></button></div><div data-uia="more-details"><p>Available to download</p></div><div data-uia="more-like-this">Recommendation noise</div>', ui: true,
    afterLoad: async page => {
      await page.waitForSelector('#cam-copy-btn', { visible: true });
      const width = await page.$eval('#cam-copy-btn', button => button.getBoundingClientRect().width);
      assert.ok(width < 240, `Copy pill stretched to ${width}px`);
    },
    expected: ['5 Seasons', 'The Duffer Brothers', 'First episode description', 'Second episode description', 'Franchise Trailer', '2m 15s', 'Available to download'], excluded: ['Current Episode', 'Recommendation noise'],
  }));
  await check('Amazon preserves full descriptions and every loaded review', () => fixture({
    name: 'Amazon', url: 'https://www.amazon.com/dp/AUDIT', html: `<h1>Product</h1><div id="productDescription"><p>First product paragraph with enough content.</p><p>Second product paragraph</p></div>${repeat(11, i => `<div data-hook="review"><span data-hook="review-body"><span>Review ${i}</span></span></div>`)}`, expected: ['Second product paragraph', 'Review 10'],
  }));
  await check('Booking preserves all loaded amenities and full room details', () => fixture({
    name: 'Booking.com', url: 'https://www.booking.com/hotel/us/audit.html',
    html: `<h1>Hotel</h1><ul data-testid="property-facilities">${repeat(61, i => `<li>Amenity ${i}</li>`)}</ul><table data-testid="rooms-table">${repeat(31, i => `<tr><td>Room ${i} ${'r'.repeat(1010)}ROOM_END_${i}</td></tr>`)}</table>`,
    expected: ['Amenity 60', 'ROOM_END_30'],
  }));
  await check('Twitch preserves all loaded panels, long descriptions, and tags', () => fixture({
    name: 'Twitch', url: 'https://www.twitch.tv/audit',
    html: `<h1>Channel</h1>${repeat(21, i => `<section data-a-target="channel-about-panel">${'p'.repeat(1010)}PANEL_END_${i}</section>`)}<div data-a-target="video-tags">${repeat(31, i => `<a>Tag ${i}</a>`)}</div>`,
    expected: ['PANEL_END_20', 'Tag 30'],
  }));
  await check('Weather preserves every loaded hourly forecast and long row details', () => fixture({
    name: 'Weather.com', url: 'https://weather.com/weather/hourbyhour/l/audit',
    html: `<h1>City</h1>${repeat(49, i => `<div data-testid="HourlyForecast">Hour ${i} ${'f'.repeat(1010)}FORECAST_END_${i}</div>`)}`,
    expected: ['FORECAST_END_48'],
  }));
  await check('Wikipedia preserves citations and reference targets', () => fixture({
    name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Audit', html: '<h1 id="firstHeading">Audit</h1><main id="mw-content-text"><p>Claim<sup class="reference"><a href="#cite-note-1">[1]</a></sup></p><div class="reflist"><ol><li id="cite-note-1"><a href="https://source.example/paper">Reference title</a></li></ol></div></main>', expected: ['[1]', 'Reference title', 'https://source.example/paper'],
  }));
  await check('Datadog documentation fallback retains code-toolbar contents', () => fixture({
    name: 'Datadog Documentation', url: 'https://docs.datadoghq.com/audit/', html: '<main id="mainContent"><h1>Audit</h1><div class="code-toolbar"><pre><code class="language-python">print("CODE_END")</code></pre><div class="toolbar"><button>Copy noise</button></div></div></main>', expected: ['CODE_END', '```python'], excluded: ['Copy noise'],
  }));
  await check('Globo preserves text columns and prefers the article body over outer page content', () => fixture({
    name: 'Globo', url: 'https://g1.globo.com/news/noticia/audit.ghtml', html: '<h1>Article title</h1><main><p>Outer page noise</p><article class="video-widget">Video widget noise</article><div class="mc-article-body"><article itemprop="articleBody"><div class="mc-column content-text"><p>First article paragraph</p><p>Second article paragraph</p></div><figure><bs-player><img src="data:image/gif;base64,R0lGODlh"><div class="clappr-player">Player controls</div></bs-player><figcaption>Article video caption</figcaption></figure></article></div></main>',
    expected: ['First article paragraph', 'Second article paragraph', 'Article video caption'], excluded: ['Outer page noise', 'Video widget noise', 'Player controls', 'data:image/gif'],
  }));
  await check('Anchored copy button stays clickable above popups and returns when they close', () => fixture({
    name: 'Globo', url: 'https://g1.globo.com/news/noticia/popup.ghtml',
    html: '<article><h1>Article title</h1><p>Article body</p></article>', ui: true,
    afterLoad: async page => {
      await page.waitForSelector('article #cam-copy-btn');
      for (const kind of ['overlay', 'modal', 'popover']) {
        await page.evaluate(kind => {
          const blocker = document.createElement(kind === 'modal' ? 'dialog' : 'div');
          blocker.id = 'site-popup';
          blocker.setAttribute('role', 'dialog');
          if (kind === 'overlay' || kind === 'popover') {
            blocker.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;max-width:none;max-height:none;z-index:2147483646;background:rgba(0,0,0,.6)';
          }
          if (kind === 'popover') blocker.setAttribute('popover', 'manual');
          document.body.appendChild(blocker);
          if (kind === 'modal') blocker.showModal();
          if (kind === 'popover') blocker.showPopover();
        }, kind);
        await page.waitForSelector('.cam-floating-wrapper #cam-copy-btn', { timeout: 5000 })
          .catch(error => { throw new Error(`${kind}: ${error.message}`); });
        const clickable = await page.evaluate(() => {
          const button = document.querySelector('#cam-copy-btn');
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === button || button.contains(hit);
        });
        assert.equal(clickable, true, `${kind} blocks the floating copy button`);
        await page.click('#cam-copy-btn');
        await page.waitForFunction(() => document.querySelector('#cam-toast')?.textContent?.includes('Copied!'), { timeout: 3000 });
        await page.evaluate(() => {
          const blocker = document.querySelector('#site-popup');
          if (blocker instanceof HTMLDialogElement) blocker.close();
          if (blocker.matches(':popover-open')) blocker.hidePopover();
          blocker.remove();
        });
        await page.waitForSelector('article #cam-copy-btn', { timeout: 5000 });
      }
    },
    expected: ['Article body'],
  }));
  await check('Copy controls follow the topmost modal and covering popovers', () => fixture({
    name: 'Globo', url: 'https://g1.globo.com/news/noticia/modals.ghtml',
    html: '<article><h1>Article title</h1><p>Article body</p></article>', ui: true,
    afterLoad: async page => {
      await page.waitForSelector('article #cam-copy-btn');
      for (const order of [['first', 'second'], ['second', 'first']]) {
        await page.evaluate(order => {
          for (const id of ['first', 'second']) {
            const dialog = document.createElement('dialog');
            dialog.id = id;
            dialog.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;max-width:none;max-height:none;background:white';
            document.body.appendChild(dialog);
          }
          for (const id of order) document.getElementById(id).showModal();
        }, order);
        for (const id of [...order].reverse()) {
          await page.waitForFunction(id => {
            const button = document.querySelector('#cam-copy-btn');
            const rect = button?.getBoundingClientRect();
            return button?.closest('dialog:modal')?.id === id
              && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
          }, { timeout: 5000 }, id);
          await page.click('#cam-copy-btn');
          await page.waitForFunction(id => document.querySelector(`#${id} #cam-toast`)?.textContent?.includes('Copied!'), { timeout: 3000 }, id);
          await page.evaluate(id => document.getElementById(id).remove(), id);
        }
        await page.waitForSelector('article #cam-copy-btn', { timeout: 5000 });
      }
      await page.evaluate(() => {
        const dialog = document.createElement('dialog');
        dialog.id = 'site-dialog';
        dialog.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;max-width:none;max-height:none;background:white';
        document.body.appendChild(dialog);
        dialog.showModal();
      });
      await page.waitForSelector('#site-dialog .cam-floating-wrapper #cam-copy-btn', { timeout: 5000 });
      await page.evaluate(() => {
        const popover = document.createElement('div');
        popover.id = 'site-menu';
        popover.setAttribute('popover', 'manual');
        popover.style.cssText = 'position:fixed;inset:auto;right:0;bottom:0;width:260px;height:260px;padding:0;border:0;margin:0;background:white';
        document.querySelector('#site-dialog').appendChild(popover);
        popover.showPopover();
      });
      await page.waitForFunction(() => {
        const button = document.querySelector('#site-menu #cam-copy-btn');
        const rect = button?.getBoundingClientRect();
        return button && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }, { timeout: 5000 });
      await page.click('#cam-copy-btn');
      await page.waitForFunction(() => document.querySelector('#site-menu #cam-toast')?.textContent?.includes('Copied!'), { timeout: 3000 });
      await page.evaluate(() => document.querySelector('#site-menu').hidePopover());
      await page.waitForSelector('#site-dialog > .cam-floating-wrapper #cam-copy-btn', { timeout: 5000 });
      await page.evaluate(() => document.querySelector('#site-dialog').remove());
      await page.waitForSelector('article #cam-copy-btn', { timeout: 5000 });
    },
    expected: ['Article body'],
  }));
  await check('Floating copy button preserves an active drag while an overlay blocks its anchor', () => fixture({
    name: 'Globo', url: 'https://g1.globo.com/news/noticia/drag.ghtml',
    html: '<article><h1>Article title</h1><p>Article body</p></article>', ui: true,
    afterLoad: async page => {
      await page.waitForSelector('article #cam-copy-btn');
      await page.evaluate(() => {
        const blocker = document.createElement('div');
        blocker.id = 'site-popup';
        blocker.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;margin:0;max-width:none;max-height:none;z-index:2147483646;background:rgba(0,0,0,.6)';
        document.body.appendChild(blocker);
      });
      await page.waitForSelector('.cam-floating-wrapper #cam-copy-btn', { timeout: 5000 });

      const start = await page.evaluate(() => {
        const wrapper = document.querySelector('.cam-floating-wrapper');
        const button = document.querySelector('#cam-copy-btn');
        const rect = wrapper.getBoundingClientRect();
        window.__camDragWrapper = wrapper;
        return { left: rect.left, top: rect.top, x: button.getBoundingClientRect().left + 18, y: button.getBoundingClientRect().top + 18 };
      });
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 80, start.y - 60, { steps: 5 });
      await page.waitForFunction(() => document.querySelector('.cam-floating-wrapper')?.classList.contains('cam-dragging'));

      const moved = await page.evaluate(() => {
        const rect = document.querySelector('.cam-floating-wrapper').getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      });
      await new Promise(resolve => setTimeout(resolve, 2200));

      const afterWatchdog = await page.evaluate(() => {
        const wrapper = document.querySelector('.cam-floating-wrapper');
        const rect = wrapper?.getBoundingClientRect();
        return {
          sameWrapper: window.__camDragWrapper === wrapper,
          dragging: wrapper?.classList.contains('cam-dragging') || false,
          left: rect?.left,
          top: rect?.top,
        };
      });
      assert.equal(afterWatchdog.sameWrapper, true, 'watchdog replaced the floating wrapper during a drag');
      assert.equal(afterWatchdog.dragging, true, 'watchdog ended the active drag');
      assert.ok(Math.abs(afterWatchdog.left - moved.left) < 1, 'watchdog reset the dragged horizontal position');
      assert.ok(Math.abs(afterWatchdog.top - moved.top) < 1, 'watchdog reset the dragged vertical position');

      await page.mouse.move(start.x - 120, start.y - 90, { steps: 5 });
      const movedAgain = await page.evaluate(() => {
        const rect = document.querySelector('.cam-floating-wrapper').getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      });
      assert.ok(movedAgain.left < afterWatchdog.left, 'pointer movement stopped after the watchdog tick');
      assert.ok(movedAgain.top < afterWatchdog.top, 'pointer movement stopped after the watchdog tick');
      await page.mouse.up();

      await page.evaluate(() => document.querySelector('#site-popup').remove());
      await page.waitForFunction(() => {
        const button = document.querySelector('article #cam-copy-btn');
        return button && !button.closest('.cam-floating-wrapper');
      }, { timeout: 5000 });
    },
    expected: ['Article body'],
  }));
  await check('Read the Docs classic themes retain the documentation body without generator metadata', () => fixture({
    name: 'Sphinx / Read the Docs', url: 'https://requests.readthedocs.io/en/latest/', html: '<div class="document"><div class="body" role="main"><h1>Guide</h1><p>Documentation body</p><pre>Code sample</pre></div></div><main><dl><dt>Footer label</dt><dd>Footer noise</dd></dl></main>',
    expected: ['Documentation body', 'Code sample'], excluded: ['Footer noise'],
  }));
  await check('Anchored copy controls never appear in converted article content', () => fixture({
    name: 'News (Generic)', url: 'https://www.foxnews.com/science/audit', html: '<article><div class="article-header"><h1>Article title</h1></div><p>Article body</p></article>', ui: true,
    afterLoad: page => page.waitForSelector('#cam-copy-btn'), expected: ['Article body'], excluded: ['Copy as Markdown'],
  }));
  await check('W&B preserves every configuration value and complete notes', () => fixture({
    name: 'Weights & Biases', url: 'https://wandb.ai/team/project/runs/audit', html: '<main>Run</main>',
    afterLoad: page => page.evaluate(() => { window.CONFIG = { BACKEND_HOST: location.origin }; }),
    resources: { '/graphql': { headers: { 'Access-Control-Allow-Origin': 'https://wandb.ai', 'Access-Control-Allow-Credentials': 'true' }, contentType: 'application/json', body: JSON.stringify({ data: { project: { run: {
      displayName: 'Audit', notes: 'n'.repeat(10_010) + 'NOTES_END', config: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`param-${i}`, 'v'.repeat(2010) + `VALUE_END_${i}`])),
    } } } }) } }, expected: ['NOTES_END', 'VALUE_END_100'],
  }));
  await check('MLflow preserves every parameter and complete values', () => fixture({
    name: 'MLflow', url: 'https://mlflow.example/#/experiments/1/runs/audit', html: '<main class="mlflow-ui-container">Run</main>',
    resources: { '/ajax-api/2.0/mlflow/runs/get': { contentType: 'application/json', body: JSON.stringify({ run: {
      info: { run_id: 'audit', run_name: 'Audit' }, data: { params: Array.from({ length: 201 }, (_, i) => ({ key: `param-${i}`, value: 'v'.repeat(2010) + `VALUE_END_${i}` })) },
    } }) } }, expected: ['VALUE_END_200'],
  }));
  await check('Substack custom domains require framework identity and post content', () => fixture({
    name: 'Substack', url: 'https://newsletter.example/p/audit', html: '<meta name="generator" content="Substack"><article><h1>Newsletter</h1><div class="body markup"><p>Full post</p></div></article>', expected: ['Full post'],
  }));

  await check('Markdown tables preserve images, footers, and repeated data', () => fixture({
    name: 'GitLab', url: 'https://gitlab.com/team/project', html: '<main><div id="readme"><table><thead><tr><th>Label</th></tr></thead><tbody><tr><td>Label</td></tr><tr><td>Label</td></tr><tr><td><img alt="Diagram" src="https://media.example/diagram.png"></td></tr></tbody><tfoot><tr><td>Footnote</td></tr></tfoot></table></div></main>',
    expected: ['Diagram', 'https://media.example/diagram.png', 'Footnote', '| Label |\n| Label |'],
  }));
  await check('Markdown tables preserve direct rows alongside a footer', () => fixture({
    name: 'GitLab', url: 'https://gitlab.com/team/project', html: '<main><div id="readme"></div></main>',
    afterLoad: page => page.evaluate(() => {
      const table = document.createElement('table');
      for (const text of ['Header', 'Body']) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
        table.append(row);
      }
      const footer = document.createElement('tfoot');
      footer.innerHTML = '<tr><td>Footer</td></tr>';
      table.append(footer);
      document.querySelector('#readme').append(table);
    }),
    expected: ['| Header |\n| --- |\n| Body |\n| Footer |'],
  }));
  await check('Placement skips hidden anchors and uses a visible alternate', () => fixture({
    name: 'Google Search', url: 'https://www.google.com/search?q=audit', html: '<div hidden><button id="hdtb-tls">Hidden Tools</button></div><div class="yeKjxb" style="width:100px;height:40px">Visible Tools</div>', ui: true,
    afterLoad: async page => {
      await page.waitForSelector('#cam-copy-btn', { visible: true });
      const state = await page.evaluate(() => ({ hidden: !!document.querySelector('[hidden] #cam-copy-btn'), alternate: document.querySelector('.yeKjxb').nextElementSibling?.id }));
      assert.equal(state.hidden, false);
      assert.equal(state.alternate, 'cam-copy-btn');
    },
  }));
  await check('Overlay placement stays visible at narrow viewport edges', () => fixture({
    name: 'YouTube', url: 'https://www.youtube.com/watch?v=audit', html: '<h1>Video</h1><div id="actions" style="position:absolute;left:4px;top:4px;width:80px;height:40px">Actions</div>', ui: true,
    afterLoad: async page => {
      await page.setViewport({ width: 320, height: 568 });
      await page.waitForSelector('#cam-copy-btn', { visible: true });
      await page.waitForFunction(() => {
        const button = document.querySelector('#cam-copy-btn').getBoundingClientRect();
        return button.left >= 8 && button.top >= 8 && button.right <= innerWidth - 8 && button.bottom <= innerHeight - 8;
      }, { timeout: 3000 });
    },
  }));
} finally { await browser.close(); }
assert.deepEqual(failures, [], `Catalog regressions failed: ${failures.join(', ')}`);
