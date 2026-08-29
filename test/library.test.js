import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const library = await import(path.join(ROOT, 'dist', 'library', 'index.js'));

const available = library.getAvailableExtractorIds();
assert.ok(available.length >= 50, 'published catalog should expose 50+ extractor loaders');
assert.deepEqual(
  [
    'microsoft-copilot',
    'gemini-notebook',
    'mistral-vibe',
    'deepseek',
    'google-ai-studio',
  ].filter((id) => !available.includes(id)),
  [],
  'AI chat extractor loader IDs should be published',
);
const selectedExtractors = await library.loadExtractors(['jira', 'confluence', 'github', 'hugging-face', 'google-docs', 'linear']);
const catalog = library.getExtractors();
assert.deepEqual(
  catalog.map(({ name }) => name).sort(),
  selectedExtractors.map(({ name }) => name).sort(),
);

const directCore = await import(path.join(ROOT, 'dist', 'library', 'core.js'));
const { jiraExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'jira.js'));
const { confluenceExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'confluence.js'));
const { githubExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'github.js'));
const { huggingFaceExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'hugging-face.js'));
const { googleDocsExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'google-docs.js'));
const { linearExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'linear.js'));
const { microsoftCopilotExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'microsoft-copilot.js'));
const { geminiNotebookExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'gemini-notebook.js'));
const { mistralVibeExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'mistral-vibe.js'));
const { deepSeekExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'deepseek.js'));
const { googleAiStudioExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'google-ai-studio.js'));
const directMatcher = directCore.createExtractorMatcher({
  extractors: [jiraExtractor, confluenceExtractor, githubExtractor, huggingFaceExtractor, googleDocsExtractor, linearExtractor],
});
assert.equal(directMatcher.match({ url: 'https://github.com/bvolpato/copy-as-markdown' })?.name, 'GitHub');
assert.equal(directMatcher.match({ url: 'https://huggingface.co/google/gemma-3-270m' })?.name, 'Hugging Face');
assert.equal(directMatcher.match({ url: 'https://huggingface.co/datasets/HuggingFaceFW/fineweb/tree/main' })?.name, 'Hugging Face');
assert.equal(directMatcher.match({ url: 'https://huggingface.co/spaces/Qwen/Qwen-Image-Edit' })?.name, 'Hugging Face');
assert.equal(directMatcher.match({ url: 'https://huggingface.co/models' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/models/text-generation' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/Models/text-generation' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/api/models' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/auth/login' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/oauth/authorize' }), null);
assert.equal(directMatcher.match({ url: 'https://huggingface.co/inference/models' }), null);
assert.equal(
  directMatcher.match({ url: 'https://docs.google.com/document/d/example/edit' })?.name,
  'Google Docs',
);
assert.equal(
  directMatcher.match({ url: 'https://linear.app/acme/issue/ENG-123/example' })?.name,
  'Linear',
);
assert.equal(
  directMatcher.match({ url: 'https://linear.app/issue/ENG-123' })?.name,
  'Linear',
);

const aiMatcher = directCore.createExtractorMatcher({
  extractors: [
    microsoftCopilotExtractor,
    geminiNotebookExtractor,
    mistralVibeExtractor,
    deepSeekExtractor,
    googleAiStudioExtractor,
  ],
});
assert.equal(aiMatcher.match({ url: 'https://copilot.com/chats/example' })?.name, 'Microsoft Copilot');
assert.equal(aiMatcher.match({ url: 'https://copilot.microsoft.com/shares/example' })?.name, 'Microsoft Copilot');
assert.equal(aiMatcher.match({ url: 'https://copilot.microsoft.com/shares/pages/example' })?.name, 'Microsoft Copilot');
assert.equal(aiMatcher.match({ url: 'https://copilot.microsoft.com/projects/project/chats/chat' })?.name, 'Microsoft Copilot');
assert.equal(aiMatcher.match({ url: 'https://notebook.google.com/notebook/example' })?.name, 'Gemini Notebook');
assert.equal(aiMatcher.match({ url: 'https://notebooklm.google.com/notebook/example' })?.name, 'Gemini Notebook');
assert.equal(aiMatcher.match({ url: 'https://chat.mistral.ai/chat/12345678-1234-1234-1234-123456789abc' })?.name, 'Mistral Vibe');
assert.equal(aiMatcher.match({ url: 'https://chat.deepseek.com/share/example' })?.name, 'DeepSeek');
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/prompts/example' })?.name, 'Google AI Studio');
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/app/prompts/example' })?.name, 'Google AI Studio');
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/apps/12345678-1234-1234-1234-123456789abc' })?.name, 'Google AI Studio');
assert.equal(aiMatcher.match({ url: 'https://copilot.com/account/general' }), null);
assert.equal(aiMatcher.match({ url: 'https://notebook.google.com/' }), null);
assert.equal(aiMatcher.match({ url: 'https://chat.mistral.ai/libraries/example' }), null);
assert.equal(aiMatcher.match({ url: 'https://chat.mistral.ai/work/example' }), null);
assert.equal(aiMatcher.match({ url: 'https://chat.deepseek.com/downloads/privacy.pdf' }), null);
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/api-keys' }), null);
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/apps?prompt=hello' }), null);
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/prompts' }), null);
assert.equal(aiMatcher.match({ url: 'https://aistudio.google.com/apps/not-a-uuid' }), null);

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
    'linear.app',
    '*.atlassian.net',
  ],
  when: ({ document, extractor }) => extractor.name !== 'GitHub'
    || Boolean(document?.querySelector('[data-copy-as-markdown-enabled]')),
});

assert.deepEqual(
  matcher.extractors.map(({ name }) => name),
  ['Jira', 'Confluence', 'GitHub', 'Hugging Face', 'Google Docs', 'Linear'],
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
assert.equal(
  matcher.match({ url: 'https://linear.app/acme/document/specification-123' })?.name,
  'Linear',
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
    await CopyAsMarkdown.loadExtractors(['jira', 'confluence', 'github', 'hugging-face', 'google-docs', 'linear']);
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
