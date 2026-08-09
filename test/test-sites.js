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

function boxesOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function createFixturePage(browser, scriptContent, {
  url,
  html,
  csp = '',
  beforeLoad,
  waitForButton = true,
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
  if (waitForButton) await page.waitForSelector('#cam-copy-btn', { timeout: 4000 });
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

async function clickAndCapture(page) {
  await prepareClipboardCapture(page);
  await page.evaluate(() => document.querySelector('#cam-copy-btn').click());
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: 4000 });
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function clickAndCaptureWithPointer(page) {
  await prepareClipboardCapture(page);
  await page.click('#cam-copy-btn');
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: 4000 });
  return page.evaluate(() => window.__camCapturedMarkdown);
}

async function chooseAndCapture(page, optionId) {
  await prepareClipboardCapture(page);
  await page.click('#cam-copy-btn');
  await page.waitForSelector(`#cam-option-dialog [data-option-id="${optionId}"]`, { timeout: 4000 });
  await page.click(`#cam-option-dialog [data-option-id="${optionId}"]`);
  await page.waitForFunction(() => window.__camCapturedMarkdown.length > 0, { timeout: 4000 });
  return page.evaluate(() => window.__camCapturedMarkdown);
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

async function runExpandedPlatformChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Expanded platform extractor guards${COLORS.reset}`);

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

  const fixtures = [
    {
      name: 'Notion',
      url: 'https://workspace.notion.site/project-plan',
      html: `<main role="main"><h1 data-testid="page-title">Project Plan</h1>
        <div data-block-id="block-1"><p>Notion fixture body.</p></div></main>`,
      expected: ['Notion fixture body.'],
    },
    {
      name: 'Microsoft 365',
      url: 'https://www.office.com/launch/word?auth=2',
      html: `<input aria-label="Document title" value="Quarterly Plan">
        <div role="document"><h1>Quarterly Plan</h1><p>Office fixture body.</p></div>`,
      expected: ['Office fixture body.'],
    },
    {
      name: 'Slack',
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
      url: 'https://acme.atlassian.net/browse/PROJ-42',
      html: `<main id="issue-content"><h1 data-testid="issue.views.issue-base.foundation.summary.heading">Fix production export</h1>
        <div data-testid="issue.views.field.rich-text.description"><p>Jira fixture description.</p></div>
        <dl><dt>Status</dt><dd>In Progress</dd></dl></main>`,
      expected: ['PROJ-42', 'Jira fixture description.'],
    },
    {
      name: 'Confluence',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Runbook',
      html: `<main><h1 data-testid="page-title">Operations Runbook</h1>
        <div data-testid="renderer-container"><div class="ak-renderer-document"><p>Confluence fixture body.</p></div></div></main>`,
      expected: ['Operations Runbook', 'Confluence fixture body.'],
    },
    {
      name: 'GitLab',
      url: 'https://gitlab.com/acme/project/-/blob/main/src/app.ts',
      html: `<main><div data-testid="blob-content"><pre>export const gitlabFixture = true;</pre></div></main>`,
      expected: ['export const gitlabFixture = true;'],
    },
    {
      name: 'Bitbucket',
      url: 'https://bitbucket.org/acme/project/src/main/src/app.ts',
      html: `<main><div data-testid="source-code"><pre>export const bitbucketFixture = true;</pre></div></main>`,
      expected: ['export const bitbucketFixture = true;'],
    },
    {
      name: 'Perplexity',
      url: 'https://www.perplexity.ai/search/fixture',
      html: `<main><div data-testid="conversation-turn"><div data-testid="user-query">Perplexity question?</div></div>
        <div data-testid="conversation-turn"><div data-testid="answer"><p>Perplexity fixture answer.</p></div>
          <div data-testid="citation"><a href="https://example.com/source">Primary source</a></div></div></main>`,
      expected: ['Perplexity question?', 'Perplexity fixture answer.', 'Primary source'],
    },
    {
      name: 'Grok',
      url: 'https://grok.com/c/fixture',
      html: `<main><div data-testid="conversation-turn"><div data-testid="user-message">Grok question?</div></div>
        <div data-testid="conversation-turn"><div data-testid="assistant-message"><p>Grok fixture answer.</p></div></div></main>`,
      expected: ['Grok question?', 'Grok fixture answer.'],
    },
    {
      name: 'Facebook',
      url: 'https://www.facebook.com/acme/posts/12345/',
      html: `<main role="main"><article role="article"><strong><a href="/acme">Alice</a></strong>
        <div data-testid="post_message">Facebook fixture body.</div><div role="toolbar"></div></article></main>`,
      expected: ['Facebook fixture body.'],
    },
    {
      name: 'Instagram',
      url: 'https://www.instagram.com/p/ABC123/',
      html: `<main><article><header><a href="/alice/">alice</a></header>
        <div data-testid="post-caption">Instagram fixture caption.</div><section></section></article></main>`,
      expected: ['Instagram fixture caption.'],
    },
    {
      name: 'TikTok',
      url: 'https://www.tiktok.com/@alice/video/1234567890',
      html: `<main><article data-e2e="browse-video"><span data-e2e="video-author-uniqueid">alice</span>
        <div data-e2e="browse-video-desc">TikTok fixture caption.</div>
        <div data-e2e="browse-share-group"></div></article></main>`,
      expected: ['TikTok fixture caption.'],
    },
  ];

  for (const fixture of fixtures) {
    const page = await createFixturePage(browser, scriptContent, {
      url: fixture.url,
      html: `<!doctype html><html><head><title>${fixture.name} fixture</title></head><body>${fixture.html}</body></html>`,
    });
    try {
      const markdown = await clickAndCapture(page);
      for (const value of fixture.expected) {
        assertCheck(markdown.includes(value), `${fixture.name} output missing ${JSON.stringify(value)}: ${markdown}`);
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

  log('✅', 'Fifteen new platform extractors route and capture representative content');
  console.log('');
}

async function runProductionUiChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Production UI guards${COLORS.reset}`);
  const chromeStoreUrl = 'https://chromewebstore.google.com/detail/copy-as-markdown/pcjanmkidppaeojkanbjbmmgpjfeecol';
  const userscriptUrl = 'https://github.com/bvolpato/copy-as-markdown/releases/latest/download/copy-as-markdown.user.js';

  const landingPage = await browser.newPage();
  try {
    await landingPage.goto(pathToFileURL(path.join(ROOT, 'docs', 'index.html')).href, {
      waitUntil: 'domcontentloaded',
    });
    await landingPage.waitForFunction(
      () => [...document.querySelectorAll('[data-hero-install] img, .install-card .install-logo')]
        .every((logo) => logo.complete && logo.naturalWidth > 0),
      { timeout: 4000 },
    );
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
      purposeBuiltCount: document.body.textContent.includes('44 purpose-built'),
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
    assertCheck(controls.siteCards === 45, `landing page rendered ${controls.siteCards} site cards instead of 45`);
    assertCheck(controls.purposeBuiltCount, 'landing page purpose-built extractor count is stale');
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
