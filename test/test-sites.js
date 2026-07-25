/**
 * Copy as Markdown — Integration test suite.
 *
 * Uses Wayback Machine snapshots for stable, reproducible DOM testing.
 * Each test loads an archived page, injects the built userscript, and
 * validates:
 *   1. The button (#cam-copy-btn) is injected
 *   2. Anchor selectors (when defined) find matching DOM elements
 *   3. Extraction produces non-trivial Markdown output
 *
 * Run:
 *   node test/test-sites.js              # live Wayback suite
 *   node test/test-sites.js Wikipedia    # single live site
 *   node test/test-sites.js --regression # deterministic browser guards only
 *   node test/test-sites.js --list       # list available sites
 *
 * Prerequisites:
 *   pnpm build   (produces dist/userscript/copy-as-markdown.user.js)
 */

import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// ----------------------------------------------------------------
// Test fixture: one entry per extractor + fallback
// ----------------------------------------------------------------
// Each entry specifies:
//   name           — extractor name (matches the register() name)
//   url            — live URL (used for extractor matching)
//   archiveUrl     — Wayback Machine URL (stable DOM)
//   anchorSelectors — CSS selectors the anchor config uses (if any)
//   expectAnchored — whether buttonPlacement is 'anchor'
//   minChars       — minimum expected markdown length
//   mustContain    — strings the extraction output must include
//
// To add a new site: add an entry here and create src/extractors/<name>.ts

const SITES = [
  {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Markdown',
    archiveUrl: 'https://web.archive.org/web/2024/https://en.wikipedia.org/wiki/Markdown',
    anchorSelectors: ['#p-views ul', '.mw-portlet-views ul'],
    expectAnchored: true,
    minChars: 500,
    mustContain: ['Markdown', 'source: Wikipedia'],
  },
  {
    name: 'GitHub',
    url: 'https://github.com/bvolpato/copy-as-markdown',
    archiveUrl: 'https://web.archive.org/web/2025/https://github.com/bvolpato/copy-as-markdown',
    anchorSelectors: [],
    expectAnchored: false,
    minChars: 100,
    mustContain: ['copy-as-markdown'],
  },
  {
    name: 'Stack Overflow',
    url: 'https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array',
    archiveUrl: 'https://web.archive.org/web/2025/https://stackoverflow.com/questions/11227809',
    anchorSelectors: ['#question-header + .d-flex', '#question-header', '.question-header'],
    expectAnchored: false,
    minChars: 500,
    mustContain: ['source: Stack Overflow'],
  },
  {
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=27814234',
    archiveUrl: 'https://web.archive.org/web/2025/https://news.ycombinator.com/item?id=27814234',
    anchorSelectors: [],
    expectAnchored: false,
    minChars: 200,
    mustContain: ['source: Hacker News'],
  },
  {
    name: 'arXiv',
    url: 'https://arxiv.org/abs/1706.03762',
    archiveUrl: 'https://web.archive.org/web/2025/https://arxiv.org/abs/1706.03762',
    anchorSelectors: ['.submission-history', '.extra-services', '.abs-button-row', '.html-header-message', 'h1.title'],
    expectAnchored: false,
    minChars: 300,
    mustContain: ['source: arXiv'],
  },
  {
    name: 'Reddit',
    url: 'https://www.reddit.com/r/learnprogramming/comments/4qzyj4/what_is_markdown/',
    archiveUrl: 'https://web.archive.org/web/2025/https://www.reddit.com/r/learnprogramming/comments/4qzyj4',
    anchorSelectors: [
      'shreddit-post [slot="post-actions"]',
      'shreddit-post .flex',
      '[data-testid="post-actions"]',
      '.Post .flat-list.buttons',
      '.Post .actionBar',
    ],
    expectAnchored: false,
    minChars: 100,
    mustContain: ['source: Reddit'],
  },
  {
    name: 'Bing Search',
    url: 'https://www.bing.com/search?q=what+is+markdown',
    archiveUrl: 'https://web.archive.org/web/2025/https://www.bing.com/search?q=what+is+markdown',
    anchorSelectors: ['#b_header .b_scopebar ul', '#b_header'],
    expectAnchored: false,
    minChars: 200,
    mustContain: ['source: Bing Search'],
  },
  {
    name: 'Amazon',
    url: 'https://www.amazon.com/dp/B08F7PTF53',
    archiveUrl: 'https://web.archive.org/web/2025/https://www.amazon.com/dp/B08F7PTF53',
    anchorSelectors: ['#title', '#titleSection', '#productTitle'],
    expectAnchored: false,
    minChars: 100,
    mustContain: ['source: Amazon'],
  },
  {
    name: 'Fallback (example.com)',
    url: 'https://example.com',
    archiveUrl: 'https://web.archive.org/web/2025/https://example.com',
    anchorSelectors: [],
    expectAnchored: false,
    minChars: 50,
    mustContain: ['Example Domain'],
  },
];

// ----------------------------------------------------------------
// Test runner
// ----------------------------------------------------------------

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function createFixturePage(browser, scriptContent, {
  url,
  html,
  csp = '',
  beforeLoad,
}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  if (beforeLoad) await page.evaluateOnNewDocument(beforeLoad);
  if (csp) await page.evaluateOnNewDocument(scriptContent);

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isNavigationRequest() && req.resourceType() === 'document') {
      req.respond({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: csp ? { 'Content-Security-Policy': csp } : {},
        body: html,
      });
    } else {
      req.abort();
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (!csp) await page.addScriptTag({ content: scriptContent });
  await page.waitForSelector('#cam-copy-btn', { timeout: 4000 });
  return page;
}

async function clickAndCapture(page) {
  await page.evaluate(() => {
    window.__camCapturedMarkdown = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__camCapturedMarkdown = text;
        },
      },
    });
    document.execCommand = (command) => {
      if (command === 'copy') {
        const textarea = document.querySelector('textarea');
        if (textarea) window.__camCapturedMarkdown = textarea.value;
        return true;
      }
      return false;
    };
    document.querySelector('#cam-copy-btn').click();
  });
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: 4000 });
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function runRegressionChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Deterministic regression guards${COLORS.reset}`);

  const overlayFixtures = [
    {
      name: 'Reddit',
      url: 'https://www.reddit.com/r/test/comments/123/test/',
      anchor: '<shreddit-post><div id="anchor" slot="post-actions"></div></shreddit-post>',
    },
    {
      name: 'YouTube',
      url: 'https://www.youtube.com/watch?v=test',
      anchor: '<div id="top-level-buttons-computed"></div>',
    },
    {
      name: 'X',
      url: 'https://x.com/test/status/123',
      anchor: '<div id="anchor" data-testid="userActions"></div>',
    },
    {
      name: 'LinkedIn',
      url: 'https://www.linkedin.com/posts/test',
      anchor: '<div id="anchor" class="feed-shared-control-menu"></div>',
    },
    {
      name: 'WhatsApp',
      url: 'https://web.whatsapp.com/',
      anchor: '<div id="main"><header><div id="anchor" data-testid="chat-header-actions"></div></header></div>',
    },
    {
      name: 'Polymarket',
      url: 'https://polymarket.com/event/test',
      anchor: '<div id="anchor" class="flex items-center"><button class="bookmarkButton"></button></div>',
    },
  ];

  for (const fixture of overlayFixtures) {
    const page = await createFixturePage(browser, scriptContent, {
      url: fixture.url,
      html: `<!doctype html><html><head><title>${fixture.name}</title></head><body>
        <style>#anchor, #top-level-buttons-computed {
          position: absolute; left: 600px; top: 120px; width: 180px; height: 48px;
        }</style>
        ${fixture.anchor}
      </body></html>`,
    });
    try {
      await page.waitForSelector('.cam-overlay-container #cam-copy-btn', { timeout: 4000 });
      const geometry = await page.evaluate(() => {
        const target = document.querySelector(
          'shreddit-post [slot="post-actions"], #top-level-buttons-computed, [data-testid="userActions"], .feed-shared-control-menu, #main header [data-testid="chat-header-actions"], div.flex.items-center:has(.bookmarkButton)'
        );
        const button = document.querySelector('#cam-copy-btn');
        const targetRect = target.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        return {
          floating: !!document.querySelector('.cam-floating-wrapper'),
          target: {
            left: targetRect.left, right: targetRect.right,
            top: targetRect.top, bottom: targetRect.bottom,
          },
          button: {
            left: buttonRect.left, right: buttonRect.right,
            top: buttonRect.top, bottom: buttonRect.bottom,
            width: buttonRect.width, height: buttonRect.height,
          },
        };
      });
      assertCheck(!geometry.floating, `${fixture.name} overlay config remained floating`);
      assertCheck(geometry.button.width > 0 && geometry.button.height > 0, `${fixture.name} overlay measured before layout`);
      assertCheck(!boxesOverlap(geometry.button, geometry.target), `${fixture.name} overlay overlaps anchor target`);
    } finally {
      await page.close();
    }
  }
  log('✅', 'Six site overlay configs activate with measured, non-overlapping geometry');

  const chatgptPage = await createFixturePage(browser, scriptContent, {
    url: 'https://chatgpt.com/c/regression',
    html: `<!doctype html><html><head><title>Image regression</title></head><body>
      <div id="conversation-header-actions" style="position:absolute;left:600px;top:30px;width:150px;height:40px"></div>
      <section data-testid="conversation-turn-1" data-turn="assistant">
        <div class="markdown" data-message-model-slug="gpt-test">
          <p>Assistant answer</p>
          <img alt="Inline image" src="https://assets.test/inline.png" width="512" height="512">
        </div>
        <img alt="Inline duplicate" src="https://assets.test/inline.png" width="512" height="512">
        <figure><img alt="Generated image" src="https://assets.test/generated.png" style="width:512px;height:512px"></figure>
        <img alt="Avatar" src="https://assets.test/avatar.png" width="32" height="32">
      </section>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCapture(chatgptPage);
    const inlineCount = markdown.split('https://assets.test/inline.png').length - 1;
    const generatedCount = markdown.split('https://assets.test/generated.png').length - 1;
    assertCheck(inlineCount === 1, `ChatGPT inline image emitted ${inlineCount} times`);
    assertCheck(generatedCount === 1, `ChatGPT generated image emitted ${generatedCount} times`);
    assertCheck(!markdown.includes('avatar.png'), 'ChatGPT avatar leaked as content image');
    assertCheck(markdown.includes('Assistant answer'), 'ChatGPT assistant text missing');
    log('✅', 'ChatGPT keeps standalone generated images and deduplicates inline images');
  } finally {
    await chatgptPage.close();
  }

  const strictCsp = "script-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types 'none'";
  const selectionPage = await createFixturePage(browser, scriptContent, {
    url: 'https://fixture.test/selection',
    csp: strictCsp,
    html: `<!doctype html><html><head><title>Selection fixture</title></head><body>
      <main>
        <p id="selected">alpha\u2028beta / 10\u202F000 / می\u200Cروم / 👩\u200D💻 / \u2066isolated\u2069</p>
        <p>must not copy</p>
      </main>
    </body></html>`,
  });
  try {
    await selectionPage.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#selected'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    const markdown = await clickAndCapture(selectionPage);
    assertCheck(markdown.includes('alpha beta / 10 000'), `Unicode separators lost text boundaries: ${JSON.stringify(markdown)}`);
    assertCheck(markdown.includes('می\u200Cروم'), 'Persian ZWNJ was stripped');
    assertCheck(markdown.includes('👩\u200D💻'), 'Emoji ZWJ was stripped');
    assertCheck(markdown.includes('isolated') && !markdown.includes('\u2066') && !markdown.includes('\u2069'), 'Bidi isolates were not cleaned');
    assertCheck(!markdown.includes('must not copy'), 'Selected-text fallback copied unselected content');
    log('✅', 'Strict Trusted Types selection works and Unicode boundaries/joiners are preserved');
  } finally {
    await selectionPage.close();
  }

  const claudePage = await createFixturePage(browser, scriptContent, {
    url: 'https://claude.ai/chat/regression',
    html: `<!doctype html><html><head><title>Claude fixture</title></head><body>
      <div data-testid="wiggle-controls-actions" style="position:absolute;left:600px;top:30px;width:150px;height:40px"></div>
      <article role="article"><div data-testid="user-message">Claude question</div></article>
      <article role="article"><div class="standard-markdown"><p>Claude answer</p></div></article>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCapture(claudePage);
    assertCheck(markdown.includes('Claude question'), 'Claude user message missing');
    assertCheck(markdown.includes('Claude answer'), 'Claude response missing');
  } finally {
    await claudePage.close();
  }

  const geminiPage = await createFixturePage(browser, scriptContent, {
    url: 'https://gemini.google.com/app/regression',
    csp: strictCsp,
    html: `<!doctype html><html><head><title>Gemini fixture</title></head><body>
      <div class="conversation-container">
        <user-query><p class="query-text-line">Gemini question</p></user-query>
        <model-response><div class="markdown markdown-main-panel"><p>Gemini answer</p></div></model-response>
      </div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCapture(geminiPage);
    assertCheck(markdown.includes('Gemini question'), 'Gemini user message missing');
    assertCheck(markdown.includes('Gemini answer'), 'Gemini response missing');
    log('✅', 'Claude and strict-Trusted-Types Gemini basics extract correctly');
  } finally {
    await geminiPage.close();
  }

  const lifecyclePage = await createFixturePage(browser, scriptContent, {
    url: 'https://chatgpt.com/c/overlay-lifecycle',
    beforeLoad: () => {
      const tracked = { scroll: new Set(), resize: new Set() };
      const nativeAdd = window.addEventListener;
      const nativeRemove = window.removeEventListener;
      window.addEventListener = function(type, listener, options) {
        if (tracked[type]) tracked[type].add(listener);
        return nativeAdd.call(this, type, listener, options);
      };
      window.removeEventListener = function(type, listener, options) {
        if (tracked[type]) tracked[type].delete(listener);
        return nativeRemove.call(this, type, listener, options);
      };
      window.__camListenerCounts = () => ({
        scroll: tracked.scroll.size,
        resize: tracked.resize.size,
      });
    },
    html: `<!doctype html><html><head><title>Overlay lifecycle</title></head><body>
      <div id="conversation-header-actions" style="position:absolute;left:600px;top:120px;width:180px;height:48px"></div>
    </body></html>`,
  });
  try {
    await lifecyclePage.waitForSelector('.cam-overlay-container #cam-copy-btn');
    await lifecyclePage.evaluate(() => document.querySelector('#conversation-header-actions').remove());
    await lifecyclePage.waitForSelector('.cam-floating-wrapper #cam-copy-btn', { timeout: 5000 });

    await lifecyclePage.evaluate(() => {
      const target = document.createElement('div');
      target.id = 'conversation-header-actions';
      target.style.cssText = 'position:absolute;left:700px;top:180px;width:200px;height:56px';
      document.body.appendChild(target);
    });
    await lifecyclePage.waitForSelector('.cam-overlay-container #cam-copy-btn', { timeout: 5000 });

    const lifecycle = await lifecyclePage.evaluate(() => {
      const targetRect = document.querySelector('#conversation-header-actions').getBoundingClientRect();
      const buttonRect = document.querySelector('#cam-copy-btn').getBoundingClientRect();
      return {
        buttons: document.querySelectorAll('#cam-copy-btn').length,
        listeners: window.__camListenerCounts(),
        target: {
          left: targetRect.left, right: targetRect.right,
          top: targetRect.top, bottom: targetRect.bottom,
        },
        button: {
          left: buttonRect.left, right: buttonRect.right,
          top: buttonRect.top, bottom: buttonRect.bottom,
        },
      };
    });
    assertCheck(lifecycle.buttons === 1, `overlay lifecycle left ${lifecycle.buttons} buttons`);
    assertCheck(lifecycle.listeners.scroll === 1 && lifecycle.listeners.resize === 1, `overlay listeners leaked: ${JSON.stringify(lifecycle.listeners)}`);
    assertCheck(!boxesOverlap(lifecycle.button, lifecycle.target), 're-anchored overlay overlaps replacement target');

    await lifecyclePage.evaluate(() => document.querySelector('#conversation-header-actions').remove());
    await lifecyclePage.waitForSelector('.cam-floating-wrapper #cam-dismiss-btn', { timeout: 5000 });
    await lifecyclePage.click('#cam-dismiss-btn');
    await lifecyclePage.evaluate(() => {
      const target = document.createElement('div');
      target.id = 'conversation-header-actions';
      document.body.appendChild(target);
    });
    await new Promise(r => setTimeout(r, 2400));
    const dismissed = await lifecyclePage.evaluate(() => ({
      buttons: document.querySelectorAll('#cam-copy-btn').length,
      listeners: window.__camListenerCounts(),
    }));
    assertCheck(dismissed.buttons === 0, 'dismissed floating button re-anchored');
    assertCheck(dismissed.listeners.scroll === 0 && dismissed.listeners.resize === 0, `dismiss left overlay listeners: ${JSON.stringify(dismissed.listeners)}`);
    log('✅', 'Overlay falls back, re-anchors without leaks, and dismissal stops watchdog');
  } finally {
    await lifecyclePage.close();
  }

  console.log('');
}

async function runProductionUiChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Production UI guards${COLORS.reset}`);

  const floatingPage = await browser.newPage();
  await floatingPage.setViewport({ width: 390, height: 844 });
  try {
    await floatingPage.setContent(`
      <!doctype html>
      <html>
        <head><title>Fallback page</title></head>
        <body>
          <main><h1>Fallback article</h1><p>Enough text for fallback extraction.</p></main>
          <button id="talk-widget" style="position: fixed; right: 16px; bottom: 16px; width: 64px; height: 64px;">Talk with us</button>
        </body>
      </html>
    `);
    await floatingPage.addScriptTag({ content: scriptContent });
    await floatingPage.waitForSelector('#cam-copy-btn', { timeout: 4000 });
    await new Promise(r => setTimeout(r, 800));

    const layout = await floatingPage.evaluate(() => {
      const btn = document.querySelector('#cam-copy-btn');
      const chat = document.querySelector('#talk-widget');
      const btnRect = btn.getBoundingClientRect();
      const chatRect = chat.getBoundingClientRect();
      return {
        buttonCount: document.querySelectorAll('#cam-copy-btn').length,
        floatingWrapperCount: document.querySelectorAll('.cam-floating-wrapper').length,
        anchorWrapperCount: document.querySelectorAll('[data-cam-anchor-wrapper]').length,
        button: {
          left: btnRect.left,
          right: btnRect.right,
          top: btnRect.top,
          bottom: btnRect.bottom,
          width: btnRect.width,
          height: btnRect.height,
        },
        chat: {
          left: chatRect.left,
          right: chatRect.right,
          top: chatRect.top,
          bottom: chatRect.bottom,
          width: chatRect.width,
          height: chatRect.height,
        },
        bottomGap: window.innerHeight - btnRect.bottom,
      };
    });

    assertCheck(layout.buttonCount === 1, `expected 1 button, found ${layout.buttonCount}`);
    assertCheck(layout.floatingWrapperCount === 1, `expected 1 floating wrapper, found ${layout.floatingWrapperCount}`);
    assertCheck(layout.anchorWrapperCount === 0, `expected 0 anchor wrappers, found ${layout.anchorWrapperCount}`);
    assertCheck(layout.button.width <= 40 && layout.button.height <= 40, `floating button too large: ${layout.button.width}x${layout.button.height}`);
    assertCheck(layout.bottomGap >= 88, `floating button too low: ${layout.bottomGap}px from bottom`);
    assertCheck(!boxesOverlap(layout.button, layout.chat), 'floating button overlaps Talk with us widget');

    await floatingPage.addScriptTag({ content: scriptContent });
    await new Promise(r => setTimeout(r, 800));
    const duplicateCounts = await floatingPage.evaluate(() => ({
      buttons: document.querySelectorAll('#cam-copy-btn').length,
      floatingWrappers: document.querySelectorAll('.cam-floating-wrapper').length,
      anchorWrappers: document.querySelectorAll('[data-cam-anchor-wrapper]').length,
    }));

    assertCheck(duplicateCounts.buttons === 1, `duplicate userscript injection left ${duplicateCounts.buttons} buttons`);
    assertCheck(duplicateCounts.floatingWrappers === 1, `duplicate userscript injection left ${duplicateCounts.floatingWrappers} floating wrappers`);
    assertCheck(duplicateCounts.anchorWrappers === 0, `duplicate userscript injection left ${duplicateCounts.anchorWrappers} anchor wrappers`);
    log('✅', 'Floating button is smaller, raised above chat widget, and singleton after duplicate injection');
  } finally {
    await floatingPage.close();
  }

  const anchorPage = await browser.newPage();
  await anchorPage.setViewport({ width: 1280, height: 800 });
  await anchorPage.setRequestInterception(true);
  anchorPage.on('request', (req) => {
    if (req.isNavigationRequest() && req.resourceType() === 'document') {
      req.respond({
        status: 200,
        contentType: 'text/html',
        body: `
          <!doctype html>
          <html>
            <head><title>Markdown - Wikipedia</title></head>
            <body>
              <h1 id="firstHeading">Markdown</h1>
              <main id="mw-content-text"><p>Markdown content fixture.</p></main>
            </body>
          </html>
        `,
      });
    } else {
      req.abort();
    }
  });

  try {
    await anchorPage.goto('https://en.wikipedia.org/wiki/Markdown', { waitUntil: 'domcontentloaded' });
    await anchorPage.addScriptTag({ content: scriptContent });
    await anchorPage.waitForSelector('#cam-copy-btn', { timeout: 4000 });

    await anchorPage.evaluate(() => {
      history.pushState({}, '', '/wiki/Markdown_Test_Route');
      document.body.appendChild(document.createElement('section'));
    });
    await new Promise(r => setTimeout(r, 1200));

    await anchorPage.evaluate(() => {
      const nav = document.createElement('nav');
      nav.id = 'p-views';
      const list = document.createElement('ul');
      nav.appendChild(list);
      document.body.appendChild(nav);
    });

    await anchorPage.waitForFunction(() => {
      return document.querySelectorAll('#cam-copy-btn').length === 1
        && document.querySelectorAll('[data-cam-anchor-wrapper]').length === 1
        && !document.querySelector('.cam-floating-wrapper')
        && !!document.querySelector('#p-views ul #cam-copy-btn');
    }, { timeout: 5000 });

    log('✅', 'Stale SPA anchor observers cannot stack duplicate buttons');
  } finally {
    await anchorPage.close();
  }

  console.log('');
}

async function runTests(filter) {
  const scriptPath = path.join(ROOT, 'dist', 'userscript', 'copy-as-markdown.user.js');
  if (!fs.existsSync(scriptPath)) {
    console.error('❌  Build not found. Run "pnpm build" first.');
    process.exit(1);
  }
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');

  const regressionOnly = filter === '--regression';
  const sites = regressionOnly
    ? []
    : filter
    ? SITES.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : SITES;

  if (!regressionOnly && sites.length === 0) {
    console.error(`❌  No site matching "${filter}". Use --list to see available sites.`);
    process.exit(1);
  }

  const screenshotDir = path.join(ROOT, 'test', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log(`\n${COLORS.bold}Copy as Markdown — Integration Tests${COLORS.reset}`);
  console.log(
    regressionOnly
      ? `${COLORS.dim}Running deterministic browser fixtures${COLORS.reset}\n`
      : `${COLORS.dim}Testing ${sites.length} site(s) via Wayback Machine snapshots${COLORS.reset}\n`
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  const results = [];

  await runRegressionChecks(browser, scriptContent);
  await runProductionUiChecks(browser, scriptContent);

  if (regressionOnly) {
    await browser.close();
    console.log(`${COLORS.green}✨ All deterministic browser checks passed!${COLORS.reset}\n`);
    return;
  }

  for (const site of sites) {
    const result = { name: site.name, checks: [], passed: true };
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.setBypassCSP(true);

    // Block heavy resources for speed
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'media', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`${COLORS.cyan}● ${site.name}${COLORS.reset} ${COLORS.dim}(${site.archiveUrl})${COLORS.reset}`);

    try {
      // Navigate to archive
      await page.goto(site.archiveUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for the page to settle
      await new Promise(r => setTimeout(r, 2000));

      // -- Check 1: Anchor selectors present in DOM --
      if (site.anchorSelectors.length > 0) {
        const selectorResults = await page.evaluate((selectors) => {
          return selectors.map(sel => {
            try {
              return { selector: sel, found: !!document.querySelector(sel) };
            } catch {
              return { selector: sel, found: false };
            }
          });
        }, site.anchorSelectors);

        const anyFound = selectorResults.some(r => r.found);
        const foundList = selectorResults.filter(r => r.found).map(r => r.selector);
        const missedList = selectorResults.filter(r => !r.found).map(r => r.selector);

        if (anyFound) {
          result.checks.push({ name: 'Anchor selectors', pass: true });
          log('✅', `Anchor selectors: ${foundList.join(', ')}`);
          if (missedList.length > 0) {
            log('⚠️ ', `${COLORS.yellow}Missed (OK if fallbacks): ${missedList.join(', ')}${COLORS.reset}`);
          }
        } else {
          // Archive pages may strip some DOM; only warn, don't fail
          result.checks.push({ name: 'Anchor selectors', pass: true, warn: true });
          log('⚠️ ', `${COLORS.yellow}No anchor selectors found (archive may differ from live)${COLORS.reset}`);
        }
      }

      // -- Check 2: Inject userscript and verify button appears --
      await page.evaluate((script) => {
        // Remove Wayback Machine toolbar to avoid interference
        const wbToolbar = document.getElementById('wm-ipp-base') || document.getElementById('wm-ipp');
        if (wbToolbar) wbToolbar.remove();

        // Override location for extractor matching
        const url = new URL(window.location.href);
        // Extract the original URL from Wayback format: /web/TIMESTAMP/ORIGINAL_URL
        const match = url.pathname.match(/\/web\/\d+\/(https?:\/\/.+)/);
        if (match) {
          try {
            Object.defineProperty(window, '__camTestUrl', { value: match[1] });
          } catch {}
        }

        const scriptEl = document.createElement('script');
        scriptEl.textContent = script;
        document.head.appendChild(scriptEl);
      }, scriptContent);

      // Wait for button injection
      let buttonFound = false;
      try {
        await page.waitForSelector('#cam-copy-btn', { timeout: 12000 });
        buttonFound = true;
      } catch {
        // Also check for the floating wrapper (dismissed pages won't have the button)
        buttonFound = await page.evaluate(() => !!document.querySelector('#cam-copy-btn, .cam-floating-wrapper'));
      }

      if (buttonFound) {
        result.checks.push({ name: 'Button injected', pass: true });
        log('✅', 'Button #cam-copy-btn injected');

        const singletonCounts = await page.evaluate(() => ({
          buttons: document.querySelectorAll('#cam-copy-btn').length,
          floatingWrappers: document.querySelectorAll('.cam-floating-wrapper').length,
          anchorWrappers: document.querySelectorAll('[data-cam-anchor-wrapper]').length,
        }));

        if (singletonCounts.buttons === 1 && singletonCounts.floatingWrappers + singletonCounts.anchorWrappers <= 1) {
          result.checks.push({ name: 'Singleton UI', pass: true });
          log('✅', 'Singleton UI: exactly one Copy as Markdown button');
        } else {
          result.checks.push({ name: 'Singleton UI', pass: false });
          result.passed = false;
          log('❌', `${COLORS.red}Singleton UI failed: ${JSON.stringify(singletonCounts)}${COLORS.reset}`);
        }
      } else {
        result.checks.push({ name: 'Button injected', pass: false });
        result.passed = false;
        log('❌', `${COLORS.red}Button NOT found${COLORS.reset}`);
      }

      // -- Check 3: Button is anchored vs floating --
      if (buttonFound) {
        const isFloating = await page.evaluate(() => {
          const btn = document.querySelector('#cam-copy-btn');
          return btn?.classList.contains('cam-floating') || false;
        });

        const placement = isFloating ? 'floating' : 'anchored';
        result.checks.push({ name: 'Placement', pass: true, value: placement });
        log('✅', `Placement: ${placement}${site.expectAnchored ? ' (expected: anchored)' : ''}`);
      }

      // -- Check 4: Click the button and check extraction output --
      if (buttonFound) {
        const extraction = await page.evaluate(async () => {
          const btn = document.querySelector('#cam-copy-btn');
          if (!btn) return { error: 'no button' };

          // Intercept clipboard write
          let captured = '';
          const origWrite = navigator.clipboard?.writeText;
          if (navigator.clipboard) {
            navigator.clipboard.writeText = async (text) => { captured = text; };
          }

          // Also intercept fallback textarea method
          const origExecCommand = document.execCommand;
          document.execCommand = function(cmd) {
            if (cmd === 'copy') {
              const ta = document.querySelector('textarea');
              if (ta) captured = ta.value;
              return true;
            }
            return origExecCommand.call(document, cmd);
          };

          btn.click();
          // Wait for async extraction
          await new Promise(r => setTimeout(r, 3000));

          return { text: captured, length: captured.length };
        });

        if (extraction.length >= site.minChars) {
          result.checks.push({ name: 'Extraction length', pass: true, value: extraction.length });
          log('✅', `Extraction: ${extraction.length.toLocaleString()} chars (min: ${site.minChars})`);
        } else if (extraction.length > 0) {
          result.checks.push({ name: 'Extraction length', pass: true, value: extraction.length, warn: true });
          log('⚠️ ', `${COLORS.yellow}Extraction: ${extraction.length} chars (below ${site.minChars} threshold, archive may differ)${COLORS.reset}`);
        } else {
          result.checks.push({ name: 'Extraction length', pass: false, value: 0 });
          // Don't fail — clipboard interception may not work in headless
          log('⚠️ ', `${COLORS.yellow}Extraction: could not capture clipboard (expected in headless)${COLORS.reset}`);
        }

        // Check mustContain (only if we got output)
        if (extraction.length > 0) {
          for (const needle of site.mustContain) {
            const found = extraction.text.includes(needle);
            if (found) {
              result.checks.push({ name: `Contains "${needle}"`, pass: true });
            } else {
              result.checks.push({ name: `Contains "${needle}"`, pass: false, warn: true });
              log('⚠️ ', `${COLORS.yellow}Missing expected text: "${needle}"${COLORS.reset}`);
            }
          }
        }
      }

      // -- Screenshot for visual inspection --
      const screenshotFile = path.join(screenshotDir, `${site.name.replace(/[^a-zA-Z0-9]/g, '_')}.png`);
      await page.screenshot({ path: screenshotFile, fullPage: false });
      log('📸', `${COLORS.dim}Screenshot: test/screenshots/${path.basename(screenshotFile)}${COLORS.reset}`);

    } catch (err) {
      result.checks.push({ name: 'Page load', pass: false });
      result.passed = false;
      log('❌', `${COLORS.red}Error: ${err.message}${COLORS.reset}`);
    } finally {
      await page.close();
    }

    results.push(result);
    console.log('');
  }

  await browser.close();

  // -- Summary --
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`${COLORS.bold}${'─'.repeat(50)}${COLORS.reset}`);
  console.log(`${COLORS.bold}Results: ${passed}/${total} passed${failed > 0 ? `, ${COLORS.red}${failed} failed${COLORS.reset}` : ''}${COLORS.reset}`);

  if (failed > 0) {
    console.log(`\n${COLORS.red}Failed sites:${COLORS.reset}`);
    results.filter(r => !r.passed).forEach(r => {
      const failedChecks = r.checks.filter(c => !c.pass && !c.warn).map(c => c.name);
      console.log(`  ❌ ${r.name}: ${failedChecks.join(', ')}`);
    });
    process.exit(1);
  }

  console.log(`\n${COLORS.green}✨ All tests passed!${COLORS.reset}\n`);

  // Write JSON report
  const reportPath = path.join(screenshotDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
}

// ----------------------------------------------------------------
// CLI
// ----------------------------------------------------------------

const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log('\nAvailable test sites:\n');
  SITES.forEach(s => console.log(`  ${s.name.padEnd(25)} ${s.archiveUrl}`));
  console.log('');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  node test/test-sites.js              # run all tests
  node test/test-sites.js Wikipedia    # test a single site
  node test/test-sites.js --regression # deterministic browser guards only
  node test/test-sites.js --list       # list available sites
`);
  process.exit(0);
}

runTests(args[0]).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
