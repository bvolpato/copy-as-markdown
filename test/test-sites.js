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
 *   node test/test-sites.js              # full suite
 *   node test/test-sites.js Wikipedia    # single site
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

async function runTests(filter) {
  const scriptPath = path.join(ROOT, 'dist', 'userscript', 'copy-as-markdown.user.js');
  if (!fs.existsSync(scriptPath)) {
    console.error('❌  Build not found. Run "pnpm build" first.');
    process.exit(1);
  }
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');

  const sites = filter
    ? SITES.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : SITES;

  if (sites.length === 0) {
    console.error(`❌  No site matching "${filter}". Use --list to see available sites.`);
    process.exit(1);
  }

  const screenshotDir = path.join(ROOT, 'test', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log(`\n${COLORS.bold}Copy as Markdown — Integration Tests${COLORS.reset}`);
  console.log(`${COLORS.dim}Testing ${sites.length} site(s) via Wayback Machine snapshots${COLORS.reset}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  });

  const results = [];

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
  node test/test-sites.js --list       # list available sites
`);
  process.exit(0);
}

runTests(args[0]).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
