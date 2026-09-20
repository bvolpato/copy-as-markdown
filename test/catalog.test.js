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
