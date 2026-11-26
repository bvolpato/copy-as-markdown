import { CHATGPT_CASES } from './chatgpt-cases.js';

export const AI_CHAT_CASES = [
  ...CHATGPT_CASES,
  ...['app/fixture', 'share/fixture', 'app'].map((route) => ({
    id: 'gemini',
    extractor: 'Gemini',
    url: `https://gemini.google.com/${route}`,
    html: `<!doctype html><html><head><title>Repeated turns - Gemini</title></head><body><main>
      <conversation-turn>
        <user-query><div class="query-text-line">Repeated question.</div></user-query>
        <model-response><div class="markdown markdown-main-panel"><p>Repeated answer.</p></div></model-response>
      </conversation-turn>
      <conversation-turn>
        <user-query><div class="query-text-line">Repeated question.</div></user-query>
        <model-response><div class="markdown markdown-main-panel"><p>Repeated answer.</p></div></model-response>
      </conversation-turn>
      <textarea>Unsaved composer draft.</textarea>
    </main></body></html>`,
    contains: ['# Repeated turns'],
    excludes: ['Unsaved composer draft.'],
    ordered: ['## 👤 User', 'Repeated question.', '## 🤖 Gemini', 'Repeated answer.', '## 👤 User', 'Repeated question.', '## 🤖 Gemini', 'Repeated answer.'],
    occurrences: { 'Repeated question.': 2, 'Repeated answer.': 2 },
  })),
  ...[
    ['gemini', 'Gemini', 'https://gemini.google.com/app/fixture'],
    ['claude', 'Claude', 'https://claude.ai/chat/fixture'],
    ['grok', 'Grok', 'https://grok.com/c/fixture'],
    ['meta-ai', 'Meta AI', 'https://www.meta.ai/c/fixture'],
    ['perplexity', 'Perplexity', 'https://www.perplexity.ai/search/fixture'],
  ].map(([id, extractor, url]) => ({
    id, extractor, url,
    html: `<main>${[0, 1].map(() => `
      <div data-role="user"><div data-role="user"><p>Repeated question.</p></div></div>
      <div data-role="assistant"><div data-role="assistant"><p>Repeated answer.</p></div></div>
    `).join('')}</main>`,
    contains: [],
    ordered: ['Repeated question.', 'Repeated answer.', 'Repeated question.', 'Repeated answer.'],
    occurrences: { 'Repeated question.': 2, 'Repeated answer.': 2 },
  })),
  {
    id: 'gemini',
    extractor: 'Gemini',
    url: 'https://gemini.google.com/share/current-viewer',
    html: `<!doctype html><html><head><title>Gemini - direct access to Google AI</title></head><body><main><share-viewer>
      <h1>Rocket chat</h1>
      <share-turn-viewer>
        <user-query><button><img alt="Uploaded image preview" src="https://images.example/upload.png"></button>
          <div class="query-text"><h5 class="cdk-visually-hidden">You said Draw a rock...</h5><p class="query-text-line">Draw a rocket.</p><p class="query-text-line"><span>    With  fins.</span></p></div></user-query>
        <response-container><model-thoughts><div class="markdown markdown-main-panel"><p>Hidden thoughts.</p></div></model-thoughts>
          <message-content><div class="markdown markdown-main-panel"><p>Here it is.</p>
            <div class="math-block" data-math="r^3"><span class="katex-display"><span class="katex"><math><semantics><msup><mi>r</mi><mn>3</mn></msup><annotation encoding="application/x-tex">r^3</annotation></semantics></math></span></span></div>
            <generated-image><button><img alt=", AI generated" src="https://images.example/rocket.png"></button></generated-image>
            <code-block><div class="code-block-decoration"><span>Python</span><button>Copy</button></div><div><pre><code>launch()</code></pre></div></code-block>
          </div></message-content>
          <message-content style="display: none"><div class="markdown markdown-main-panel"><p>Hidden draft.</p></div></message-content></response-container>
      </share-turn-viewer></share-viewer></main></body></html>`,
    ordered: [
      '# Rocket chat', '## 👤 User', 'Draw a rocket.\n    With  fins.', '![Uploaded image preview](https://images.example/upload.png)',
      '## 🤖 Gemini', 'Here it is.', '$$r^3$$', '```python\nlaunch()\n```', '![, AI generated](https://images.example/rocket.png)',
      '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.',
    ],
    contains: [],
    excludes: ['You said', 'Hidden thoughts.', 'Hidden draft.', 'direct access', '\nPython\n'],
    occurrences: { 'upload.png': 1, 'rocket.png': 1, 'r^3': 1 },
  },
  {
    id: 'gemini',
    extractor: 'Gemini',
    url: 'https://gemini.google.com/share/shared-document',
    html: '<!doctype html><html><head><title>Gemini</title></head><body><main><h1>Design notes</h1><p>Document body.</p></main></body></html>',
    ordered: ['# Design notes', 'Document body.'],
    contains: [],
    excludes: ['**Coverage:**'],
  },
  {
    id: 'grok',
    extractor: 'Grok',
    url: 'https://grok.com/share/current-transcript',
    html: `<!doctype html><html><head><title>Sort check | Shared Grok Conversation</title></head><body><div data-transcript-renderer="plane"><div style="height: 4000px">
      <div data-plane-row="response:1"><div role="article" data-testid="user-message" class="message-bubble"><h2 class="sr-only" data-no-copy="true">You</h2>
        <span data-bubble-text style="white-space: pre-wrap">class A {
  int b;
}</span></div></div>
      <div data-plane-row="response:2"><div role="article" data-testid="assistant-message" class="message-bubble"><h2 class="sr-only" data-no-copy="true">Grok</h2>
        <div class="response-content-markdown"><p>First part.</p><div data-testid="generated-image-row"><button><img alt="Banner" src="https://images.example/banner.png"></button></div><img alt="" aria-hidden="true" src="https://images.example/banner.png"></div>
        <div>Searched</div><div class="response-content-markdown"><p>Second part.</p></div></div></div>
      <div data-plane-row="transcript:bottom-spacing"></div>
    </div></div></body></html>`,
    ordered: [
      '# Sort check', '## 👤 User', 'class A {\n  int b;\n}', '## 🤖 Grok', 'First part.', 'Second part.',
      '![Banner](https://images.example/banner.png)', 'older or virtualized history was not loaded',
    ],
    contains: [],
    excludes: ['Shared Grok', '## You', '## Grok'],
    occurrences: { '## 🤖 Grok': 1, 'banner.png': 1 },
  },
  {
    id: 'grok',
    extractor: 'Grok',
    url: 'https://grok.com/share/complete-transcript',
    html: `<!doctype html><html><head><title>Files | Shared Grok Conversation</title></head><body><div data-transcript-renderer="plane"><div style="height: 612px">
      <div data-plane-row="response:1" style="height: 200px"><div role="article" data-testid="user-message" class="message-bubble">
        <a href="https://files.example/report.pdf">report.pdf</a><span data-bubble-text>Quoted text.</span><span data-bubble-text>Summarize it.</span></div></div>
      <div data-plane-row="response:2" style="height: 200px"><div role="article" data-testid="assistant-message" class="message-bubble">
        <div class="response-content-markdown"><table><tbody><tr><th>Form</th></tr><tr><td><span class="katex"><math><semantics><mi>a</mi><annotation encoding="application/x-tex">\\frac{a}{b} | x</annotation></semantics></math></span></td></tr></tbody></table></div>
        <div style="display: none"><div class="response-content-markdown"><p>Earlier answer.</p></div></div></div></div>
      <div data-plane-row="transcript:bottom-spacing"></div>
    </div></div></body></html>`,
    ordered: [
      '[report.pdf](https://files.example/report.pdf)', 'Quoted text.', 'Summarize it.',
      '| $\\frac{a}{b} \\| x$ |', 'unloaded page history is not included',
    ],
    contains: [],
    excludes: ['Earlier answer.'],
  },
  {
    id: 'grok',
    extractor: 'Grok',
    url: 'https://grok.com/c/shared-container',
    html: `<main><article>${[1, 2].map((turn) => `
      <div data-testid="user-message"><div class="prose">Question ${turn}.</div></div><img alt="Uploaded image" src="https://images.example/upload-${turn}.png">
      <div data-testid="assistant-message"><div class="response-content-markdown"><p>Answer ${turn}.</p></div></div><img alt="Generated image" src="https://images.example/generated-${turn}.png"><sup><a href="https://docs.example/${turn}">Docs ${turn}</a></sup>
    `).join('')}</article></main>`,
    ordered: [1, 2].flatMap((turn) => [
      `Question ${turn}.`, `upload-${turn}.png`, `Answer ${turn}.`, `generated-${turn}.png`, `- [Docs ${turn}]`,
    ]),
    contains: [],
    occurrences: Object.fromEntries([1, 2].flatMap((turn) => [
      [`upload-${turn}.png`, 1], [`generated-${turn}.png`, 1], [`- [Docs ${turn}]`, 1],
    ])),
  },
  {
    id: 'perplexity',
    extractor: 'Perplexity',
    url: 'https://www.perplexity.ai/session/current-session',
    html: `<!doctype html><html><head><title>European founders</title><meta property="og:title" content="Perplexity"><link rel="canonical" href="https://www.perplexity.ai"></head><body><main>
      <div data-workflow-entry="0"><div data-message-bubble="right"><div data-renderer="lm"><p>List founders.</p></div></div></div>
      <div data-workflow-final-text><div>Finished</div><div class="prose" data-renderer="lm"><p>Two founders.
        <span class="citation" data-pplx-citation-url="https://news.example/founders"><span>news</span><span>+1</span></span></p></div></div>
    </main></body></html>`,
    ordered: ['# European founders', '## 👤 User', 'List founders.', '## 🤖 Perplexity', 'Two founders. [news](https://news.example/founders)'],
    contains: ['url: "https://www.perplexity.ai/session/current-session"', '> **Coverage:**'],
    excludes: ['Finished', '+1'],
  },
  {
    id: 'perplexity',
    extractor: 'Perplexity',
    url: 'https://www.perplexity.ai/page/published-page',
    html: `<!doctype html><html><head><title>Perplexity</title></head><body><main><h2>Cable damage</h2>
      <div data-last-section="false"><div class="prose"><h2>What happened</h2></div><div id="markdown-content-0"><p>Two cables broke.</p></div></div>
    </main></body></html>`,
    ordered: ['# Cable damage', '### What happened', 'Two cables broke.'],
    contains: [],
  },
  {
    id: 'claude',
    extractor: 'Claude',
    url: 'https://claude.ai/chat/code-label',
    html: `<!doctype html><html><head><title>Code label - Claude</title></head><body><main>
      <div role="article"><div data-testid="user-message"><div class="standard-markdown"><p>Part one.</p></div><div class="standard-markdown"><p style="white-space: pre-wrap">Open fence:
\`\`\`js
a()</p></div></div></div>
      <div role="article"><div class="standard-markdown"><div><div><button>Copy</button></div><div>python</div><div><pre><code class="language-python">x = 1</code></pre></div></div><p>Done.</p></div></div>
    </main></body></html>`,
    ordered: ['## 👤 User', 'Part one.', '```js\na()\n```', '## 🤖 Claude', '```python\nx = 1\n```', 'Done.', '> **Coverage:**'],
    contains: [],
    excludes: ['\npython\n'],
    occurrences: { '## 👤 User': 1, '## 🤖 Claude': 1 },
  },
  {
    id: 'deepseek',
    extractor: 'DeepSeek',
    url: 'https://chat.deepseek.com/a/chat/s/answer-heading',
    html: `<!doctype html><html><head><title>Fraction help - DeepSeek</title></head><body><main>
      <div class="ds-message _63c77b1"><div class="d29f3d7d">Explain.</div></div>
      <div class="ds-message _63c77b1"><div class="_4f9bf79 _43c05b5"><div class="ds-markdown"><h1>Answer heading</h1>
        <p>Use <span class="katex"><span class="katex-mathml"><math><semantics><mfrac><mi>a</mi><mi>b</mi></mfrac><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">ab</span></span>.<sup><a href="#fn1">1</a></sup></p>
        <div><div class="md-code-block-banner-wrap"><span>python</span><button>Copy</button></div><pre><span>print(1)</span></pre></div></div></div></div>
    </main></body></html>`,
    ordered: ['# Fraction help', 'Explain.', '# Answer heading', 'Use $\\frac{a}{b}$.', '```python\nprint(1)\n```'],
    contains: ['title: Fraction help'],
    excludes: ['### Sources', '\npython\n'],
  },
  {
    id: 'meta-ai',
    extractor: 'Meta AI',
    url: 'https://www.meta.ai/c/answer-heading',
    html: `<!doctype html><html><head><title>Trip plan - Meta AI</title></head><body><main><div data-testid="message">
      <div data-testid="user-message">Plan a trip.</div>
      <div data-testid="assistant-message"><div class="markdown"><h1>Day one</h1></div><img alt="Generated map" src="https://images.example/map.png"><button aria-label="Previous image"></button></div>
    </div></main></body></html>`,
    ordered: ['# Trip plan', 'Plan a trip.', '## 🤖 Meta AI', '# Day one', '![Generated map](https://images.example/map.png)'],
    contains: ['unloaded page history is not included'],
    excludes: [],
    occurrences: { 'map.png': 1 },
  },
  {
    id: 'microsoft-copilot',
    extractor: 'Microsoft Copilot',
    url: 'https://copilot.microsoft.com/shares/pages/example-page',
    setup: 'copilot-open-shadow',
    html: `<!doctype html><html><head><title>Release notes - Microsoft Copilot</title></head><body>
      <main data-testid="share-page"><div data-content="conversation"><style>.css-hidden { display: none; }</style>
        <h1 data-testid="conversation-title">Release notes</h1>
        <div data-testid="user-message">
          <div data-testid="message-content" contenteditable="true"><p>First standalone prompt.</p></div>
        </div>
        <div data-testid="composer" contenteditable="true">Unsaved composer draft.</div>
        <cib-message-group source="bot">
          <div class="content"><p>Current Copilot answer.</p><p><a href="https://docs.example/inline)![Injected](https://attacker.example/inline">Inline escaped link</a></p><p class="css-hidden">CSS HIDDEN STALE COPY</p><pre><code>pnpm build</code></pre>
            <section data-testid="artifact-content"><h2>Inline artifact</h2></section>
            <div data-testid="image"><img src="https://images.example/release.png" alt="Chart](https://attacker.example/track) ![Injected"></div>
            <div data-testid="image"><img src="https://images.example/release.png)![Injected](https://attacker.example/image" alt="Escaped generated image"></div>
            <div data-testid="image"><img src="javascript:alert(1)" alt="Unsafe generated image"></div>
          </div>
          <div data-testid="citation"><a href="https://docs.example/release">Release source</a></div>
          <div data-testid="citation"><a href="https://docs.example/citation)![Injected](https://attacker.example/citation">Escaped citation</a></div>
          <div data-testid="attachment"><a href="https://files.example/release.pdf" download="release.pdf">release.pdf</a></div>
          <div data-testid="attachment"><a href="https://files.example/attachment)![Injected](https://attacker.example/attachment" download="attachment.txt">Escaped attachment</a></div>
        </cib-message-group>
        <div data-content="message" data-author="user"><div data-testid="message-content">Current topology follow-up.</div></div>
        <cib-message id="shadow-turn" type="bot"></cib-message>
        <div data-content="message" data-author="bot"><div data-testid="message-content">Data-author bot answer.</div></div>
        <div id="slot-conversation-host">
          <div slot="assistant" data-content="message" data-author="bot"><div data-testid="message-content">Slotted assistant answer.</div></div>
          <div slot="user" data-content="message" data-author="user"><div data-testid="message-content">Slotted user prompt.</div></div>
          <div data-content="message" data-author="bot"><div data-testid="message-content">UNSLOTTED NONRENDERED TURN</div></div>
          <div slot="hidden" data-content="message" data-author="bot"><div data-testid="message-content">HIDDEN SLOTTED</div></div>
        </div>
        <div id="text-slot-host">Assigned plain text.</div>
        <div id="shadow-artifact"></div>
      </div><aside aria-label="Unrelated virtualized picker"><div data-virtualized="true"></div></aside></main>
    </body></html>`,
    ordered: [
      '## 👤 User',
      'First standalone prompt.',
      '## 🤖 Copilot',
      'Current Copilot answer.',
      'Current topology follow-up.',
      'Open shadow answer.',
      'Nested open shadow body.',
      'Data-author bot answer.',
      'Slotted user prompt.',
      'Slotted assistant answer.',
      '## Artifacts',
      'Shadow artifact',
    ],
    contains: [
      '```\npnpm build\n```',
      '### Sources',
      '[Release source](https://docs.example/release)',
      '[Inline escaped link](https://docs.example/inline%29![Injected]%28https://attacker.example/inline)',
      '[Escaped citation](https://docs.example/citation%29![Injected]%28https://attacker.example/citation)',
      '![Chart\\](https://attacker.example/track) !\\[Injected](https://images.example/release.png)',
      '![Escaped generated image](https://images.example/release.png%29![Injected]%28https://attacker.example/image)',
      '[release.pdf](https://files.example/release.pdf)',
      '[Escaped attachment](https://files.example/attachment%29![Injected]%28https://attacker.example/attachment)',
      'Inline artifact',
      '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.',
    ],
    excludes: [
      'javascript:alert',
      'Unsaved composer draft.',
      'CSS HIDDEN STALE COPY',
      'UNSLOTTED NONRENDERED TURN',
      'HIDDEN SLOTTED',
      'SUPPRESSED SLOT FALLBACK TURN',
      '![Chart](https://attacker.example/track)',
      'https://docs.example/inline)![Injected](',
      'https://docs.example/citation)![Injected](',
      'https://files.example/attachment)![Injected](',
      'https://images.example/release.png)![Injected](',
      'older or virtualized history was not loaded',
    ],
    occurrences: { 'Inline artifact': 1 },
  },
  {
    id: 'gemini-notebook',
    extractor: 'Gemini Notebook',
    url: 'https://notebook.google.com/notebook/example-notebook',
    html: `<!doctype html><html><head><title>Research notebook - Gemini Notebook</title><style>.concealed { display: none; }</style></head><body>
      <main>
        <h1 data-testid="notebook-title">Research notebook</h1>
        <chat-panel><div class="chat-panel-content" role="log" data-virtualized="true">
        <article class="from-user-container"><div class="query-text">What supports the claim?</div></article>
        <article class="to-user-container">
          <div class="response-content"><p>The primary study supports it.</p></div>
          <div data-testid="source-citation"><a href="https://papers.example/study">Primary study</a></div>
        </article>
        </div></chat-panel>
        <section class="artifact-library-container">
          <button class="artifact-item-button"><span>Study guide</span><span aria-hidden="true">more_vert</span></button>
          <button>Artifact viewer controls</button>
        </section>
        <div class="artifact-viewer-content"><h2>Study guide preview</h2><p>Review the evidence.</p></div>
        <div class="artifact-viewer-content concealed">Hidden artifact draft</div>
        <div class="single-source-container" data-drive-id="drive-file-42">
          <a href="https://drive.example/file)![Injected](https://attacker.example/source">Market research.pdf</a><button>Source menu control</button>
        </div>
        <div class="single-source-container concealed">Hidden source.pdf</div>
      </main>
    </body></html>`,
    ordered: ['## 👤 User', 'What supports the claim?', '## 🤖 Gemini Notebook', 'The primary study supports it.'],
    contains: [
      '[Primary study](https://papers.example/study)',
      '## Sources',
      '[Market research.pdf](https://drive.example/file%29![Injected]%28https://attacker.example/source) (source: drive-file-42)',
      '## Artifacts',
      'Study guide',
      'Study guide preview',
      '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.',
    ],
    excludes: [
      'Artifact viewer controls',
      'Source menu control',
      'Hidden artifact draft',
      'Hidden source.pdf',
      'https://drive.example/file)![Injected](',
    ],
  },
  {
    id: 'mistral-vibe',
    extractor: 'Mistral Vibe',
    url: 'https://chat.mistral.ai/chat/12345678-1234-1234-1234-123456789abc',
    html: `<!doctype html><html><head><title>Quarterly analysis - Vibe</title></head><body>
      <main>
        <h1 data-testid="task-title">Quarterly analysis</h1>
        <div data-testid="conversation-layout">
          <div data-message-id="user-1" data-message-author-role="user"><div data-testid="message-content">Analyze sales.csv.</div></div>
          <div data-message-id="assistant-1" data-message-author-role="assistant"><div data-message-part-type="answer" data-testid="text-message-part"><p>Revenue increased.</p></div></div>
        </div>
        <section data-testid="canvas-content"><div class="canvas-content"><h2>Revenue chart</h2><table><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q4</td><td>42</td></tr></table></div></section>
      </main>
    </body></html>`,
    ordered: ['## 👤 User', 'Analyze sales.csv.', '## 🤖 Mistral', 'Revenue increased.'],
    contains: ['## Artifacts', 'Revenue chart', '| Quarter | Revenue |'],
    occurrences: { 'Revenue chart': 1 },
  },
  {
    id: 'deepseek',
    extractor: 'DeepSeek',
    url: 'https://chat.deepseek.com/a/chat/s/example-chat',
    html: `<!doctype html><html><head><title>Parser review - DeepSeek</title></head><body>
      <main>
        <div class="ds-message _63c77b1"><div class="d29f3d7d _9663006">Review this parser.</div></div>
        <div class="ds-message _63c77b1"><div class="_4f9bf79 _43c05b5"><div class="ds-markdown"><p>Use semantic roles first.</p><pre><code class="language-ts">const role = 'assistant';</code></pre></div></div></div>
      </main>
    </body></html>`,
    ordered: ['## 👤 User', 'Review this parser.', '## 🤖 DeepSeek', 'Use semantic roles first.'],
    contains: ["const role = 'assistant';"],
    occurrences: { 'Use semantic roles first.': 1 },
  },
  {
    id: 'google-ai-studio',
    extractor: 'Google AI Studio',
    url: 'https://aistudio.google.com/apps/12345678-1234-1234-1234-123456789abc',
    html: `<!doctype html><html><head><title>Alien bot - Google AI Studio</title><style>.concealed { display: none; }</style></head><body>
      <main>
        <h1 data-testid="prompt-title" class="concealed">Hidden prompt title</h1>
        <h1 data-testid="prompt-title">Alien bot</h1>
        <div data-model="hidden-model" class="concealed"></div>
        <div data-model="gemini-3.1-pro"></div>
        <textarea aria-label="System instructions" class="concealed">Hidden system prompt.</textarea>
        <textarea aria-label="System instructions">Keep answers concise.</textarea>
        <ms-chat-turn class="concealed"><div data-turn-role="User"></div><ms-text-chunk>Hidden turn.</ms-text-chunk></ms-chat-turn>
        <ms-chat-turn><div data-turn-role="User"></div><ms-text-chunk>Where are you?</ms-text-chunk></ms-chat-turn>
        <ms-chat-turn><div data-turn-role="Model"></div><ms-text-chunk><div contenteditable="true"><p>On Europa.</p></div></ms-text-chunk><ms-text-chunk><p>Second transmission.</p></ms-text-chunk><div class="code-block"><pre><code>const moon = 'Europa';</code></pre></div></ms-chat-turn>
        <div contenteditable="true" data-testid="composer">Unsent AI Studio composer.</div>
        <aside data-testid="artifact-content" class="concealed">Hidden generated app</aside>
        <aside data-testid="artifact-content"><h2>Generated app</h2><pre><code>&lt;main&gt;Europa&lt;/main&gt;</code></pre></aside>
      </main>
    </body></html>`,
    ordered: ['## System instructions', 'Keep answers concise.', '## 👤 User', 'Where are you?', '## 🤖 Model', 'On Europa.', 'Second transmission.', "const moon = 'Europa';"],
    contains: ['**Model:** gemini-3.1-pro', '## Artifacts', 'Generated app', '<main>Europa</main>'],
    excludes: [
      'Hidden prompt title',
      'hidden-model',
      'Hidden system prompt.',
      'Hidden turn.',
      'Unsent AI Studio composer.',
      'Hidden generated app',
    ],
  },
];
