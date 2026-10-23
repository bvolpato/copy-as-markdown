const BACKTICK = String.fromCharCode(96);
const fourBackticks = BACKTICK.repeat(4);
const fiveBackticks = BACKTICK.repeat(5);
const threeBackticks = BACKTICK.repeat(3);

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const completeSource = [
  `const literal = "${fourBackticks}";`,
  'if (value < limit && ready) return "A&B";',
  'const path = "src/query.ts";',
].join('\n');

const diffSource = [
  'diff --git a/src/parse.ts b/src/parse.ts',
  '--- a/src/parse.ts',
  '+++ b/src/parse.ts',
  '@@ -1,2 +1,3 @@',
  '-const mode = "legacy";',
  '+const mode = "strict";',
  '+const label = "Parser";',
].join('\n');

export const BITBUCKET_CASES = [
  {
    id: 'bitbucket-complete-blob',
    name: 'Bitbucket',
    url: 'https://bitbucket.org/acme/renderer/src/main/src/query.ts',
    head: '<meta property="og:title" content="query.ts | Bitbucket">',
    html: `<main>
      <div data-testid="source-code"><pre>${escapeHtml(completeSource)}</pre></div>
      <div data-testid="file-actions"><button>Open file actions</button></div>
    </main>`,
    expected: [
      '# acme/renderer/query.ts',
      `## File Contents\n\n${fiveBackticks}ts\n${completeSource}\n${fiveBackticks}`,
    ],
    excluded: ['Open file actions', 'File is not fully rendered by Bitbucket.'],
    ordered: [
      '## File Contents',
      `${fiveBackticks}ts`,
      `const literal = "${fourBackticks}";`,
      'if (value < limit && ready) return "A&B";',
      `${fiveBackticks}`,
    ],
    occurrences: { 'const path = "src/query.ts";': 1 },
  },
  {
    id: 'bitbucket-truncated-blob',
    name: 'Bitbucket',
    url: 'https://bitbucket.org/acme/renderer/src/main/config/settings.json',
    head: '<meta property="og:title" content="settings.json | Bitbucket">',
    html: `<main>
      <div data-testid="source-code"><pre>{"visible": true}</pre></div>
      <div data-testid="source-file-truncated">Only the first lines are shown in this fixture.</div>
    </main>`,
    expected: [
      '# acme/renderer/settings.json',
      '```json\n{"visible": true}\n```',
      '*File is not fully rendered by Bitbucket.*',
    ],
    excluded: ['Only the first lines are shown in this fixture.'],
    ordered: [
      '```json',
      '{"visible": true}',
      '*File is not fully rendered by Bitbucket.*',
    ],
  },
  {
    id: 'bitbucket-issue-discussion',
    name: 'Bitbucket',
    url: 'https://bitbucket.org/acme/renderer/issues/248',
    head: '<meta property="og:title" content="Parser flags follow-up | Bitbucket">',
    html: `<main>
      <div data-testid="issue-status">Open</div>
      <a data-testid="author-name">Morgan Lee</a>
      <time datetime="2026-10-12T09:30:00Z"></time>
      <section data-testid="issue-description">
        <p>Track the rendered parser behavior.</p>
        <button>Edit description</button>
      </section>
      <article data-testid="comment">
        <a data-testid="author-name">Priya Rao</a>
        <time datetime="2026-10-13T11:45:00Z"></time>
        <div data-testid="comment-content">
          <p>Preserve <strong>quoted strings</strong> and ordered steps.</p>
          <ol><li>Keep the source text.</li><li>Drop action controls.</li></ol>
          <button>Reply</button><div class="comment-actions">Report this comment</div>
        </div>
      </article>
      <article data-testid="comment">
        <a data-testid="author-name">Duplicate reviewer</a>
        <div data-testid="comment-content">
          <p>Preserve <strong>quoted strings</strong> and ordered steps.</p>
          <ol><li>Keep the source text.</li><li>Drop action controls.</li></ol>
        </div>
      </article>
      <article data-testid="comment">
        <a data-testid="author-name">Description echo</a>
        <div data-testid="comment-content"><p>Track the rendered parser behavior.</p></div>
      </article>
    </main>
    <aside>Unrelated repository navigation</aside>`,
    expected: [
      '# Issue #248: Parser flags follow-up',
      '**Status:** Open',
      '**Author:** Morgan Lee',
      '**Created:** 2026-10-12T09:30:00Z',
      '## Description\n\nTrack the rendered parser behavior.',
      '## Comments',
      '### Priya Rao (2026-10-13T11:45:00Z)',
      'Preserve **quoted strings** and ordered steps.',
      '1. Keep the source text.\n2. Drop action controls.',
    ],
    excluded: [
      'Edit description', 'Reply', 'Report this comment', 'Duplicate reviewer',
      'Description echo', 'Unrelated repository navigation',
    ],
    ordered: [
      '# Issue #248: Parser flags follow-up',
      '**Status:** Open',
      '**Author:** Morgan Lee',
      '## Description',
      'Track the rendered parser behavior.',
      '## Comments',
      '### Priya Rao (2026-10-13T11:45:00Z)',
      'Preserve **quoted strings** and ordered steps.',
    ],
    occurrences: {
      'Track the rendered parser behavior.': 1,
      'Preserve **quoted strings** and ordered steps.': 1,
      '## Comments': 1,
    },
  },
  {
    id: 'bitbucket-pull-request-diff',
    name: 'Bitbucket',
    url: 'https://bitbucket.org/acme/renderer/pull-requests/73/diff',
    head: '<meta property="og:title" content="Strict parser rollout | Bitbucket">',
    html: `<main>
      <div data-testid="pull-request-status">Open</div>
      <a data-testid="author-name">Morgan Lee</a>
      <time datetime="2026-10-14T16:05:00Z"></time>
      <span data-testid="source-branch">feature/strict-parser</span>
      <span data-testid="destination-branch">main</span>
      <section data-testid="pull-request-description"><p>Switch parsing to strict mode.</p></section>
      <section data-testid="diff-file">
        <a data-testid="file-path">src/parse.ts</a>
        <button>Open diff menu</button>
        <pre data-testid="diff-content">${diffSource}</pre>
      </section>
      <nav>Files changed navigation</nav>
    </main>`,
    expected: [
      '# Pull Request #73: Strict parser rollout',
      '**Status:** Open',
      '**Author:** Morgan Lee',
      '**Created:** 2026-10-14T16:05:00Z',
      '**Source:** `feature/strict-parser`',
      '**Target:** `main`',
      '## Description\n\nSwitch parsing to strict mode.',
      `## Changes\n\n### src/parse.ts\n\n${threeBackticks}diff\n${diffSource}\n${threeBackticks}`,
    ],
    excluded: ['Open diff menu', 'Files changed navigation'],
    ordered: [
      '# Pull Request #73: Strict parser rollout',
      '**Status:** Open',
      '**Author:** Morgan Lee',
      '**Source:** `feature/strict-parser`',
      '**Target:** `main`',
      '## Description',
      '## Changes',
      '### src/parse.ts',
      'diff --git a/src/parse.ts b/src/parse.ts',
      '+const label = "Parser";',
    ],
    occurrences: { '+const mode = "strict";': 1, 'diff --git a/src/parse.ts b/src/parse.ts': 1 },
  },
];
