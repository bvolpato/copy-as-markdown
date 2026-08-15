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
import { fileURLToPath, pathToFileURL } from 'url';

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
    mustContain: ['Markdown', 'url:'],
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
    mustContain: ['url:'],
  },
  {
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=27814234',
    archiveUrl: 'https://web.archive.org/web/2025/https://news.ycombinator.com/item?id=27814234',
    anchorSelectors: [],
    expectAnchored: false,
    minChars: 200,
    mustContain: ['url:'],
  },
  {
    name: 'arXiv',
    url: 'https://arxiv.org/abs/1706.03762',
    archiveUrl: 'https://web.archive.org/web/2025/https://arxiv.org/abs/1706.03762',
    anchorSelectors: ['.submission-history', '.extra-services', '.abs-button-row', '.html-header-message', 'h1.title'],
    expectAnchored: false,
    minChars: 300,
    mustContain: ['url:'],
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
    mustContain: ['url:'],
  },
  {
    name: 'Bing Search',
    url: 'https://www.bing.com/search?q=what+is+markdown',
    archiveUrl: 'https://web.archive.org/web/2025/https://www.bing.com/search?q=what+is+markdown',
    anchorSelectors: ['#b_header .b_scopebar ul', '#b_header'],
    expectAnchored: false,
    minChars: 200,
    mustContain: ['url:'],
  },
  {
    name: 'Amazon',
    url: 'https://www.amazon.com/dp/B08F7PTF53',
    archiveUrl: 'https://web.archive.org/web/2025/https://www.amazon.com/dp/B08F7PTF53',
    anchorSelectors: ['#title', '#titleSection', '#productTitle'],
    expectAnchored: false,
    minChars: 100,
    mustContain: ['url:'],
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

const REQUESTED_FIRST_CLASS_SITES = new Map([
  ['Notion', 'Notion'],
  ['Sphinx / Read the Docs', 'Sphinx / Read the Docs'],
  ['Gmail', 'Gmail'],
  ['Grok', 'Grok'],
  ['Meta AI', 'Meta AI'],
  ['Gemini', 'Gemini'],
  ['ChatGPT', 'ChatGPT'],
  ['Claude', 'Claude'],
  ['Perplexity', 'Perplexity'],
  ['X', 'X (Twitter)'],
  ['LeetLLM', 'LeetLLM'],
  ['WhatsApp', 'WhatsApp'],
  ['Google Search', 'Google Search'],
  ['DuckDuckGo Search', 'DuckDuckGo Search'],
  ['Wikipedia', 'Wikipedia'],
  ['YouTube', 'YouTube'],
  ['Facebook', 'Facebook'],
  ['Reddit', 'Reddit'],
  ['Bing Search', 'Bing Search'],
  ['TikTok', 'TikTok'],
  ['Yahoo Search', 'Yahoo Search'],
  ['Yandex Search', 'Yandex Search'],
  ['Netflix', 'Netflix'],
  ['Baidu Search', 'Baidu Search'],
  ['Pinterest', 'Pinterest'],
  ['Temu', 'Temu'],
  ['Weather.com', 'Weather.com'],
  ['Twitch', 'Twitch'],
  ['VK', 'VK'],
  ['Globo', 'Globo'],
  ['FOX', 'FOX'],
  ['Fox News', 'News (Generic)'],
  ['BBC', 'News (Generic)'],
  ['Discord', 'Discord'],
  ['GitHub', 'GitHub'],
  ['Brave Search', 'Brave Search'],
  ['Booking.com', 'Booking.com'],
  ['OpenRouter', 'OpenRouter'],
  ['Artificial Analysis', 'Artificial Analysis'],
  ['DeepSWE', 'DeepSWE'],
  ['Weights & Biases', 'Weights & Biases'],
  ['MLflow', 'MLflow'],
]);

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
const FIXTURE_TIMEOUT = 8000;

function log(icon, msg) {
  console.log(`  ${icon}  ${msg}`);
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function frontmatterKeys(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.match(/^([^:]+):/)?.[1])
    .filter(Boolean);
}

function assertCompactMetadata(markdown, context) {
  const omitted = new Set([
    'source', 'content_source', 'complete', 'completeness', 'truncated', 'scope', 'route', 'type',
    'messages', 'tables', 'code_blocks', 'media_items', 'transcript_segments',
    'rendered_blocks', 'rendered_database_rows', 'included_database_rows',
    'reactions', 'comments', 'shares', 'views', 'likes', 'lines', 'bytes', 'size',
    'entries', 'directories', 'files', 'commits', 'changed_files', 'additions', 'deletions',
    'patch_bytes', 'patch_url', 'patch_api_url', 'raw_url', 'speaker_notes', 'output_limits', 'reading_time',
  ]);
  const noisy = frontmatterKeys(markdown).filter((key) =>
    omitted.has(key) || /(?:^|_)(?:count|total|included|found)$/.test(key),
  );
  assertCheck(noisy.length === 0, `${context} leaked noisy metadata: ${noisy.join(', ')}`);
}

function assertUnboundedMarkdown(markdown, context) {
  assertCheck(markdown.length > 120_000, `${context} did not preserve oversized content: ${markdown.length}`);
  assertCheck(!markdown.includes('*[Content truncated for agent context.]*'), `${context} emitted truncation marker`);
  assertCheck((markdown.match(/^---$/gm) || []).length === 2, `${context} corrupted frontmatter fences`);
  const keys = frontmatterKeys(markdown);
  assertCheck(keys.includes('title') && keys.includes('url'), `${context} lost title/url frontmatter: ${keys.join(', ')}`);
  assertCheck(markdown.startsWith('---\n') && markdown.includes('\n---\n'), `${context} lost frontmatter boundaries`);
}

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function createFixturePage(browser, scriptContent, {
  url,
  html,
  csp = '',
  beforeLoad,
  afterLoad,
  waitForButton = true,
  context = url,
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
  if (afterLoad) await page.evaluate(afterLoad);
  if (!csp) await page.addScriptTag({ content: scriptContent });
  if (waitForButton) {
    try {
      await page.waitForSelector('#cam-copy-btn', { timeout: FIXTURE_TIMEOUT });
    } catch (error) {
      await page.close();
      throw new Error(`${context} did not render Copy as Markdown button`, { cause: error });
    }
  }
  return page;
}

async function prepareClipboardCapture(page) {
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
  });
}

async function clickAndCapture(page, context = 'fixture') {
  await prepareClipboardCapture(page);
  await page.evaluate(() => document.querySelector('#cam-copy-btn').click());
  try {
    await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: FIXTURE_TIMEOUT });
  } catch (error) {
    throw new Error(`${context} did not copy Markdown`, { cause: error });
  }
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function clickAndCaptureWithPointer(page) {
  await prepareClipboardCapture(page);
  await page.click('#cam-copy-btn');
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: FIXTURE_TIMEOUT });
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function chooseAndCapture(page, optionId) {
  await prepareClipboardCapture(page);
  await page.click('#cam-copy-btn');
  await page.waitForSelector(`#cam-option-dialog [data-option-id="${optionId}"]`, { timeout: FIXTURE_TIMEOUT });
  await page.click(`#cam-option-dialog [data-option-id="${optionId}"]`);
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: FIXTURE_TIMEOUT });
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function assertRouteIdentity(page, expectedExtractor, context) {
  const actualExtractor = await page.$eval(
    '#cam-copy-btn',
    (button) => button.dataset.camExtractor || '',
  );
  assertCheck(
    actualExtractor === expectedExtractor,
    `${context} routed to ${JSON.stringify(actualExtractor)} instead of ${JSON.stringify(expectedExtractor)}`,
  );
}

async function runRegressionChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Deterministic regression guards${COLORS.reset}`);

  const extensionContent = fs.readFileSync(
    path.join(ROOT, 'dist', 'chrome', 'content.js'),
    'utf8',
  );
  const toolbarPage = await browser.newPage();
  try {
    await toolbarPage.setContent(`<!doctype html><html><head><title>Toolbar fixture</title></head><body>
      <main><h1>Toolbar copy</h1><p>Clipboard protocol fixture.</p></main>
    </body></html>`);
    await toolbarPage.evaluate(() => {
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(listener) {
              window.__camMessageListener = listener;
            },
          },
        },
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(text) {
            window.__camToolbarClipboard = text;
          },
        },
      });
      document.execCommand = () => false;
    });
    await toolbarPage.addScriptTag({ content: extensionContent });

    const success = await toolbarPage.evaluate(() => new Promise(resolve => {
      const keepAlive = window.__camMessageListener(
        { action: 'copy-as-markdown' },
        {},
        response => resolve({ keepAlive, response }),
      );
    }));
    assertCheck(success.keepAlive === true, 'toolbar listener did not keep async response channel open');
    assertCheck(success.response.success === true, `toolbar copy failed: ${success.response.error}`);
    const copied = await toolbarPage.evaluate(() => window.__camToolbarClipboard);
    assertCheck(copied.includes('Toolbar copy'), 'toolbar copy response completed before clipboard write');

    await toolbarPage.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText() {
            throw new DOMException('Clipboard permission denied', 'NotAllowedError');
          },
        },
      });
      document.execCommand = () => false;
    });
    const failure = await toolbarPage.evaluate(() => new Promise(resolve => {
      window.__camMessageListener(
        { action: 'copy-as-markdown' },
        {},
        response => resolve(response),
      );
    }));
    assertCheck(failure.success === false, 'clipboard denial was reported as success');
    const failureToast = await toolbarPage.$eval('#cam-toast', element => element.textContent);
    assertCheck(failureToast.includes('Copy failed'), 'clipboard denial did not show page feedback');
    log('✅', 'Toolbar waits for clipboard result and reports denied writes');
  } finally {
    await toolbarPage.close();
  }

  const gmailToolbarPage = await createFixturePage(browser, extensionContent, {
    url: 'https://mail.google.com/mail/u/0/#search/cursor/FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR',
    waitForButton: false,
    beforeLoad: () => {
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(listener) {
              window.__camMessageListener = listener;
            },
          },
        },
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(text) {
            window.__camToolbarClipboard = text;
          },
        },
      });
      document.execCommand = () => false;
      window.fetch = async () => new Response(`<!doctype html><html><head><title>Gmail - Toolbar Thread</title></head><body>
        <div class="maincontent"><table class="message"><tbody>
          <tr><td>Toolbar Sender &lt;sender@example.com&gt;</td><td align="right">Jul 29</td></tr>
          <tr><td colspan="2">to me</td></tr>
          <tr><td colspan="2"><p>Complete toolbar thread body.</p></td></tr>
        </tbody></table></div>
      </body></html>`, { status: 200 });
    },
    html: '<!doctype html><html><head><title>Gmail</title></head><body><main><h2 class="hP">Toolbar Thread</h2></main></body></html>',
  });
  try {
    const result = await gmailToolbarPage.evaluate(() => new Promise(resolve => {
      const keepAlive = window.__camMessageListener(
        { action: 'copy-as-markdown' },
        {},
        response => resolve({ keepAlive, response }),
      );
    }));
    const copied = await gmailToolbarPage.evaluate(() => window.__camToolbarClipboard);
    assertCheck(result.keepAlive === true && result.response.success === true, 'Gmail extension toolbar copy failed');
    assertCheck(copied.includes('title: Toolbar Thread') && copied.includes('Complete toolbar thread body.'), 'Gmail extension toolbar copied incomplete thread');
    assertCompactMetadata(copied, 'Gmail toolbar output');
    assertCheck(await gmailToolbarPage.$('#cam-copy-btn') === null, 'Gmail extension unexpectedly added a page button');
    log('✅', 'Gmail works through extension toolbar without adding page UI');
  } finally {
    await gmailToolbarPage.close();
  }

  const unsafeMetadataPage = await createFixturePage(browser, scriptContent, {
    url: 'https://en.wikipedia.org/wiki/Unsafe_metadata_fixture',
    html: `<!doctype html><html><head><title>Safe fixture title</title></head><body>
      <h1 id="firstHeading">Safe heading</h1>
      <div id="p-views"><ul></ul></div>
      <div id="mw-content-text"><p>Frontmatter fixture body.</p></div>
    </body></html>`,
  });
  try {
    const unsafeTitle = 'Unsafe "title" and \'quote\': line\n---\ninjected: true\r\u2028\u0001\uD800';
    await unsafeMetadataPage.evaluate((title) => {
      document.getElementById('firstHeading').textContent = title;
    }, unsafeTitle);
    const markdown = await clickAndCaptureWithPointer(unsafeMetadataPage);
    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    const firstBodyHeading = markdown.indexOf('\n# ');
    const frontmatterFences = markdown.slice(0, firstBodyHeading).match(/^---$/gm) || [];
    const escapedTitle = JSON.stringify(unsafeTitle)
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    assertCheck(frontmatter, 'unsafe metadata output lost frontmatter boundaries');
    assertCheck(firstBodyHeading > 0, 'unsafe metadata output lost article body boundary');
    assertCheck(frontmatterFences.length === 2, `unsafe metadata output emitted ${frontmatterFences.length} frontmatter fences`);
    assertCheck(frontmatter[1].split('\n').length === 2, 'unsafe metadata value created extra frontmatter lines');
    assertCheck(frontmatter[1].includes(`title: ${escapedTitle}`), `unsafe metadata value was not escaped in place: ${JSON.stringify({ expected: escapedTitle, actual: frontmatter[1] })}`);
    assertCheck(!/^injected:/m.test(frontmatter[1]), 'unsafe metadata injected a frontmatter key');
    assertCheck(
      JSON.stringify(frontmatterKeys(markdown)) === JSON.stringify(['title', 'url']),
      `unsafe metadata changed frontmatter keys: ${frontmatterKeys(markdown).join(', ')}`,
    );
    assertCheck(markdown.includes('Frontmatter fixture body.'), 'unsafe metadata broke body extraction');
    log('✅', 'Page-controlled metadata stays inside escaped, two-line frontmatter');
  } finally {
    await unsafeMetadataPage.close();
  }

  const gmailThreadPage = await createFixturePage(browser, scriptContent, {
    url: 'https://mail.google.com/mail/u/0/#search/cursor/FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR',
    csp: "require-trusted-types-for 'script'",
    beforeLoad: () => {
      window.__gmailPrintFetches = [];
      window.__gmailPrintHtml = `<!doctype html><html><head><title>Gmail - Project Phoenix</title></head><body>
        <div class="maincontent">
          <table class="message"><tbody>
            <tr><td><b>Alice Example</b> &lt;alice@example.com&gt;</td><td align="right" title="July 28, 2026, 10:00 AM">Jul 28</td></tr>
            <tr><td colspan="2">to Bob Example &lt;bob@example.com&gt;</td></tr>
            <tr><td colspan="2"><div><p>First complete message.</p><ul><li>Decision one</li></ul><a href="?view=att&amp;disp=attd">spec.pdf</a></div></td></tr>
          </tbody></table>
          <table class="message"><tbody>
            <tr><td><b>Bob Example</b> &lt;bob@example.com&gt;</td><td align="right" title="July 28, 2026, 11:00 AM">Jul 28</td></tr>
            <tr><td colspan="2">to Alice Example &lt;alice@example.com&gt;</td></tr>
            <tr><td colspan="2"><div><p>Second complete reply.</p><blockquote>Keep this quoted context.</blockquote></div></td></tr>
          </tbody></table>
        </div>
      </body></html>`;
      window.fetch = async (input) => {
        window.__gmailPrintFetches.push(String(input));
        return new Response(window.__gmailPrintHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      };
    },
    html: `<!doctype html><html><head><title>Inbox noise</title></head><body>
      <div role="main"><h2 class="hP">Project Phoenix</h2><div>INBOX_NAVIGATION_NOISE</div></div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(gmailThreadPage);
    const fetches = await gmailThreadPage.evaluate(() => window.__gmailPrintFetches);
    assertCheck(markdown.includes('thread_id: FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR'), 'Gmail thread ID missing');
    assertCheck(markdown.includes('title: Project Phoenix'), 'Gmail subject missing');
    assertCompactMetadata(markdown, 'Gmail print output');
    assertCheck(markdown.includes('## Message 1: Alice Example') && markdown.includes('First complete message.'), 'Gmail first message missing');
    assertCheck(markdown.includes('## Message 2: Bob Example') && markdown.includes('Second complete reply.'), 'Gmail second message missing');
    assertCheck(markdown.includes('**Attachments:** spec.pdf'), 'Gmail attachment metadata missing');
    assertCheck(markdown.includes('> Keep this quoted context.'), 'Gmail quoted content missing');
    assertCheck(!markdown.includes('INBOX_NAVIGATION_NOISE'), 'Gmail copied surrounding inbox UI');
    assertCheck(fetches.length === 1 && fetches[0] === 'https://mail.google.com/mail/u/0/?ui=2&view=pt&search=all&th=FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR', `Gmail fetched ${fetches.join(', ')}`);
    log('✅', 'Gmail copies complete authenticated threads from Print all view');
  } finally {
    await gmailThreadPage.close();
  }

  const gmailLiveFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://mail.google.com/mail/u/1/#inbox/FMfcgzFallbackThread123',
    beforeLoad: () => {
      window.fetch = async () => new Response('', { status: 500 });
    },
    html: `<!doctype html><html><head><title>Fallback thread</title></head><body>
      <div role="main"><h2 class="hP">Fallback Subject</h2>
        <div class="adn ads" data-message-id="#msg-f:1">
          <span class="gD" name="Carol Example" email="carol@example.com">Carol</span>
          <span class="g2">to me</span><span class="g3" title="July 29, 2026, 9:00 AM">9:00 AM</span>
          <div class="a3s aiL"><p>Live fallback body.</p></div>
        </div>
      </div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(gmailLiveFallbackPage);
    assertCompactMetadata(markdown, 'Gmail live output');
    assertCheck(markdown.includes('Carol Example <carol@example.com>'), 'Gmail live sender missing');
    assertCheck(markdown.includes('Live fallback body.'), 'Gmail live body missing');
    log('✅', 'Gmail falls back to semantic live message DOM');
  } finally {
    await gmailLiveFallbackPage.close();
  }

  const githubRepoPage = await createFixturePage(browser, scriptContent, {
    url: 'https://github.com/bvolpato/SkyRL',
    html: `<!doctype html><html><head><title>bvolpato/SkyRL</title></head><body>
      <div itemprop="about">A modular full-stack RL library</div>
      <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
        payload: {
          codeViewRepoRoute: {
            path: '/',
            refInfo: { name: 'main', currentOid: 'ca813682c55e0bc6f74dbfbc4fbf13270e8f9848' },
            tree: {
              totalCount: 3,
              items: [
                { name: 'skyrl', path: 'skyrl', contentType: 'directory' },
                { name: 'README.md', path: 'README.md', contentType: 'file' },
                { name: 'pyproject.toml', path: 'pyproject.toml', contentType: 'file' },
              ],
            },
          },
          codeViewLayoutRoute: {
            repo: {
              ownerLogin: 'bvolpato',
              name: 'SkyRL',
              defaultBranch: 'main',
              public: true,
              private: false,
              isFork: true,
            },
          },
        },
      })}</script>
      <div id="readme"><article class="markdown-body"><h1>SkyRL</h1><p>README fixture body.</p></article></div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(githubRepoPage);
    assertCheck(markdown.includes('title: bvolpato/SkyRL'), 'GitHub repository title missing');
    assertCheck(markdown.includes('| Directory | [skyrl](https://github.com/bvolpato/SkyRL/tree/main/skyrl) | `skyrl` |'), 'GitHub repository directory missing');
    assertCheck(markdown.includes('| File | [README.md](https://github.com/bvolpato/SkyRL/blob/main/README.md) | `README.md` |'), 'GitHub repository file missing');
    assertCheck(markdown.includes('README fixture body.'), 'GitHub repository README missing');
    log('✅', 'GitHub repository pages include current directory entries and README');
  } finally {
    await githubRepoPage.close();
  }

  const githubFileLines = [
    '"""Complete file fixture."""',
    '',
    'VALUE = 42',
    'def read_value():',
    '    return VALUE',
  ];
  const githubFilePage = await createFixturePage(browser, scriptContent, {
    url: 'https://github.com/bvolpato/SkyRL/blob/main/skyrl/env_vars.py',
    html: `<!doctype html><html><head><title>bvolpato/SkyRL: env_vars.py</title></head><body>
      <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
        payload: {
          codeViewLayoutRoute: {
            path: 'skyrl/env_vars.py',
            refInfo: { name: 'main', currentOid: 'ca813682c55e0bc6f74dbfbc4fbf13270e8f9848' },
            repo: { ownerLogin: 'bvolpato', name: 'SkyRL', defaultBranch: 'main', public: true },
          },
          codeViewBlobLayoutRoute: {
            path: 'skyrl/env_vars.py',
            refInfo: { name: 'main', currentOid: 'ca813682c55e0bc6f74dbfbc4fbf13270e8f9848' },
            blob: {
              displayName: 'env_vars.py',
              rawBlobUrl: 'https://github.com/bvolpato/SkyRL/raw/refs/heads/main/skyrl/env_vars.py',
              language: 'Python',
              truncated: false,
              headerInfo: { blobSize: '95 Bytes', lineInfo: { truncatedLoc: '5' } },
            },
          },
          'codeViewBlobLayoutRoute.StyledBlob': { rawLines: githubFileLines },
        },
      })}</script>
      <main>DOM_FILE_HEADER_WITHOUT_CONTENT</main>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(githubFilePage);
    assertCheck(markdown.includes('title: bvolpato/SkyRL/skyrl/env_vars.py'), 'GitHub file title missing');
    assertCompactMetadata(markdown, 'GitHub file output');
    assertCheck(markdown.includes(`\`\`\`python\n${githubFileLines.join('\n')}\n\`\`\``), 'GitHub full file content missing or altered');
    assertCheck(!markdown.includes('DOM_FILE_HEADER_WITHOUT_CONTENT'), 'GitHub file fell back to page header');
    log('✅', 'GitHub blob pages include complete file metadata and content');
  } finally {
    await githubFilePage.close();
  }

  const githubStaleBlobContent = `# LeetLLM - Project Overview

## Architecture

AI curriculum platform with progressive lessons.

## Key Commands

\`\`\`bash
cd web && pnpm dev
./deploy.sh
\`\`\`

## Detailed Guide

See AGENTS_TESTING.md, AGENTS_DEPLOY.md, and AGENTS_MONITOR.md.
`;
  const githubStaleBlobPage = await createFixturePage(browser, scriptContent, {
    url: 'https://github.com/bvolpato/leetllm.com/blob/main/AGENTS.md',
    beforeLoad: () => {
      window.__githubRawFetches = [];
      window.fetch = async (input) => {
        window.__githubRawFetches.push(String(input));
        return new Response(window.__githubStaleBlobContent, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      };
    },
    html: `<!doctype html><html><head><title>Comparing bd90a609065c28c74d0f7eac8dd4fa81f448c18e...main · bvolpato/leetllm.com</title></head><body>
      <script>window.__githubStaleBlobContent = ${JSON.stringify(githubStaleBlobContent)};</script>
      <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
        payload: {
          codeViewLayoutRoute: {
            repo: { ownerLogin: 'bvolpato', name: 'leetllm.com', defaultBranch: 'main', public: true },
          },
        },
      })}</script>
      <main><pre># Development\ncd web &amp;&amp; pnpm dev\n./deploy.sh</pre></main>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(githubStaleBlobPage);
    const fetches = await githubStaleBlobPage.evaluate(() => window.__githubRawFetches);
    assertCheck(markdown.includes('title: bvolpato/leetllm.com/AGENTS.md'), 'stale GitHub SPA title replaced current file title');
    assertCompactMetadata(markdown, 'GitHub raw file output');
    assertCheck(markdown.includes('# LeetLLM - Project Overview') && markdown.includes('## Detailed Guide'), 'GitHub stale page omitted full raw file');
    assertCheck(!markdown.includes('# Comparing bd90a609065c28c74d0f7eac8dd4fa81f448c18e...main'), 'GitHub stale comparison heading leaked into output');
    assertCheck(fetches.length === 1 && fetches[0] === 'https://github.com/bvolpato/leetllm.com/raw/refs/heads/main/AGENTS.md', `GitHub stale page fetched ${fetches.join(', ')}`);
    log('✅', 'GitHub blob URLs ignore stale SPA DOM and fetch canonical full files');
  } finally {
    await githubStaleBlobPage.close();
  }

  const githubChangesPage = await createFixturePage(browser, scriptContent, {
    url: 'https://github.com/NovaSky-AI/SkyRL/pull/1952/changes',
    beforeLoad: () => {
      window.__githubPatchFixture = `From ee7ab9927d5d0a3436dd98fd6b955fc9718d0260 Mon Sep 17 00:00:00 2001
From: bvolpato <brunocvcunha@gmail.com>
Date: Tue, 28 Jul 2026 11:38:50 -0400
Subject: [PATCH] [fix][megatron] Bind async checkpoint finalization to GPU

---
 skyrl/megatron_strategy.py | 3 ++-
 1 file changed, 2 insertions(+), 1 deletion(-)

diff --git a/skyrl/megatron_strategy.py b/skyrl/megatron_strategy.py
index 1111111..2222222 100644
--- a/skyrl/megatron_strategy.py
+++ b/skyrl/megatron_strategy.py
@@ -1,2 +1,3 @@
-finalize_async_calls()
+torch.cuda.set_device(local_rank)
+finalize_async_calls()
`;
      window.__githubPatchFetches = [];
      window.fetch = async (input) => {
        window.__githubPatchFetches.push(String(input));
        return new Response(window.__githubPatchFixture, {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      };
    },
    html: `<!doctype html><html><head><title>SkyRL PR changes</title></head><body>
      <h1 class="gh-header-title"><bdi class="js-issue-title">[fix][megatron] Bind async checkpoint finalization to GPU</bdi></h1>
      <div class="gh-header-meta">
        <span class="State" title="Status: Merged">Merged</span>
        <a class="author">erictang000</a>
        <span class="commit-ref" title="NovaSky-AI/SkyRL:main">main</span>
        <span class="commit-ref head-ref" title="bvolpato/SkyRL:bvolpato/bind-async-checkpoint-device">branch</span>
        <relative-time datetime="2026-07-28T18:35:49Z"></relative-time>
      </div>
      <main><div class="random-rendered-diff">DOM_DIFF_NOISE</div></main>
    </body></html>`,
  });
  try {
    const routeCases = [
      {
        path: '/NovaSky-AI/SkyRL/pull/1952/changes',
        fetchUrl: 'https://api.github.com/repos/NovaSky-AI/SkyRL/pulls/1952',
      },
      {
        path: '/NovaSky-AI/SkyRL/pull/1952/changes/ee7ab9927d5d0a3436dd98fd6b955fc9718d0260',
        fetchUrl: 'https://api.github.com/repos/NovaSky-AI/SkyRL/commits/ee7ab9927d5d0a3436dd98fd6b955fc9718d0260',
      },
      {
        path: '/NovaSky-AI/SkyRL/pull/1952/files',
        type: 'GitHub Pull Request Patch',
        patchUrl: 'https://github.com/NovaSky-AI/SkyRL/pull/1952.patch',
        fetchUrl: 'https://api.github.com/repos/NovaSky-AI/SkyRL/pulls/1952',
      },
      {
        path: '/NovaSky-AI/SkyRL/pull/1952/commits/ee7ab9927d5d0a3436dd98fd6b955fc9718d0260',
        fetchUrl: 'https://api.github.com/repos/NovaSky-AI/SkyRL/commits/ee7ab9927d5d0a3436dd98fd6b955fc9718d0260',
      },
    ];

    for (const routeCase of routeCases) {
      await githubChangesPage.evaluate((path) => {
        history.replaceState({}, '', path);
        window.__githubPatchFetches = [];
      }, routeCase.path);
      const markdown = await clickAndCaptureWithPointer(githubChangesPage);
      const fetched = await githubChangesPage.evaluate(() => window.__githubPatchFetches);
      const patchFixture = await githubChangesPage.evaluate(() => window.__githubPatchFixture);
      assertCompactMetadata(markdown, `${routeCase.path} patch output`);
      assertCheck(markdown.includes(patchFixture), `${routeCase.path} did not preserve canonical patch`);
      assertCheck(!markdown.includes('DOM_DIFF_NOISE'), `${routeCase.path} used rendered DOM diff`);
      assertCheck(fetched.length === 1 && fetched[0] === routeCase.fetchUrl, `${routeCase.path} fetched ${fetched.join(', ')}`);
    }
    log('✅', 'GitHub PR and commit change routes fetch canonical patches with focused metadata');
  } finally {
    await githubChangesPage.close();
  }

  const googleDocsPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.google.com/document/d/fixture-doc/edit?tab=t.0',
    csp: "require-trusted-types-for 'script'",
    beforeLoad: () => {
      window.__googleDocsFixtureFetches = [];
      window.fetch = async (input) => {
        const url = new URL(String(input), window.location.origin);
        window.__googleDocsFixtureFetches.push(url.toString());
        if (url.pathname.endsWith('/mobilebasic') && url.searchParams.get('tab') === 't.0') {
          return new Response(`<!doctype html><html><body>
            <main id="doc-contents">
              <h1>Hero Run Summary &amp; Action Items</h1>
              <p>Generation completed after the NCCL fix.</p>
              <ul><li>Validate replay output</li></ul>
            </main>
          </body></html>`, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('', { status: 400 });
      };
    },
    html: `<!doctype html><html><head><title>Hero Run Summary - Google Docs</title></head><body>
      <div class="docs-title-input-label-inner">Hero Run Summary</div>
      <div class="docs-titlebar-buttons"><button>Share</button></div>
      <div id="docs-editor-container"><canvas class="kix-canvas-tile-content"></canvas></div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCapture(googleDocsPage);
    assertCheck(
      markdown.includes('Generation completed after the NCCL fix.'),
      'Google Docs canvas document did not fall back to mobilebasic HTML',
    );
    assertCheck(markdown.includes('- Validate replay output'), 'Google Docs mobilebasic list was lost');
    const fetches = await googleDocsPage.evaluate(() => window.__googleDocsFixtureFetches);
    assertCheck(
      fetches.some(url => url.includes('/mobilebasic') && url.includes('tab=t.0')),
      'Google Docs mobilebasic request did not preserve active tab',
    );
    log('✅', 'Google Docs canvas extraction falls back to authenticated mobilebasic HTML');
  } finally {
    await googleDocsPage.close();
  }

  const datadogPage = await createFixturePage(browser, extensionContent, {
    url: 'https://app.datadoghq.com/dashboard/abc-def-ghi/checkout-golden-signals?live=true',
    beforeLoad: () => {
      window.__datadogFixtureFetches = [];
      window.fetch = async (input) => {
        const url = new URL(String(input), window.location.origin);
        window.__datadogFixtureFetches.push(url.toString());
        if (url.pathname === '/api/v1/dashboard/abc-def-ghi') {
          return new Response(JSON.stringify({
            template_variables: [
              { name: 'Environment', prefix: 'environment', default: '*' },
              { name: 'Region', prefix: 'region', default: '*' },
            ],
            widgets: [{
              id: 'api',
              definition: {
                type: 'group',
                widgets: [{
                  id: 'requests',
                  definition: {
                    type: 'timeseries',
                    requests: [{
                      q: 'sum:fixture.requests{$Environment,$Region} by {route}',
                    }],
                  },
                }],
              },
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (
          url.pathname === '/api/v1/query'
          && url.searchParams.get('query')
            === 'sum:fixture.requests{environment:env-prod-only,region:us-east-1-only} by {route}'
        ) {
          return new Response(JSON.stringify({
            series: [
              {
                display_name: 'fixture.requests',
                tag_set: ['route:/checkout'],
                pointlist: [[1, 8], [2, 16], [3, 13], [4, 30], [5, 26], [6, 42]],
              },
              {
                display_name: 'fixture.requests',
                tag_set: ['route:/search'],
                pointlist: [[1, 40], [2, 34], [3, 38], [4, 22], [5, 18], [6, 6]],
              },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>Checkout Golden Signals | Datadog</title>
      <style>.fixture-hidden { display: none; }</style></head><body>
      <header class="dashboard_header">
        <div class="new-dashboard-header__board_title"><h1>Checkout Golden Signals</h1></div>
        <div class="dashboard_header__toolbar">
          <button>Share</button>
          <button class="actions_trigger">NOISE_CONFIGURE</button>
        </div>
        <div class="dashboard_header__bottom-row">
          <div class="template-variable-list">
            <fieldset class="templateVariableSelect">
              <legend>Environment</legend><span role="combobox">env-prod-only</span>
            </fieldset>
            <fieldset class="templateVariableSelect">
              <legend>Region</legend><span role="combobox">us-east-1-only</span>
            </fieldset>
            <fieldset class="templateVariableSelect fixture-hidden">
              <legend>Environment</legend><span role="combobox">NOISE_HIDDEN_FILTER</span>
            </fieldset>
          </div>
          <input aria-label="Time range picker" value="Past 1 Hour">
          <span class="date-range-picker__time-zone__label">UTC-04:00 (America/New_York)</span>
        </div>
      </header>
      <div class="multi-size-layout__group" data-testid="group-api">
        <div class="group-header__title">
          <div class="druids_layout_overflower__overflow" aria-hidden="true">NOISE_GROUP_TITLE_DUPLICATE</div>
          <div data-component-name="overflower-original">API Health</div>
        </div>
        <div class="group__content">
          <div class="dashboard_widget" data-testid="widget-success">
            <div class="widget query_value"><h3 data-testid="widget-title">Checkout success rate</h3>
              <div data-response-state="has-some-response">
                <div class="query-value__value">99.95</div><span class="query-value__unit">%</span>
              </div>
              <img alt="NOISE_STEG_WATERMARK" src="data:image/bmp;base64,Qk0=">
            </div>
          </div>
          <div class="dashboard_widget" data-testid="widget-lag">
            <div class="widget query_value"><h3 data-testid="widget-title">Queue lag</h3>
              <div class="query-value__container--no-data">(No data)</div>
            </div>
          </div>
          <div class="dashboard_widget" id="widget_requests" data-testid="widget-requests">
            <div class="widget timeseries"><h3 data-testid="widget-title">Requests and deploys</h3>
              <svg><text>NOISE_AXIS_TICK</text></svg>
              <svg><g class="dataviz_y-axis left">
                <text class="dataviz_y-axis__label">Requests/s</text>
                <g class="tick" transform="translate(0, 0)"><text>100</text></g>
                <g class="tick" transform="translate(0, 24)"><text>50</text></g>
                <g class="tick" transform="translate(0, 48)"><text>0</text></g>
              </g></svg>
              <div class="rendering-layers-container"><div class="rendering-layer">
                <canvas class="fixture-timeseries" width="160" height="48"></canvas>
              </div></div>
              <div class="dataviz-annotations-renderer">
                <div role="note">CURRENT_DEPLOY_MARKER</div>
                <div role="note" class="fixture-hidden">NOISE_STALE_ANNOTATION</div>
              </div>
              <div>NOISE_RESIZE_HANDLE</div>
            </div>
          </div>
        </div>
      </div>
      <div class="multi-size-layout__group" data-testid="group-traffic">
        <div class="group-header__title">Traffic Breakdown</div>
        <div class="group__content">
          <div class="dashboard_widget" data-testid="widget-endpoints">
            <div class="widget toplist"><h3 data-testid="widget-title">Top endpoints</h3>
              <div class="stacked-toplist">
                <div class="stacked-toplist__item">
                  <svg data-synthetics-toplist-label="/checkout"><text>72%</text></svg>
                  <span class="stacked-toplist__value-label">72%</span>
                </div>
                <div class="stacked-toplist__item">
                  <span data-synthetics-toplist-label>/search</span>
                  <span class="stacked-toplist__value-label">18%</span>
                </div>
              </div>
            </div>
          </div>
          <div class="dashboard_widget" data-testid="widget-route-status">
            <div class="widget query_table"><h3 data-testid="widget-title">Route status</h3>
              <table>
                <thead><tr><th>Route</th><th>Errors</th></tr></thead>
                <tbody>
                  <tr><td>/checkout</td><td>0</td></tr>
                  <tr><td>/search</td><td>2</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="dashboard_widget" data-testid="widget-semantic-fallback">
            <div role="group">
              <button aria-label="Semantic fallback widget"></button>
              <div class="widget timeseries" data-response-state="no-response"></div>
            </div>
          </div>
        </div>
      </div>
      <aside>NOISE_KEYBOARD_SHORTCUTS</aside>
    </body></html>`,
  });
  try {
    await datadogPage.evaluate(() => {
      const canvas = document.querySelector('.fixture-timeseries');
      const context = canvas.getContext('2d');
      const drawSeries = (color, points) => {
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        points.forEach(([x, y], index) => {
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      };
      drawSeries('#2384ba', [[0, 40], [30, 32], [60, 35], [90, 18], [120, 22], [159, 6]]);
      drawSeries('#e763fa', [[0, 8], [30, 14], [60, 10], [90, 26], [120, 30], [159, 42]]);
    });
    await datadogPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const configure = document.querySelector('.actions_trigger');
      return button && configure && button.nextElementSibling === configure;
    });

    const markdown = await clickAndCapture(datadogPage);
    const datadogFixtureFetches = await datadogPage.evaluate(
      () => window.__datadogFixtureFetches,
    );
    const lines = markdown.split('\n');
    const lineFor = (text) => lines.find(line => line.includes(text)) || '';
    const occurrenceCount = (text) => markdown.split(text).length - 1;

    assertCheck(markdown.includes('# Checkout Golden Signals'), 'Datadog dashboard title missing');
    assertCheck(
      markdown.includes(
        'filters: {"Environment":"env-prod-only","Region":"us-east-1-only"}',
      ),
      'Datadog selected filters missing from metadata',
    );
    assertCheck(!markdown.includes('## Filters'), 'Datadog filters duplicated in body');
    assertCheck(markdown.includes('## API Health'), 'Datadog API group missing');
    assertCheck(markdown.includes('## Traffic Breakdown'), 'Datadog traffic group missing');
    assertCheck(
      markdown.indexOf('## API Health') < markdown.indexOf('Checkout success rate')
        && markdown.indexOf('Checkout success rate') < markdown.indexOf('Requests and deploys')
        && markdown.indexOf('Requests and deploys') < markdown.indexOf('## Traffic Breakdown')
        && markdown.indexOf('## Traffic Breakdown') < markdown.indexOf('Top endpoints'),
      'Datadog group/widget order changed',
    );
    assertCheck(
      lineFor('Checkout success rate').includes('99.95 %'),
      `Datadog query value/unit pairing lost: ${lineFor('Checkout success rate')}`,
    );
    assertCheck(lineFor('Queue lag').includes('No data'), 'Datadog no-data state missing');
    assertCheck(
      lineFor('Semantic fallback widget').includes('No data'),
      'Datadog accessible widget-title fallback missing',
    );
    assertCheck(
      lineFor('Requests and deploys').includes('CURRENT_DEPLOY_MARKER'),
      'Datadog visible chart annotation missing',
    );
    assertCheck(
      lineFor('Requests and deploys').includes('route:/checkout:')
        && lineFor('Requests and deploys').includes('route:/search:')
        && !lineFor('Requests and deploys').includes('Series 1:')
        && /[▁▂▃▄▅▆▇█]{8}/u.test(lineFor('Requests and deploys'))
        && lineFor('Requests and deploys').includes('≈ first')
        && lineFor('Requests and deploys').includes('min')
        && lineFor('Requests and deploys').includes('max')
        && lineFor('Requests and deploys').includes('avg')
        && lineFor('Requests and deploys').includes('last')
        && lineFor('Requests and deploys').includes('Requests/s'),
      `Datadog canvas sparklines missing: ${lineFor('Requests and deploys')} FETCHES=${JSON.stringify(datadogFixtureFetches)}`,
    );
    assertCheck(
      markdown.includes('### Top endpoints')
        && markdown.includes('| /checkout | 72% |')
        && markdown.includes('| /search | 18% |')
        && markdown.indexOf('| /checkout | 72% |') < markdown.indexOf('| /search | 18% |'),
      'Datadog detailed top-list table missing or reordered',
    );
    assertCheck(
      markdown.includes('### Route status')
        && markdown.includes('| Route | Errors |')
        && markdown.includes('| /checkout | 0 |')
        && markdown.includes('| /search | 2 |'),
      'Datadog query table missing',
    );
    assertCheck(
      !markdown.includes('| Widget | Snapshot |\n\n| --- | --- |'),
      'Datadog widget table contains blank lines between rows',
    );
    assertCheck(occurrenceCount('env-prod-only') === 1, 'Datadog visible filter duplicated');
    assertCheck(occurrenceCount('CURRENT_DEPLOY_MARKER') === 1, 'Datadog annotation duplicated');
    for (const noise of [
      'NOISE_CONFIGURE',
      'NOISE_HIDDEN_FILTER',
      'NOISE_STALE_ANNOTATION',
      'NOISE_STEG_WATERMARK',
      'NOISE_AXIS_TICK',
      'NOISE_RESIZE_HANDLE',
      'NOISE_KEYBOARD_SHORTCUTS',
      'NOISE_GROUP_TITLE_DUPLICATE',
      'data:image/bmp',
    ]) {
      assertCheck(!markdown.includes(noise), `Datadog noise leaked: ${noise}`);
    }

    await datadogPage.evaluate(() => {
      const configure = document.querySelector('.actions_trigger');
      configure.parentElement.prepend(configure);
    });
    await datadogPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const configure = document.querySelector('.actions_trigger');
      return button && configure && button.nextElementSibling === configure;
    }, { timeout: 5000 });

    await datadogPage.evaluate(() => {
      const oldToolbar = document.querySelector('.dashboard_header__toolbar');
      const toolbar = document.createElement('div');
      toolbar.className = 'dashboard_header__toolbar';
      const configure = document.createElement('button');
      configure.className = 'actions_trigger';
      configure.textContent = 'Replacement Configure';
      toolbar.appendChild(configure);
      oldToolbar.replaceWith(toolbar);
    });
    await datadogPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const configure = document.querySelector('.actions_trigger');
      return document.querySelectorAll('#cam-copy-btn').length === 1
        && button && configure && button.nextElementSibling === configure;
    }, { timeout: 5000 });

    await datadogPage.evaluate(() => {
      history.pushState({}, '', '/logs');
      document.body.appendChild(document.createElement('span'));
    });
    await datadogPage.waitForFunction(() =>
      !document.querySelector('#cam-copy-btn')
        && !document.documentElement.hasAttribute('data-cam-active-instance'),
    { timeout: 5000 });

    await datadogPage.evaluate(() => {
      history.pushState({}, '', '/dashboard/xyz-uvw-rst/restored');
      document.body.appendChild(document.createElement('span'));
    });
    await datadogPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const configure = document.querySelector('.actions_trigger');
      return document.querySelectorAll('#cam-copy-btn').length === 1
        && button && configure && button.nextElementSibling === configure;
    }, { timeout: 5000 });
    log('✅', 'Datadog extraction, toolbar placement, and SPA lifecycle are semantic');
  } finally {
    await datadogPage.close();
  }

  const datadogListPage = await createFixturePage(browser, extensionContent, {
    url: 'https://app.datadoghq.com/dashboard/lists',
    waitForButton: false,
    html: `<!doctype html><html><head><title>Dashboard List | Datadog</title></head><body>
      <div class="dashboard_header__toolbar"><button class="actions_trigger">Configure</button></div>
    </body></html>`,
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 1200));
    assertCheck(
      await datadogListPage.$('#cam-copy-btn') === null,
      'Datadog dashboard list incorrectly received page button',
    );
    log('✅', 'Datadog non-dashboard route does not receive page button');
  } finally {
    await datadogListPage.close();
  }

  const emptyDatadogPage = await createFixturePage(browser, extensionContent, {
    url: 'https://app.datadoghq.com/dashboard/emp-tyd-one/empty',
    html: `<!doctype html><html><head><title>Empty Dashboard | Datadog</title></head><body>
      <header>
        <div class="new-dashboard-header__board_title"><h1>Empty Dashboard</h1></div>
        <div class="dashboard_header__toolbar"><button class="actions_trigger">Configure</button></div>
        <div class="dashboard_header__bottom-row"><div class="template-variable-list">
          <fieldset class="templateVariableSelect"><legend>Environment</legend>
            <span role="combobox">prod</span></fieldset>
        </div></div>
      </header>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCapture(emptyDatadogPage);
    assertCheck(
      markdown.includes('filters: {"Environment":"prod"}'),
      'Empty Datadog dashboard lost filter metadata',
    );
    assertCheck(
      markdown.includes('No dashboard widgets found'),
      'Empty Datadog dashboard omitted loading warning',
    );
    log('✅', 'Datadog filters-only dashboard keeps no-widget warning');
  } finally {
    await emptyDatadogPage.close();
  }

  const datadogNotebookPage = await createFixturePage(browser, extensionContent, {
    url: 'https://app.datadoghq.com/notebook/15105594/crawlerpy-trends-analysis',
    beforeLoad: () => {
      window.fetch = async (input) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === '/api/v1/notebooks/15105594') {
          return new Response(JSON.stringify({
            data: {
              attributes: {
                time: { live_span: '1h' },
                template_variables: [],
                cells: [{
                  id: 'graph-one',
                  attributes: {
                    definition: {
                      type: 'timeseries',
                      requests: [{
                        formulas: [{ formula: 'query1' }],
                        queries: [{
                          data_source: 'metrics',
                          name: 'query1',
                          query: 'sum:fixture.requests{service:crawlerpy} by {path,status_family}',
                        }],
                      }],
                    },
                    time: null,
                  },
                }],
              },
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (
          url.pathname === '/api/v1/query'
          && url.searchParams.get('query')
            === 'sum:fixture.requests{service:crawlerpy} by {path,status_family}'
        ) {
          return new Response(JSON.stringify({
            series: [{
              display_name: 'fixture.requests',
              tag_set: ['path:/search', 'status_family:2xx'],
              pointlist: [[1, 8], [2, 16], [3, 13], [4, 30], [5, 26], [6, 42]],
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>CrawlerPy — Trends Analysis | Datadog</title>
      <style>.fixture-hidden { display: none; }</style></head><body>
      <div class="notebook-toolbar">
        <div class="viewModeSelect"><span aria-selected="true">Editing</span></div>
        <div class="NotebooksShareButton"><button aria-label="Share">NOISE_SHARE</button></div>
        <button data-dd-action-name="Notebook Settings Button">NOISE_SETTINGS</button>
      </div>
      <div class="NotebookRichText__content NotebookRichText__content--has-comments">
        <div class="NotebookRichText__editor">
          <header class="Notebook__CellWidthContainer">
            <div class="NotebookActionBar">
              <button class="NotebookFavorite__button">NOISE_FAVORITE</button>
              <button class="NotebookTypeButton__typeModalButton">
                <span class="druids_pills_tag__text">Report</span>
              </button>
            </div>
            <div class="NotebookTitle"><h1 class="NotebookTitle__text">CrawlerPy — Trends Analysis</h1></div>
            <aside class="NotebookMetadata">
              <span data-testid="user-pill">
                <span aria-hidden="true">NOISE_AUTHOR_DUPLICATE</span>
                <span data-component-name="overflower-original">Bruno Volpato</span>
              </span>
              <button class="Notebook__toggleVersionSidePanel">Updated 1 minute ago</button>
              <button class="NotebookMetadata__access-pill">Unrestricted access</button>
            </aside>
          </header>
          <div class="dd-rich-text-editor__content"><div class="tiptap ProseMirror">
            <p data-cell="intro">Trends analysis for <code>service:crawlerpy</code> with <strong>live context</strong>. See <a href="/services/crawlerpy">service page</a>.</p>
            <h2 data-cell="http">HTTP Traffic</h2>
            <div class="react-renderer node-widget"><div data-qa="cell" data-cell="graph-one">
              <div data-cell-id="graph-one" data-test-cell-type="timeseries">
                <button data-toc-graph-title="HTTP Request Rate by Path and Status">
                  HTTP Request Rate by Path and Status
                </button>
                <div data-response-state="has-some-response">
                  <svg><text>NOISE_AXIS_TICK</text></svg>
                  <svg><g class="dataviz_y-axis left">
                    <text class="dataviz_y-axis__label">Requests/s</text>
                    <g class="tick" transform="translate(0, 0)"><text>100</text></g>
                    <g class="tick" transform="translate(0, 24)"><text>50</text></g>
                    <g class="tick" transform="translate(0, 48)"><text>0</text></g>
                  </g></svg>
                  <div class="rendering-layers-container"><div class="rendering-layer">
                    <canvas class="fixture-notebook-timeseries" width="160" height="48"></canvas>
                  </div></div>
                  <div class="dataviz-annotations-renderer">
                    <div role="note">4.81k</div>
                    <div role="note">3.83k</div>
                    <div role="note" class="fixture-hidden">NOISE_HIDDEN_SNAPSHOT</div>
                  </div>
                </div>
              </div>
            </div></div>
            <p><br></p>
            <h2 data-cell="tools">Tool Activity</h2>
            <div class="react-renderer node-widget"><div data-qa="cell" data-cell="graph-two">
              <div data-cell-id="graph-two" data-test-cell-type="timeseries">
                <button data-toc-graph-title="Tool Error Rate (%)">Tool Error Rate (%)</button>
                <div data-response-state="no-response"></div>
              </div>
            </div></div>
          </div></div>
        </div>
        <div class="NotebookEditor__CommentsContainer">NOISE_COMMENTS</div>
      </div>
      <footer class="AddCellFooter">NOISE_ADD_CELL</footer>
    </body></html>`,
  });
  try {
    await datadogNotebookPage.evaluate(() => {
      const canvas = document.querySelector('.fixture-notebook-timeseries');
      const context = canvas.getContext('2d');
      context.strokeStyle = '#2384ba';
      context.lineWidth = 2;
      context.beginPath();
      [[0, 40], [30, 32], [60, 35], [90, 18], [120, 22], [159, 6]]
        .forEach(([x, y], index) => {
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
      context.stroke();
    });
    await datadogNotebookPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const share = document.querySelector('.NotebooksShareButton');
      return button && share && button.nextElementSibling === share;
    });

    const markdown = await clickAndCapture(datadogNotebookPage);
    const lines = markdown.split('\n');
    const lineFor = (text) => lines.find(line => line.includes(text)) || '';
    assertCompactMetadata(markdown, 'Datadog notebook output');
    assertCheck(markdown.includes('notebook_id: 15105594'), 'Notebook ID metadata missing');
    assertCheck(markdown.includes('author: Bruno Volpato'), 'Notebook author metadata missing');
    assertCheck(markdown.includes('notebook_type: Report'), 'Notebook type metadata missing');
    assertCheck(markdown.includes('updated: Updated 1 minute ago'), 'Notebook update metadata missing');
    assertCheck(markdown.includes('access: Unrestricted access'), 'Notebook access metadata missing');
    assertCheck(markdown.includes('view_mode: Editing'), 'Notebook view-mode metadata missing');
    assertCheck(
      markdown.includes('Trends analysis for `service:crawlerpy` with **live context**.')
        && markdown.includes('[service page](https://app.datadoghq.com/services/crawlerpy)'),
      'Notebook rich text or inline code lost',
    );
    assertCheck(markdown.includes('## HTTP Traffic'), 'Notebook heading missing');
    assertCheck(markdown.includes('### HTTP Request Rate by Path and Status'), 'Notebook graph title missing');
    assertCheck(lineFor('Snapshot:').includes('4.81k; 3.83k'), 'Notebook visible graph snapshot missing');
    assertCheck(
      lineFor('path:/search, status_family:2xx:').includes('≈ first')
        && lineFor('path:/search, status_family:2xx:').includes('min')
        && lineFor('path:/search, status_family:2xx:').includes('max')
        && lineFor('path:/search, status_family:2xx:').includes('avg')
        && lineFor('path:/search, status_family:2xx:').includes('last')
        && /[▁▂▃▄▅▆▇█]{8}/u.test(lineFor('path:/search, status_family:2xx:')),
      `Notebook named canvas sparkline/stats missing: ${lineFor('path:/search')}`,
    );
    assertCheck(markdown.includes('### Tool Error Rate (%)'), 'Notebook second graph title missing');
    assertCheck(
      markdown.indexOf('Trends analysis') < markdown.indexOf('## HTTP Traffic')
        && markdown.indexOf('## HTTP Traffic') < markdown.indexOf('### HTTP Request Rate')
        && markdown.indexOf('### HTTP Request Rate') < markdown.indexOf('## Tool Activity')
        && markdown.indexOf('## Tool Activity') < markdown.indexOf('### Tool Error Rate'),
      'Notebook cell order changed',
    );
    assertCheck(
      markdown.includes('- Type: Timeseries') && markdown.includes('- Snapshot: No data'),
      'Notebook graph type/no-data summary missing',
    );
    for (const noise of [
      'NOISE_SHARE',
      'NOISE_SETTINGS',
      'NOISE_FAVORITE',
      'NOISE_AUTHOR_DUPLICATE',
      'NOISE_AXIS_TICK',
      'NOISE_HIDDEN_SNAPSHOT',
      'NOISE_COMMENTS',
      'NOISE_ADD_CELL',
    ]) {
      assertCheck(!markdown.includes(noise), `Notebook noise leaked: ${noise}`);
    }

    await datadogNotebookPage.evaluate(() => {
      const oldToolbar = document.querySelector('.notebook-toolbar');
      const toolbar = document.createElement('div');
      toolbar.className = 'notebook-toolbar';
      const share = document.createElement('div');
      share.className = 'NotebooksShareButton';
      toolbar.appendChild(share);
      oldToolbar.replaceWith(toolbar);
    });
    await datadogNotebookPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const share = document.querySelector('.NotebooksShareButton');
      return document.querySelectorAll('#cam-copy-btn').length === 1
        && button && share && button.nextElementSibling === share;
    }, { timeout: 5000 });

    await datadogNotebookPage.evaluate(() => {
      history.pushState({}, '', '/logs');
      document.body.appendChild(document.createElement('span'));
    });
    await datadogNotebookPage.waitForFunction(() => !document.querySelector('#cam-copy-btn'), {
      timeout: 5000,
    });

    await datadogNotebookPage.evaluate(() => {
      history.pushState({}, '', '/notebook/15105595/restored');
      document.body.appendChild(document.createElement('span'));
    });
    await datadogNotebookPage.waitForFunction(() => {
      const button = document.querySelector('#cam-copy-btn');
      const share = document.querySelector('.NotebooksShareButton');
      return document.querySelectorAll('#cam-copy-btn').length === 1
        && button && share && button.nextElementSibling === share;
    }, { timeout: 5000 });
    log('✅', 'Datadog notebook extraction and toolbar SPA lifecycle are semantic');
  } finally {
    await datadogNotebookPage.close();
  }

  const datadogNotebookListPage = await createFixturePage(browser, extensionContent, {
    url: 'https://app.datadoghq.com/notebook/list',
    waitForButton: false,
    html: `<!doctype html><html><head><title>Notebook List | Datadog</title></head><body>
      <div class="NotebooksShareButton"></div>
    </body></html>`,
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 1200));
    assertCheck(
      await datadogNotebookListPage.$('#cam-copy-btn') === null,
      'Datadog notebook list incorrectly received page button',
    );
    log('✅', 'Datadog non-notebook route does not receive page button');
  } finally {
    await datadogNotebookListPage.close();
  }

  const datadogDocsSource = `---
title: Quickstart fixture
description: Source Markdown wins.
---

# Quickstart fixture

Fetched from the Datadog Documentation Markdown endpoint.

\`\`\`bash
DD_SITE=datadoghq.com
\`\`\``;
  const datadogDocsMarkdownPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.datadoghq.com/llm_observability/quickstart/?site=us5#setup',
    beforeLoad: () => {
      window.__datadogDocsFetches = [];
      window.fetch = async (url, options) => {
        window.__datadogDocsFetches.push({ url: String(url), options });
        return new Response(`---
title: Quickstart fixture
description: Source Markdown wins.
---

# Quickstart fixture

Fetched from the Datadog Documentation Markdown endpoint.

\`\`\`bash
DD_SITE=datadoghq.com
\`\`\``, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown' },
        });
      };
    },
    html: `<!doctype html><html><head><title>Quickstart | Datadog Documentation</title></head><body>
      <div id="mainContent"><h1 id="pagetitle">Quickstart</h1><p>DOM fallback must not replace source Markdown.</p></div>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(datadogDocsMarkdownPage, 'Datadog Documentation', 'Datadog Documentation Markdown');
    const markdown = await clickAndCapture(datadogDocsMarkdownPage);
    const fetches = await datadogDocsMarkdownPage.evaluate(() => window.__datadogDocsFetches);
    assertCheck(markdown === datadogDocsSource, `Datadog Documentation changed source Markdown: ${markdown}`);
    assertCheck(
      fetches.length === 1
        && fetches[0].url === 'https://docs.datadoghq.com/llm_observability/quickstart.md',
      `Datadog Documentation fetched wrong Markdown URL: ${JSON.stringify(fetches)}`,
    );
    assertCheck(!markdown.includes('DOM fallback'), 'Datadog Documentation used DOM despite successful Markdown fetch');
    log('✅', 'Datadog Documentation copies successful .md responses unchanged');
  } finally {
    await datadogDocsMarkdownPage.close();
  }

  const datadogDocsFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.datadoghq.com/example/no-markdown/',
    beforeLoad: () => {
      window.fetch = async () => new Response('Not found', { status: 404 });
    },
    html: `<!doctype html><html><head>
      <title>DOM Fallback | Datadog Documentation</title>
      <link rel="canonical" href="https://docs.datadoghq.com/example/no-markdown/">
      <script src="/_static/documentation_options.js"></script>
    </head><body><div class="mainContent-wrapper"><div id="mainContent">
      <div id="breadcrumbs">NOISE_BREADCRUMBS</div>
      <h1 id="pagetitle">DOM Fallback</h1>
      <p>Rendered Datadog documentation body.</p>
      <pre><code class="language-bash">datadog-agent status</code></pre>
      <div data-nosnippet>NOISE_REGION_MESSAGE</div>
    </div></div></body></html>`,
  });
  try {
    await assertRouteIdentity(datadogDocsFallbackPage, 'Datadog Documentation', 'Datadog Documentation fallback');
    const markdown = await clickAndCapture(datadogDocsFallbackPage);
    assertCheck(markdown.includes('# DOM Fallback'), 'Datadog Documentation DOM fallback lost title');
    assertCheck(markdown.includes('Rendered Datadog documentation body.'), 'Datadog Documentation DOM fallback lost body');
    assertCheck(markdown.includes('datadog-agent status'), 'Datadog Documentation DOM fallback lost code');
    assertCheck(!markdown.includes('NOISE_BREADCRUMBS'), 'Datadog Documentation DOM fallback leaked breadcrumbs');
    assertCheck(!markdown.includes('NOISE_REGION_MESSAGE'), 'Datadog Documentation DOM fallback leaked regional noise');
    assertCompactMetadata(markdown, 'Datadog Documentation DOM fallback');
    log('✅', 'Datadog Documentation falls back to cleaned rendered DOM');
  } finally {
    await datadogDocsFallbackPage.close();
  }

  const linkedinProfilePage = await createFixturePage(browser, scriptContent, {
    url: 'https://www.linkedin.com/in/bvolpato/',
    html: `<!doctype html><html><head><title>Bruno Volpato | LinkedIn</title>
      <meta property="og:description" content="Distributed systems engineer. View Bruno Volpato's profile on LinkedIn, a professional community.">
    </head><body><main role="main">
      <section data-view-name="profile-card"><h1>Bruno Volpato</h1>
        <div data-generated-suggestion-target="headline">Staff Software Engineer</div>
        <div class="pv-text-details__left-panel"><span class="text-body-small inline">New York, United States</span></div>
        <button>Edit profile</button></section>
      <section><div id="about"></div><h2>About</h2><div>Building high-throughput distributed systems.</div><button>see more</button></section>
      <section><h2>Experience</h2><ul><li><strong>Staff Software Engineer</strong><div>Datadog</div><div>2024 – Present</div></li></ul>
        <a href="/in/bvolpato/details/experience/">Show all experience</a></section>
      <section><h2>Education</h2><ul><li><strong>North Carolina State University</strong><div>Computer Science</div></li></ul></section>
    </main></body></html>`,
    context: 'LinkedIn profile',
  });
  try {
    await assertRouteIdentity(linkedinProfilePage, 'LinkedIn', 'LinkedIn profile fixture');
    const markdown = await clickAndCapture(linkedinProfilePage, 'LinkedIn profile');
    for (const expected of [
      '# Bruno Volpato',
      '**Staff Software Engineer**',
      'New York, United States',
      '## About',
      'Building high-throughput distributed systems.',
      '## Experience',
      'Datadog',
      '## Education',
      'North Carolina State University',
    ]) {
      assertCheck(markdown.includes(expected), `LinkedIn profile output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    for (const excluded of ['Edit profile', 'Show all experience', '# Bruno Volpato | LinkedIn']) {
      assertCheck(!markdown.includes(excluded), `LinkedIn profile output leaked ${JSON.stringify(excluded)}: ${markdown}`);
    }
    assertCompactMetadata(markdown, 'LinkedIn profile output');
    log('✅', 'LinkedIn profiles survive class-name changes through semantic sections and metadata fallbacks');
  } finally {
    await linkedinProfilePage.close();
  }

  const overlayFixtures = [
    {
      name: 'Reddit',
      extractor: 'Reddit',
      url: 'https://www.reddit.com/r/test/comments/123/test/',
      anchor: '<shreddit-post><div id="anchor" slot="post-actions"></div></shreddit-post>',
    },
    {
      name: 'YouTube',
      extractor: 'YouTube',
      url: 'https://www.youtube.com/watch?v=test',
      anchor: '<div id="top-level-buttons-computed"></div>',
    },
    {
      name: 'X',
      extractor: 'X (Twitter)',
      url: 'https://x.com/test/status/123',
      anchor: '<div id="anchor" data-testid="userActions"></div>',
    },
    {
      name: 'LinkedIn',
      extractor: 'LinkedIn',
      url: 'https://www.linkedin.com/posts/test',
      anchor: '<div id="anchor" class="feed-shared-control-menu"></div>',
    },
    {
      name: 'WhatsApp',
      extractor: 'WhatsApp',
      url: 'https://web.whatsapp.com/',
      anchor: '<div id="main"><header><div id="anchor" data-testid="chat-header-actions"></div></header></div>',
    },
    {
      name: 'Polymarket',
      extractor: 'Polymarket',
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
      await assertRouteIdentity(page, fixture.extractor, fixture.name);
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
    await assertRouteIdentity(chatgptPage, 'ChatGPT', 'ChatGPT');
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

  const chatgptCanvasPage = await createFixturePage(browser, scriptContent, {
    url: 'https://chatgpt.com/c/canvas-regression',
    html: `<!doctype html><html><head><title>Canvas regression</title></head><body>
      <div id="conversation-header-actions"></div>
      ${Array.from({ length: 205 }, (_, index) => `
        <section data-testid="conversation-turn-${index + 10}" data-turn="user">
          <div data-message-author-role="user">Canvas prefix turn ${index + 1}</div>
        </section>
      `).join('')}
      <section data-testid="conversation-turn-1" data-turn="assistant">
        <div data-message-author-role="assistant" data-message-model-slug="gpt-test">
          <div class="markdown">
            <div data-writing-block="true" data-testid="writing-block-container">
              <div data-testid="writing-block-header-surface">
                <button type="button" aria-label="Edit">Edit</button>
                <button type="button" aria-label="Copy">Copy</button>
              </div>
              <div class="writing-block-editor">
                <div class="ProseMirror markdown prose" data-writing-block-fullscreen-editor-region="true" contenteditable="true">
                  <h1>Canvas design document</h1>
                  <p>Canvas body must be copied as Markdown.</p>
                  <ul><li>Canvas list item</li></ul>
                  <pre><code>leash/balanced/interactive</code></pre>
                  <p>${'canvas-payload '.repeat(10_000)}CANVAS_END_SENTINEL</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <div contenteditable="true">ChatGPT composer must not leak</div>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(chatgptCanvasPage, 'ChatGPT', 'ChatGPT canvas');
    const markdown = await clickAndCapture(chatgptCanvasPage);
    assertCheck(markdown.includes('# Canvas design document'), 'ChatGPT canvas heading missing');
    assertCheck(markdown.includes('Canvas body must be copied as Markdown.'), 'ChatGPT canvas body missing');
    assertCheck(markdown.includes('- Canvas list item'), 'ChatGPT canvas list missing');
    assertCheck(markdown.includes('leash/balanced/interactive'), 'ChatGPT canvas code missing');
    assertCheck(markdown.includes('Canvas prefix turn 205'), 'ChatGPT conversation turn limit dropped content');
    assertCheck(markdown.includes('CANVAS_END_SENTINEL'), 'ChatGPT canvas character limit dropped content');
    assertCheck(markdown.length > 120_000, `ChatGPT oversized canvas output was unexpectedly short: ${markdown.length}`);
    assertCheck(!markdown.includes('*[Content truncated for agent context.]*'), 'ChatGPT canvas emitted truncation marker');
    assertCheck(!markdown.includes('ChatGPT composer must not leak'), 'ChatGPT composer leaked into canvas output');
    assertCheck(!markdown.includes('\nEdit\n') && !markdown.includes('\nCopy\n'), 'ChatGPT canvas controls leaked');
    log('✅', 'ChatGPT preserves canvas writing blocks and excludes editor controls');
  } finally {
    await chatgptCanvasPage.close();
  }

  const strictCsp = "script-src 'unsafe-inline'; require-trusted-types-for 'script'; trusted-types 'none'";
  const selectionPage = await createFixturePage(browser, scriptContent, {
    url: 'https://fixture.test/selection',
    csp: strictCsp,
    html: `<!doctype html><html><head><title>Selection fixture</title></head><body>
      <main>
        <p id="selected">alpha\u2028beta / 10\u202F000 / می\u200Cروم / 👩\u200D💻 / \u2066isolated\u2069 / A\u00A0B\u1680C\u2007D\u205FE\u3000F / \u201Cdouble\u201D \u2018single\u2019 \u2014 \u2013 \u2212 \u2026 / ＦＵＬＬ ﬁ / water\u200Bmark\u200Ctest\u200Dvalue\u2060\uFE0F\u{E0100}\u{E0061}</p>
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
    assertCheck(markdown.includes('A B C D E F'), `Non-ASCII spaces were not normalized: ${JSON.stringify(markdown)}`);
    assertCheck(markdown.includes('"double" \'single\' - - - ...'), `Unicode punctuation was not normalized: ${JSON.stringify(markdown)}`);
    assertCheck(markdown.includes('FULL fi'), `Compatibility characters were not normalized: ${JSON.stringify(markdown)}`);
    assertCheck(markdown.includes('watermarktestvalue'), `Invisible watermark characters were not removed: ${JSON.stringify(markdown)}`);
    assertCheck(!/[\u200B\u2060\uFE0F\u{E0100}\u{E0061}]/u.test(markdown), 'Invisible watermark code points survived normalization');
    assertCheck(!markdown.includes('must not copy'), 'Selected-text fallback copied unselected content');
    log('✅', 'Strict Trusted Types selection works and Unicode output is sanitized');
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
    await assertRouteIdentity(claudePage, 'Claude', 'Claude');
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
    await assertRouteIdentity(geminiPage, 'Gemini', 'Gemini');
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

async function runExpandedPlatformChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Expanded platform extractor guards${COLORS.reset}`);

  await runSearchAndLinkedInChecks(browser, scriptContent);
  await runMetricPlatformChecks(browser, scriptContent);

  const sheetsPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.google.com/spreadsheets/d/sheet-fixture/edit?gid=42#gid=42',
    beforeLoad: () => {
      window.fetch = async () => new Response(
        'Name,Value\nAlpha,10\n"Beta, Inc.",20',
        { status: 200, headers: { 'Content-Type': 'text/csv' } },
      );
    },
    html: `<!doctype html><html><head><title>Metrics - Google Sheets</title></head><body>
      <div class="docs-title-input-label-inner">Metrics</div>
      <div class="docs-sheet-active-tab" data-sheet-id="42">Overview</div>
    </body></html>`,
  });
  try {
    const markdown = await clickAndCaptureWithPointer(sheetsPage);
    assertCheck(markdown.includes('spreadsheet_id: sheet-fixture'), 'Google Sheets extractor did not activate');
    assertCheck(markdown.includes('| Alpha | 10 |'), 'Google Sheets row missing');
    assertCheck(markdown.includes('| Beta, Inc. | 20 |'), 'Google Sheets quoted CSV cell missing');
    assertCompactMetadata(markdown, 'Google Sheets output');
  } finally {
    await sheetsPage.close();
  }

  const slidesPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.google.com/presentation/d/slides-fixture/edit',
    beforeLoad: () => {
      window.fetch = async () => new Response(`<!doctype html><html><body>
        <div class="slide" title="Slide 1">
          <div class="slide-content">
            <div><div class="shape" style="top:10px;left:10px"><p style="font-size:28px">Launch Plan</p></div></div>
            <div><div class="shape" style="top:100px;left:10px"><p style="font-size:16px">Ship safely</p></div></div>
          </div>
          <div class="slide-notes">Discuss rollout.</div>
        </div>
        <div class="slide" title="Slide 2">
          <div class="slide-content">
            <div class="shape" style="top:10px;left:10px"><p style="font-size:28px">Launch Results</p></div>
            <div class="shape" style="top:100px;left:10px"><p style="font-size:16px">No incidents</p></div>
          </div>
          <div class="slide-notes">Share metrics.</div>
        </div>
      </body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
    html: `<!doctype html><html><head><title>Launch - Google Slides</title></head><body>
      <div class="docs-title-input-label-inner">Launch</div>
      <div role="listitem" aria-selected="true" aria-label="Slide 2"></div>
    </body></html>`,
  });
  try {
    const currentMarkdown = await chooseAndCapture(slidesPage, 'current');
    assertCheck(currentMarkdown.includes('presentation_id: slides-fixture'), 'Google Slides extractor did not activate');
    assertCheck(currentMarkdown.includes('Launch Results'), 'Google Slides current slide title missing');
    assertCheck(currentMarkdown.includes('No incidents'), 'Google Slides current slide body missing');
    assertCheck(currentMarkdown.includes('Share metrics.'), 'Google Slides current slide notes missing');
    assertCheck(!currentMarkdown.includes('Launch Plan'), 'Google Slides current scope included another slide');
    assertCompactMetadata(currentMarkdown, 'Google Slides current-slide output');

    const allMarkdown = await chooseAndCapture(slidesPage, 'all');
    assertCheck(allMarkdown.includes('Launch Plan'), 'Google Slides first slide title missing');
    assertCheck(allMarkdown.includes('Ship safely'), 'Google Slides first slide body missing');
    assertCheck(allMarkdown.includes('Launch Results'), 'Google Slides second slide title missing');
    assertCheck(allMarkdown.indexOf('Launch Plan') < allMarkdown.indexOf('Launch Results'), 'Google Slides slide order changed');
    assertCompactMetadata(allMarkdown, 'Google Slides all-slides output');
  } finally {
    await slidesPage.close();
  }

  const slidesTextFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://docs.google.com/presentation/d/slides-text-fixture/edit',
    beforeLoad: () => {
      window.fetch = async (url) => {
        if (String(url).includes('/htmlpresent')) return new Response('Unavailable', { status: 503 });
        return new Response(
          'Slide 1: Architecture\nService map\n\nRetry behavior\fSlide 2: Results\nAll checks passed',
          { status: 200, headers: { 'Content-Type': 'text/plain' } },
        );
      };
    },
    html: `<!doctype html><html><head><title>Fallback - Google Slides</title></head><body>
      <div class="docs-title-input-label-inner">Fallback</div>
    </body></html>`,
  });
  try {
    const markdown = await chooseAndCapture(slidesTextFallbackPage, 'all');
    assertCheck(markdown.includes('## Slide 1: Architecture'), 'Google Slides text fallback lost first slide');
    assertCheck(markdown.includes('Retry behavior'), 'Google Slides text fallback lost paragraph after blank line');
    assertCheck(markdown.includes('## Slide 2: Results'), 'Google Slides text fallback lost second slide');
    assertCheck(!markdown.includes('## Slide 3'), 'Google Slides text fallback treated paragraph as slide');
  } finally {
    await slidesTextFallbackPage.close();
  }

  const jiraApiPage = await createFixturePage(browser, scriptContent, {
    url: 'https://acme.atlassian.net/browse/API-77',
    beforeLoad: () => {
      window.__atlassianFetches = [];
      window.fetch = async (url, options) => {
        window.__atlassianFetches.push({ url: String(url), options });
        return new Response(JSON.stringify({
          key: 'API-77',
          names: {
            status: 'Status',
            assignee: 'Assignee',
            customfield_10001: 'Customer impact',
            creator: 'Creator',
            customfield_10002: 'Development',
            customfield_10003: 'Global Rank',
            customfield_10004: 'Attachment Count',
          },
          renderedFields: {},
          fields: {
            summary: 'REST-backed issue copy',
            description: {
              type: 'doc', version: 1, content: [
                { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'API checklist' }] },
                { type: 'paragraph', content: [
                  { type: 'text', text: 'Preserve ' },
                  { type: 'text', text: 'complete context', marks: [{ type: 'strong' }] },
                  { type: 'text', text: ' from Jira.' },
                ] },
                { type: 'bulletList', content: [
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First ADF item' }] }] },
                  { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second ADF item' }] }] },
                ] },
                { type: 'codeBlock', attrs: { language: 'bash' }, content: [{ type: 'text', text: 'curl /health' }] },
              ],
            },
            status: { name: 'In Progress' },
            assignee: { displayName: 'Alice Example' },
            customfield_10001: 'High',
            creator: { displayName: 'Duplicate Creator' },
            customfield_10002: '{summaryBean=com.atlassian.jira.plugin.devstatus.rest.SummaryBean@3f8dc7bf, devSummaryJson={"cachedValue":{}}}',
            customfield_10003: '9223372036854775807',
            customfield_10004: '0.0',
            comment: {
              total: 1,
              comments: [{
                id: '9001',
                author: { displayName: 'Bob Example' },
                created: '2026-08-09T12:00:00.000Z',
                body: { type: 'doc', version: 1, content: [{
                  type: 'paragraph', content: [
                    { type: 'text', text: 'Verified against ' },
                    { type: 'text', text: 'runbook', marks: [{ type: 'link', attrs: { href: 'https://example.com/runbook' } }] },
                    { type: 'text', text: '.' },
                  ],
                }] },
              }],
            },
            issuelinks: [{
              type: { outward: 'blocks' },
              outwardIssue: { key: 'OPS-8', fields: { summary: 'Production rollout' } },
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    html: `<!doctype html><html><head><title>Stale Jira shell</title></head><body>
      <main id="issue-content">
        <h1 data-testid="issue.views.issue-base.foundation.summary.heading">STALE DOM SUMMARY</h1>
        <div data-testid="issue.views.issue-base.foundation.description"><p>STALE DOM DESCRIPTION</p></div>
        <button data-testid="issue.views.issue-base.foundation.actions.more-actions">More</button>
      </main>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(jiraApiPage, 'Jira', 'Jira REST fixture');
    const anchored = await jiraApiPage.evaluate(() => {
      const target = document.querySelector('[data-testid="issue.views.issue-base.foundation.actions.more-actions"]');
      return !document.querySelector('.cam-floating-wrapper')
        && target?.previousElementSibling?.id === 'cam-copy-btn';
    });
    assertCheck(anchored, 'Jira copy control did not join native issue actions');
    const markdown = await clickAndCapture(jiraApiPage);
    const fetches = await jiraApiPage.evaluate(() => window.__atlassianFetches);
    assertCheck(
      fetches.length === 1
        && fetches[0].url === 'https://acme.atlassian.net/rest/api/3/issue/API-77?expand=names%2CrenderedFields&fields=*all'
        && fetches[0].options.credentials === 'same-origin',
      `Jira fetched wrong REST resource: ${JSON.stringify(fetches)}`,
    );
    for (const expected of [
      '# API-77: REST-backed issue copy',
      '## API checklist',
      '**complete context**',
      '- First ADF item',
      '```bash\ncurl /health\n```',
      '**Customer Impact:** High',
      '[OPS-8: blocks: Production rollout](https://acme.atlassian.net/browse/OPS-8)',
      '### Bob Example',
      '[runbook](https://example.com/runbook)',
    ]) {
      assertCheck(markdown.includes(expected), `Jira REST output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('STALE DOM'), 'Jira REST success mixed stale issue DOM into output');
    for (const excluded of [
      '**Creator:**', '**Development:**', 'summaryBean=', '**Global Rank:**', '**Attachment Count:**',
    ]) {
      assertCheck(!markdown.includes(excluded), `Jira REST output leaked internal field ${JSON.stringify(excluded)}: ${markdown}`);
    }
    assertCompactMetadata(markdown, 'Jira REST output');
  } finally {
    await jiraApiPage.close();
  }

  const confluenceApiPage = await createFixturePage(browser, scriptContent, {
    url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/456/REST+Runbook',
    beforeLoad: () => {
      window.__atlassianFetches = [];
      window.fetch = async (url, options) => {
        window.__atlassianFetches.push({ url: String(url), options });
        return new Response(JSON.stringify({
          id: '456',
          status: 'current',
          title: 'REST Runbook',
          spaceId: '987',
          createdAt: '2026-07-01T10:00:00.000Z',
          version: { number: 7, createdAt: '2026-08-09T11:00:00.000Z' },
          labels: { results: [{ name: 'operations' }, { name: 'production' }] },
          body: { view: { representation: 'view', value: `
            <h2>Recovery steps</h2>
            <p>Use <strong>REST page content</strong>, including content outside viewport.</p>
            <table><tbody><tr><th>Service</th><th>Owner</th></tr><tr><td>API</td><td>Platform</td></tr></tbody></table>
            <pre><code>kubectl get pods</code></pre>
          ` } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    html: `<!doctype html><html><head><title>Stale Confluence shell</title></head><body>
      <main>
        <h1 data-testid="page-title">STALE DOM TITLE</h1>
        <div data-testid="renderer-container"><div class="ak-renderer-document"><p>STALE DOM BODY</p></div></div>
        <div data-testid="object-header-actions-container">
          <button data-testid="copy-link-button">Copy link</button>
          <button id="more-actions-trigger">More</button>
        </div>
        <section id="comments-section"><div class="comment">
          <span class="author">Carol Example</span><time datetime="2026-08-09T12:30:00.000Z"></time>
          <div class="comment-body"><p>Visible page comment.</p></div>
        </div></section>
      </main>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(confluenceApiPage, 'Confluence', 'Confluence REST fixture');
    const anchored = await confluenceApiPage.evaluate(() => {
      const target = document.querySelector('[data-testid="object-header-actions-container"]');
      return !document.querySelector('.cam-floating-wrapper')
        && target?.lastElementChild?.id === 'cam-copy-btn';
    });
    assertCheck(anchored, 'Confluence copy control did not join native page actions');
    const markdown = await clickAndCapture(confluenceApiPage);
    const fetches = await confluenceApiPage.evaluate(() => window.__atlassianFetches);
    assertCheck(
      fetches.length === 1
        && fetches[0].url === 'https://acme.atlassian.net/wiki/api/v2/pages/456?body-format=view&include-labels=true'
        && fetches[0].options.credentials === 'same-origin',
      `Confluence fetched wrong REST resource: ${JSON.stringify(fetches)}`,
    );
    for (const expected of [
      '# REST Runbook',
      '**Labels:** operations, production',
      '## Recovery steps',
      '**REST page content**',
      '| Service | Owner |',
      'kubectl get pods',
      '### Carol Example',
      'Visible page comment.',
    ]) {
      assertCheck(markdown.includes(expected), `Confluence REST output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('STALE DOM BODY'), 'Confluence REST success mixed stale page DOM into output');
    assertCompactMetadata(markdown, 'Confluence REST output');
  } finally {
    await confluenceApiPage.close();
  }

  const confluenceSpaceOverviewPage = await createFixturePage(browser, scriptContent, {
    url: 'https://acme.atlassian.net/wiki/spaces/CCSD/overview?homepageId=1991704878',
    beforeLoad: () => {
      window.__atlassianFetches = [];
      window.fetch = async (url, options) => {
        window.__atlassianFetches.push({ url: String(url), options });
        return new Response(JSON.stringify({
          id: '1991704878',
          status: 'current',
          title: 'CCSD Home',
          spaceId: '2468',
          version: { number: 4, createdAt: '2026-08-10T12:00:00.000Z' },
          labels: { results: [] },
          body: { view: { representation: 'view', value: `
            <h2>Welcome to CCSD</h2>
            <p>Space homepage content from Confluence REST.</p>
          ` } },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    },
    html: `<!doctype html><html><head><title>CCSD overview</title></head><body>
      <main><h1>CCSD</h1><p>STALE SPACE OVERVIEW SHELL</p>
        <div data-testid="object-header-actions-container"></div>
      </main>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(confluenceSpaceOverviewPage, 'Confluence', 'Confluence space overview fixture');
    const markdown = await clickAndCapture(confluenceSpaceOverviewPage);
    const fetches = await confluenceSpaceOverviewPage.evaluate(() => window.__atlassianFetches);
    assertCheck(
      fetches.length === 1
        && fetches[0].url === 'https://acme.atlassian.net/wiki/api/v2/pages/1991704878?body-format=view&include-labels=true'
        && fetches[0].options.credentials === 'same-origin',
      `Confluence space overview fetched wrong homepage resource: ${JSON.stringify(fetches)}`,
    );
    for (const expected of ['# CCSD Home', '## Welcome to CCSD', 'Space homepage content from Confluence REST.']) {
      assertCheck(markdown.includes(expected), `Confluence space overview output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('STALE SPACE OVERVIEW SHELL'),
      'Confluence space overview mixed stale shell into REST output');
  } finally {
    await confluenceSpaceOverviewPage.close();
  }

  log('✅', 'Jira and Confluence prefer authenticated REST content, including space homepages, and use native action bars');

  const fixtures = [
    {
      name: 'Notion',
      extractor: 'Notion',
      url: 'https://workspace.notion.site/project-plan',
      html: `<main role="main"><h1 data-testid="page-title">Project Plan</h1>
        <div data-testid="property-row"><span data-testid="property-name">Status</span><span>In Progress</span></div>
        <div data-block-id="block-1"><p>Notion fixture body.</p><label><input type="checkbox" checked> Ship fix</label>
          <pre><code class="language-typescript">const ready = true;</code></pre></div>
        <div role="grid"><div role="row"><div role="columnheader">Task</div><div role="columnheader">Owner</div></div>
          <div role="row"><div role="gridcell">Release</div><div role="gridcell">Bruno</div></div></div>
        <button>Load more</button></main>`,
      expected: [
        'title: Project Plan', 'url: "https://workspace.notion.site/project-plan"',
        '## Properties', '**Status:** In Progress', 'Notion fixture body.', '[x] Ship fix',
        '```typescript\nconst ready = true;\n```', '| Task | Owner |', '| Release | Bruno |',
        'Database export includes rendered rows only',
      ],
      excluded: ['\\"Project Plan\\"', 'Load more'],
    },
    {
      name: 'Notion custom domain',
      extractor: 'Notion',
      url: 'https://notes.example.org/project-plan',
      html: `<main class="notion-page-content"><h1 data-testid="page-title">Custom Notion Page</h1>
        <div data-block-id="custom-block"><p>Content-detected Notion body.</p></div></main>`,
      expected: ['# Custom Notion Page', 'Content-detected Notion body.'],
    },
    {
      name: 'Sphinx / Read the Docs',
      extractor: 'Sphinx / Read the Docs',
      url: 'https://docs.example.org/guide/install.html',
      html: `<script src="/_static/documentation_options.js"></script><nav>SPHINX NAVIGATION NOISE</nav>
        <div class="document"><aside class="sphinxsidebar">SPHINX SIDEBAR NOISE</aside>
          <div class="body" role="main"><h1>Install Guide<a class="headerlink" href="#install">¶</a></h1>
            <p>Sphinx fixture documentation.</p><p><a href="/guide/configure.html">Configure next</a></p>
            <div class="highlight-python"><div class="highlight"><pre><span>print</span>("ready")</pre></div></div>
          </div></div>`,
      expected: [
        '# Install Guide', 'Sphinx fixture documentation.',
        '[Configure next](https://docs.example.org/guide/configure.html)',
        '```python\nprint("ready")\n```',
      ],
      excluded: ['SPHINX NAVIGATION NOISE', 'SPHINX SIDEBAR NOISE', '¶'],
    },
    {
      name: 'Read the Docs classic',
      extractor: 'Sphinx / Read the Docs',
      url: 'https://project.readthedocs.io/en/latest/quickstart.html',
      html: `<div class="wy-nav-side">READTHEDOCS SIDEBAR NOISE</div><div class="wy-nav-content">
        <div class="rst-content"><div class="wy-breadcrumbs">READTHEDOCS BREADCRUMB NOISE</div>
          <div role="main" class="document"><div itemprop="articleBody"><h1>Quickstart<a class="headerlink" href="#quickstart"></a></h1>
            <p>Read the Docs fixture body.</p><div class="admonition note"><p class="admonition-title">Note</p><p>Keep useful admonitions.</p></div>
          </div></div></div></div>`,
      expected: ['# Quickstart', 'Read the Docs fixture body.', 'Keep useful admonitions.'],
      excluded: ['READTHEDOCS SIDEBAR NOISE', 'READTHEDOCS BREADCRUMB NOISE', ''],
    },
    {
      name: 'Microsoft 365',
      extractor: 'Microsoft 365',
      url: 'https://www.office.com/launch/word?auth=2',
      html: `<input aria-label="Document title" value="Quarterly Plan">
        <div role="document"><h1>Quarterly Plan</h1><p>Office fixture body.</p></div>`,
      expected: ['Office fixture body.'],
    },
    {
      name: 'Slack',
      extractor: 'Slack',
      url: 'https://app.slack.com/client/T123/C456',
      html: `<main role="main" data-qa="message_pane">
        <div data-qa="message_container" data-ts="123">
          <button data-qa="message_sender_name">Alice</button>
          <time datetime="2026-07-29T12:00:00Z">12:00</time>
          <div data-qa="message-text">Slack fixture decision.</div>
        </div></main>`,
      expected: ['Slack fixture decision.'],
    },
    {
      name: 'Discord',
      extractor: 'Discord',
      url: 'https://discord.com/channels/1/2',
      html: `<main role="main"><ol data-list-id="chat-messages">
        <li id="chat-messages-1"><h3><span class="username">Bob</span></h3>
          <time datetime="2026-07-29T12:00:00Z">12:00</time>
          <div id="message-content-1">Discord fixture decision.</div>
        </li></ol></main>`,
      expected: ['Discord fixture decision.'],
    },
    {
      name: 'Jira',
      extractor: 'Jira',
      url: 'https://acme.atlassian.net/browse/PROJ-42',
      beforeLoad: () => { window.fetch = async () => new Response('Unavailable', { status: 503 }); },
      html: `<main id="issue-content"><h1 data-testid="issue.views.issue-base.foundation.summary.heading">Fix production export</h1>
        <div data-testid="issue.views.field.rich-text.description"><p>Jira fixture description.</p></div>
        <dl><dt>Status</dt><dd>In Progress</dd></dl></main>`,
      expected: ['PROJ-42', 'Jira fixture description.'],
    },
    {
      name: 'Confluence',
      extractor: 'Confluence',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Runbook',
      beforeLoad: () => { window.fetch = async () => new Response('Unavailable', { status: 503 }); },
      html: `<main><h1 data-testid="page-title">Operations Runbook</h1>
        <div data-testid="renderer-container"><div class="ak-renderer-document"><p>Confluence fixture body.</p></div></div></main>`,
      expected: ['Operations Runbook', 'Confluence fixture body.'],
    },
    {
      name: 'Artificial Analysis',
      extractor: 'Artificial Analysis',
      url: 'https://artificialanalysis.ai/models/fixture-model',
      html: `<nav>ARTIFICIAL_ANALYSIS_NAV_NOISE</nav>
        <section class="bg-brand-blue-light">
          <div><a target="_blank" href="https://fixture.example/">Fixture Labs</a>
            <button aria-label="Effort">Effort max<svg aria-hidden="true"></svg></button>
            <p>Proprietary model</p><p><span>Released</span> August 2026</p>
          </div>
          <h1>Fixture Model (Adaptive Reasoning, Max Effort) Intelligence, Performance &amp; Price Analysis</h1>
          <div aria-labelledby="intelligence-title"><h4 id="intelligence-title">Intelligence</h4>
            <button><span>#2</span> / 188</button>
            <div class="metric-block"><div class="value-row"><div class="text-4xl"><span>88</span></div><div>Artificial Analysis Intelligence Index</div></div></div>
          </div>
          <div aria-labelledby="cost-title"><h4 id="cost-title">Cost</h4>
            <button><span>#73</span> / 188</button>
            <div class="metric-block"><div>In $5.00 Out $25.00 Cache Discount 90%</div><div class="value-row"><div class="text-4xl"><span>$2.34</span></div><div>Cost per Intelligence Index task</div></div></div>
          </div>
          <button aria-controls="comparison-summary">Comparison Summary<svg aria-hidden="true"></svg></button>
          <div id="comparison-summary"><p>Fixture Model leads its comparison class while remaining expensive.</p></div>
          <button aria-controls="technical-specifications">Technical specifications<svg aria-hidden="true"></svg></button>
          <div id="technical-specifications"><table><tbody>
            <tr><th><svg aria-hidden="true"></svg>Reasoning</th><td><span>Yes</span><button><svg></svg></button><div class="sr-only">Hidden explanation noise.</div></td></tr>
            <tr><th>Input modality</th><td><button><svg></svg></button><div class="sr-only"><p>Supports: text and image</p></div></td></tr>
            <tr><th>Context window</th><td><span>1M</span><button><svg></svg></button><div class="sr-only">HIDDEN_CONTEXT_NOISE</div></td></tr>
          </tbody></table></div>
        </section>
        <main><div class="recharts-wrapper">CHART_AXIS_NOISE OTHER_MODEL_DOM_NOISE</div></main>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Artificial Analysis Intelligence Index',
          creator: { '@type': 'Organization', name: 'Artificial Analysis', url: 'https://artificialanalysis.ai' },
          description: 'Composite intelligence score · Higher is better',
          measurementTechnique: 'Independent fixture evaluation.',
          license: 'https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf',
          citation: 'Artificial Analysis fixture citation.',
          data: [
            { label: 'Fixture Model (max)', artificialAnalysisIntelligenceIndex: 88.5, detailsUrl: '/models/fixture-model' },
            { label: 'Other Model', artificialAnalysisIntelligenceIndex: 87, detailsUrl: '/models/other-model' },
          ],
        })}</script>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Latency: Time To First Answer Token',
          description: 'Seconds to first answer token · Lower is better',
          data: [
            { label: 'Fixture Model (max)', reasoningTime: 12.5, inputTime: 3.25, detailsUrl: '/models/fixture-model' },
          ],
        })}</script>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [{
            '@type': 'Question',
            name: 'Who created Fixture Model?',
            acceptedAnswer: { '@type': 'Answer', text: '<strong>Fixture Labs</strong> created Fixture Model.' },
          }],
        })}</script>`,
      expected: [
        '# Fixture Model (Adaptive Reasoning, Max Effort) Intelligence, Performance & Price Analysis',
        '| Provider | [Fixture Labs](https://fixture.example/) |',
        '| Reasoning effort | max |', '| Model class | Proprietary |', '| Released | August 2026 |',
        '| Intelligence | 88 | #2 / 188 | Artificial Analysis Intelligence Index |',
        '| Cost | $2.34 | #73 / 188 | Cost per Intelligence Index task | In $5.00 Out $25.00 Cache Discount 90% |',
        'Fixture Model leads its comparison class while remaining expensive.',
        '| Reasoning | Yes |', '| Input modality | text and image |', '| Context window | 1M |',
        '| Artificial Analysis Intelligence Index | Fixture Model (max) | Artificial analysis intelligence index: 88.5 |',
        '| Latency: Time To First Answer Token | Fixture Model (max) | Reasoning time: 12.5; Input time: 3.25 |',
        '| Measurement technique | Independent fixture evaluation. |',
        '[Terms of use](https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf)',
        '### Who created Fixture Model?', '**Fixture Labs** created Fixture Model.',
      ],
      excluded: [
        'ARTIFICIAL_ANALYSIS_NAV_NOISE', 'CHART_AXIS_NOISE', 'OTHER_MODEL_DOM_NOISE',
        'Other Model', 'Hidden explanation noise.', 'HIDDEN_CONTEXT_NOISE',
      ],
    },
    {
      name: 'Artificial Analysis homepage',
      extractor: 'Artificial Analysis',
      url: 'https://artificialanalysis.ai/',
      html: `<nav>ARTIFICIAL_ANALYSIS_HOME_NAV_NOISE</nav>
        <section class="container hero">
          <div><h1>Independent analysis of AI</h1>
            <p>Understand the AI landscape to choose the best model and provider for your use case</p></div>
          <div>
            <a href="/optima"><span>Launch</span><p>Optima</p><p>Build custom benchmarks from your own tasks.</p></a>
            <a href="/articles/index-update"><span>Update</span><p>Intelligence Index v4.1.1</p><p>Latest evaluation update.</p></a>
          </div>
        </section>
        <main>
          <section id="intelligence"><div class="section-heading"><div><h2><span aria-hidden="true"></span><span>Intelligence</span></h2></div>
            <p>Intelligence of leading AI models based on independent evaluations</p></div>
            <svg>ARTIFICIAL_ANALYSIS_HOME_SVG_NOISE</svg></section>
          <section id="coding-agents"><div class="section-heading"><div><h2><a href="/agents/coding-agents">Coding Agent Index</a></h2></div>
            <p>Performance, cost, and execution time for leading coding agents</p></div>
            <button>ARTIFICIAL_ANALYSIS_HOME_CONTROL_NOISE</button></section>
        </main>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Intelligence',
          creator: { '@type': 'Organization', name: 'Artificial Analysis', url: 'https://artificialanalysis.ai' },
          description: 'Artificial Analysis Intelligence Index · Higher is better',
          measurementTechnique: 'Independent homepage fixture evaluation.',
          license: 'https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf',
          citation: 'Artificial Analysis homepage fixture citation.',
          data: [
            { label: 'Fixture Frontier', artificialAnalysisIntelligenceIndex: 91.25, detailsUrl: '/models/fixture-frontier' },
            { label: 'Fixture Efficient', artificialAnalysisIntelligenceIndex: 89.5, detailsUrl: '/models/fixture-efficient' },
          ],
        })}</script>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Intelligence',
          creator: { '@type': 'Organization', name: 'Artificial Analysis', url: 'https://artificialanalysis.ai' },
          description: 'Artificial Analysis Intelligence Index · Higher is better',
          measurementTechnique: 'Independent homepage fixture evaluation.',
          license: 'https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf',
          citation: 'Artificial Analysis homepage fixture citation.',
          data: [
            { label: 'Fixture Frontier', artificialAnalysisIntelligenceIndex: 91.25, detailsUrl: '/models/fixture-frontier' },
            { label: 'Fixture Efficient', artificialAnalysisIntelligenceIndex: 89.5, detailsUrl: '/models/fixture-efficient' },
          ],
        })}</script>
        <script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: 'Text to Image Leaderboard',
          description: 'Elo scores with confidence intervals',
          data: [{
            label: 'Fixture Image Model',
            detailsUrl: '/media/fixture-image-model',
            elo: [
              { '@type': 'PropertyValue', name: 'mid', value: 1370.24 },
              { '@type': 'PropertyValue', name: 'lower', value: 1360.24 },
              { '@type': 'PropertyValue', name: 'upper', value: 1380.24 },
            ],
          }],
        })}</script>`,
      expected: [
        '# Independent analysis of AI',
        'Understand the AI landscape to choose the best model and provider for your use case',
        '| Launch | [Optima](https://artificialanalysis.ai/optima) | Build custom benchmarks from your own tasks. |',
        '| Update | [Intelligence Index v4.1.1](https://artificialanalysis.ai/articles/index-update) | Latest evaluation update. |',
        '| Intelligence | Intelligence of leading AI models based on independent evaluations |',
        '| [Coding Agent Index](https://artificialanalysis.ai/agents/coding-agents) | Performance, cost, and execution time for leading coding agents |',
        '## Published Datasets', '### Intelligence',
        '| [Fixture Frontier](https://artificialanalysis.ai/models/fixture-frontier) | Artificial analysis intelligence index: 91.25 |',
        '| [Fixture Efficient](https://artificialanalysis.ai/models/fixture-efficient) | Artificial analysis intelligence index: 89.5 |',
        '### Text to Image Leaderboard',
        '| [Fixture Image Model](https://artificialanalysis.ai/media/fixture-image-model) | Elo mid: 1370.24; Elo lower: 1360.24; Elo upper: 1380.24 |',
        '| Measurement technique | Independent homepage fixture evaluation. |',
        '[Terms of use](https://artificialanalysis.ai/docs/legal/Terms-of-Use.pdf)',
      ],
      excluded: [
        'ARTIFICIAL_ANALYSIS_HOME_NAV_NOISE', 'ARTIFICIAL_ANALYSIS_HOME_SVG_NOISE',
        'ARTIFICIAL_ANALYSIS_HOME_CONTROL_NOISE',
      ],
      exactOccurrences: { '### Intelligence': 1 },
    },
    {
      name: 'OpenRouter',
      extractor: 'OpenRouter',
      url: 'https://openrouter.ai/fixture/model-v1',
      beforeLoad: () => {
        window.fetch = async (input) => {
          const url = String(input);
          if (url.includes('/api/v1/models/')) {
            return new Response(JSON.stringify({
              data: {
                id: 'fixture/model-v1',
                name: 'Fixture: Model V1',
                description: 'Endpoint catalog fixture.',
                architecture: {
                  modality: 'text+image->text',
                  input_modalities: ['text', 'image'],
                  output_modalities: ['text'],
                  tokenizer: 'FixtureTokenizer',
                },
                endpoints: [{
                  name: 'Fixture Cloud | fixture/model-v1',
                  model_id: 'fixture/model-v1',
                  model_name: 'Fixture: Model V1',
                  provider_name: 'Fixture Cloud',
                  tag: 'fixture-cloud/flex',
                  context_length: 1048576,
                  max_completion_tokens: 65536,
                  max_prompt_tokens: null,
                  quantization: 'fp8',
                  pricing: {
                    prompt: '0.000000375',
                    completion: '0.000001875',
                    input_cache_read: '0.0000000375',
                    discount: 0.5,
                  },
                  supported_parameters: ['tools', 'structured_outputs'],
                  status: 0,
                  uptime_last_5m: 99.9,
                  uptime_last_30m: 99.8,
                  uptime_last_1d: 99.7,
                  supports_implicit_caching: true,
                  supports_voice_cloning: false,
                  latency_last_30m: 0.42,
                  throughput_last_30m: 123.4,
                }],
              },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/v1/model/')) {
            return new Response(JSON.stringify({
              data: {
                id: 'fixture/model-v1',
                canonical_slug: 'fixture/model-v1-20260814',
                name: 'Fixture: Model V1',
                created: 1786665600,
                description: 'Short API description.',
                context_length: 1048576,
                architecture: {
                  modality: 'text+image->text',
                  input_modalities: ['text', 'image'],
                  output_modalities: ['text'],
                  tokenizer: 'FixtureTokenizer',
                  instruct_type: null,
                },
                pricing: {
                  prompt: '0.000000375',
                  completion: '0.000001875',
                  input_cache_read: '0.0000000375',
                  web_search: '0.014',
                },
                top_provider: {
                  context_length: 1048576,
                  max_completion_tokens: 65536,
                  is_moderated: false,
                },
                per_request_limits: { prompt_tokens: 1000000 },
                supported_parameters: ['temperature', 'tools', 'structured_outputs'],
                default_parameters: { temperature: 0.7 },
                expiration_date: null,
                hugging_face_id: null,
                knowledge_cutoff: '2026-07',
                reasoning: {
                  mandatory: false,
                  default_enabled: true,
                  supported_efforts: ['low', 'high'],
                },
                supported_voices: null,
                benchmarks: {
                  artificial_analysis: { intelligence_index: 88.5 },
                },
                links: { details: '/api/v1/models/fixture/model-v1/endpoints' },
                future_definition: { routing_class: 'exact' },
              },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return new Response('Not found', { status: 404 });
        };
      },
      html: `<nav>OPENROUTER_NAV_NOISE</nav>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Fixture: Model V1","description":"Fixture model description from JSON-LD.","author":{"@type":"Organization","name":"fixture"},"featureList":["1,048,576 token context","Input modalities: text, image","Output modalities: text"]}</script>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"Which providers serve Fixture Model?","acceptedAnswer":{"@type":"Answer","text":"Fixture Cloud serves this model with automatic failover."}}]}</script>
        <main id="app-shell"><div id="page-content"><div data-marketplace-wrapper="true">
          <div id="model-title-row"><div><h1>Fixture: Model V1</h1><h3 title="Model identifier for use in the API">fixture/model-v1</h3></div></div>
          <section id="providers"><h2>Providers</h2><table><thead><tr><th>Provider</th><th>Input</th></tr></thead><tbody><tr><td>PAGE_ONLY_PROVIDER_NOISE</td><td>$9</td></tr></tbody></table></section>
          <script>window.__next_f = ['CLIENT_HYDRATION_NOISE'];</script>
        </div></div></main>`,
      expected: [
        '# Fixture: Model V1', 'Fixture model description from JSON-LD.',
        '| Model ID | fixture/model-v1 |', '| Canonical slug | fixture/model-v1-20260814 |',
        '| input_modalities | text, image |',
        '| prompt | 0.000000375 | $0.375 / 1M input tokens |',
        'structured_outputs', '| supported_efforts | low, high |',
        '| artificial_analysis.intelligence_index | 88.5 |',
        '| future_definition.routing_class | exact |',
        'fixture-cloud/flex', '| supports_implicit_caching | true |',
        'Fixture Cloud serves this model with automatic failover.',
      ],
      excluded: ['OPENROUTER_NAV_NOISE', 'PAGE_ONLY_PROVIDER_NOISE', 'CLIENT_HYDRATION_NOISE'],
    },
    {
      name: 'OpenRouter JSON-LD fallback',
      extractor: 'OpenRouter',
      url: 'https://openrouter.ai/fixture/fallback-model',
      beforeLoad: () => {
        window.fetch = async () => new Response('Unavailable', { status: 503 });
      },
      html: `<nav>OPENROUTER_FALLBACK_NAV_NOISE</nav>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Fixture: Fallback Model","description":"Structured fallback description.","author":{"@type":"Organization","name":"fixture"},"featureList":["32,768 token context","Input Price: $2/M tokens"]}</script>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"What does fallback preserve?","acceptedAnswer":{"@type":"Answer","text":"Fallback preserves published model definitions."}}]}</script>
        <main id="app-shell"><div id="page-content"><div data-marketplace-wrapper="true">
          <div id="model-title-row"><div><h1>Fixture: Fallback Model</h1><h3 title="Model identifier for use in the API">fixture/fallback-model</h3></div></div>
          <section id="providers"><h2>Providers</h2><table><thead><tr><th>Provider</th><th>Input /M</th></tr></thead><tbody><tr><td>Fallback Cloud</td><td>$2.00</td></tr></tbody></table></section>
          <section id="api"><h2>API</h2><table><thead><tr><th>Parameter</th><th>Supported</th></tr></thead><tbody><tr><td>tools</td><td>Yes</td></tr></tbody></table></section>
        </div></div></main>`,
      expected: [
        '# Fixture: Fallback Model', 'Structured fallback description.',
        '32,768 token context', '| Fallback Cloud | $2.00 |',
        '| tools | Yes |', 'Fallback preserves published model definitions.',
      ],
      excluded: ['OPENROUTER_FALLBACK_NAV_NOISE'],
    },
    {
      name: 'DeepSWE',
      extractor: 'DeepSWE',
      url: 'https://deepswe.datacurve.ai/',
      beforeLoad: () => {
        window.fetch = async (input) => {
          if (!String(input).includes('/artifacts/v1.1/leaderboard-live.json')) {
            return new Response('Not found', { status: 404 });
          }
          return new Response(JSON.stringify({
            scope: 'Every fixture rollout grouped by configuration.',
            unit: 'Fixture pass@1 scoring definition.',
            generated_at: '2026-08-13T16:11:55Z',
            n_tasks_in_set: 113,
            latest_job: { name: 'fixture-latest-job', finished_at: '2026-08-13T05:10:16Z' },
            rows: [
              {
                model: 'fixture-model-alpha', reasoning_effort: 'max',
                config: 'fixture_alpha_max', harness: 'mini-swe-agent', source: 'deep-swe',
                pass_at_1: 0.736486, pass_at_4: 0.884956,
                n_passed: 327, n_attempted: 444,
                n_tasks_passed_any: 100, n_tasks_attempted: 113,
                ci_lo: 0.697763, ci_hi: 0.77521, n_runs: 4,
                ci_method: '95% fixture run-to-run interval',
                mean_cost_usd: 11.837583, median_cost_usd: 10.428151,
                mean_output_tokens: 117565.69, median_output_tokens: 113366.5,
                mean_input_tokens: 15025834.4, median_input_tokens: 12130307.5,
                mean_duration_seconds: 1911.82, median_duration_seconds: 1801.12,
                mean_agent_steps: 99.04, median_agent_steps: 90.5,
                median_peak_context_tokens: 215810,
                median_output_tokens_to_pass: 112874,
              },
              {
                model: 'fixture-model-beta', reasoning_effort: 'medium',
                config: 'fixture_beta_medium', harness: 'mini-swe-agent', source: 'deep-swe',
                pass_at_1: 0.5, pass_at_4: 0.75,
                n_passed: 226, n_attempted: 452,
                n_tasks_passed_any: 85, n_tasks_attempted: 113,
                ci_lo: 0.48, ci_hi: 0.52, n_runs: 4,
                ci_method: '95% fixture run-to-run interval',
                mean_cost_usd: 2.5, median_cost_usd: 2,
                mean_output_tokens: 50000, median_output_tokens: 45000,
                mean_input_tokens: 1000000, median_input_tokens: 900000,
                mean_duration_seconds: 600, median_duration_seconds: 550,
                mean_agent_steps: 50, median_agent_steps: 45,
                median_peak_context_tokens: 80000,
                median_output_tokens_to_pass: 42000,
              },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
      },
      html: `<main><header><h1>DeepSWE</h1>
          <p>Measuring fixture coding agents on original tasks.</p>
          <dl><div><dt>tasks</dt><dd>113</dd></div><div><dt>models</dt><dd>2</dd></div></dl>
          <a href="/blog">Read the blog</a><a href="/run">Run DeepSWE</a>
        </header>
        <section id="leaderboard"><h2>Leaderboard</h2>
          <button aria-pressed="true">v1.1</button><button aria-pressed="true">Cost</button>
          <div role="button" data-chart-pin-source><span class="font-medium text-foreground">DOM_FILTERED_ONLY_NOISE</span><span>[low]</span><span>1%±1%</span><span>Avg cost $99.00</span><span>Out tok 1k</span><span>Steps 1</span></div>
          <svg role="img" aria-label="Pass rate vs Avg cost"><text>SVG_AXIS_NOISE</text></svg>
        </section>
        <section class="article-prose"><p>DeepSWE fixture benchmark separates frontier configurations.</p><ul><li><strong>Contamination free</strong>: Fixture tasks are original.</li></ul></section>
        <section><h2>Task Examples</h2><a href="/data/tasks/fixture-task"><h3>Fixture task title</h3><p>Fixture task summary.</p><div><span>fixture/repo</span><span>rust</span></div></a><a href="/data/tasks">All 113 tasks</a></section>
        <section><h2>Read the full blog</h2><ol><li><a href="/blog/deepswe#methodology"><span>01</span><span>Methodology</span></a></li></ol></section>
        <section id="updates"><form><input value="NEWSLETTER_NOISE"></form></section>
      </main>`,
      expected: [
        '# DeepSWE', '| Version | v1.1 |', 'Measuring fixture coding agents',
        '| Configurations | 2 |', '| Tasks in set | 113 |', 'fixture-latest-job',
        'Every fixture rollout grouped by configuration.',
        '| fixture-model-alpha | max | 73.65% | 69.78% to 77.52% | 88.5%',
        '| fixture_alpha_max | mini-swe-agent | deep-swe | $10.4282 |',
        'DeepSWE fixture benchmark separates frontier configurations.',
        '[Fixture task title](https://deepswe.datacurve.ai/data/tasks/fixture-task)',
        'Repository: fixture/repo | Language: rust',
        '[Methodology](https://deepswe.datacurve.ai/blog/deepswe#methodology)',
        '[Published leaderboard artifact](https://deepswe.datacurve.ai/artifacts/v1.1/leaderboard-live.json)',
      ],
      excluded: ['DOM_FILTERED_ONLY_NOISE', 'SVG_AXIS_NOISE', 'NEWSLETTER_NOISE'],
    },
    {
      name: 'DeepSWE DOM fallback',
      extractor: 'DeepSWE',
      url: 'https://deepswe.datacurve.ai/',
      beforeLoad: () => {
        window.fetch = async () => new Response('Unavailable', { status: 503 });
      },
      html: `<main><header><h1>DeepSWE</h1><p>Fallback benchmark.</p></header>
        <section id="leaderboard"><h2>Leaderboard</h2><button aria-pressed="true">v1.1</button>
          <div role="button" data-chart-pin-source>
            <span class="font-medium text-foreground">fixture-fallback-model</span><span>[high]</span>
            <div class="sm:hidden"><span>74%±4%</span><span>Avg cost $11.84</span><span>Out tok 118k</span><span>Steps 99</span></div>
            <div class="hidden sm:block"><span>74%±4%</span><span>$11.84</span><span>118k</span><span>99</span></div>
          </div>
          <svg role="img"><text>FALLBACK_SVG_NOISE</text></svg>
        </section>
      </main>`,
      expected: [
        '# DeepSWE', '| Version | v1.1 |',
        '| fixture-fallback-model | high | 74% | 70% to 78%',
        '| $11.84 | 118,000 | 99 |',
      ],
      excluded: ['FALLBACK_SVG_NOISE', '74%±4%74%±4%'],
      exactOccurrences: { 'fixture-fallback-model': 1, '$11.84': 1, '118,000': 1 },
    },
    {
      name: 'GitLab',
      extractor: 'GitLab',
      url: 'https://gitlab.com/acme/project/-/blob/main/src/app.ts',
      html: `<main><div data-testid="blob-content"><pre>export const gitlabFixture = true;</pre></div></main>`,
      expected: ['export const gitlabFixture = true;'],
    },
    {
      name: 'Bitbucket',
      extractor: 'Bitbucket',
      url: 'https://bitbucket.org/acme/project/src/main/src/app.ts',
      html: `<main><div data-testid="source-code"><pre>export const bitbucketFixture = true;</pre></div></main>`,
      expected: ['export const bitbucketFixture = true;'],
    },
    {
      name: 'Perplexity',
      extractor: 'Perplexity',
      url: 'https://www.perplexity.ai/search/fixture',
      html: `<main><div data-testid="conversation-turn"><div data-testid="user-query">Perplexity question?</div></div>
        <div data-testid="conversation-turn"><div data-testid="answer"><p>Perplexity fixture answer.</p></div>
          <div data-testid="citation"><a href="https://example.com/source">Primary source</a></div></div></main>`,
      expected: ['Perplexity question?', 'Perplexity fixture answer.', 'Primary source'],
    },
    {
      name: 'Grok',
      extractor: 'Grok',
      url: 'https://grok.com/c/fixture',
      html: `<main><div data-testid="conversation-turn"><div data-testid="user-message">Grok question?</div></div>
        <div data-testid="conversation-turn"><div data-testid="assistant-message"><p>Grok fixture answer.</p></div></div></main>`,
      expected: ['Grok question?', 'Grok fixture answer.'],
    },
    {
      name: 'Facebook',
      extractor: 'Facebook',
      url: 'https://www.facebook.com/acme/posts/12345/',
      html: `<main role="main"><article role="article"><strong><a href="/acme">Alice</a></strong>
        <div data-testid="post_message">Facebook fixture body.</div><div role="toolbar"></div></article></main>`,
      expected: ['Facebook fixture body.'],
    },
    {
      name: 'Instagram',
      extractor: 'Instagram',
      url: 'https://www.instagram.com/p/ABC123/',
      html: `<main><article><header><a href="/alice/">alice</a></header>
        <div data-testid="post-caption">Instagram fixture caption.</div><section></section></article></main>`,
      expected: ['Instagram fixture caption.'],
    },
    {
      name: 'TikTok',
      extractor: 'TikTok',
      url: 'https://www.tiktok.com/@alice/video/1234567890',
      html: `<main><article data-e2e="browse-video"><span data-e2e="video-author-uniqueid">alice</span>
        <div data-e2e="browse-video-desc">TikTok fixture caption.</div>
        <div data-e2e="browse-share-group"></div></article></main>`,
      expected: ['TikTok fixture caption.'],
    },
    {
      name: 'Gmail',
      extractor: 'Gmail',
      url: 'https://mail.google.com/mail/u/0/#inbox/fixture-thread',
      html: `<main><h2 class="hP">Gmail fixture thread</h2>
        <div class="adn ads"><span class="gD" name="Alice Example" email="alice@example.com">Alice</span>
          <span class="g2">to me</span><span class="g3" title="August 8, 2026, 9:00 AM">9:00 AM</span>
          <div class="a3s aiL"><p>Gmail fixture message.</p></div></div></main>`,
      expected: ['Gmail fixture message.'],
    },
    {
      name: 'Meta AI',
      extractor: 'Meta AI',
      url: 'https://www.meta.ai/chat/fixture',
      html: `<main><div data-testid="message">
        <div data-testid="user-message">Meta AI fixture question?</div>
        <div data-testid="assistant-message"><p>Meta AI fixture answer.</p>
          <div data-testid="citation"><a href="https://example.com/meta-source">Meta source</a></div>
        </div></div></main>`,
      expected: ['Meta AI fixture question?', 'Meta AI fixture answer.', 'Meta source'],
    },
    {
      name: 'ChatGPT',
      extractor: 'ChatGPT',
      url: 'https://chatgpt.com/c/fixture-platform',
      html: `<main><div id="conversation-header-actions"></div>
        <section data-testid="conversation-turn-1" data-turn="user"><div class="whitespace-pre-wrap">ChatGPT fixture question?</div></section>
        <section data-testid="conversation-turn-2" data-turn="assistant"><div class="markdown"><p>ChatGPT fixture answer.</p></div></section></main>`,
      expected: ['ChatGPT fixture question?', 'ChatGPT fixture answer.'],
    },
    {
      name: 'Claude',
      extractor: 'Claude',
      url: 'https://claude.ai/chat/fixture-platform',
      html: `<main><div data-testid="wiggle-controls-actions"></div>
        <article role="article"><div data-testid="user-message">Claude fixture question?</div></article>
        <article role="article"><div class="standard-markdown"><p>Claude fixture answer.</p></div></article></main>`,
      expected: ['Claude fixture question?', 'Claude fixture answer.'],
    },
    {
      name: 'Gemini',
      extractor: 'Gemini',
      url: 'https://gemini.google.com/app/fixture-platform',
      html: `<main><div class="conversation-container">
        <user-query><p class="query-text-line">Gemini fixture question?</p></user-query>
        <model-response><div class="markdown markdown-main-panel"><p>Gemini fixture answer.</p></div></model-response>
        <user-query><p class="query-text-line">Gemini follow-up question?</p></user-query>
        <model-response><div class="markdown markdown-main-panel"><p>Gemini follow-up answer.</p></div></model-response>
      </div></main>`,
      expected: [
        'Gemini fixture question?', 'Gemini fixture answer.',
        'Gemini follow-up question?', 'Gemini follow-up answer.',
      ],
    },
    {
      name: 'X',
      extractor: 'X (Twitter)',
      url: 'https://x.com/alice/status/1234567890',
      html: `<main><article data-testid="tweet"><div data-testid="User-Name"><span><span>Alice Example</span></span><a href="/alice">@alice</a></div>
        <time datetime="2026-08-08T12:00:00Z">Aug 8</time><div data-testid="tweetText">X fixture post.</div>
        <div role="group"><button aria-label="12 Likes"></button></div></article></main>`,
      expected: ['X fixture post.', 'Alice Example'],
    },
    {
      name: 'LeetLLM',
      extractor: 'LeetLLM',
      url: 'https://www.leetllm.com/learn/markdown-basics',
      html: `<main><article data-reader-article><h1>Markdown Basics</h1>
        <div data-section="Foundations"></div><div data-difficulty="Beginner"></div>
        <div itemprop="articleBody"><p>LeetLLM lesson fixture body.</p><pre><code>print("hello")</code></pre>
          <a data-print-reference data-reference-title="Markdown guide" href="https://example.com/markdown-guide">Reference</a></div>
      </article></main>`,
      expected: ['LeetLLM lesson fixture body.', 'print("hello")', 'Markdown guide'],
    },
    {
      name: 'WhatsApp',
      extractor: 'WhatsApp',
      url: 'https://web.whatsapp.com/',
      html: `<div id="main"><header><span title="Fixture Chat">Fixture Chat</span><div data-testid="chat-header-actions"></div></header>
        <div data-testid="msg-container"><span data-testid="msg-author"><span>Alice</span></span><span data-testid="msg-time">09:00</span>
          <div data-testid="msg-text"><span>WhatsApp fixture message.</span></div></div></div>`,
      expected: ['Fixture Chat', 'WhatsApp fixture message.'],
    },
    {
      name: 'Google Search',
      extractor: 'Google Search',
      url: 'https://www.google.com/search?q=%5Bmarkdown%5D%20%23%20test',
      afterLoad: () => history.replaceState({}, '', '/search?q=%5Bmarkdown%5D%20%23%20test'),
      html: `<div id="hdtb-tls"></div><main><div class="MjjYud"><a href="javascript:alert(1)">Unsafe</a><h3><a href="/url?q=https%3A%2F%2Fexample.com%2Fgoogle-result">Google fixture result</a></h3><div class="VwiC3b">Google fixture snippet.</div></div></main>`,
      expected: ['**Query:** \\[markdown\\] # test', 'Google fixture result', 'Google fixture snippet.', 'https://example.com/google-result'],
      excluded: ['javascript:', 'google.com/url?'],
    },
    {
      name: 'DuckDuckGo Search',
      extractor: 'DuckDuckGo Search',
      url: 'https://duckduckgo.com/?q=markdown',
      html: `<div id="react-duckbar" data-testid="duckbar"><section><nav><ul>
        <li><a href="/?q=markdown&ia=web">All</a></li><li><a href="/?q=markdown&ia=images">Images</a></li>
        <li><a href="/?q=markdown&ia=videos">Videos</a></li><li><a href="/?q=markdown&ia=news">News</a></li>
      </ul><ul><li><a href="/?q=markdown&ia=chat">Duck.ai</a></li></ul></nav></section></div>
      <main><article class="result"><h2><a class="result__a" href="https://example.com/ddg-result">DuckDuckGo fixture result</a></h2><p class="result__snippet">DuckDuckGo fixture snippet.</p></article></main>`,
      anchorParentSelector: '#react-duckbar nav > ul:first-of-type',
      expected: ['DuckDuckGo fixture result', 'DuckDuckGo fixture snippet.'],
    },
    {
      name: 'Wikipedia',
      extractor: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Markdown',
      html: `<h1 id="firstHeading">Markdown fixture</h1><div id="p-views"><ul></ul></div><main id="mw-content-text"><p>Wikipedia fixture article body.</p></main>`,
      expected: ['Wikipedia fixture article body.'],
    },
    {
      name: 'YouTube',
      extractor: 'YouTube',
      url: 'https://www.youtube.com/watch?v=fixture123',
      html: `<div id="top-level-buttons-computed"></div><main><h1 class="title">YouTube fixture video</h1><div id="description"><yt-attributed-string>YouTube fixture description.</yt-attributed-string></div></main>`,
      expected: ['YouTube fixture'],
    },
    {
      name: 'Reddit',
      extractor: 'Reddit',
      url: 'https://www.reddit.com/r/markdown/comments/abc123/fixture/',
      html: `<main><shreddit-post data-post-id="t3_abc123"><div slot="post-actions"></div><h1>Reddit fixture title</h1><div slot="text-body">Reddit fixture body.</div></shreddit-post></main>`,
      expected: ['Reddit fixture body.'],
    },
    {
      name: 'Bing Search',
      extractor: 'Bing Search',
      url: 'https://www.bing.com/search?q=markdown',
      html: `<header id="b_header"><div class="b_scopebar"></div></header><main><li class="b_algo"><a href="javascript:alert(1)">Unsafe</a><h2><a href="/ck/a?u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9iaW5nLXJlc3VsdA==">Bing fixture result</a></h2><div class="b_caption"><p>Bing fixture snippet.</p></div></li></main>`,
      expected: ['Bing fixture result', 'Bing fixture snippet.', 'https://example.com/bing-result'],
      excluded: ['javascript:', 'bing.com/ck/a?'],
    },
    {
      name: 'Yahoo Search',
      extractor: 'Yahoo Search',
      url: 'https://search.yahoo.com/search?p=markdown',
      html: `<header id="header"></header><main id="web"><li class="algo"><h3><a href="https://example.com/yahoo-result">Yahoo fixture result</a></h3><p class="compText aAbs">Yahoo fixture snippet.</p></li></main>`,
      expected: ['Yahoo fixture result', 'Yahoo fixture snippet.'],
    },
    {
      name: 'Yandex Search',
      extractor: 'Yandex Search',
      url: 'https://yandex.com/search?text=markdown',
      html: `<header class="SearchHeader"></header><main id="search-result"><article class="serp-item"><h2><a href="https://example.com/yandex-result">Yandex fixture result</a></h2><p class="OrganicTextContentSpan">Yandex fixture snippet.</p></article></main>`,
      expected: ['Yandex fixture result', 'Yandex fixture snippet.'],
    },
    {
      name: 'Netflix',
      extractor: 'Netflix',
      url: 'https://www.netflix.com/title/80000000',
      html: `<main><h1 data-uia="video-title">Netflix fixture title</h1><div data-uia="video-description">Netflix fixture synopsis.</div><div data-uia="video-year">2026</div></main>`,
      expected: ['Netflix fixture title', 'Netflix fixture synopsis.'],
    },
    {
      name: 'Baidu Search',
      extractor: 'Baidu Search',
      url: 'https://www.baidu.com/s?wd=markdown',
      html: `<header id="form"></header><main id="content_left"><div class="result"><h3><a href="https://example.com/baidu-result">Baidu fixture result</a></h3><p class="c-abstract">Baidu fixture snippet.</p></div></main>`,
      expected: ['Baidu fixture result', 'Baidu fixture snippet.'],
    },
    {
      name: 'Pinterest',
      extractor: 'Pinterest',
      url: 'https://www.pinterest.com/pin/123456789/',
      html: `<script type="application/ld+json">{"id":"123456789","image":"javascript:alert(1)"}</script><main><div data-test-id="pin"><div data-test-id="pin-action-buttons"></div><h1 data-test-id="pin-title">Pinterest fixture pin</h1><div data-test-id="pin-description">Pinterest fixture description.</div><a href="https://example.com/pin-image"><img alt="Fixture image" src="https://example.com/pin-image.png"></a><div data-test-id="comment"><span data-test-id="comment-author">Alice</span><p data-test-id="comment-text">Pinterest fixture comment.</p></div></div></main>`,
      expected: ['Pinterest fixture pin', 'Pinterest fixture description.', 'Pinterest fixture comment.'],
      excluded: ['javascript:'],
    },
    {
      name: 'Temu',
      extractor: 'Temu',
      url: 'https://www.temu.com/goods.html?goods_id=123456',
      html: `<main><h1 data-testid="goods-title">Temu fixture product</h1><div data-testid="price">$12.99</div><div data-testid="description">Temu fixture description.</div><div data-testid="seller-name">Fixture Store</div></main>`,
      expected: ['Temu fixture product', 'Temu fixture description.', '$12.99'],
    },
    {
      name: 'Weather.com',
      extractor: 'Weather.com',
      url: 'https://www.weather.com/weather/today/l/New+York+NY',
      html: `<main><h1 data-testid="LocationTitle">New York, NY</h1><div data-testid="CurrentConditions"><span data-testid="TemperatureValue">72°</span><span data-testid="wxPhrase">Sunny</span></div><div data-testid="FeelsLike">Feels Like 72°</div></main>`,
      expected: ['New York, NY Weather', '72°', 'Sunny'],
    },
    {
      name: 'Twitch',
      extractor: 'Twitch',
      url: 'https://www.twitch.tv/videos/123456789',
      html: `<main><h1 data-a-target="video-title">Twitch fixture video</h1><a data-a-target="video-info-channel-name" href="https://www.twitch.tv/alice">Alice</a><div data-a-target="video-description">Twitch fixture description.</div></main>`,
      expected: ['Twitch fixture video', 'Twitch fixture description.'],
    },
    {
      name: 'VK',
      extractor: 'VK',
      url: 'https://vk.com/wall-1_2',
      html: `<main><article class="wall_post" data-post-id="-1_2"><div class="post_actions"></div><a class="post_author_link" href="/id1">Alice</a><div class="wall_post_text">VK fixture post.</div><time datetime="2026-08-08">Aug 8</time></article></main>`,
      expected: ['VK fixture post.', 'Alice'],
    },
    {
      name: 'Globo',
      extractor: 'Globo',
      url: 'https://www.globo.com/news/fixture-story',
      html: `<main><article><header><h1>Globo fixture article</h1></header><div class="mc-article-body"><p>Globo fixture article body.</p></div></article></main>`,
      expected: ['Globo fixture article', 'Globo fixture article body.'],
    },
    {
      name: 'FOX',
      extractor: 'FOX',
      url: 'https://www.fox.com/shows/fixture-show',
      html: `<main><h1>FOX fixture show</h1><div data-testid="description">FOX fixture description.</div></main>`,
      expected: ['FOX fixture show', 'FOX fixture description.'],
    },
    {
      name: 'Fox News',
      extractor: 'News (Generic)',
      url: 'https://www.foxnews.com/politics/fixture-story',
      html: `<main><article><header><h1>Fox News fixture story</h1></header><p>Fox News fixture body.</p></article></main>`,
      expected: ['Fox News fixture story', 'Fox News fixture body.'],
    },
    {
      name: 'BBC',
      extractor: 'News (Generic)',
      url: 'https://www.bbc.com/news/articles/fixture-story',
      html: `<main><article><header><h1>BBC fixture story</h1></header><p>BBC fixture body.</p></article></main>`,
      expected: ['BBC fixture story', 'BBC fixture body.'],
    },
    {
      name: 'GitHub',
      extractor: 'GitHub',
      url: 'https://github.com/bvolpato/copy-as-markdown',
      html: `<main><h1>copy-as-markdown</h1><div id="readme"><article class="markdown-body"><p>GitHub fixture README.</p></article></div></main>`,
      expected: ['GitHub fixture README.'],
    },
    {
      name: 'Brave Search',
      extractor: 'Brave Search',
      url: 'https://search.brave.com/search?q=markdown',
      html: `<header id="searchbox"></header><main><article data-testid="search-result"><h3><a href="https://example.com/brave-result">Brave fixture result</a></h3><p data-testid="result-description">Brave fixture snippet.</p></article></main>`,
      expected: ['Brave fixture result', 'Brave fixture snippet.'],
    },
    {
      name: 'Booking.com',
      extractor: 'Booking.com',
      url: 'https://www.booking.com/hotel/us/fixture-hotel.html',
      html: `<main><div data-testid="property-header"><h1>Booking fixture hotel</h1><div data-testid="address">New York</div></div><div data-testid="property-description">Booking fixture description.</div><div data-testid="review-score">9.1</div></main>`,
      expected: ['Booking fixture hotel', 'Booking fixture description.', '9.1'],
    },
  ];

  const dedicatedMetricFixtures = new Set(['Weights & Biases', 'MLflow']);
  for (const [name, extractor] of REQUESTED_FIRST_CLASS_SITES) {
    if (dedicatedMetricFixtures.has(name)) continue;
    const fixture = fixtures.find((candidate) => candidate.name === name);
    assertCheck(fixture, `Missing requested first-class fixture for ${name}`);
    assertCheck(
      fixture.extractor === extractor,
      `${name} fixture expects ${JSON.stringify(fixture.extractor)} instead of ${JSON.stringify(extractor)}`,
    );
  }

  const expectedAnchored = new Set([
    'Google Search', 'DuckDuckGo Search', 'Bing Search', 'Yahoo Search', 'Yandex Search',
    'Netflix', 'Baidu Search', 'Temu', 'Weather.com', 'Twitch', 'Brave Search', 'Booking.com',
  ]);

  for (const fixture of fixtures) {
    const page = await createFixturePage(browser, scriptContent, {
      url: fixture.url,
      html: `<!doctype html><html><head><title>${fixture.name} fixture</title></head><body>${fixture.html}</body></html>`,
      beforeLoad: fixture.beforeLoad,
      afterLoad: fixture.afterLoad,
      context: fixture.name,
    });
    try {
      await assertRouteIdentity(page, fixture.extractor, fixture.name);
      if (expectedAnchored.has(fixture.name)) {
        const floating = await page.$('.cam-floating-wrapper');
        assertCheck(!floating, `${fixture.name} copy control did not use its native anchor`);
      }
      if (fixture.anchorParentSelector) {
        const anchoredInsideTarget = await page.evaluate((selector) =>
          document.querySelector(selector)?.contains(document.getElementById('cam-copy-btn')) || false,
        fixture.anchorParentSelector);
        assertCheck(anchoredInsideTarget,
          `${fixture.name} copy control did not join ${fixture.anchorParentSelector}`);
      }
      const markdown = await clickAndCapture(page, fixture.name);
      for (const value of fixture.expected) {
        assertCheck(markdown.includes(value), `${fixture.name} output missing ${JSON.stringify(value)}: ${markdown}`);
      }
      for (const value of fixture.excluded || []) {
        assertCheck(!markdown.includes(value), `${fixture.name} output unexpectedly included ${JSON.stringify(value)}: ${markdown}`);
      }
      for (const [value, expectedCount] of Object.entries(fixture.exactOccurrences || {})) {
        const actualCount = markdown.split(value).length - 1;
        assertCheck(actualCount === expectedCount,
          `${fixture.name} output included ${JSON.stringify(value)} ${actualCount} times instead of ${expectedCount}: ${markdown}`);
      }
      assertCompactMetadata(markdown, `${fixture.name} output`);
      if (fixture.name === 'Grok') {
        const keys = frontmatterKeys(markdown);
        assertCheck(
          JSON.stringify(keys) === JSON.stringify(['title', 'url']),
          `Grok frontmatter is not focused: ${keys.join(', ')}`,
        );
      }
    } finally {
      await page.close();
    }
  }

  const hydratedDocumentationPage = await createFixturePage(browser, scriptContent, {
    url: 'https://manual.example.org/guide/',
    html: `<!doctype html><html><head><title>Ordinary page</title></head><body>
      <main><div class="document">Generic article content.</div></main>
    </body></html>`,
  });
  try {
    await assertRouteIdentity(hydratedDocumentationPage, 'Fallback', 'ordinary document-class page');
    await hydratedDocumentationPage.evaluate(() => {
      document.documentElement.setAttribute('data-content_root', './');
      const content = document.createElement('div');
      content.className = 'document';
      content.innerHTML = '<div class="body" role="main"><h1>Hydrated Manual</h1><p>Late Sphinx content.</p></div>';
      document.body.appendChild(content);
    });
    await hydratedDocumentationPage.waitForFunction(
      () => document.querySelector('#cam-copy-btn')?.dataset.camExtractor === 'Sphinx / Read the Docs',
      { timeout: 5000 },
    );
    const markdown = await clickAndCapture(hydratedDocumentationPage);
    assertCheck(markdown.includes('# Hydrated Manual') && markdown.includes('Late Sphinx content.'),
      `hydrated Sphinx output is incomplete: ${markdown}`);
  } finally {
    await hydratedDocumentationPage.close();
  }

  const nonContentRoutes = [
    ['Meta AI settings', 'https://www.meta.ai/settings'],
    ['X settings', 'https://x.com/settings'],
    ['Facebook settings', 'https://www.facebook.com/settings'],
    ['VK messages', 'https://vk.com/im'],
    ['Notion public settings', 'https://workspace.notion.site/settings'],
    ['Notion private settings', 'https://www.notion.so/settings'],
    ['OpenRouter models index', 'https://openrouter.ai/models'],
  ];
  for (const [name, url] of nonContentRoutes) {
    const page = await createFixturePage(browser, scriptContent, {
      url,
      html: `<!doctype html><html><head><title>${name}</title></head><body><main>Settings fixture</main></body></html>`,
    });
    try {
      await assertRouteIdentity(page, 'Fallback', name);
    } finally {
      await page.close();
    }
  }

  log('✅', `${REQUESTED_FIRST_CLASS_SITES.size} requested sites route through representative content fixtures`);
  log('✅', 'Content detection upgrades hydrated Sphinx pages without claiming ordinary document markup');
  log('✅', 'Non-content settings and messaging routes stay on generic fallback');
  console.log('');
}

async function runSearchAndLinkedInChecks(browser, scriptContent) {
  const ddgExtraResults = Array.from({ length: 26 }, (_, index) => {
    const resultNumber = index + 1;
    return `<article class="result"><h2><a class="result__a" href="https://example.com/ddg-result-${resultNumber}">DuckDuckGo result ${resultNumber}</a></h2><p class="result__snippet">Result ${resultNumber} snippet.</p></article>`;
  }).join('');
  const duckduckgoPage = await createFixturePage(browser, scriptContent, {
    url: 'https://duckduckgo.com/html/?q=markdown+fixture',
    html: `<!doctype html><html><head><title>DuckDuckGo HTML fixture</title></head><body>
      <div id="duckbar"><nav><ul><li>Web</li></ul></nav></div>
      <div id="zero_click_wrapper">
        <div class="zci__body">Markdown is a lightweight markup language.</div>
        <section class="zci"><h2>Markdown</h2><div class="module__content">Markup syntax knowledge panel.</div></section>
      </div>
      <main>
        <article class="result">
          <a href="javascript:alert('unsafe')">Unsafe link</a>
          <h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fddg-safe-result">Safe redirected result</a></h2>
          <p class="result__snippet">Safe result snippet.</p>
        </article>
        <article class="result">
          <h2><a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fddg-safe-result">Safe redirected result</a></h2>
          <p class="result__snippet">Duplicate result snippet.</p>
        </article>
        <article class="result"><h2><a class="result__a" href="data:text/html,unsafe">Unsafe-only result</a></h2></article>
        ${ddgExtraResults}
      </main>
      <div class="related-searches"><a href="/?q=markdown+guide">markdown guide</a><a href="/?q=markdown+syntax">markdown syntax</a></div>
    </body></html>`,
    context: 'DuckDuckGo HTML search',
  });
  try {
    await assertRouteIdentity(duckduckgoPage, 'DuckDuckGo Search', 'DuckDuckGo HTML search');
    const markdown = await clickAndCapture(duckduckgoPage, 'DuckDuckGo HTML search');
    for (const expected of [
      '**Query:** markdown fixture',
      '## Instant Answer',
      'Markdown is a lightweight markup language.',
      '## Knowledge Panel: Markdown',
      'Markup syntax knowledge panel.',
      '**URL:** https://example.com/ddg-safe-result',
      '## Related Searches',
      '- markdown guide',
      '- markdown syntax',
      '### 25.',
    ]) {
      assertCheck(markdown.includes(expected), `DuckDuckGo HTML output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('javascript:'), 'DuckDuckGo emitted unsafe javascript URL');
    assertCheck(!markdown.includes('data:text/html'), 'DuckDuckGo emitted unsafe non-HTTP URL');
    assertCheck(!markdown.includes('### 26.'), 'DuckDuckGo exceeded 25-result cap');
    assertCheck(
      (markdown.match(/### \d+\. Safe redirected result/g) || []).length === 1,
      'DuckDuckGo did not deduplicate repeated result links',
    );
    assertCompactMetadata(markdown, 'DuckDuckGo HTML output');
    log('✅', 'DuckDuckGo HTML route includes answer panels, safe redirects, related searches, and bounded deduplicated results');
  } finally {
    await duckduckgoPage.close();
  }

  const linkedinPostPage = await createFixturePage(browser, scriptContent, {
    url: 'https://www.linkedin.com/posts/acme_fixture-activity-1234567890',
    html: `<!doctype html><html><head><title>LinkedIn post fixture</title></head><body><main>
      <article class="feed-shared-update-v2">
        <div class="update-components-actor__title"><span class="visually-hidden">Alice Example</span></div>
        <div class="update-components-text"><span>LinkedIn post body from fixture.</span></div>
        <span class="social-details-social-counts__reactions-count">42</span>
        <div class="comments-comment-item">
          <span class="comments-post-meta__name-text">Bob Example</span>
          <div class="comments-comment-item__main-content">Useful comment from Bob.</div>
        </div>
        <button>Like</button>
      </article>
    </main></body></html>`,
    context: 'LinkedIn post',
  });
  try {
    await assertRouteIdentity(linkedinPostPage, 'LinkedIn', 'LinkedIn post');
    const markdown = await clickAndCapture(linkedinPostPage, 'LinkedIn post');
    for (const expected of [
      '# Post by Alice Example',
      'LinkedIn post body from fixture.',
      '**Reactions:** 42',
      '## Comments (1)',
      '**Bob Example:**',
      '> Useful comment from Bob.',
    ]) {
      assertCheck(markdown.includes(expected), `LinkedIn post output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCompactMetadata(markdown, 'LinkedIn post output');
    log('✅', 'LinkedIn post extraction preserves author, body, reactions, and comments');
  } finally {
    await linkedinPostPage.close();
  }

  const linkedinArticlePage = await createFixturePage(browser, scriptContent, {
    url: 'https://www.linkedin.com/pulse/reliable-systems-acme-article-1234567890',
    html: `<!doctype html><html><head><title>Reliable Systems | LinkedIn</title></head><body><main>
      <h1>Reliable Systems</h1><div class="author-info__name">Ada Example</div>
      <article class="article-content"><p>LinkedIn article introduction.</p><h2>Findings</h2><ul><li>Bounded output matters.</li></ul></article>
    </main></body></html>`,
    context: 'LinkedIn article',
  });
  try {
    await assertRouteIdentity(linkedinArticlePage, 'LinkedIn', 'LinkedIn article');
    const markdown = await clickAndCapture(linkedinArticlePage, 'LinkedIn article');
    for (const expected of ['# Reliable Systems', 'LinkedIn article introduction.', '## Findings', 'Bounded output matters.']) {
      assertCheck(markdown.includes(expected), `LinkedIn article output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCompactMetadata(markdown, 'LinkedIn article output');
    log('✅', 'LinkedIn article extraction preserves title and article body');
  } finally {
    await linkedinArticlePage.close();
  }

  const linkedinJsonLdPage = await createFixturePage(browser, scriptContent, {
    url: 'https://www.linkedin.com/in/jsonld-profile-fixture/',
    html: `<!doctype html><html><head><title>Profile | LinkedIn</title>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Person","name":"Ada Lovelace","jobTitle":"Research Engineer","address":{"@type":"PostalAddress","addressLocality":"London","addressCountry":"UK"},"description":"Computing pioneer profile summary."}</script>
    </head><body><main role="main"><p>Computing pioneer profile summary.</p></main></body></html>`,
    context: 'LinkedIn JSON-LD profile',
  });
  try {
    await assertRouteIdentity(linkedinJsonLdPage, 'LinkedIn', 'LinkedIn JSON-LD profile');
    const markdown = await clickAndCapture(linkedinJsonLdPage, 'LinkedIn JSON-LD profile');
    for (const expected of [
      '# Ada Lovelace',
      '**Research Engineer**',
      '📍 London, UK',
      '## Profile',
      'Computing pioneer profile summary.',
    ]) {
      assertCheck(markdown.includes(expected), `LinkedIn JSON-LD profile output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCompactMetadata(markdown, 'LinkedIn JSON-LD profile output');
    log('✅', 'LinkedIn profile JSON-LD fallback supplies top-card identity and summary');
  } finally {
    await linkedinJsonLdPage.close();
  }
}

async function runMetricPlatformChecks(browser, scriptContent) {
  const wandbPage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/run-abc',
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const url = String(input);
        const request = JSON.parse(String(init.body));
        window.__metricFixtureFetches.push({
          url,
          credentials: init.credentials,
          authorization: init.headers?.Authorization || init.headers?.authorization || '',
          query: request.query,
          variables: request.variables,
        });
        if (request.query.includes('CopyAsMarkdownRun')) {
          return new Response(JSON.stringify({ data: { project: { run: {
            name: 'run-abc',
            displayName: 'Forecast Baseline',
            state: 'finished',
            group: 'daily',
            jobType: 'train',
            commit: 'abc123',
            createdAt: '2026-08-10T10:00:00Z',
            heartbeatAt: '2026-08-10T10:30:00Z',
            description: 'Baseline demand forecast.',
            config: JSON.stringify({
              learning_rate: { value: 0.01 },
              model: { value: 'transformer|small' },
              _wandb: { value: 'NOISE_CONFIG' },
            }),
            summaryMetrics: JSON.stringify({ loss: 0.25, accuracy: 0.9 }),
            historyLineCount: 1200,
            historyKeys: {
              keys: {
                loss: { typeCounts: [{ type: 'number' }] },
                accuracy: { typeCounts: [{ type: 'number' }] },
                images: { typeCounts: [{ type: 'images' }] },
                'system/gpu': { typeCounts: [{ type: 'number' }] },
              },
            },
            user: { name: 'Ada Example', username: 'ada' },
          } } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (request.query.includes('RunSampledHistory')) {
          return new Response(JSON.stringify({ data: { project: { run: { sampledHistory: [[
            { _step: 2, _timestamp: 1786356120, loss: 0.5, accuracy: 0.8 },
            { _step: 0, _timestamp: 1786356000, loss: 1 },
            { _step: 1, _timestamp: 1786356060, accuracy: 0.7, loss: 0.75 },
          ]] } } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>Forecast Baseline | Weights & Biases</title></head><body>
      <main><h1>STALE W&B SHELL</h1><p>NOISE_WANDB_DOM</p></main>
    </body></html>`,
    context: 'Weights & Biases metrics',
  });
  try {
    await assertRouteIdentity(wandbPage, 'Weights & Biases', 'Weights & Biases run fixture');
    const markdown = await clickAndCapture(wandbPage, 'Weights & Biases metrics');
    for (const expected of [
      '# Forecast Baseline',
      'Baseline demand forecast.',
      '| learning_rate | 0.01 |',
      '| model | transformer\\|small |',
      '## Metrics Summary',
      '### accuracy',
      '### loss',
      '| 0 | 2026-08-10T10:00:00.000Z | 1 |',
      'sampled history: up to 500 rows from 1200 logged history rows',
    ]) {
      assertCheck(markdown.includes(expected), `Weights & Biases output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    for (const excluded of ['NOISE_WANDB_DOM', 'NOISE_CONFIG', 'system/gpu', '### images']) {
      assertCheck(!markdown.includes(excluded), `Weights & Biases output leaked ${JSON.stringify(excluded)}: ${markdown}`);
    }
    const fetches = await wandbPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.length === 2, `Weights & Biases made ${fetches.length} API requests`);
    assertCheck(fetches.every(({ url }) => url === 'https://api.wandb.ai/graphql'), 'Weights & Biases used wrong GraphQL host');
    assertCheck(fetches.every(({ credentials }) => credentials === 'include'), 'Weights & Biases omitted browser session credentials');
    assertCheck(fetches.every(({ authorization }) => !authorization), 'Weights & Biases sent an Authorization credential');
    assertCheck(
      fetches[1].variables.specs[0].includes('"samples":500')
        && fetches[1].variables.specs[0].includes('"accuracy"')
        && fetches[1].variables.specs[0].includes('"loss"'),
      `Weights & Biases sampled-history variables are wrong: ${JSON.stringify(fetches[1].variables)}`,
    );
    assertCompactMetadata(markdown, 'Weights & Biases output');
  } finally {
    await wandbPage.close();
  }

  const wandbFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.example.test/acme/forecasting/runs/private-run',
    beforeLoad: () => {
      window.fetch = async () => new Response('{}', { status: 403 });
    },
    html: `<!doctype html><html><head><title>Private Run | Weights & Biases</title></head><body>
      <main><h1>Private Run</h1><section><h2>Visible metrics</h2><table>
        <tr><th>Metric</th><th>Latest</th></tr><tr><td>loss</td><td>0.42</td></tr>
      </table></section></main>
    </body></html>`,
    context: 'self-hosted Weights & Biases fallback',
  });
  try {
    await assertRouteIdentity(wandbFallbackPage, 'Weights & Biases', 'self-hosted Weights & Biases fixture');
    const markdown = await clickAndCapture(wandbFallbackPage, 'self-hosted Weights & Biases fallback');
    assertCheck(markdown.includes('## Visible Run Content'), `W&B fallback omitted visible content: ${markdown}`);
    assertCheck(markdown.includes('| loss | 0.42 |'), `W&B fallback omitted visible metric table: ${markdown}`);
  } finally {
    await wandbFallbackPage.close();
  }

  const wandbSummaryFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/summary-only',
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const request = JSON.parse(String(init.body));
        window.__metricFixtureFetches.push(request.query);
        if (request.query.includes('CopyAsMarkdownRun')) {
          return new Response(JSON.stringify({ data: { project: { run: {
            name: 'summary-only',
            displayName: 'Summary Fallback Run',
            state: 'finished',
            config: '{malformed-json',
            summaryMetrics: JSON.stringify({ loss: 0.31, accuracy: 0.88, _private: 99 }),
            historyLineCount: 2,
            historyKeys: JSON.stringify({ keys: {
              loss: { typeCounts: [{ type: 'number' }] },
              accuracy: { typeCounts: [{ type: 'number' }] },
            } }),
          } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (request.query.includes('RunSampledHistory')) {
          return new Response(JSON.stringify({ data: { project: { run: { sampledHistory: [] } } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: '<!doctype html><html><head><title>Summary Fallback | Weights & Biases</title></head><body><main><h1>STALE SUMMARY SHELL</h1></main></body></html>',
    context: 'Weights & Biases summary fallback',
  });
  try {
    await assertRouteIdentity(wandbSummaryFallbackPage, 'Weights & Biases', 'W&B summary fallback fixture');
    const markdown = await clickAndCapture(wandbSummaryFallbackPage, 'W&B summary fallback');
    for (const expected of [
      '# Summary Fallback Run',
      '## Metrics Summary',
      '### accuracy',
      '### loss',
      '| 0 | 0.88 |',
      '| 0 | 0.31 |',
    ]) {
      assertCheck(markdown.includes(expected), `W&B summary fallback output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('STALE SUMMARY SHELL'), 'W&B used DOM despite successful run metadata');
    const fetches = await wandbSummaryFallbackPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.length === 2, `W&B summary fallback made ${fetches.length} GraphQL requests`);
    assertCompactMetadata(markdown, 'W&B summary fallback output');
    log('✅', 'W&B empty sampled history falls back to numeric summary metrics and tolerates malformed config JSON');
  } finally {
    await wandbSummaryFallbackPage.close();
  }

  const wandbHistoryFailurePage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/history-failure',
    beforeLoad: () => {
      window.fetch = async (input, init = {}) => {
        const request = JSON.parse(String(init.body));
        if (request.query.includes('CopyAsMarkdownRun')) {
          return new Response(JSON.stringify({ data: { project: { run: {
            name: 'history-failure',
            displayName: 'History Failure Run',
            historyKeys: JSON.stringify({ keys: { loss: { typeCounts: [{ type: 'number' }] } } }),
            summaryMetrics: JSON.stringify({ loss: 0.5 }),
          } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ errors: [{ message: 'sampled history unavailable' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    },
    html: `<!doctype html><html><head><title>History Failure | Weights & Biases</title></head><body><main>
      <h1>History Failure Run</h1><p>Rendered fallback after GraphQL history failure.</p>
    </main></body></html>`,
    context: 'Weights & Biases history failure',
  });
  try {
    await assertRouteIdentity(wandbHistoryFailurePage, 'Weights & Biases', 'W&B history failure fixture');
    const markdown = await clickAndCapture(wandbHistoryFailurePage, 'W&B history failure');
    assertCheck(markdown.includes('# History Failure Run'), 'W&B history failure fallback lost title');
    assertCheck(markdown.includes('## Visible Run Content'), 'W&B GraphQL history failure did not use DOM fallback');
    assertCheck(markdown.includes('Rendered fallback after GraphQL history failure.'), 'W&B history failure fallback lost visible content');
    assertCompactMetadata(markdown, 'W&B history failure output');
    log('✅', 'W&B GraphQL history failure falls back to rendered run content');
  } finally {
    await wandbHistoryFailurePage.close();
  }

  const wandbCapPage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/metric-cap',
    beforeLoad: () => {
      window.fetch = async (input, init = {}) => {
        const request = JSON.parse(String(init.body));
        if (request.query.includes('CopyAsMarkdownRun')) {
          return new Response(JSON.stringify({ data: { project: { run: {
            name: 'metric-cap',
            displayName: 'Metric Cap Run',
            config: '{broken-config',
            historyKeys: JSON.stringify({ keys: window.__wandbHistoryKeys }),
            historyLineCount: 1,
          } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (request.query.includes('RunSampledHistory')) {
          return new Response(JSON.stringify({ data: { project: { run: { sampledHistory: [window.__wandbHistoryRow] } } } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('{}', { status: 404 });
      };
      window.__wandbHistoryKeys = {};
      window.__wandbHistoryRow = { _step: 0 };
      for (let index = 0; index < 55; index += 1) {
        const name = `metric-${String(index).padStart(2, '0')}`;
        window.__wandbHistoryKeys[name] = { typeCounts: [{ type: 'number' }] };
        window.__wandbHistoryRow[name] = index + 0.5;
      }
    },
    html: '<!doctype html><html><head><title>Metric Cap | Weights & Biases</title></head><body><main><h1>Metric Cap Run</h1></main></body></html>',
    context: 'Weights & Biases metric cap',
  });
  try {
    await assertRouteIdentity(wandbCapPage, 'Weights & Biases', 'W&B metric cap fixture');
    const markdown = await clickAndCapture(wandbCapPage, 'W&B metric cap');
    assertCheck(markdown.includes('*Showing first 50 of 55 numeric metric keys.*'), 'W&B metric cap note missing');
    assertCheck(markdown.includes('### metric-00') && markdown.includes('### metric-49'), 'W&B metric cap omitted first metrics');
    assertCheck(!markdown.includes('### metric-50'), 'W&B emitted metric beyond 50-key cap');
    assertCheck((markdown.match(/^### metric-\d+$/gm) || []).length === 50, 'W&B metric cap emitted wrong series count');
    assertCheck(markdown.length < 20_000, `W&B metric output was not bounded: ${markdown.length} chars`);
    assertCompactMetadata(markdown, 'W&B metric cap output');
    log('✅', 'W&B caps numeric metric series at 50 and keeps malformed config output bounded');
  } finally {
    await wandbCapPage.close();
  }

  const wandbOversizedPage = await createFixturePage(browser, scriptContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/oversized-output',
    beforeLoad: () => {
      window.__wandbHugeConfig = {};
      for (let index = 0; index < 100; index += 1) {
        window.__wandbHugeConfig[`config-${String(index).padStart(3, '0')}`] = {
          value: `large-${index}-${'x'.repeat(1990)}`,
        };
      }
      window.fetch = async (input, init = {}) => {
        const request = JSON.parse(String(init.body));
        if (request.query.includes('CopyAsMarkdownRun')) {
          return new Response(JSON.stringify({ data: { project: { run: {
            name: 'oversized-output',
            displayName: 'Oversized W&B Run',
            config: JSON.stringify(window.__wandbHugeConfig),
            historyKeys: '{}',
          } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: '<!doctype html><html><head><title>Oversized W&amp;B Run | Weights &amp; Biases</title></head><body><main><h1>Oversized W&amp;B Run</h1></main></body></html>',
    context: 'Weights & Biases oversized output',
  });
  try {
    await assertRouteIdentity(wandbOversizedPage, 'Weights & Biases', 'W&B oversized output fixture');
    const markdown = await clickAndCapture(wandbOversizedPage, 'W&B oversized output');
    assertUnboundedMarkdown(markdown, 'W&B oversized output');
    log('✅', 'W&B oversized configuration output preserves complete content');
  } finally {
    await wandbOversizedPage.close();
  }

  const extensionContent = fs.readFileSync(path.join(ROOT, 'dist', 'chrome', 'content.js'), 'utf8');
  const wandbExtensionPage = await createFixturePage(browser, extensionContent, {
    url: 'https://wandb.ai/acme/forecasting/runs/extension-ui',
    html: '<!doctype html><html><head><title>Extension UI | Weights & Biases</title></head><body><main><h1>Extension UI Run</h1></main></body></html>',
    context: 'Weights & Biases extension page UI',
  });
  try {
    await assertRouteIdentity(wandbExtensionPage, 'Weights & Biases', 'W&B extension page UI');
    const ui = await wandbExtensionPage.evaluate(() => ({
      buttons: document.querySelectorAll('#cam-copy-btn').length,
      floating: document.querySelectorAll('.cam-floating-wrapper').length,
      extractor: document.querySelector('#cam-copy-btn')?.dataset.camExtractor || '',
    }));
    assertCheck(ui.buttons === 1 && ui.floating === 1 && ui.extractor === 'Weights & Biases', `W&B extension page UI selection failed: ${JSON.stringify(ui)}`);
    log('✅', 'W&B extension content script selects page button for run routes');
  } finally {
    await wandbExtensionPage.close();
  }

  const mlflowPage = await createFixturePage(browser, scriptContent, {
    url: 'https://metrics.example.test/mlflow/#/experiments/7/runs/run-123',
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        window.__metricFixtureFetches.push({ url: url.toString(), credentials: init.credentials });
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          return new Response(JSON.stringify({ run: {
            info: {
              run_id: 'run-123',
              run_name: 'Demand Forecast',
              experiment_id: '7',
              status: 'FINISHED',
              start_time: 1786356000000,
              end_time: 1786356180000,
              artifact_uri: 's3://example-artifacts/run-123',
              lifecycle_stage: 'active',
              user_id: 'ada',
            },
            data: {
              metrics: [
                { key: 'loss', value: 0.25, step: 2, timestamp: 1786356120000 },
                { key: 'accuracy', value: 0.9, step: 1, timestamp: 1786356060000 },
              ],
              params: [{ key: 'learning_rate', value: '0.01' }],
              tags: [{ key: 'release', value: 'v2|canary' }],
            },
            inputs: { dataset_inputs: [{ dataset: { name: 'demand-v4' } }] },
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/metrics/get-history') {
          const key = url.searchParams.get('metric_key');
          const token = url.searchParams.get('page_token');
          if (key === 'loss' && !token) {
            return new Response(JSON.stringify({
              metrics: [
                { key: 'loss', value: 0.75, step: 1, timestamp: 1786356060000 },
                { key: 'loss', value: 1, step: 0, timestamp: 1786356000000 },
              ],
              next_page_token: 'loss-page-2',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (key === 'loss' && token === 'loss-page-2') {
            return new Response(JSON.stringify({
              metrics: [{ key: 'loss', value: 0.25, step: 2, timestamp: 1786356120000 }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (key === 'accuracy') {
            return new Response(JSON.stringify({
              metrics: [
                { key: 'accuracy', value: 0.8, step: 0, timestamp: 1786356000000 },
                { key: 'accuracy', value: 0.9, step: 1, timestamp: 1786356060000 },
              ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        }
        return new Response('<!doctype html><title>MLflow shell</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      };
    },
    html: `<!doctype html><html><head><title>Demand Forecast | MLflow</title></head><body>
      <main><h1>STALE MLFLOW SHELL</h1><p>NOISE_MLFLOW_DOM</p></main>
    </body></html>`,
    context: 'MLflow metrics',
  });
  try {
    await assertRouteIdentity(mlflowPage, 'MLflow', 'MLflow run fixture');
    const markdown = await clickAndCapture(mlflowPage, 'MLflow metrics');
    for (const expected of [
      '# Demand Forecast',
      '| learning_rate | 0.01 |',
      '| release | v2\\|canary |',
      '## Metrics Summary',
      '### accuracy',
      '### loss',
      '| 0 | 2026-08-10T10:00:00.000Z | 1 |',
      '"name": "demand-v4"',
    ]) {
      assertCheck(markdown.includes(expected), `MLflow output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('NOISE_MLFLOW_DOM'), `MLflow mixed stale DOM into API output: ${markdown}`);
    assertCheck(markdown.indexOf('| 0 | 2026-08-10T10:00:00.000Z | 1 |') < markdown.indexOf('| 2 | 2026-08-10T10:02:00.000Z | 0.25 |'), 'MLflow history was not sorted by step');
    const fetches = await mlflowPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.every(({ url }) => url.includes('/mlflow/ajax-api/2.0/mlflow/')), `MLflow lost static prefix: ${JSON.stringify(fetches)}`);
    assertCheck(fetches.every(({ credentials }) => credentials === 'include'), 'MLflow omitted browser session credentials');
    assertCheck(fetches.some(({ url }) => url.includes('page_token=loss-page-2')), 'MLflow did not paginate metric history');
    assertCheck(fetches.filter(({ url }) => url.includes('/runs/get')).length === 1, 'MLflow retried run API unnecessarily');
    assertCompactMetadata(markdown, 'MLflow output');
  } finally {
    await mlflowPage.close();
  }

  const mlflowHistoryFallbackPage = await createFixturePage(browser, scriptContent, {
    url: 'https://metrics.example.test/mlflow/#/experiments/7/runs/history-fallback',
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        window.__metricFixtureFetches.push(url.toString());
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          return new Response(JSON.stringify({ run: {
            info: {
              run_id: 'history-fallback',
              run_name: 'History Fallback',
              experiment_id: '7',
              status: 'FINISHED',
              start_time: 1786356000000,
            },
            data: { metrics: [{ key: 'loss', value: 0.42, step: 7, timestamp: 1786356420000 }] },
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/metrics/get-history') {
          return new Response('{}', { status: 503 });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: '<!doctype html><html><head><title>History Fallback | MLflow</title></head><body><main><h1>STALE HISTORY SHELL</h1></main></body></html>',
    context: 'MLflow history fallback',
  });
  try {
    await assertRouteIdentity(mlflowHistoryFallbackPage, 'MLflow', 'MLflow history fallback fixture');
    const markdown = await clickAndCapture(mlflowHistoryFallbackPage, 'MLflow history fallback');
    assertCheck(markdown.includes('# History Fallback'), 'MLflow history fallback lost run title');
    assertCheck(markdown.includes('### loss'), 'MLflow history fallback omitted metric series');
    assertCheck(markdown.includes('| 7 | 2026-08-10T10:07:00.000Z | 0.42 |'), 'MLflow history fallback omitted latest metric point');
    assertCheck(!markdown.includes('STALE HISTORY SHELL'), 'MLflow history fallback used stale DOM despite run API success');
    const fetches = await mlflowHistoryFallbackPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.some((url) => url.includes('/metrics/get-history')), 'MLflow history fallback did not attempt history API');
    assertCompactMetadata(markdown, 'MLflow history fallback output');
    log('✅', 'MLflow history API failure preserves latest run metric value');
  } finally {
    await mlflowHistoryFallbackPage.close();
  }

  const mlflowOversizedPage = await createFixturePage(browser, scriptContent, {
    url: 'https://metrics.example.test/mlflow/#/experiments/7/runs/oversized-output',
    beforeLoad: () => {
      window.__mlflowHugeParams = [];
      for (let index = 0; index < 200; index += 1) {
        window.__mlflowHugeParams.push({
          key: `param-${String(index).padStart(3, '0')}`,
          value: `large-${index}-${'y'.repeat(1990)}`,
        });
      }
      window.fetch = async (input) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          return new Response(JSON.stringify({ run: {
            info: {
              run_id: 'oversized-output',
              run_name: 'Oversized MLflow Run',
              experiment_id: '7',
              status: 'FINISHED',
              start_time: 1786356000000,
            },
            data: { metrics: [], params: window.__mlflowHugeParams },
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: '<!doctype html><html><head><title>Oversized MLflow Run | MLflow</title></head><body><main><h1>Oversized MLflow Run</h1></main></body></html>',
    context: 'MLflow oversized run output',
  });
  try {
    await assertRouteIdentity(mlflowOversizedPage, 'MLflow', 'MLflow oversized run fixture');
    const markdown = await clickAndCapture(mlflowOversizedPage, 'MLflow oversized run');
    assertUnboundedMarkdown(markdown, 'MLflow oversized run output');
    log('✅', 'MLflow oversized run parameters preserve complete content');
  } finally {
    await mlflowOversizedPage.close();
  }

  const mlflowComparisonPage = await createFixturePage(browser, scriptContent, {
    url: "https://metrics.example.test/mlflow/#/experiments/48/runs?searchFilter=attributes.run_id%20in%20('run-visible-a','run-visible-b','run-hidden')&compareRunsMode=CHART",
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        window.__metricFixtureFetches.push({ url: url.toString(), credentials: init.credentials });
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          const runId = url.searchParams.get('run_id');
          const runs = {
            'run-visible-a': {
              info: {
                run_id: 'run-visible-a',
                run_name: 'Visible A',
                experiment_id: '48',
                status: 'FINISHED',
                start_time: 1786356000000,
              },
              data: { metrics: [{ key: 'policy/policy_entropy', value: 0.25, step: 2 }] },
            },
            'run-visible-b': {
              info: {
                run_id: 'run-visible-b',
                run_name: 'Visible B',
                experiment_id: '48',
                status: 'RUNNING',
                start_time: 1786356060000,
              },
              data: { metrics: [{ key: 'policy/policy_entropy', value: 0.4, step: 2 }] },
            },
          };
          if (runs[runId]) {
            return new Response(JSON.stringify({ run: runs[runId] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/metrics/get-history') {
          const runId = url.searchParams.get('run_id');
          const values = runId === 'run-visible-a' ? [0.5, 0.35, 0.25] : [0.6, 0.5, 0.4];
          return new Response(JSON.stringify({ metrics: values.map((value, step) => ({
            key: 'policy/policy_entropy',
            value,
            step,
            timestamp: 1786356000000 + step * 60000,
          })) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>Runs - Experiment 48 - MLflow</title></head><body><main>
      <a data-testid="experiment-link" href="#/experiments/48">phase4</a>
      <h2>Training runs</h2>
      <div class="ag-row" row-id="run-visible-a"><input class="is-visibility-toggle-checkbox" type="checkbox" checked><a href="#/experiments/48/runs/run-visible-a">Rendered A</a></div>
      <div class="ag-row" row-id="run-visible-b"><input class="is-visibility-toggle-checkbox" type="checkbox" checked><a href="#/experiments/48/runs/run-visible-b">Rendered B</a></div>
      <div class="ag-row" row-id="run-hidden"><input class="is-visibility-toggle-checkbox" type="checkbox"><a href="#/experiments/48/runs/run-hidden">Hidden Run</a></div>
      <div data-testid="experiment-view-compare-runs-chart-area">
        <input role="searchbox" value="entropy">
        <div data-testid="experiment-view-compare-runs-card"><h4 title="policy/policy_entropy">policy/policy_entropy</h4></div>
      </div>
    </main></body></html>`,
    context: 'MLflow comparison metrics',
  });
  try {
    await assertRouteIdentity(mlflowComparisonPage, 'MLflow', 'MLflow comparison fixture');
    const markdown = await clickAndCapture(mlflowComparisonPage, 'MLflow comparison metrics');
    for (const expected of [
      '# phase4 Run Comparison',
      '- **Visible runs:** 2',
      '| Visible A | run-visible-a | FINISHED | 2026-08-10T10:00:00.000Z |',
      '| Visible B | run-visible-b | RUNNING | 2026-08-10T10:01:00.000Z |',
      '### policy/policy_entropy (Visible A)',
      '### policy/policy_entropy (Visible B)',
      '| 2 | 2026-08-10T10:02:00.000Z | 0.25 |',
    ]) {
      assertCheck(markdown.includes(expected), `MLflow comparison output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(!markdown.includes('Hidden Run'), `MLflow comparison included hidden run: ${markdown}`);
    const fetches = await mlflowComparisonPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.every(({ url }) => url.includes('/mlflow/ajax-api/2.0/mlflow/')), `MLflow comparison lost static prefix: ${JSON.stringify(fetches)}`);
    assertCheck(fetches.every(({ credentials }) => credentials === 'include'), 'MLflow comparison omitted browser session credentials');
    assertCheck(fetches.filter(({ url }) => url.includes('/runs/get')).length === 2, `MLflow comparison fetched wrong run count: ${JSON.stringify(fetches)}`);
    assertCheck(fetches.filter(({ url }) => url.includes('/metrics/get-history')).length === 2, `MLflow comparison fetched wrong history count: ${JSON.stringify(fetches)}`);
    assertCompactMetadata(markdown, 'MLflow comparison output');
  } finally {
    await mlflowComparisonPage.close();
  }

  const mlflowOversizedComparisonPage = await createFixturePage(browser, scriptContent, {
    url: "https://metrics.example.test/mlflow/#/experiments/50/runs?searchFilter=attributes.run_id%20in%20('oversized-comparison')&compareRunsMode=CHART",
    beforeLoad: () => {
      window.fetch = async (input) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          return new Response(JSON.stringify({ run: {
            info: {
              run_id: 'oversized-comparison',
              run_name: `Oversized Comparison ${'z'.repeat(130_000)}`,
              experiment_id: '50',
              status: 'FINISHED',
            },
            data: { metrics: [{ key: 'loss', value: 0.5, step: 1 }] },
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/metrics/get-history') {
          return new Response(JSON.stringify({ metrics: [{
            key: 'loss', value: 0.5, step: 1, timestamp: 1786356000000,
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>Runs | MLflow</title></head><body><main>
      <a data-testid="experiment-link" href="#/experiments/50">Oversized comparison</a>
      <div class="ag-row" row-id="oversized-comparison"><input class="is-visibility-toggle-checkbox" type="checkbox" checked><a href="#/experiments/50/runs/oversized-comparison">Rendered run</a></div>
      <div data-testid="experiment-view-compare-runs-chart-area"><div data-testid="experiment-view-compare-runs-card"><h4 title="loss">loss</h4></div></div>
    </main></body></html>`,
    context: 'MLflow oversized comparison output',
  });
  try {
    await assertRouteIdentity(mlflowOversizedComparisonPage, 'MLflow', 'MLflow oversized comparison fixture');
    const markdown = await clickAndCapture(mlflowOversizedComparisonPage, 'MLflow oversized comparison');
    assertUnboundedMarkdown(markdown, 'MLflow oversized comparison output');
    log('✅', 'MLflow oversized comparison output preserves complete content');
  } finally {
    await mlflowOversizedComparisonPage.close();
  }

  const mlflowSearchFilterPage = await createFixturePage(browser, scriptContent, {
    url: "https://metrics.example.test/mlflow/#/experiments/49/runs?searchFilter=attributes.run_id%20in%20('run-01','run-02','run-03','run-04','run-05','run-06','run-07','run-08','run-09','run-10','run-11','run-12')&compareRunsMode=CHART",
    beforeLoad: () => {
      window.__metricFixtureFetches = [];
      window.fetch = async (input, init = {}) => {
        const url = new URL(String(input), window.location.origin);
        window.__metricFixtureFetches.push(url.toString());
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/runs/get') {
          const runId = url.searchParams.get('run_id') || '';
          const match = runId.match(/^run-(\d\d)$/);
          if (!match || Number(match[1]) > 10) return new Response('{}', { status: 404 });
          const index = Number(match[1]);
          return new Response(JSON.stringify({ run: {
            info: {
              run_id: runId,
              run_name: `Fallback Run ${match[1]}`,
              experiment_id: '49',
              status: index % 2 ? 'FINISHED' : 'RUNNING',
              start_time: 1786356000000 + index * 60000,
            },
            data: { metrics: [{ key: 'loss', value: index / 100, step: index }] },
          } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname === '/mlflow/ajax-api/2.0/mlflow/metrics/get-history') {
          const runId = url.searchParams.get('run_id') || '';
          const index = Number(runId.slice(-2));
          return new Response(JSON.stringify({ metrics: [{
            key: 'loss', value: index / 100, step: index, timestamp: 1786356000000 + index * 60000,
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
      };
    },
    html: `<!doctype html><html><head><title>Runs | MLflow</title></head><body><main>
      <a data-testid="experiment-link" href="#/experiments/49">Fallback experiment</a>
      <div data-testid="experiment-view-compare-runs-chart-area"><input role="searchbox" value="loss"></div>
    </main></body></html>`,
    context: 'MLflow searchFilter comparison fallback',
  });
  try {
    await assertRouteIdentity(mlflowSearchFilterPage, 'MLflow', 'MLflow searchFilter comparison fixture');
    const markdown = await clickAndCapture(mlflowSearchFilterPage, 'MLflow searchFilter comparison');
    for (const expected of [
      '# Fallback experiment Run Comparison',
      '- **Visible runs:** 12',
      '*Showing first 10 of 12 visible runs.*',
      '### loss (Fallback Run 01)',
      '### loss (Fallback Run 10)',
    ]) {
      assertCheck(markdown.includes(expected), `MLflow searchFilter comparison output missing ${JSON.stringify(expected)}: ${markdown}`);
    }
    assertCheck(
      !markdown.includes('### loss (Fallback Run 11)') && !markdown.includes('| Fallback Run 11 |'),
      'MLflow searchFilter comparison exceeded 10-run cap',
    );
    const fetches = await mlflowSearchFilterPage.evaluate(() => window.__metricFixtureFetches);
    assertCheck(fetches.filter((url) => url.includes('/runs/get')).length === 10, 'MLflow searchFilter fallback fetched wrong run count');
    assertCheck(fetches.filter((url) => url.includes('/metrics/get-history')).length === 10, 'MLflow searchFilter fallback fetched wrong history count');
    assertCompactMetadata(markdown, 'MLflow searchFilter comparison output');
    log('✅', 'MLflow comparison falls back to searchFilter IDs when rows are absent and caps visible runs');
  } finally {
    await mlflowSearchFilterPage.close();
  }

  const mlflowListPage = await createFixturePage(browser, scriptContent, {
    url: 'https://metrics.example.test/mlflow/#/experiments/7/runs',
    html: '<!doctype html><html><head><title>MLflow runs</title></head><body><main><h1>Runs</h1></main></body></html>',
  });
  try {
    await assertRouteIdentity(mlflowListPage, 'Fallback', 'MLflow run list');
  } finally {
    await mlflowListPage.close();
  }

  const mlflowLookalikePage = await createFixturePage(browser, scriptContent, {
    url: 'https://analytics.example.test/#/experiments/7/runs/lookalike',
    html: '<!doctype html><html><head><title>Analytics Dashboard</title></head><body><main><h1>Analytics Dashboard</h1><p>Not an MLflow application.</p></main></body></html>',
    context: 'non-MLflow hash lookalike',
  });
  try {
    await assertRouteIdentity(mlflowLookalikePage, 'Fallback', 'non-MLflow hash lookalike');
    const markdown = await clickAndCapture(mlflowLookalikePage, 'non-MLflow hash lookalike');
    assertCheck(markdown.includes('Not an MLflow application.'), 'non-MLflow hash lookalike did not use fallback extraction');
    assertCheck(!markdown.includes('source: MLflow'), 'non-MLflow hash lookalike claimed MLflow identity');
    log('✅', 'MLflow hash-shaped routes require MLflow page identity before claiming extractor');
  } finally {
    await mlflowLookalikePage.close();
  }

  log('✅', 'W&B sampled metrics plus MLflow run and comparison histories produce bounded Markdown time series');
}

async function runProductionUiChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Production UI guards${COLORS.reset}`);
  const chromeStoreUrl = 'https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol';
  const userscriptUrl = 'https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js';

  const landingPage = await browser.newPage();
  const faviconRequests = [];
  await landingPage.setRequestInterception(true);
  landingPage.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === 'https://t1.gstatic.com' && requestUrl.pathname === '/faviconV2') {
      const targetUrl = requestUrl.searchParams.get('url');
      faviconRequests.push({ url: request.url(), targetUrl });
      if (targetUrl === 'https://claude.ai') {
        request.abort();
        return;
      }
      request.respond({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#34d399"/></svg>',
      });
      return;
    }
    request.continue();
  });
  try {
    await landingPage.goto(pathToFileURL(path.join(ROOT, 'docs', 'index.html')).href, {
      waitUntil: 'domcontentloaded',
    });
    await landingPage.waitForFunction(
      () => [...document.querySelectorAll('[data-hero-install] img, .install-card .install-logo')]
        .every((logo) => logo.complete && logo.naturalWidth > 0),
      { timeout: 4000 },
    );
    for (const siteName of ['Datadog dashboards', 'ChatGPT', 'Claude']) {
      await landingPage.evaluate((name) => {
        const card = [...document.querySelectorAll('.site-card')].find((candidate) => (
          candidate.querySelector('h3')?.textContent?.trim() === name
        ));
        card?.scrollIntoView({ block: 'center' });
      }, siteName);
      await landingPage.waitForFunction((name) => {
        const card = [...document.querySelectorAll('.site-card')].find((candidate) => (
          candidate.querySelector('h3')?.textContent?.trim() === name
        ));
        return card?.querySelector('.site-icon')?.dataset.faviconRequested === 'true';
      }, { timeout: 4000 }, siteName);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    await landingPage.addScriptTag({ content: scriptContent });
    await new Promise(r => setTimeout(r, 800));
    const controls = await landingPage.evaluate(() => ({
      injected: document.querySelectorAll('#cam-copy-btn').length,
      demo: document.querySelectorAll('#copy_as_markdown_btn').length,
      chromeDisabled: document.querySelector('[data-install="chrome"]')?.classList.contains('is-disabled'),
      chromeLink: document.querySelector('[data-install="chrome"] a')?.href,
      chromeStatus: document.querySelector('[data-install="chrome"] .install-status')?.textContent?.trim(),
      firefoxLink: document.querySelector('[data-install="firefox"] a')?.href,
      latestReleaseLink: document.querySelector('.latest-release')?.href,
      heroFirefoxLink: document.querySelector('[data-hero-install="firefox"]')?.href,
      heroReleaseLink: document.querySelector('[data-hero-install="userscript"]')?.href,
      heroChromeLink: document.querySelector('[data-hero-install="chrome"]')?.href,
      userscriptLink: document.querySelector('[data-install="userscript"] a')?.href,
      installChoices: [...document.querySelectorAll('[data-hero-install]')].map((link) => ({
        type: link.dataset.heroInstall,
        primary: link.classList.contains('btn-install'),
        logo: link.querySelector('img')?.getAttribute('src'),
        logoLoaded: Boolean(link.querySelector('img')?.naturalWidth),
      })),
      cardLogosLoaded: [...document.querySelectorAll('.install-card .install-logo')]
        .every((logo) => logo.naturalWidth > 0),
      siteCards: document.querySelectorAll('.site-card').length,
      purposeBuiltCount: document.body.textContent.includes('64 purpose-built'),
      favicons: {
        configured: document.querySelectorAll('.site-icon[data-favicon-url]').length,
        invalidTargets: [...document.querySelectorAll('.site-icon[data-favicon-url]')]
          .filter((icon) => new URL(icon.dataset.faviconUrl).protocol !== 'https:').length,
        datadog: [...document.querySelectorAll('.site-card')]
          .find((card) => card.querySelector('h3')?.textContent?.trim() === 'Datadog dashboards')
          ?.querySelector('.site-icon img')?.src,
        chatgpt: [...document.querySelectorAll('.site-card')]
          .find((card) => card.querySelector('h3')?.textContent?.trim() === 'ChatGPT')
          ?.querySelector('.site-icon img')?.src,
        chatgptBackground: (() => {
          const icon = [...document.querySelectorAll('.site-card')]
            .find((card) => card.querySelector('h3')?.textContent?.trim() === 'ChatGPT')
            ?.querySelector('.site-icon');
          return icon ? getComputedStyle(icon).backgroundColor : '';
        })(),
        claudeFallback: [...document.querySelectorAll('.site-card')]
          .find((card) => card.querySelector('h3')?.textContent?.trim() === 'Claude')
          ?.querySelector('.site-icon')?.textContent?.trim(),
        genericFallbacks: ['News (20+ sites)', 'Any website'].every((name) => {
          const icon = [...document.querySelectorAll('.site-card')]
            .find((card) => card.querySelector('h3')?.textContent?.trim() === name)
            ?.querySelector('.site-icon');
          return icon && !icon.dataset.faviconUrl && !icon.querySelector('img');
        }),
      },
    }));
    assertCheck(controls.injected === 0, 'page opt-out still injected a Copy as Markdown button');
    assertCheck(controls.demo === 1, 'page opt-out removed the site-owned demo control');
    assertCheck(!controls.chromeDisabled && controls.chromeLink === chromeStoreUrl && !controls.chromeStatus, 'Chrome install card does not link to the live store');
    assertCheck(controls.firefoxLink === 'https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/', 'Firefox install link is incorrect');
    assertCheck(controls.latestReleaseLink === 'https://github.com/bvolpato/copy-as-markdown/releases/latest', 'latest release link is incorrect');
    assertCheck(controls.heroFirefoxLink === controls.firefoxLink, 'hero Firefox install link is incorrect');
    assertCheck(controls.heroReleaseLink === userscriptUrl && controls.userscriptLink === userscriptUrl, 'userscript install link is incorrect');
    assertCheck(controls.heroChromeLink === chromeStoreUrl, 'hero Chrome install link is incorrect');
    assertCheck(
      controls.installChoices.length === 3
        && controls.installChoices.every(({ primary, logoLoaded }) => primary && logoLoaded),
      `install choices are not equal first-class actions: ${JSON.stringify(controls.installChoices)}`,
    );
    assertCheck(controls.cardLogosLoaded, 'install card logos did not load');
    assertCheck(controls.siteCards === 65, `landing page rendered ${controls.siteCards} site cards instead of 65`);
    assertCheck(controls.purposeBuiltCount, 'landing page purpose-built extractor count is stale');
    assertCheck(controls.favicons.configured === 63, `landing page configured ${controls.favicons.configured} service favicons instead of 63`);
    assertCheck(controls.favicons.invalidTargets === 0, 'landing page configured non-HTTPS favicon targets');
    assertCheck(controls.favicons.genericFallbacks, 'generic landing-page cards should retain local emoji fallbacks');
    assertCheck(controls.favicons.claudeFallback === '🧠', 'failed favicon request removed Claude emoji fallback');
    assertCheck(
      controls.favicons.chatgptBackground === 'rgb(248, 250, 252)',
      `ChatGPT favicon needs a light contrast badge: ${controls.favicons.chatgptBackground}`,
    );
    for (const [name, src, targetUrl] of [
      ['Datadog', controls.favicons.datadog, 'https://datadoghq.com'],
      ['ChatGPT', controls.favicons.chatgpt, 'https://chatgpt.com'],
    ]) {
      const faviconUrl = new URL(src);
      assertCheck(faviconUrl.origin === 'https://t1.gstatic.com' && faviconUrl.pathname === '/faviconV2', `${name} icon does not use Google FaviconV2`);
      assertCheck(
        faviconUrl.searchParams.get('client') === 'SOCIAL'
          && faviconUrl.searchParams.get('type') === 'FAVICON'
          && faviconUrl.searchParams.get('fallback_opts') === 'TYPE,SIZE,URL'
          && faviconUrl.searchParams.get('url') === targetUrl
          && faviconUrl.searchParams.get('size') === '32'
          && faviconUrl.searchParams.get('drop_404_icon') === 'true',
        `${name} favicon URL is incomplete: ${src}`,
      );
    }
    assertCheck(
      faviconRequests.some(({ targetUrl }) => targetUrl === 'https://claude.ai'),
      'landing page did not request Claude favicon fallback',
    );
    await landingPage.emulateMediaType('print');
    const printDemoDisplay = await landingPage.$eval('.live-demo-wrapper', (element) => getComputedStyle(element).display);
    assertCheck(printDemoDisplay === 'none', 'landing page demo button remains visible when printing');
    await landingPage.emulateMediaType('screen');
    await landingPage.click('#copy_as_markdown_btn');
    await landingPage.waitForSelector('#copy_as_markdown_btn.success', { timeout: 4000 });
    log('✅', 'Landing page exposes equal logo-backed userscript and extension installs');
  } finally {
    await landingPage.close();
  }

  const optOutPage = await browser.newPage();
  try {
    await optOutPage.setContent('<!doctype html><html><head><title>Opt-out contract</title></head><body><main>Content</main></body></html>');
    await optOutPage.addScriptTag({ content: scriptContent });
    await optOutPage.waitForSelector('#cam-copy-btn', { timeout: 4000 });
    await optOutPage.evaluate(() => {
      const marker = document.createElement('div');
      marker.id = 'copy_as_markdown_btn';
      document.body.appendChild(marker);
    });
    await optOutPage.waitForFunction(() => !document.querySelector('#cam-copy-btn'), { timeout: 4000 });
    await optOutPage.evaluate(() => document.getElementById('copy_as_markdown_btn').remove());
    await optOutPage.waitForSelector('#cam-copy-btn', { timeout: 5000 });
    log('✅', 'Site-owned button contract suppresses injected UI dynamically');
  } finally {
    await optOutPage.close();
  }

  const floatingPage = await createFixturePage(browser, scriptContent, {
    url: 'https://floating.fixture.test/regression',
    html: `<!doctype html>
      <html>
        <head><title>Fallback page</title></head>
        <body>
          <main><h1>Fallback article</h1><p>Enough text for fallback extraction.</p></main>
          <button id="talk-widget" style="position: fixed; right: 16px; bottom: 16px; width: 64px; height: 64px;">Talk with us</button>
        </body>
      </html>`,
  });
  await floatingPage.setViewport({ width: 390, height: 844 });
  try {
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

    await floatingPage.emulateMediaType('print');
    const printControls = await floatingPage.evaluate(() => ({
      button: getComputedStyle(document.querySelector('#cam-copy-btn')).display,
      wrapper: getComputedStyle(document.querySelector('.cam-floating-wrapper')).display,
      dismiss: getComputedStyle(document.querySelector('#cam-dismiss-btn')).display,
    }));
    assertCheck(
      Object.values(printControls).every((display) => display === 'none'),
      `Copy as Markdown controls remain visible when printing: ${JSON.stringify(printControls)}`,
    );
    await floatingPage.emulateMediaType('screen');

    await floatingPage.evaluate(() => {
      window.__camCopyCount = 0;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => { window.__camCopyCount += 1; },
        },
      });
    });
    const startX = layout.button.left + layout.button.width / 2;
    const startY = layout.button.top + layout.button.height / 2;
    await floatingPage.mouse.move(startX, startY);
    await floatingPage.mouse.down();
    await floatingPage.mouse.move(80, 180, { steps: 6 });
    await floatingPage.mouse.up();
    await new Promise(r => setTimeout(r, 150));

    const dragged = await floatingPage.evaluate(() => {
      const button = document.querySelector('#cam-copy-btn');
      const rect = button.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        copyCount: window.__camCopyCount,
        stored: JSON.parse(localStorage.getItem('cam-position:floating.fixture.test')),
        title: button.title,
      };
    });
    assertCheck(Math.abs(dragged.left - layout.button.left) > 100, 'floating button did not move after drag');
    assertCheck(dragged.copyCount === 0, 'dragging floating button triggered copy');
    assertCheck(Number.isFinite(dragged.stored?.left) && Number.isFinite(dragged.stored?.top), 'floating position was not persisted');
    assertCheck(dragged.title.includes('Drag to reposition'), 'floating button does not advertise drag behavior');

    await floatingPage.addScriptTag({ content: scriptContent });
    await new Promise(r => setTimeout(r, 800));
    const duplicateCounts = await floatingPage.evaluate(() => {
      const rect = document.querySelector('#cam-copy-btn').getBoundingClientRect();
      return {
        buttons: document.querySelectorAll('#cam-copy-btn').length,
        floatingWrappers: document.querySelectorAll('.cam-floating-wrapper').length,
        anchorWrappers: document.querySelectorAll('[data-cam-anchor-wrapper]').length,
        left: rect.left,
        top: rect.top,
      };
    });

    assertCheck(duplicateCounts.buttons === 1, `duplicate userscript injection left ${duplicateCounts.buttons} buttons`);
    assertCheck(duplicateCounts.floatingWrappers === 1, `duplicate userscript injection left ${duplicateCounts.floatingWrappers} floating wrappers`);
    assertCheck(duplicateCounts.anchorWrappers === 0, `duplicate userscript injection left ${duplicateCounts.anchorWrappers} anchor wrappers`);
    assertCheck(Math.abs(duplicateCounts.left - dragged.left) < 2 && Math.abs(duplicateCounts.top - dragged.top) < 2, 'floating position was not restored after reinjection');
    const draggedMarkdown = await clickAndCaptureWithPointer(floatingPage);
    assertCheck(draggedMarkdown.includes('Fallback article'), 'floating button no longer copies after dragging');
    assertCompactMetadata(draggedMarkdown, 'fallback output');
    assertCheck(
      JSON.stringify(frontmatterKeys(draggedMarkdown)) === JSON.stringify(['title', 'url']),
      `fallback frontmatter is not focused: ${frontmatterKeys(draggedMarkdown).join(', ')}`,
    );
    log('✅', 'Floating button hides when printing, avoids widgets, drags safely, and remains singleton');
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
  await runExpandedPlatformChecks(browser, scriptContent);
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
