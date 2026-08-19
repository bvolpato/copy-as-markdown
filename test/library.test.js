import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = await import(path.join(ROOT, 'dist', 'library', 'index.js'));

const available = library.getAvailableExtractorIds();
assert.ok(available.length >= 50, 'published catalog should expose 50+ extractor loaders');
const selectedExtractors = await library.loadExtractors(['jira', 'confluence', 'github', 'google-docs']);
const catalog = library.getExtractors();
assert.deepEqual(
  catalog.map(({ name }) => name).sort(),
  selectedExtractors.map(({ name }) => name).sort(),
);

const directCore = await import(path.join(ROOT, 'dist', 'library', 'core.js'));
const { jiraExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'jira.js'));
const { confluenceExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'confluence.js'));
const { githubExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'github.js'));
const { googleDocsExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'google-docs.js'));
const directMatcher = directCore.createExtractorMatcher({
  extractors: [jiraExtractor, confluenceExtractor, githubExtractor, googleDocsExtractor],
});
assert.equal(directMatcher.match({ url: 'https://github.com/bvolpato/copy-as-markdown' })?.name, 'GitHub');
assert.equal(
  directMatcher.match({ url: 'https://docs.google.com/document/d/example/edit' })?.name,
  'Google Docs',
);

const markerDocument = {
  querySelector(selector) {
    return selector === '[data-copy-as-markdown-enabled]' ? {} : null;
  },
};
const emptyDocument = { querySelector() { return null; } };

const matcher = library.createExtractorMatcher({
  extractors: selectedExtractors,
  domains: [
    'github.com',
    'docs.google.com',
    'jira.corp.example',
    'confluence.corp.example',
    '*.atlassian.net',
  ],
  when: ({ document, extractor }) => extractor.name !== 'GitHub'
    || Boolean(document?.querySelector('[data-copy-as-markdown-enabled]')),
});

assert.deepEqual(
  matcher.extractors.map(({ name }) => name),
  ['Jira', 'Confluence', 'GitHub', 'Google Docs'],
);
assert.equal(
  matcher.match({ url: 'https://jira.corp.example/browse/ENG-123' })?.name,
  'Jira',
);
assert.equal(
  matcher.match({ url: 'https://confluence.corp.example/display/ENG/Plan' })?.name,
  'Confluence',
);
assert.equal(
  matcher.match({
    url: 'https://github.com/bvolpato/copy-as-markdown',
    document: markerDocument,
  })?.name,
  'GitHub',
);
assert.equal(matcher.match({
  url: 'https://github.com/bvolpato/copy-as-markdown',
  document: emptyDocument,
}), null);
assert.equal(matcher.match({
  url: 'https://www.github.com/bvolpato/copy-as-markdown',
  document: markerDocument,
}), null, 'domain restrictions should be exact unless wildcarded');
assert.equal(
  matcher.match({ url: 'https://acme.atlassian.net/browse/ENG-123' })?.name,
  'Jira',
);

const originMatcher = library.createExtractorMatcher({
  extractors: ['GitHub'],
  origins: ['https://github.com'],
  urlPatterns: ['*://github.com/bvolpato/*'],
});
assert.equal(
  originMatcher.match({ url: 'https://github.com/bvolpato/copy-as-markdown' })?.name,
  'GitHub',
);
assert.equal(originMatcher.match({ url: 'https://github.com/openai/codex' }), null);
assert.throws(
  () => library.createExtractorMatcher({ extractors: ['missing'] }),
  /Unknown extractor: missing/,
);

const domExtractor = library.defineExtractor({
  name: 'Internal DOM',
  matches: [],
  detect: (document) => Boolean(document?.querySelector('[data-internal-page]')),
  extract: async () => '# Internal',
});
const domMatcher = library.createExtractorMatcher({
  extractors: [domExtractor],
  domains: ['internal.example.com'],
});
assert.equal(domMatcher.match({
  url: 'https://internal.example.com/app',
  document: { querySelector: () => ({}) },
})?.name, 'Internal DOM');
assert.equal(domMatcher.match({
  url: 'https://other.example.com/app',
  document: { querySelector: () => ({}) },
}), null);

const nodeMatch = matcher.match({ url: 'https://jira.corp.example/browse/ENG-123' });
await assert.rejects(nodeMatch.extract(), /active browser page/);

const browserCode = fs.readFileSync(path.join(ROOT, 'dist', 'library', 'browser.js'), 'utf8');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html>
    <html>
      <head><base href="https://docs.example.test/guide/"></head>
      <body>
        <main id="content">
          <h1>Library\u200b API</h1>
          <p>Use \u201csmart quotes\u201d \u2014 safely.</p>
          <a href="install">Install</a>
        </main>
      </body>
    </html>`);
  await page.addScriptTag({ content: browserCode });

  const result = await page.evaluate(async () => {
    await CopyAsMarkdown.loadExtractors(['jira', 'confluence', 'github', 'google-docs']);
    return {
      markdown: CopyAsMarkdown.domToMarkdown(document.querySelector('#content')),
      extractorCount: CopyAsMarkdown.getExtractors().length,
      availableCount: CopyAsMarkdown.getAvailableExtractorIds().length,
      uiCount: document.querySelectorAll('#cam-copy-btn, #cam-toast').length,
    };
  });

  assert.equal(result.extractorCount, catalog.length);
  assert.equal(result.availableCount, available.length);
  assert.equal(result.uiCount, 0, 'library import should not start userscript or extension UI');
  assert.match(result.markdown, /# Library API/);
  assert.match(result.markdown, /Use "smart quotes" - safely\./);
  assert.match(result.markdown, /\[Install\]\(https:\/\/docs\.example\.test\/guide\/install\)/);
} finally {
  await browser.close();
}

console.log('✅ Standalone library matching and DOM conversion checks passed');
