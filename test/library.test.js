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
const selectedExtractors = await library.loadExtractors([
  'jira',
  'confluence',
  'documentation',
  'github',
  'google-docs',
  'linear',
  'hugging-face',
]);
const catalog = library.getExtractors();
assert.deepEqual(
  catalog.map(({ name }) => name).sort(),
  selectedExtractors.map(({ name }) => name).sort(),
);

const notionExtractor = await library.loadExtractor('notion');
const [notionFromBatch] = await library.loadExtractors(['notion']);
assert.equal(notionFromBatch, notionExtractor, 'repeated loads should reuse the extractor');
const notionByName = library.getExtractors(['Notion']);
assert.equal(notionByName.length, 2, 'name selection must preserve both Notion routes');
for (const extractors of [[notionExtractor], ['Notion'], [notionExtractor, 'Notion']]) {
  const notionMatcher = library.createExtractorMatcher({ extractors });
  for (const url of [
    'https://www.notion.so/Page-12345678901234567890123456789012',
    'https://team.notion.so/Page-12345678-1234-1234-1234-123456789012',
    'https://team.notion.site/Public-page',
    'https://docs.team.notion.site:8443/Public-page',
  ]) {
    assert.equal(notionMatcher.matchAll({ url }).length, 1, `Notion route must match once: ${url}`);
  }
  for (const url of [
    'https://www.notion.so/settings',
    'https://www.notion.so/Public-page',
    'https://team.notion.site/settings',
    'https://team.notion.site/api/page',
    'https://team.notion.site/',
    'https://team.notion.site.evil.example/Public-page',
  ]) {
    assert.equal(notionMatcher.match({ url }), null, `Notion route must reject: ${url}`);
  }
}

const directCore = await import(path.join(ROOT, 'dist', 'library', 'core.js'));
const { jiraExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'jira.js'));
const { confluenceExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'confluence.js'));
const { documentationExtractor } = await import(path.join(ROOT, 'dist', 'library', 'extractors', 'documentation.js'));
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
  extractors: [
    jiraExtractor,
    confluenceExtractor,
    documentationExtractor,
    githubExtractor,
    googleDocsExtractor,
    linearExtractor,
    huggingFaceExtractor,
  ],
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
  directMatcher.match({
    url: 'https://docs.internal.example/guide',
    document: {
      location: { hostname: 'docs.internal.example' },
      querySelector(selector) {
        if (selector === 'meta[name="generator"]') return { content: 'Docusaurus v3' };
        if (selector === '.theme-doc-markdown.markdown') {
          return { textContent: 'Docusaurus content', querySelector: () => null };
        }
        return null;
      },
      querySelectorAll(selector) {
        const element = this.querySelector(selector);
        return element ? [element] : [];
      },
    },
  })?.name,
  'Sphinx / Read the Docs',
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

assert.ok(available.includes('microsoft-teams'));
const teamsExtractor = await library.loadExtractor('microsoft-teams');
const { microsoftTeamsExtractor } = await import(
  path.join(ROOT, 'dist', 'library', 'extractors', 'microsoft-teams.js')
);
assert.equal(teamsExtractor.name, 'Microsoft Teams');
assert.equal(microsoftTeamsExtractor.name, 'Microsoft Teams');
const teamsMatcher = directCore.createExtractorMatcher({
  extractors: [microsoftTeamsExtractor],
});
assert.equal(
  teamsMatcher.match({ url: 'https://teams.microsoft.com/v2/' })?.name,
  'Microsoft Teams',
);
assert.equal(
  teamsMatcher.match({ url: 'https://teams.cloud.microsoft/v2/' })?.name,
  'Microsoft Teams',
);
assert.equal(
  teamsMatcher.match({ url: 'https://teams.live.com/v2/' })?.name,
  'Microsoft Teams',
);
assert.equal(
  teamsMatcher.match({ url: 'https://teams.microsoft.com/l/message/thread/message' })?.name,
  'Microsoft Teams',
);
assert.equal(
  teamsMatcher.match({ url: 'https://teams.microsoft.com/l/team/thread/conversations' })?.name,
  'Microsoft Teams',
);
assert.equal(teamsMatcher.match({ url: 'https://teams.microsoft.com/' }), null);
assert.equal(teamsMatcher.match({ url: 'https://teams.cloud.microsoft/settings' }), null);
assert.equal(
  teamsMatcher.match({ url: 'https://teams.microsoft.com/l/meetup-join/meeting' }),
  null,
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
    'linear.app',
    '*.atlassian.net',
  ],
  when: ({ document, extractor }) => extractor.name !== 'GitHub'
    || Boolean(document?.querySelector('[data-copy-as-markdown-enabled]')),
});

assert.deepEqual(
  matcher.extractors.map(({ name }) => name),
  ['Jira', 'Confluence', 'Sphinx / Read the Docs', 'GitHub', 'Google Docs', 'Linear', 'Hugging Face'],
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
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox'] });
try {
  const notionPage = await browser.newPage();
  await notionPage.setRequestInterception(true);
  notionPage.on('request', request => request.respond({
    contentType: 'text/html',
    body: '<!doctype html><main class="notion-page-content"><h1>Custom Notion page</h1><div data-block-id="a"><p>Detected Notion content</p></div></main>',
  }));
  await notionPage.goto('https://custom.example/page');
  await notionPage.addScriptTag({ content: browserCode });
  const notionDirect = await notionPage.evaluate(async () => {
    const extractor = await CopyAsMarkdown.loadExtractor('notion');
    const detected = extractor.detect(document);
    const markdown = await extractor.extract();
    document.querySelector('main').remove();
    const rejection = await extractor.extract().then(() => null, error => error.message);
    return { detected, markdown, rejection };
  });
  assert.equal(notionDirect.detected, true);
  assert.ok(notionDirect.markdown.includes('Detected Notion content'));
  assert.equal(notionDirect.rejection, 'No Notion extractor matches the active browser page');
  await notionPage.close();

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
    await CopyAsMarkdown.loadExtractors([
      'jira',
      'confluence',
      'documentation',
      'github',
      'hugging-face',
      'google-docs',
      'linear',
    ]);
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

  const codeCases = await page.evaluate(() => {
    const inline = 'a[b](c)d “Ａ”\u200b';
    const block = 'const text = “Ａ”;  \n\n\n```\n````\n\tend  \n\n';
    const root = document.createElement('div');
    const prose = root.appendChild(document.createElement('p'));
    prose.textContent = '“Prose”\u200b — Ａ';
    const paragraph = root.appendChild(document.createElement('p'));
    paragraph.appendChild(document.createElement('code')).textContent = inline;
    const pre = root.appendChild(document.createElement('pre'));
    const code = pre.appendChild(document.createElement('code'));
    code.className = 'language-typescript';
    code.textContent = block;
    const markdown = CopyAsMarkdown.domToMarkdown(root);
    const list = document.createElement('ul');
    list.appendChild(document.createElement('li'))
      .appendChild(document.createElement('code')).textContent = inline;
    const codeSpan = (text) => {
      const element = document.createElement('code');
      element.textContent = text;
      return CopyAsMarkdown.domToMarkdown(element);
    };
    return {
      inline, block, markdown,
      pageMarkdown: CopyAsMarkdown.buildPageMarkdown({ title: 'Example' }, markdown),
      cleaned: CopyAsMarkdown.cleanMarkdown(markdown),
      list: CopyAsMarkdown.domToMarkdown(list),
      edgeBackticks: codeSpan('`edge`'),
      padded: codeSpan(' value '),
      spaces: codeSpan('   '),
      newline: codeSpan('one\ntwo'),
      noFinalNewline: CopyAsMarkdown.htmlToMarkdown('<pre><code class="language-c++">one</code></pre>'),
      quoted: CopyAsMarkdown.htmlToMarkdown('<blockquote><pre><code>“Ａ”  \n\n\nend</code></pre></blockquote>'),
      listBlock: CopyAsMarkdown.htmlToMarkdown('<ul><li><pre><code>“Ａ”  \n\n\nend</code></pre></li></ul>'),
      listBefore: CopyAsMarkdown.htmlToMarkdown('<ul><li><p>Example:</p><pre><code>“Ａ”  \nline</code></pre></li></ul>'),
      listAfter: CopyAsMarkdown.htmlToMarkdown('<ul><li><pre><code>“Ａ”  \nline</code></pre><p>Explanation after.</p></li></ul>'),
      listCard: CopyAsMarkdown.htmlToMarkdown('<ol><li><a href="https://example.test/card"><h3>Card title</h3><p>Card body</p></a></li></ol>'),
      table: CopyAsMarkdown.htmlToMarkdown('<table><tr><th>Code</th></tr><tr><td><strong><code>“Ａ”  value</code></strong></td></tr></table>'),
      tablePath: CopyAsMarkdown.htmlToMarkdown('<table><tr><th>Code</th></tr><tr><td><code>C:\\foo | bar</code></td></tr></table>'),
      tableEscapedPipe: CopyAsMarkdown.htmlToMarkdown('<table><tr><th>Code</th></tr><tr><td><code>C:\\foo\\|bar</code></td></tr></table>'),
    };
  });
  assert.match(codeCases.markdown, /"Prose" - A/);
  assert.ok(codeCases.markdown.includes('`' + codeCases.inline + '`'), 'inline code must retain literal Unicode and punctuation');
  const fenced = '`````typescript\n' + codeCases.block + '`````';
  assert.ok(codeCases.markdown.includes(fenced), 'a fence must exceed every literal backtick run and retain code whitespace');
  assert.equal(codeCases.cleaned, codeCases.markdown, 'Markdown cleanup must preserve code on repeated calls');
  assert.ok(codeCases.pageMarkdown.endsWith(codeCases.markdown), 'page metadata must not rewrite code');
  assert.equal(codeCases.list, '- `' + codeCases.inline + '`', 'list normalization must preserve code');
  assert.equal(codeCases.edgeBackticks, '`` `edge` ``');
  assert.equal(codeCases.padded, '`  value  `');
  assert.equal(codeCases.spaces, '`   `');
  assert.equal(codeCases.newline, '`one two`');
  assert.equal(codeCases.noFinalNewline, '```c++\none\n```');
  assert.equal(codeCases.quoted, '> ```\n> “Ａ”  \n> \n> \n> end\n> ```');
  assert.equal(codeCases.listBlock, '- ```\n  “Ａ”  \n\n\n  end\n  ```');
  assert.equal(codeCases.listBefore, '- Example:\n\n  ```\n  “Ａ”  \n  line\n  ```');
  assert.equal(codeCases.listAfter, '- ```\n  “Ａ”  \n  line\n  ```\n\n  Explanation after.');
  assert.equal(codeCases.listCard, '1. [### Card title Card body](https://example.test/card)');
  assert.equal(codeCases.table, '| Code |\n| --- |\n| **`“Ａ”  value`** |');
  assert.equal(codeCases.tablePath, '| Code |\n| --- |\n| `C:\\foo \\| bar` |');
  assert.equal(codeCases.tableEscapedPipe, '| Code |\n| --- |\n| `C:\\foo\\\\|bar` |');
  assert.equal(library.cleanMarkdown(codeCases.tablePath), codeCases.tablePath);
  assert.equal(library.cleanMarkdown('`unmatched\n\n“Prose”\n\n`another'), '`unmatched\n\n"Prose"\n\n`another', 'unmatched delimiters across paragraphs must not bypass prose normalization');

  const { spawnSync } = await import('node:child_process');
  const quotePrefix = '> '.repeat(80);
  const literalCode = 'a[b](c)d “Ａ”\u200b  \\|\n\n```\nlast  \n';
  const literalFence = '````text\n' + literalCode + '````';
  const adversarialMarkdown = quotePrefix + '“Prose”\u200b\n' + quotePrefix + '\n\n' + literalFence;
  const cleanupResult = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { cleanMarkdown } = await import(${JSON.stringify(new URL('../dist/library/index.js', import.meta.url).href)});
    process.stdout.write(cleanMarkdown(${JSON.stringify(adversarialMarkdown)}));
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(cleanupResult.error, undefined, 'deep quote prefixes must complete Markdown cleanup within the process deadline');
  assert.equal(cleanupResult.status, 0, cleanupResult.stderr);
  assert.equal(cleanupResult.stdout, quotePrefix + '"Prose"\n' + quotePrefix.trimEnd() + '\n\n' + literalFence, 'deep prefixes must preserve code and retain prose normalization');

  const imageCases = await page.evaluate(() => {
    const image = (src, alt) => {
      const element = document.createElement('img');
      element.setAttribute('src', src);
      element.setAttribute('alt', alt);
      return CopyAsMarkdown.domToMarkdown(element);
    };
    return {
      safe: image('../image(1).png', 'chart [draft] \\ path'),
      unsafe: ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'mailto:evil@example.test', 'http://[invalid']
        .map((src) => image(src, 'Unavailable image')),
      empty: image('', 'Missing image'),
    };
  });
  assert.equal(imageCases.safe, '![chart \\[draft\\] \\\\ path](https://docs.example.test/image%281%29.png)');
  assert.deepEqual(imageCases.unsafe, Array(4).fill('Unavailable image'));
  assert.equal(imageCases.empty, 'Missing image');

  const tableCases = await page.evaluate(() => {
    const table = (html) => CopyAsMarkdown.htmlToMarkdown(html);
    return {
      spans: table('<table><tr><th>Group</th><th>Left</th><th>Right</th></tr><tr><td rowspan="2">A</td><td colspan="2">Both</td></tr><tr><td>L</td><td>R</td></tr></table>'),
      sections: table('<table><thead><tr><th>Group</th><th>Value</th></tr></thead><tbody><tr><td rowspan="0">A</td><td>1</td></tr><tr><td>2</td></tr></tbody><tbody><tr><td>B</td><td>3</td></tr></tbody><tfoot><tr><td>End</td><td>4</td></tr></tfoot></table>'),
      nested: table('<table><tr><th>Outer</th><th>Other</th></tr><tr><td><table><tr><td>Nested</td></tr></table></td><td>Value</td></tr></table>'),
      oversized: table('<table><tr><td colspan="999999999" rowspan="999999999">Wide</td></tr><tr><td>Next</td></tr></table>'),
    };
  });
  assert.equal(tableCases.spans, '| Group | Left | Right |\n| --- | --- | --- |\n| A | Both |  |\n|  | L | R |');
  assert.equal(tableCases.sections, '| Group | Value |\n| --- | --- |\n| A | 1 |\n|  | 2 |\n| B | 3 |\n| End | 4 |');
  assert.equal(tableCases.nested, '| Outer | Other |\n| --- | --- |\n| Nested | Value |');
  assert.equal(tableCases.oversized.split('\n').length, 3, 'row spans must not invent rows');
  assert.ok(tableCases.oversized.length < 20000, 'malformed spans must have bounded expansion');
  assert.ok(tableCases.oversized.includes('Next'), 'bounded spans must retain following cell values');

  await page.setContent(`<!doctype html>
    <html>
      <head><base href="https://teams.cloud.microsoft/v2/"></head>
      <body>
        <header data-tid="chat-header"><h1 data-tid="header-chat-title">Project Phoenix</h1></header>
        <main data-tid="chat-pane-message-list" role="log" aria-label="Messages">
          <div role="listitem">Activity chrome that is not a message</div>
          <article data-tid="chat-pane-item" data-message-id="chat-pane-item-message">
            <span data-tid="message-author-name">Live Alice</span>
            <time data-tid="message-timestamp" datetime="2026-08-29T13:55:00Z">9:55 AM</time>
            <div data-tid="message-attachment">
              <a href="https://files.example.com/live-chat.pdf">live-chat.pdf</a>
            </div>
            <div data-tid="message-reactions">
              <button aria-label="Live Alice reacted with Like">Like 1</button>
            </div>
            <div data-tid="chat-pane-message">
              <div data-tid="messageBodyContent">Outer chat item owns this message.</div>
            </div>
          </article>
          <article data-tid="message-group-container" data-message-id="message-1">
            <span data-tid="message-group-author">Alice</span>
            <time data-tid="message-group-time" datetime="2026-08-29T14:00:00Z">10:00 AM</time>
            <div data-tid="message-content">
              <p>Review the <a href="https://example.com/plan">launch plan</a>.</p>
              <pre><code>pnpm typecheck</code></pre>
            </div>
            <div data-tid="message-reactions">
              <button aria-label="Alice reacted with Like">Like 1</button>
            </div>
            <div data-tid="message-attachment">
              <a href="https://files.example.com/spec.pdf" download="spec.pdf">spec.pdf</a>
            </div>
          </article>
          <article data-tid="message-list-item" data-message-id="message-2">
            <div data-tid="replied-to-message">
              <span data-tid="message-author-name">Alice</span>
              <div data-tid="messageBodyContent">Review the launch plan.</div>
            </div>
            <span data-tid="message-author-name">Bob</span>
            <time data-tid="message-timestamp" datetime="2026-08-29T14:05:00Z">10:05 AM</time>
            <div data-tid="message-body">Approved.</div>
          </article>
          <article role="listitem">
            <span data-tid="message-author-name">Zoe</span>
            <div data-tid="message-body">Generic list item with body evidence.</div>
          </article>
          <article role="listitem">
            <span data-tid="message-author-name">Zoe</span>
            <div data-tid="message-body">Generic list item with body evidence.</div>
          </article>
        </main>
      </body>
    </html>`);

  const teamsResult = await page.evaluate(async () => {
    const extractor = await CopyAsMarkdown.loadExtractor('microsoft-teams');
    return { name: extractor.name, markdown: await extractor.extract() };
  });
  assert.equal(teamsResult.name, 'Microsoft Teams');
  assert.match(teamsResult.markdown, /# Microsoft Teams · Project Phoenix/);
  assert.match(teamsResult.markdown, /## Live Alice[\s\S]+\*\*Time:\*\* 2026-08-29T13:55:00Z/);
  assert.match(teamsResult.markdown, /## Live Alice[\s\S]+Outer chat item owns this message\./);
  assert.match(teamsResult.markdown, /\*\*Attachments:\*\* \[live-chat\.pdf\]\(https:\/\/files\.example\.com\/live-chat\.pdf\)/);
  assert.match(teamsResult.markdown, /\*\*Reactions:\*\* Live Alice reacted with Like/);
  assert.match(teamsResult.markdown, /## Alice[\s\S]+### ↳ Bob[\s\S]+## Zoe/);
  assert.doesNotMatch(teamsResult.markdown, /Activity chrome/);
  assert.match(teamsResult.markdown, /```[\s\S]*pnpm typecheck[\s\S]*```/);
  assert.match(teamsResult.markdown, /\*\*Links:\*\* https:\/\/example\.com\/plan/);
  assert.match(teamsResult.markdown, /\*\*Attachments:\*\* \[spec\.pdf\]\(https:\/\/files\.example\.com\/spec\.pdf\)/);
  assert.match(teamsResult.markdown, /\*\*Reactions:\*\* Alice reacted with Like/);
  assert.match(teamsResult.markdown, /\*\*Reply to:\*\* Alice: "Review the launch plan\."/);
  assert.equal(teamsResult.markdown.match(/Generic list item with body evidence\./g)?.length, 2);

  await page.setContent(`<!doctype html>
    <html>
      <body>
        <div data-tid="team-name">Core Platform</div>
        <header><h1 data-tid="channel-header-title">General</h1></header>
        <main role="list" aria-label="Messages">
          <article data-tid="channel-pane-message" data-message-id="channel-message-1">
            <span data-tid="message-author-name">Carol</span>
            <div data-tid="messageBodyContent">Deployment finished.</div>
            <button data-tid="response-summary-button">2 replies</button>
          </article>
          <section data-tid="message-group-container">
            <div data-tid="message-group-header">
              <span id="author-channel-body">Fran</span>
              <time id="timestamp-channel-body" datetime="2026-08-29T15:30:00Z">11:30 AM</time>
            </div>
            <div
              id="message-body-channel-body"
              aria-labelledby="author-channel-body timestamp-channel-body"
            >Labelled body-root message.</div>
            <div data-testid="file-attachment" aria-label="labelled-sibling.txt">
              <a href="https://files.example.com/labelled-sibling.txt"></a>
            </div>
            <div data-tid="message-reactions">
              <button aria-label="Fran reacted with Heart">Heart 1</button>
            </div>
            <button data-tid="response-summary-button">4 replies</button>
          </section>
          <section data-tid="message-group-container">
            <div data-tid="message-group-header">Grace</div>
            <time data-tid="message-group-time" datetime="2026-08-29T15:35:00Z">11:35 AM</time>
            <div id="message-body-group-fallback" aria-labelledby="missing-label">
              Group-header fallback message.
            </div>
          </section>
          <section data-tid="message-wrapper">
            <span id="author-wrapper-body">A</span>
            <time id="timestamp-wrapper-body" datetime="2026-08-29T15:40:00Z">11:40 AM</time>
            <div
              id="message-body-wrapper-body"
              aria-labelledby="author-wrapper-body timestamp-wrapper-body"
            >Nested labelled wrapper body.</div>
            <div data-testid="file-attachment" aria-label="wrapper-sibling.txt">
              <a href="https://files.example.com/wrapper-sibling.txt"></a>
            </div>
            <div data-tid="message-reactions">
              <button aria-label="A reacted with Like">Like 1</button>
            </div>
            <button data-tid="response-summary-button">3 replies</button>
          </section>
        </main>
      </body>
    </html>`);
  const channelMarkdown = await page.evaluate(async () => {
    const extractor = await CopyAsMarkdown.loadExtractor('microsoft-teams');
    return extractor.extract();
  });
  assert.match(channelMarkdown, /# Microsoft Teams · Core Platform · #General/);
  assert.match(channelMarkdown, /## Carol[\s\S]+## Fran[\s\S]+## Grace/);
  assert.match(channelMarkdown, /\*\*Replies:\*\* 2 replies/);
  assert.match(channelMarkdown, /\*\*Time:\*\* 2026-08-29T15:30:00Z/);
  assert.match(channelMarkdown, /\*\*Time:\*\* 2026-08-29T15:35:00Z/);
  assert.match(channelMarkdown, /\*\*Time:\*\* 2026-08-29T15:40:00Z/);
  assert.equal(channelMarkdown.match(/## Fran/g)?.length, 1);
  assert.match(
    channelMarkdown,
    /Labelled body-root message\.[\s\S]+\[labelled-sibling\.txt\]\(https:\/\/files\.example\.com\/labelled-sibling\.txt\)[\s\S]+\*\*Reactions:\*\* Fran reacted with Heart[\s\S]+\*\*Replies:\*\* 4 replies/,
  );
  assert.equal(channelMarkdown.match(/^## A$/gm)?.length, 1);
  assert.match(
    channelMarkdown,
    /## A[\s\S]+Nested labelled wrapper body\.[\s\S]+\[wrapper-sibling\.txt\]\(https:\/\/files\.example\.com\/wrapper-sibling\.txt\)[\s\S]+\*\*Reactions:\*\* A reacted with Like[\s\S]+\*\*Replies:\*\* 3 replies/,
  );

  await page.setContent(`<!doctype html>
    <html>
      <head><base href="https://teams.cloud.microsoft/v2/"></head>
      <body>
        <div data-tid="team-name">Core Platform</div>
        <header><h1 data-tid="channel-header-title">Incidents</h1></header>
        <section id="channel-pane-l2">
          <header><h2 data-tid="thread-header-title">Database recovery</h2></header>
          <article data-tid="channel-pane-message" data-message-id="thread-message-1">
            <span id="author-thread-message-1">Dana</span>
            <time data-tid="message-time" datetime="2026-08-29T15:00:00Z">11:00 AM</time>
            <div id="content-thread-message-1">Recovery started.</div>
            <div data-testid="file-attachment">
              <a href="https://files.example.com/runbook.pdf">runbook.pdf</a>
            </div>
          </article>
          <div data-tid="channel-replies-runway">
            <article data-tid="channel-replies-pane-message">
              <span id="author-thread-message-2">Eli</span>
              <time id="timestamp-thread-message-2" datetime="2026-08-29T15:05:00Z">11:05 AM</time>
              <div data-tid="message-group-container">
                <div data-tid="message-wrapper">
                  <div
                    data-tid="messageQuotedReply"
                    data-track-module-name="messageQuotedReply"
                    data-message-id="nested-quoted-id"
                  >
                    <div data-tid="quoted-reply-card" aria-label="Begin Reference">
                      <span id="author-quoted-message">Dana</span>
                      <div id="content-quoted-message">Earlier context.</div>
                    </div>
                  </div>
                  <div id="message-body-thread-message-2">Replica is healthy.</div>
                  <div data-tid="file-chiclet-log" data-message-id="nested-file-id">
                    <a href="https://files.example.com/recovery.log">recovery.log</a>
                  </div>
                  <div
                    data-tid="file-preview-root"
                    title="chart ] draft.png"
                    amspreviewurl="https://files.example.com/chart.png"
                  ></div>
                  <div
                    data-tid="file-preview-root"
                    title="spec ] draft.pdf&#10;https://files.example.com/spec-draft.pdf"
                  ></div>
                  <div
                    data-tid="file-preview-root"
                    title="Unsafe preview"
                    amspreviewurl="javascript:alert(1)"
                  ></div>
                  <div
                    data-tid="file-preview-root"
                    aria-label="Preview fallback.pdf"
                    amspreviewurl="https://files.example.com/preview-fallback.pdf"
                  ><a href="javascript:alert(2)"></a></div>
                  <div
                    data-tid="file-preview-root"
                    aria-label="Title fallback.pdf"
                    title="https://files.example.com/title-fallback.pdf"
                  ><a href="#"></a></div>
                  <div
                    data-tid="file-preview-root"
                    aria-label="Empty-anchor fallback.pdf"
                    amspreviewurl="https://files.example.com/empty-anchor-fallback.pdf"
                  ><a href=""></a></div>
                </div>
              </div>
            </article>
            <article data-tid="channel-replies-pane-message">
              <span id="author-thread-message-3">Hana</span>
              <div data-tid="message-wrapper">
                <div
                  data-track-module-name="messageQuotedReply"
                  data-message-id="nested-tracked-quote-id"
                >
                  <span id="author-tracked-quote">Eli</span>
                  <div id="content-tracked-quote">Tracked-only quote.</div>
                </div>
                <div id="message-body-thread-message-3">Following up.</div>
              </div>
            </article>
          </div>
        </section>
      </body>
    </html>`);
  const threadMarkdown = await page.evaluate(async () => {
    const extractor = await CopyAsMarkdown.loadExtractor('microsoft-teams');
    return extractor.extract();
  });
  assert.match(
    threadMarkdown,
    /# Microsoft Teams · Core Platform · #Incidents · Database recovery/,
  );
  assert.match(threadMarkdown, /## Dana[\s\S]+### ↳ Eli[\s\S]+### ↳ Hana/);
  assert.match(threadMarkdown, /\*\*Time:\*\* 2026-08-29T15:00:00Z/);
  assert.match(threadMarkdown, /\*\*Time:\*\* 2026-08-29T15:05:00Z/);
  assert.match(threadMarkdown, /\*\*Reply to:\*\* Dana: "Earlier context\."/);
  assert.equal(threadMarkdown.match(/Earlier context\./g)?.length, 1);
  assert.match(threadMarkdown, /\*\*Reply to:\*\* Eli: "Tracked-only quote\."/);
  assert.equal(threadMarkdown.match(/Tracked-only quote\./g)?.length, 1);
  assert.match(threadMarkdown, /\[runbook\.pdf\]\(https:\/\/files\.example\.com\/runbook\.pdf\)/);
  assert.match(threadMarkdown, /\[recovery\.log\]\(https:\/\/files\.example\.com\/recovery\.log\)/);
  assert.match(threadMarkdown, /\[chart \\\] draft\.png\]\(https:\/\/files\.example\.com\/chart\.png\)/);
  assert.match(threadMarkdown, /\[spec \\\] draft\.pdf\]\(https:\/\/files\.example\.com\/spec-draft\.pdf\)/);
  assert.match(threadMarkdown, /Unsafe preview/);
  assert.doesNotMatch(threadMarkdown, /javascript:/);
  assert.match(threadMarkdown, /\[Preview fallback\.pdf\]\(https:\/\/files\.example\.com\/preview-fallback\.pdf\)/);
  assert.match(threadMarkdown, /\[Title fallback\.pdf\]\(https:\/\/files\.example\.com\/title-fallback\.pdf\)/);
  assert.match(threadMarkdown, /\[Empty-anchor fallback\.pdf\]\(https:\/\/files\.example\.com\/empty-anchor-fallback\.pdf\)/);
  assert.doesNotMatch(threadMarkdown, /\]\(https:\/\/teams\.cloud\.microsoft\/v2\/#?\)/);

  // Verify Markdown clean/table/srcset/frontmatter regressions and route fixes.
  const coreMdChecks = await page.evaluate(() => {
    const tableHtml = `
      <table>
        <thead><tr><th>Field</th><th>Details</th></tr></thead>
        <tbody>
          <tr>
            <td>See <strong>important</strong> <code>arr[0]</code> details</td>
            <td><div>First</div><div>Second</div><span hidden>secret</span><span data-cam-instance="1">UI</span></td>
          </tr>
        </tbody>
      </table>
      <p>Water is H<sub>2</sub>O and (s)he checked arr[0] at <a href="https://example.com/?filter[status]=open">API</a>.</p>
      <img alt="Photo" srcset="https://cdn.example.com/w_800,f_auto,q_auto/pic.jpg 800w, https://cdn.example.com/w_1600,f_auto,q_auto/pic.jpg 1600w" />
      <dialog>Closed dialog text</dialog>
      <pre data-syntaxhighlighter-params="brush: java; gutter: false">class A {}</pre>
    `;
    const body = CopyAsMarkdown.htmlToMarkdown(tableHtml);
    const full = CopyAsMarkdown.buildPageMarkdown(
      { title: 'API arr[0]', url: 'https://example.com/?filter[status]=open' },
      body,
    );
    return { body, full };
  });
  assert.match(coreMdChecks.body, /\| See \*\*important\*\* `arr\[0\]` details \| First Second \|/);
  assert.doesNotMatch(coreMdChecks.body, /secret|Closed dialog text|\bUI\b/);
  assert.match(coreMdChecks.body, /H_\(2\)O/);
  assert.match(coreMdChecks.body, /\(s\)he checked arr\[0\]/);
  assert.match(coreMdChecks.body, /\[API\]\(https:\/\/example\.com\/\?filter\[status\]=open\)/);
  assert.match(coreMdChecks.full, /url: "https:\/\/example\.com\/\?filter\[status\]=open"/);
  assert.match(coreMdChecks.body, /!\[Photo\]\(https:\/\/cdn\.example\.com\/w_1600,f_auto,q_auto\/pic\.jpg\)/);
  assert.match(coreMdChecks.body, /```java\nclass A \{\}\n```/);

  // Verify that conversion keeps content, structure, and meaning in realistic markup.
  const conversionCases = [
    // Whitespace-only inline elements separate words in every container.
    ['<table><tr><th>Developed<span>&nbsp;</span>by</th><td>March<span> </span>9</td></tr></table>', '| Developed by | March 9 |\n| --- | --- |'],
    ['<p>a<b> </b>b <i>x</i><i> </i><i>y</i> a<a href="#x"> b </a>c</p>', 'a b *x* *y* a b c'],
    ['<h2>a<span>&nbsp;</span>b</h2><ul><li>c<span> </span>d</li></ul>', '## a b\n\n- c d'],
    ['<p>a<a href="https://example.com/x"></a>b (<a href="https://example.com/y"></a>).</p>', 'a https://example.com/x b (https://example.com/y).'],
    // Table cells keep superscripts, nested cells, code lines, and empty rows without line break marks.
    ['<table><tr><td>10<sup>5</sup> H<sub>2</sub>O</td><td><p><br></p></td></tr></table>', '| 10^(5) H_(2)O |  |\n| --- | --- |'],
    ['<table><tr><td><table><tr><td>a</td><td>1</td></tr><tr><td>b</td><td>2</td></tr></table></td><td><pre>x:\n  y</pre></td></tr></table>', '| a 1; b 2 | `x:`<br>`  y` |\n| --- | --- |'],
    ['<table><caption>Totals</caption><tr><th>A</th><th>B</th></tr><tr><td colspan="100%">All</td></tr><tr hidden><td>no</td><td>no</td></tr></table>', '*Totals*\n\n| A | B |\n| --- | --- |\n| All |  |'],
    ['<table><tr><td>a<table><tbody hidden><tr><td>no</td></tr></tbody><tr><td>b</td></tr></table></td></tr></table><table><tr hidden><td><pre>no</pre></td></tr></table>', '| a b |\n| --- |'],
    // Lists keep order, numbering, task state, and items outside valid markup.
    ['<ul><li>a<ul><li>b</li></ul>c</li><ul><li>d</li></ul><a href="https://example.com/e">e</a></ul>', '- a\n  - b\n\n  c\n  - d\n- [e](https://example.com/e)'],
    ['<ol reversed><li>c</li><li value="7">b</li><li hidden>no</li><div><li>a</li></div></ol>', '3. c\n7. b\n6. a'],
    ['<ol><a href="https://example.com/a"><li>a</li></a><a href="https://example.com/no"><li hidden>no</li></a><li>b</li></ol>', '1. [a](https://example.com/a)\n2. b'],
    ['<ul><li><input type="checkbox" checked> done</li><li><label><input type="checkbox"> open</label></li></ul>', '- [x] done\n- [ ] open'],
    ['<ul><li><h3>Title</h3><p>One</p><p>Two</p></li></ul>', '- ### Title\n\n  One\n\n  Two'],
    // Code keeps lines that exist only as elements and omits line numbers and controls.
    ['<pre><code><span>a</span><br><span>  b</span><br></code></pre>', '```\na\n  b\n```'],
    ['<pre><code><div><div class="ln" aria-hidden="true">1</div><div>a</div></div><div>b</div></code><button>Copy</button></pre>', '```\na\nb\n```'],
    ['<div class="highlight-source-go"><pre><span class="ln">1</span>a\n<span class="ln">2</span>b</pre></div>', '```go\na\nb\n```'],
    ['<table><caption>L</caption><tr><td><pre>1\n2</pre></td><td><pre>a\nb</pre></td></tr></table>', '*L*\n\n```\na\nb\n```'],
    ['<table><tr><td class="gutter"><pre>7</pre></td><td><pre>a</pre></td></tr></table><table><tr><td>404</td><td><pre>a</pre></td></tr></table><table><tr><td><pre>3\n1</pre></td><td><pre>a\nb</pre></td></tr></table>', '```\na\n```\n\n| 404 | `a` |\n| --- | --- |\n\n| `3`<br>`1` | `a`<br>`b` |\n| --- | --- |'],
    ['<pre><code><div>a</div>\n<div>b</div><div>\n</div><div>c</div><br><div>d</div></code></pre>', '```\na\nb\n\nc\n\nd\n```'],
    ['<pre>$ <code>ls</code> -l</pre>', '```\n$ ls -l\n```'],
    // Math appears once, as TeX when the page has it.
    ['<p><span class="katex"><math><semantics><mi>E</mi><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math><span aria-hidden="true">E=mc2</span></span></p>', '$E=mc^2$'],
    ['<p><math><mfrac><mn>1</mn><msup><mi>x</mi><mn>2</mn></msup></mfrac></math></p>', '1/(x^(2))'],
    ['<p><img class="mwe-math-fallback-image-inline" aria-hidden="true" alt="{\\displaystyle x^{2}}" src="x.svg"></p>', '$x^{2}$'],
    ['<table><tr><td><math alttext="\\frac{a}{b}"><mi>a</mi></math></td></tr></table>', '| $`\\frac{a}{b}`$ |\n| --- |'],
    // Emphasis delimiters stay balanced around adjacent, nested, and block content.
    ['<p><b>a</b><b>b</b> <i>c <em>d</em></i> <code>e</code><code>f</code></p>', '**ab** *c d* `ef`'],
    ['<p><b><i>a</i></b><b><i>b</i></b> <b>c</b><b><i>d</i></b></p>', '***a******b*** **c*d***'],
    ['<b><menu><li>a</li></menu></b><b><h2>Head<a href="#h">#</a></h2></b><p>See <a href="#s">\u00A7</a> 1<a href="#p">\u00B6</a></p>', '- a\n\n## Head\n\nSee \u00A7 1'],
    ['<b><h2>Head</h2></b><strong><p>One</p><p>Two</p></strong><dl><dt><b>Term</b></dt><dd>Text</dd></dl>', '## Head\n\n**One**\n\n**Two**\n\n**Term**\n\n: Text'],
    // Blocks do not absorb the text around them.
    ['Text<hr>more<table><tr><td>a</td></tr></table>after<blockquote>q<footer>Source</footer></blockquote>end', 'Text\n\n---\n\nmore\n| a |\n| --- |\n\nafter\n> q\n> Source\n\nend'],
    ['<details><summary>Sum</summary>body</details><header>H</header><address>A</address><p hidden="until-found">shown</p>', 'Sum\nbody\n\nH\n\nA\n\nshown'],
    ['<svg><style>.a{fill:red}</style><text>A</text><text>B</text></svg><p><ruby>\u6F22\u5B57<rt>kanji</rt></ruby> <q>x</q></p>', 'A B\n\u6F22\u5B57(kanji) "x"'],
    ['<ul><li><blockquote><pre>\u201Ca\u201D</pre></blockquote></li></ul><p>\u201Cb\u201D</p>', '- > ```\n  > \u201Ca\u201D\n  > ```\n\n"b"'],
    ['<img alt="x" src="data:image/png;base64,AA" data-src="https://example.com/a.png">', '![x](https://example.com/a.png)'],
  ];
  const unicodeCases = {
    literal: [
      'x\u00B2 10\u207B\u2079 2\u00BD CO\u2082 1\u00BA Java\u2122 \u2460\u2461', // superscripts, fractions, and circled numbers
      'it\u00B4s \u00AF\\_(\u30C4)_/\u00AF \u3042\u309B', // spacing accents
      '\u0E19\u0E49\u0E33 \u0E99\u0EC9\u0EB3 \u0EDC', // Thai and Lao
      '\u314B\u314B\u314B \u3160\u3160', // Hangul letters
      '\u0627\u0644\u0633\u064E\u0651\u0644\u064E\u0627\u0645 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645 \u0647\u200D.\u0642 \u06F1\u06F0\u200C\u0633\u0627\u0644\u0647', // Arabic and Persian
      '\u05D0\u05B2\u05E0\u05B4\u05D9', // Hebrew
      '\u0915\u094D\u200D\u0937 \u0D28\u0D4D\u200D \u09B6\u09CD\u09B0\u09C0', // Indic joiners
      '\u2764\uFE0F 1\uFE0F\u20E3 \uD83C\uDFF3\uFE0F\u200D\uD83C\uDF08 \uD83D\uDC69\uD83C\uDFFD\u200D\uD83D\uDCBB \uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66 \uD83E\uDD37\uD83C\uDFFD\u200D\u2640\uFE0F \uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F', // emoji sequences
      'x\u0304 Ti\u1EBFng Vi\u1EC7t', // Latin with combining marks
    ],
    stripped: [
      ['a\u200Db', 'ab'],
      ['\u4E2D\u200C\u6587', '\u4E2D\u6587'],
      ['\u0441\u200D\u043B', '\u0441\u043B'],
      ['a\uFE0Fb', 'ab'],
      ['\uD83D\uDE00\uFE0F\uFE0F\uDB40\uDD00', '\uD83D\uDE00\uFE0F'],
      ['a\uDB40\uDC62', 'a'],
      ['5\u203210\u2033', '5\'10"'],
    ],
  };
  const conversionResults = await page.evaluate((htmlCases, textCases) => ({
    html: htmlCases.map((html) => CopyAsMarkdown.htmlToMarkdown(html)),
    text: textCases.map((text) => CopyAsMarkdown.normalizeUnicodeText(text)),
    xhtml: CopyAsMarkdown.domToMarkdown(new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>T</h1><ul><li>a</li></ul><script>no()</script></body></html>',
      'application/xhtml+xml',
    ).documentElement),
    metadata: CopyAsMarkdown.buildPageMarkdown({ title: '%T', license: 'MIT', author: 'Ann' }, 'Ann will commit.'),
  }), conversionCases.map(([html]) => html), [...unicodeCases.literal, ...unicodeCases.stripped.map(([text]) => text)]);
  conversionCases.forEach(([html, expected], index) => assert.equal(conversionResults.html[index], expected, html));
  assert.deepEqual(conversionResults.text, [...unicodeCases.literal, ...unicodeCases.stripped.map(([, text]) => text)]);
  assert.equal(conversionResults.xhtml, '# T\n\n- a');
  assert.equal(conversionResults.metadata, '---\ntitle: "%T"\nlicense: MIT\n---\n\nAnn will commit.');

  // Verify that noise removal keeps section content and dates keep their day in every time zone.
  await page.emulateTimezone('America/Los_Angeles');
  await page.setContent(`<!doctype html><html><head><meta name="generator" content="Ghost 5"></head><body>
    <h1 class="gh-article-title">Post</h1><time datetime="2024-03-05">x</time>
    <div class="gh-content"><header><h1>Post</h1></header>
      <section><header><h2>Install</h2></header><p>Steps</p></section><footer>Chrome</footer>
    </div></body></html>`);
  const ghostMarkdown = await page.evaluate(async () => (await CopyAsMarkdown.loadExtractor('ghost')).extract());
  assert.match(ghostMarkdown, /\*\*Published:\*\* March 5, 2024\n\n## Install\n\nSteps$/);

  // Verify linear-time link spacing without polynomial backtracking on repeated unclosed brackets/links.
  const linkSpacingChecks = await page.evaluate(() => {
    const glued = CopyAsMarkdown.cleanMarkdown('see[docs](https://example.com)now and mail[team](mailto:a@b.com)today');
    const repeatedOpen = '0['.repeat(20000);
    const repeatedLink = '0[a](http:'.repeat(10000);
    const start = performance.now();
    const openOut = CopyAsMarkdown.cleanMarkdown(repeatedOpen);
    const linkOut = CopyAsMarkdown.cleanMarkdown(repeatedLink);
    const elapsedMs = performance.now() - start;
    return {
      glued,
      openMatches: openOut === repeatedOpen,
      linkMatches: linkOut === repeatedLink,
      elapsedMs,
    };
  });
  assert.equal(linkSpacingChecks.glued, 'see [docs](https://example.com) now and mail [team](mailto:a@b.com) today');
  assert.equal(linkSpacingChecks.openMatches, true);
  assert.equal(linkSpacingChecks.linkMatches, true);
  assert.ok(linkSpacingChecks.elapsedMs < 1000, `Expected linear-time cleanMarkdown, took ${linkSpacingChecks.elapsedMs}ms`);

  // Verify catalog routing fixes (Microsoft Copilot not shadowed by Microsoft 365, Sentry EU orgs, W&B subdomains).
  const routedExtractors = await library.loadExtractors([
    'microsoft-office',
    'microsoft-copilot',
    'sentry',
    'wandb',
  ]);
  const fullMatcher = library.createExtractorMatcher({ extractors: routedExtractors });
  assert.equal(fullMatcher.match({ url: 'https://m365.cloud.microsoft/chat' })?.name, 'Microsoft Copilot');
  assert.equal(fullMatcher.match({ url: 'https://de.sentry.io/organizations/acme/issues/12345/' })?.name, 'Sentry');
  assert.equal(fullMatcher.match({ url: 'https://acme.wandb.ai/team/proj/runs/abc123' })?.name, 'Weights & Biases');
} finally {
  await browser.close();
}

console.log('✅ Standalone library matching and DOM conversion checks passed');
