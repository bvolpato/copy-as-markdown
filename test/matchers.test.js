import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import * as library from '../dist/library/index.js';
import { MATCHER_ROUTE_CASES } from './fixtures/matcher-route-cases.js';
import { WORKSPACE_MATCHER_CASES } from './fixtures/workspace-matcher-cases.js';

await library.loadAllExtractors();
const failures = [];
async function check(name, run) {
  try { await run(); console.log(`✓ ${name}`); }
  catch (error) { failures.push(name); console.error(`✗ ${name}: ${error.message}`); }
}

await check('URL matches take precedence over DOM fallbacks and retain caller restrictions', () => {
  const fallback = library.defineExtractor({
    name: 'DOM fallback', matches: [], detect: () => true, extract: async () => 'Fallback content',
  });
  const specific = library.defineExtractor({
    name: 'URL match', matches: ['https://specific.example/content/*'], extract: async () => 'Specific content',
  });
  const input = { url: 'https://specific.example/content/page', document: {} };
  const matcher = library.createExtractorMatcher({ extractors: [fallback, specific] });
  assert.deepEqual(matcher.matchAll(input).map(({ name }) => name), ['URL match']);
  assert.equal(matcher.match(input)?.name, 'URL match');
  assert.equal(matcher.match({ ...input, url: 'https://custom.example/page' })?.name, 'DOM fallback');
  assert.equal(library.createExtractorMatcher({
    extractors: [fallback, specific], when: ({ extractor }) => extractor !== specific,
  }).match(input), null, 'A caller restriction must not re-enable a DOM fallback for a URL-matched page');
  assert.equal(library.createExtractorMatcher({
    extractors: [fallback, specific], domains: ['allowed.example'],
  }).match(input), null);
});

await check('MLflow comparison detection uses a supplied document without browser globals', async () => {
  const mlflow = await library.loadExtractor('mlflow');
  const matcher = library.createExtractorMatcher({ extractors: [mlflow] });
  for (const { suffix, chart, expected } of [
    { suffix: '?compareRunsMode=CHART', chart: false, expected: 'MLflow' },
    { suffix: '', chart: true, expected: 'MLflow' },
    { suffix: '', chart: false, expected: null },
  ]) {
    const url = `https://metrics.example/#/experiments/1/runs${suffix}`;
    const document = {
      title: 'MLflow', location: { href: url },
      querySelector: selector => chart && selector === '[data-testid="experiment-view-compare-runs-chart-area"]' ? {} : null,
    };
    assert.equal(matcher.match({ url, document })?.name ?? null, expected);
  }
});

const cases = [...MATCHER_ROUTE_CASES, ...WORKSPACE_MATCHER_CASES];
const matcher = library.createExtractorMatcher();
for (const fixture of cases) {
  await check(`${fixture.id}: URL selection`, () => {
    assert.equal(matcher.match({ url: fixture.url })?.name ?? null, fixture.extractor);
  });
}

const browserCode = fs.readFileSync(new URL('../dist/library/browser.js', import.meta.url), 'utf8');
const userscript = fs.readFileSync(new URL('../dist/userscript/copy-as-markdown.user.js', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
try {
  for (const fixture of cases.filter(({ html }) => html)) {
    await check(`${fixture.id}: headless content and page button`, async () => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      try {
        await page.setRequestInterception(true);
        page.on('request', request => {
          if (request.isNavigationRequest()) {
            void request.respond({ contentType: 'text/html', body: fixture.html });
          } else {
            void request.abort();
          }
        });
        await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
          window.__matcherFetches = [];
          window.fetch = async input => {
            window.__matcherFetches.push(String(input));
            return new Response('', { status: 404 });
          };
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async text => { window.__matcherCopied = text; } },
          });
        });
        await page.addScriptTag({ content: browserCode });
        const selected = await page.evaluate(async () => {
          await CopyAsMarkdown.loadAllExtractors();
          return CopyAsMarkdown.createExtractorMatcher().match({ document })?.name ?? null;
        });
        assert.equal(selected, fixture.extractor);
        await page.addScriptTag({ content: userscript });
        await page.waitForSelector('#cam-copy-btn', { visible: true, timeout: 5000 });
        assert.equal(await page.$eval('#cam-copy-btn', button => button.dataset.camExtractor), fixture.extractor ?? 'Fallback');
        await page.click('#cam-copy-btn');
        await page.waitForFunction(() => typeof window.__matcherCopied === 'string', { timeout: 5000 });
        const result = await page.evaluate(() => ({ text: window.__matcherCopied, fetches: window.__matcherFetches }));
        for (const value of fixture.contains ?? []) assert.ok(result.text.includes(value), `Missing ${JSON.stringify(value)}`);
        for (const value of fixture.excludes ?? []) assert.ok(!result.text.includes(value), `Unexpected ${JSON.stringify(value)}`);
        for (const [value, count] of Object.entries(fixture.occurrences ?? {})) {
          assert.equal(result.text.split(value).length - 1, count, `Occurrence count for ${JSON.stringify(value)}`);
        }
        if (fixture.extractor === null) {
          assert.deepEqual(result.fetches, [], 'Rendered fallback must not request editor exports');
        }
      } finally {
        await context.close();
      }
    });
  }

  await check('MLflow detached-document detection ignores chart markers on the active page', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<title>Unrelated active page</title>');
      await page.addScriptTag({ content: browserCode });
      const result = await page.evaluate(async () => {
        const mlflow = await CopyAsMarkdown.loadExtractor('mlflow');
        const matcher = CopyAsMarkdown.createExtractorMatcher({ extractors: [mlflow] });
        const detached = document.implementation.createHTMLDocument('MLflow');
        detached.head.insertAdjacentHTML('beforeend', '<base href="https://metrics.example/#/experiments/1/runs">');
        detached.body.innerHTML = '<div data-testid="experiment-view-compare-runs-chart-area"></div>';
        const withDetachedChart = matcher.match({ document: detached, url: detached.baseURI })?.name ?? null;
        document.body.innerHTML = detached.body.innerHTML;
        detached.body.innerHTML = '';
        const withActiveChart = matcher.match({ document: detached, url: detached.baseURI })?.name ?? null;
        return { withDetachedChart, withActiveChart };
      });
      assert.deepEqual(result, { withDetachedChart: 'MLflow', withActiveChart: null });
    } finally {
      await page.close();
    }
  });
} finally {
  await browser.close();
}

if (failures.length > 0) throw new Error(`Matcher regressions failed: ${failures.join(', ')}`);
console.log('✅ Matcher routes, DOM fallback, and headless copy checks passed');
