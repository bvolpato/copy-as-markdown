function currentTurn(index, question, answer) {
  return `<div style="height: 500px; margin-top: 12px;">
    <div data-turn-key="turn-${index}"><div data-content-search-turn-key="fallback-turn-${index}">
      <div role="separator" data-markdown-copy="exclude">Private date separator</div>
      <div data-talvt-turn-state="complete"><div class="block-BQZwFn">
        <h4 class="sr-only">You said:</h4>
        <div data-chatgpt-search-unit-key="fallback-turn-${index}:0:user" data-chatgpt-search-message-ids="user-${index}">
          <div data-content-search-unit-key="fallback-turn-${index}:0:user">
            <div data-user-message-bubble="true"><div data-search-result-target>
              <div class="text-size-chat whitespace-pre-wrap" dir="auto">${question}</div>
            </div></div>
            <div class="turn-action-controls"><button>Copy message</button><button>Edit message</button></div>
          </div>
        </div>
      </div><div class="block-BQZwFn">
        <span hidden data-chatgpt-agent-turn-start></span>
        <div class="group/activity-header"><button aria-expanded="false"></button><span>Worked for 19s</span></div>
      </div><div class="block-BQZwFn">
        <div data-content-search-unit-key="fallback-turn-${index}:2:assistant"
             data-chatgpt-search-unit-key="fallback-turn-${index}:2:assistant"
             data-chatgpt-search-message-ids="assistant-${index} assistant-${index}">
          <h4 class="sr-only" data-conversation-role="assistant">ChatGPT said:</h4>
          <div data-chatgpt-selection-message-id="assistant-${index}">
            <div data-markdown-text-style="assistant-message" class="MarkdownRoot-rZKhxa" dir="auto">
              <div data-dil-source-message-id="assistant-${index}" data-chatgpt-copy-reference="0" data-markdown-copy="contents">
                <div class="Renderer-ojZscX"><div data-dil-message-id="assistant-${index}">${answer}</div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="turn-action-controls"><button>Read aloud</button><button>Regenerate response</button></div>
      </div></div>
    </div></div>
  </div>`;
}

export const CHATGPT_CASES = [
  {
    id: 'chatgpt',
    extractor: 'ChatGPT',
    url: 'https://chatgpt.com/c/current-renderer',
    html: `<!doctype html><html><head><title>Parser discussion - ChatGPT</title></head><body>
      <style>.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; }</style>
      <main data-app-shell-main-surface="browser">
        <header data-app-shell-titlebar="true"><button>Share conversation</button></header>
        <div class="thread-scroll-container" role="region" aria-label="Conversation">
          <div data-chatgpt-conversation-selection-target="true" data-thread-find-target="conversation">
            <div role="status"><span class="sr-only">Loading older messages…</span></div>
            ${currentTurn(0, 'Explain the parser.', `
              <p data-d-component="text">Use <span data-d-default-strong data-d-inline>semantic markers</span> for each message.</p>
              <h2 data-d-component="title">Supported formats</h2>
              <div data-d-component="table"><table><tbody>
                <tr><th><p>Format</p></th><th><p>Example</p></th></tr>
                <tr><td><p><span data-d-default-strong data-d-inline>Code</span></p></td><td><p><code data-d-component="code">a | b</code></p></td></tr>
                <tr><td><p>Link</p></td><td><p><a href="https://docs.example/parser"><span>Parser docs</span><span><svg><path></path></svg></span></a></p></td></tr>
              </tbody></table></div>
              <ul data-d-component="list"><li><div><p>Keep <span data-d-default-strong>list formatting</span>.</p></div></li></ul>
              <pre><code class="language-ts">const ready = true;</code></pre>
              <p>See the reference. <span role="button" data-d-component="popover-trigger"><span data-d-inline>
                <div data-d-component="badge"><div data-d-component="favicon"><img src="https://www.google.com/s2/favicons?domain=docs.example"></div><div>Docs reference</div><div>+1</div></div>
              </span></span></p>
              <span data-d-component="caption">Caption text survives.</span>
              <div data-d-component="grid"><div data-d-component="grid-item"><h1>8 workers</h1><p>Parser capacity</p></div></div>
              <div data-markdown-copy="exclude">Excluded renderer control</div>
              <div hidden>Hidden stale answer</div>
            `)}
            ${currentTurn(1, 'Explain the parser.', '<p data-d-component="text">The second answer stays separate.</p>')}
          </div>
          <div data-markdown-copy="exclude">ChatGPT is AI and can make mistakes.</div>
        </div>
        <div data-thread-scroll-footer="true"><form data-chatgpt-composer>
          <div contenteditable="true" data-composer-markdown aria-label="Ask ChatGPT">Unsent composer draft.</div>
        </form></div>
      </main>
    </body></html>`,
    ordered: [
      '# Parser discussion', '## 👤 User', 'Explain the parser.', '## 🤖 Assistant',
      'Use **semantic markers**', '## 👤 User', 'Explain the parser.', '## 🤖 Assistant',
      'The second answer stays separate.',
    ],
    contains: [
      '| Format | Example |',
      '| **Code** | `a \\| b` |',
      '[Parser docs](https://docs.example/parser)',
      '- Keep **list formatting**.',
      '```ts\nconst ready = true;\n```',
      'Docs reference',
      'Caption text survives.',
      '# 8 workers',
      '> **Coverage:** Visible rendered conversation only; older or virtualized history was not loaded.',
    ],
    excludes: [
      'You said:', 'ChatGPT said:', 'Worked for 19s', 'Loading older messages',
      'Copy message', 'Edit message', 'Read aloud', 'Regenerate response',
      'Private date separator', 'Unsent composer draft.', 'Share conversation',
      'ChatGPT is AI and can make mistakes.', 'Excluded renderer control', 'Hidden stale answer',
      'https://www.google.com/s2/favicons',
    ],
    occurrences: { '## 👤 User': 2, '## 🤖 Assistant': 2, 'Explain the parser.': 2, 'const ready = true;': 1 },
  },
  {
    id: 'chatgpt',
    extractor: 'ChatGPT',
    url: 'https://chatgpt.com/share/mixed-renderers',
    html: `<!doctype html><html><head><title>Shared parser - ChatGPT</title></head><body><main>
      <h1>Shared parser</h1>
      <section data-testid="conversation-turn-1" data-turn="user"><div data-message-author-role="user"><div class="whitespace-pre-wrap">Legacy question.</div></div></section>
      <section data-testid="conversation-turn-2" data-turn="assistant"><div data-message-author-role="assistant"><div class="markdown"><p>Legacy answer.</p></div></div></section>
      <section data-testid="conversation-turn-3" data-turn="assistant"><div data-message-author-role="assistant"><div data-markdown-text-style="assistant-message"><p>Nested current answer.</p></div></div></section>
      ${currentTurn(4, 'Current question.', '<p>Current answer.</p>')}
    </main></body></html>`,
    ordered: ['Legacy question.', 'Legacy answer.', 'Nested current answer.', 'Current question.', 'Current answer.'],
    contains: ['# Shared parser'],
    excludes: ['You said:', 'ChatGPT said:', 'Worked for 19s', 'Private date separator'],
    occurrences: { '## 👤 User': 2, '## 🤖 Assistant': 3, 'Nested current answer.': 1 },
  },
  {
    id: 'chatgpt',
    extractor: 'ChatGPT',
    url: 'https://chatgpt.com/c/fully-rendered',
    html: `<!doctype html><html><head><title>Complete parser - ChatGPT</title></head><body><main>
      ${currentTurn(0, 'One question.', '<p>One answer.</p>')}
    </main></body></html>`,
    ordered: ['## 👤 User', 'One question.', '## 🤖 Assistant', 'One answer.'],
    contains: [
      '> **Coverage:** Visible rendered conversation only; unloaded page history is not included.',
    ],
    excludes: ['older or virtualized history was not loaded'],
    occurrences: { '## 👤 User': 1, '## 🤖 Assistant': 1 },
  },
  {
    id: 'chatgpt',
    extractor: 'ChatGPT',
    url: 'https://chatgpt.com/share/transcript-renderer',
    html: `<!doctype html><html><head><title>Transcript parser</title><meta property="og:title" content="Check out this chat"></head><body><main>
      <ol data-conversation-transcript>
        <li data-message-role="user"><div data-transcript-spacer aria-hidden="true"></div></li>
        <li data-message-role="user"><h4 aria-label="You said:">You said:</h4>
          <div data-user-message-bubble><p data-user-message-copy style="white-space: pre-wrap">def f():
    return 1</p></div></li>
        <li data-message-role="assistant"><h4 aria-label="ChatGPT said:">ChatGPT said:</h4>
          <div data-assistant-markdown-root>
            <div data-assistant-reasoning-summary>Worked for 26s</div>
            <h1>Answer heading</h1>
            <p>Cost is <span data-assistant-math-rendered="inline"><span class="katex"><math><semantics><mrow><mi>O</mi><msup><mi>n</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">O(n^2)</annotation></semantics></math></span></span>.</p>
            <div><div><button>Copy code</button></div><div><span>json</span></div><pre><code data-code-language="json">{}</code></pre></div>
          </div></li>
      </ol>
    </main></body></html>`,
    ordered: [
      '# Transcript parser', '## 👤 User', 'def f():\n    return 1',
      '## 🤖 Assistant', '# Answer heading', 'Cost is $O(n^2)$.', '```json\n{}\n```',
    ],
    contains: ['older or virtualized history was not loaded'],
    excludes: ['Check out this chat', 'said:', 'Worked for', 'Copy code', '\njson\n'],
  },
  {
    id: 'chatgpt',
    extractor: 'ChatGPT',
    url: 'https://chatgpt.com/c/tool-calls',
    html: `<!doctype html><html><head><title>Tool calls - ChatGPT</title></head><body>
      <nav><button aria-label="New folder"></button></nav><main>
      <section data-testid="conversation-turn-1" data-turn="user"><h5 class="sr-only">You said:</h5>
        <div data-message-author-role="user"><button aria-label="Open image"><img alt="Uploaded image" src="https://images.example/upload.png"></button></div></section>
      <section data-testid="conversation-turn-2" data-turn="assistant">
        <div data-message-author-role="assistant" data-message-id="1"><div class="markdown"><p>Preamble.</p></div></div>
        <div>Searched the web</div>
        <div style="display: none"><div data-message-author-role="assistant"><div class="markdown"><p>Hidden answer.</p></div></div></div>
        <div data-message-author-role="assistant"><div data-message-author-role="assistant" data-message-id="2"><div class="markdown"><p>Final answer for <span role="math" data-math-source="h_r"><span class="katex"><span class="katex-html" aria-hidden="true">hr</span></span></span>.
          <span data-testid="webpage-citation-pill"><a href="https://docs.example/a"><img alt="" src="https://www.google.com/s2/favicons?domain=docs.example">Docs</a></span><sup><a href="#fn-1">1</a></sup></p></div></div></div>
        <button aria-label="Previous response"></button></section>
    </main></body></html>`,
    ordered: [
      '## 👤 User', '![Uploaded image](https://images.example/upload.png)',
      '## 🤖 Assistant', 'Preamble.', 'Final answer for $h_r$.', '### Sources', '- [Docs](https://docs.example/a)',
    ],
    contains: ['unloaded page history is not included'],
    excludes: ['You said:', 'favicons', '#fn-1', 'older or virtualized history', 'Hidden answer.'],
    occurrences: { '## 🤖 Assistant': 1, '### Sources': 1, 'Final answer': 1 },
  },
];
