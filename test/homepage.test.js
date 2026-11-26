import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://homepage.fixture.test';
const CHROME_STORE = 'https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol';
const FIREFOX_STORE = 'https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/';
const USERSCRIPT = 'https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js';
const TYPES = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png',
};

let browser;
before(async () => { browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-setuid-sandbox'] }); });
after(async () => { await browser?.close(); });

/** Serve docs/ from one origin. Every other request is recorded and blocked. */
async function openHomepage({ width = 1280, height = 800, hash = '', javascript = true } = {}) {
  const page = await browser.newPage();
  const state = { page, errors: [], thirdParty: [] };
  await page.setViewport({ width, height });
  await page.setJavaScriptEnabled(javascript);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copied = text; } },
    });
  });
  page.on('pageerror', (error) => state.errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:') return request.continue();
    if (url.origin !== ORIGIN) {
      state.thirdParty.push(request.url());
      return request.abort();
    }
    const file = path.join(ROOT, 'docs', url.pathname === '/' ? 'index.html' : url.pathname);
    try {
      return await request.respond({
        contentType: TYPES[path.extname(file)] || 'application/octet-stream',
        body: await readFile(file),
      });
    } catch {
      state.errors.push(`missing file: ${url.pathname}`);
      return request.respond({ status: 404, body: '' });
    }
  });
  await page.goto(`${ORIGIN}/${hash}`, { waitUntil: 'networkidle0' });
  return state;
}

async function withHomepage(options, run) {
  const state = await openHomepage(options);
  try {
    await run(state.page, state);
    assert.deepEqual(state.errors, []);
    assert.deepEqual(state.thirdParty, [], 'the homepage must not contact third parties');
  } finally {
    await state.page.close();
  }
}

test('install choices are equal, have logos, and point to the live downloads', () => withHomepage({}, async (page) => {
  const links = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-hero-install], [data-install] a')].map((link) => [
      `${link.dataset.heroInstall ? 'hero' : 'card'}:${link.dataset.heroInstall || link.closest('[data-install]').dataset.install}`,
      {
        href: link.href,
        primary: link.classList.contains('btn-install'),
        logo: Boolean((link.querySelector('img') || link.closest('[data-install]').querySelector('img')).naturalWidth),
      },
    ]),
  ));
  const expected = { chrome: CHROME_STORE, firefox: FIREFOX_STORE, userscript: USERSCRIPT };
  for (const place of ['hero', 'card']) {
    for (const [type, href] of Object.entries(expected)) {
      assert.deepEqual(links[`${place}:${type}`], { href, primary: true, logo: true }, `${place} ${type}`);
    }
  }
  assert.equal(
    await page.$eval('.latest-release', (link) => link.href),
    'https://github.com/bvolpato/copy-as-markdown/releases/latest',
  );
}));

test('the demo converts each sample and keeps page noise out', () => withHomepage({}, async (page) => {
  const samples = {
    article: { has: ['# How to read a tide table', '| High | 06:12 | 3.4 m |', '1. Hours 1 and 6 move **one twelfth** each.'], noise: 'newsletter' },
    review: { has: ['# Retry only idempotent requests', '```ts\nconst SAFE', '> Can we accept `POST`'], noise: 'Merge when ready' },
    chat: { has: ['**Ana** (14:02)', '```sql\nSELECT price', '1. Roll back now.'], noise: 'Ben is typing' },
  };
  for (const [sample, { has, noise }] of Object.entries(samples)) {
    await page.click(`[data-sample="${sample}"]`);
    await page.waitForFunction((text) => [...document.querySelectorAll('#demo-out .line')].map((line) => line.textContent).join('\n').includes(text), {}, has[0]);
    await page.click('#run-demo');
    await page.waitForFunction((text) => window.__copied?.includes(text), {}, has[0]);
    const copied = await page.evaluate(() => window.__copied);
    for (const text of has) assert.ok(copied.includes(text), `${sample}: ${text}\n${copied}`);
    assert.ok(!copied.includes(noise), `${sample} kept "${noise}"`);
    await page.click('[data-out="plain"]');
    assert.ok((await page.$eval('#demo-out', (out) => out.textContent)).includes(noise), `${sample} plain copy`);
  }
}));

test('pasted HTML is converted and stays inert', () => withHomepage({}, async (page) => {
  await page.click('[data-sample="paste"]');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/html', '<h2>Pasted</h2><p><b>bold</b> <img src="https://tracker.test/x.png" onerror="window.__ran = true"></p><script>window.__ran = true<\/script>');
    data.setData('text/plain', 'Pasted\nbold');
    document.querySelector('#paste-box').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const output = await page.$eval('#demo-out', (out) => [...out.querySelectorAll('.line')].map((line) => line.textContent).join('\n'));
  assert.ok(output.includes('## Pasted') && output.includes('**bold**'), output);
  assert.equal(await page.evaluate(() => window.__ran), undefined);
}));

test('the page shows and copies itself as Markdown', () => withHomepage({}, async (page) => {
  await page.click('[data-view="markdown"]');
  await page.waitForSelector('.view-markdown #markdown-out .line');
  assert.equal(await page.$eval('#main', (main) => getComputedStyle(main).display), 'none');
  await page.click('#copy-view');
  const view = await page.evaluate(() => window.__copied);
  assert.ok(view.startsWith('---\ntitle: Copy as Markdown\n'), view.slice(0, 80));
  assert.ok(view.includes('# Copy the page. Leave the mess.'));
  assert.match(view, /\| \[Wikipedia article\]\(https:\/\/en\.wikipedia\.org\/wiki\/Markdown\) \|/);
  await page.click('[data-view="page"]');
  await page.waitForFunction(() => !document.documentElement.classList.contains('view-markdown'));
  const callout = '.try-here';
  assert.ok(await page.$eval(callout, (label) => label.checkVisibility({ visibilityProperty: true })));
  await page.click(`${callout} span`);
  await page.waitForSelector('#copy_as_markdown_btn.success');
  assert.equal(await page.evaluate(() => window.__copied), view);
  assert.equal(await page.$eval(callout, (label) => label.checkVisibility({ visibilityProperty: true })), false);
}));

test('a #markdown link opens the Markdown view', () => withHomepage({ hash: '#markdown' }, async (page) => {
  assert.ok(await page.$('.view-markdown #markdown-out .line'));
}));

test('the site filter finds sites and explains a miss', () => withHomepage({}, async (page) => {
  const visible = () => page.$$eval('[data-extractor]', (items) => items.filter((item) => item.offsetParent).map((item) => item.dataset.extractor));
  const total = (await visible()).length;
  await page.type('#site-filter', 'pull requests');
  assert.deepEqual((await visible()).sort(), ['bitbucket', 'gitea', 'github']);
  await page.$eval('#site-filter', (input) => { input.value = 'no such site'; input.dispatchEvent(new Event('input')); });
  assert.deepEqual(await visible(), []);
  assert.match(await page.$eval('#site-result', (result) => result.textContent), /general one/);
  await page.$eval('#site-filter', (input) => { input.value = ''; input.dispatchEvent(new Event('input')); });
  assert.equal((await visible()).length, total);
}));

test('every section is visible and fits on a phone', () => withHomepage({ width: 390, height: 844 }, async (page) => {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hidden: [...document.querySelectorAll('main > section')]
      .filter((section) => getComputedStyle(section).opacity !== '1' || section.offsetHeight < 100)
      .map((section) => section.id || section.className),
  }));
  assert.deepEqual(layout, { overflow: 0, hidden: [] });
}));

test('the content is complete without JavaScript', () => withHomepage({ javascript: false }, async (page) => {
  const items = await page.$$eval('[data-extractor] span', (spans) => spans.filter((item) => item.offsetParent).length);
  assert.equal(items, await page.$$eval('[data-extractor]', (all) => all.length));
}));

test('the userscript respects the copy button that the page owns', () => withHomepage({}, async (page) => {
  await page.addScriptTag({ content: await readFile(path.join(ROOT, 'dist/userscript/copy-as-markdown.user.js'), 'utf8') });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal(await page.$$eval('#cam-copy-btn', (buttons) => buttons.length), 0);
  assert.equal(await page.$$eval('#copy_as_markdown_btn', (buttons) => buttons.length), 1);
  await page.emulateMediaType('print');
  assert.equal(await page.$eval('.live-demo-wrapper', (element) => getComputedStyle(element).display), 'none');
}));
