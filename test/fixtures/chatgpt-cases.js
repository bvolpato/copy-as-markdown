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
];
