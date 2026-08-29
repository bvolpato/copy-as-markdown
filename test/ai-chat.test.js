import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { AI_CHAT_CASES } from './fixtures/ai-chat-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserCode = fs.readFileSync(path.join(ROOT, 'dist', 'library', 'browser.js'), 'utf8');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
  for (const fixture of AI_CHAT_CASES) {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.isNavigationRequest()) {
        void request.respond({ status: 200, contentType: 'text/html', body: fixture.html });
      } else {
        void request.abort();
      }
    });
    await page.goto(fixture.url, { waitUntil: 'domcontentloaded' });
    await page.evaluate((setup) => {
      if (setup !== 'copilot-open-shadow') return;
      document.querySelector('#shadow-turn')?.attachShadow({ mode: 'open' }).append(
        Object.assign(document.createElement('div'), {
          innerHTML: '<div data-testid="message-content"><p>Open shadow answer.</p><cib-adaptive-card id="nested-shadow-card"></cib-adaptive-card></div>',
        }),
      );
      document.querySelector('#shadow-turn')?.shadowRoot
        ?.querySelector('#nested-shadow-card')
        ?.attachShadow({ mode: 'open' }).append(
          Object.assign(document.createElement('div'), {
            className: 'ac-textBlock',
            textContent: 'Nested open shadow body.',
          }),
        );
      document.querySelector('#slot-conversation-host')?.attachShadow({ mode: 'open' }).append(
        Object.assign(document.createElement('div'), {
          innerHTML: '<slot name="user"></slot><slot name="assistant"></slot><slot name="hidden" style="display:none"></slot>',
        }),
      );
      document.querySelector('#text-slot-host')?.attachShadow({ mode: 'open' }).append(
        Object.assign(document.createElement('slot'), {
          innerHTML: '<cib-message-group source="bot"><div class="content">SUPPRESSED SLOT FALLBACK TURN</div></cib-message-group>',
        }),
      );
      const artifact = document.createElement('aside');
      artifact.dataset.testid = 'artifact-content';
      artifact.innerHTML = '<h2>Shadow artifact</h2><p>Rendered in an open shadow root.</p>';
      document.querySelector('#shadow-artifact')?.attachShadow({ mode: 'open' }).append(artifact);
    }, fixture.setup || '');
    await page.addScriptTag({ content: browserCode });

    const result = await page.evaluate(async (id) => {
      const extractor = await CopyAsMarkdown.loadExtractor(id);
      const match = CopyAsMarkdown.createExtractorMatcher({ extractors: [extractor] }).match();
      return {
        name: match?.name || '',
        markdown: match ? await match.extract() : '',
      };
    }, fixture.id);

    assert.equal(result.name, fixture.extractor);
    for (const expected of fixture.contains) assert.ok(result.markdown.includes(expected), expected);
    for (const excluded of fixture.excludes || []) {
      assert.ok(!result.markdown.includes(excluded), `${fixture.id}: excluded ${excluded}`);
    }
    for (const [value, count] of Object.entries(fixture.occurrences || {})) {
      assert.equal(
        result.markdown.split(value).length - 1,
        count,
        `${fixture.id}: expected ${count} occurrence(s) of ${value}`,
      );
    }
    let offset = -1;
    for (const expected of fixture.ordered) {
      const next = result.markdown.indexOf(expected, offset + 1);
      assert.ok(next > offset, `${fixture.id}: expected ordered content ${expected}`);
      offset = next;
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('✅ AI chat rendered-DOM extraction checks passed');
