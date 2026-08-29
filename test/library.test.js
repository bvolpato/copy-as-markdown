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
} finally {
  await browser.close();
}

console.log('✅ Standalone library matching and DOM conversion checks passed');
