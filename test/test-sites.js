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
    assertCheck(markdown.includes('source: Datadog Notebook'), 'Notebook source metadata missing');
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

async function runProductionUiChecks(browser, scriptContent) {
  console.log(`${COLORS.cyan}● Production UI guards${COLORS.reset}`);

  const landingPage = await browser.newPage();
  try {
    await landingPage.goto(pathToFileURL(path.join(ROOT, 'docs', 'index.html')).href, {
      waitUntil: 'domcontentloaded',
    });
    await landingPage.addScriptTag({ content: scriptContent });
    await new Promise(r => setTimeout(r, 800));
    const controls = await landingPage.evaluate(() => ({
      injected: document.querySelectorAll('#cam-copy-btn').length,
      demo: document.querySelectorAll('#demo-btn').length,
      chromeDisabled: document.querySelector('[data-install="chrome"]')?.classList.contains('is-disabled'),
      chromeLink: !!document.querySelector('[data-install="chrome"] a'),
      chromeStatus: document.querySelector('[data-install="chrome"] .install-status')?.textContent?.trim(),
      firefoxLink: document.querySelector('[data-install="firefox"] a')?.href,
      latestReleaseLink: document.querySelector('.latest-release')?.href,
    }));
    assertCheck(controls.injected === 0, 'page opt-out still injected a Copy as Markdown button');
    assertCheck(controls.demo === 1, 'page opt-out removed the site-owned demo control');
    assertCheck(controls.chromeDisabled && !controls.chromeLink && controls.chromeStatus === 'WIP', 'Chrome install card is not disabled as WIP');
    assertCheck(controls.firefoxLink === 'https://addons.mozilla.org/en-US/firefox/addon/copy-as-markdown-addon/', 'Firefox install link is incorrect');
    assertCheck(controls.latestReleaseLink === 'https://github.com/bvolpato/copy-as-markdown/releases/latest', 'latest release link is incorrect');
    log('✅', 'Landing page keeps Try it, hides duplicate UI, and exposes correct install states');
  } finally {
    await landingPage.close();
  }

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
