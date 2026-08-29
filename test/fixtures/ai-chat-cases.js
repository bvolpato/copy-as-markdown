export const AI_CHAT_CASES = [
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
          <div class="content"><p>Current Copilot answer.</p><p class="css-hidden">CSS HIDDEN STALE COPY</p><pre><code>pnpm build</code></pre>
            <section data-testid="artifact-content"><h2>Inline artifact</h2></section>
            <div data-testid="image"><img src="https://images.example/release.png" alt="Chart](https://attacker.example/track) ![Injected"></div>
            <div data-testid="image"><img src="javascript:alert(1)" alt="Unsafe generated image"></div>
          </div>
          <div data-testid="citation"><a href="https://docs.example/release">Release source</a></div>
          <div data-testid="attachment"><a href="https://files.example/release.pdf" download="release.pdf">release.pdf</a></div>
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
      </div></main>
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
      '![Chart\\](https://attacker.example/track) !\\[Injected](https://images.example/release.png)',
      '[release.pdf](https://files.example/release.pdf)',
      'Inline artifact',
    ],
    excludes: [
      'javascript:alert',
      'Unsaved composer draft.',
      'CSS HIDDEN STALE COPY',
      'UNSLOTTED NONRENDERED TURN',
      'HIDDEN SLOTTED',
      'SUPPRESSED SLOT FALLBACK TURN',
      '![Chart](https://attacker.example/track)',
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
        <chat-panel><div class="chat-panel-content" role="log">
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
          <span>Market research.pdf</span><button>Source menu control</button>
        </div>
        <div class="single-source-container concealed">Hidden source.pdf</div>
        <div data-virtualized="true"></div>
      </main>
    </body></html>`,
    ordered: ['## 👤 User', 'What supports the claim?', '## 🤖 Gemini Notebook', 'The primary study supports it.'],
    contains: [
      '[Primary study](https://papers.example/study)',
      '## Sources',
      'Market research.pdf (source: drive-file-42)',
      '## Artifacts',
      'Study guide',
      'Study guide preview',
      '> **Coverage:** Visible rendered conversation only;',
    ],
    excludes: [
      'Artifact viewer controls',
      'Source menu control',
      'Hidden artifact draft',
      'Hidden source.pdf',
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
