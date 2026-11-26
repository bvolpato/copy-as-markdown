export const GITHUB_CASES = [
  {
    id: 'github-react-issue-comments',
    name: 'GitHub',
    url: 'https://github.com/acme/project/issues/42',
    html: `<main>
      <h1><bdi data-testid="issue-title">Current issue title</bdi><span>#42</span></h1>
      <span data-testid="header-state" data-component="StateLabel">Closed</span>
      <div data-testid="issue-body" class="react-issue-body">
        <a data-testid="issue-body-header-author" href="/reporter">Example Reporter (reporter)</a>
        <relative-time datetime="2026-10-01T12:00:00Z">on Oct 1, 2026</relative-time>
        <div data-testid="issue-body-viewer"><div data-testid="markdown-body" class="markdown-body">
          <div class="markdown-body"><p>Issue description.</p></div>
        </div></div>
      </div>
      <div class="react-issue-comment"><a data-testid="avatar-link" href="/first-reader">First Reader (first-reader)</a>
        <relative-time datetime="2026-10-02T12:00:00Z">on Oct 2, 2026</relative-time>
        <div data-testid="markdown-body" class="markdown-body"><div class="markdown-body"><p>Same reply.</p></div></div>
      </div>
      <div class="react-issue-comment"><a data-testid="avatar-link" href="/second-reader">Second Reader (second-reader)</a>
        <relative-time datetime="2026-10-03T12:00:00Z">on Oct 3, 2026</relative-time>
        <div data-testid="markdown-body" class="markdown-body"><div class="markdown-body"><p>Same reply.</p></div></div>
      </div>
      <div class="react-issue-comment"><a data-testid="avatar-link" href="/screenshot-reader">screenshot-reader</a>
        <div data-testid="markdown-body" class="markdown-body"><p><img src="https://images.example/screenshot.png" alt="Screenshot evidence"></p></div>
      </div>
    </main>`,
    expected: ['# Issue #42: Current issue title', '**Status:** Closed', '**Author:** @reporter'],
    ordered: ['## Description', 'Issue description.', '## Comments', '### first-reader (2026-10-02T12:00:00Z)', 'Same reply.', '### second-reader (2026-10-03T12:00:00Z)', 'Same reply.', '### screenshot-reader', '![Screenshot evidence](https://images.example/screenshot.png)'],
    occurrences: { 'Issue description.': 1, 'Same reply.': 2 },
  },
  {
    id: 'github-current-pr-single-comment',
    name: 'GitHub',
    url: 'https://github.com/acme/project/pull/7',
    html: `<main>
      <h1><span class="markdown-title">Current pull request title</span><span class="sr-only"> - #7</span></h1>
      <span data-component="StateLabel" data-status="pullMerged">Merged</span>
      <div class="timeline-comment"><a class="author">pr-author</a><relative-time datetime="2026-10-01T12:00:00Z"></relative-time>
        <div class="comment-body markdown-body js-comment-body"><p>Pull request description.</p></div>
      </div>
      <div class="js-timeline-item"><div class="timeline-comment"><a class="author">reviewer</a>
        <relative-time datetime="2026-10-02T12:00:00Z"></relative-time>
        <div class="comment-body markdown-body js-comment-body"><p>The only review comment.</p></div>
      </div></div>
    </main>`,
    expected: ['# Pull Request #7: Current pull request title', '**Status:** Merged', '**Author:** @pr-author'],
    ordered: ['## Description', 'Pull request description.', '## Comments', '### reviewer (2026-10-02T12:00:00Z)', 'The only review comment.'],
    occurrences: { 'Pull request description.': 1, 'The only review comment.': 1 },
  },
  {
    id: 'github-legacy-issue-comments',
    name: 'GitHub',
    url: 'https://github.com/acme/project/issues/8',
    html: `<main><h1 class="gh-header-title"><bdi class="js-issue-title">Legacy issue</bdi><span class="f1-light">#8</span></h1>
      <div class="gh-header-meta"><a class="author">reporter</a></div>
      <div class="js-timeline-item"><div class="timeline-comment"><div class="comment-body">Legacy description.</div></div></div>
      <div class="js-timeline-item"><div class="timeline-comment"><a class="author">reader</a><div class="comment-body">Legacy reply.</div></div></div>
    </main>`,
    ordered: ['# Issue #8: Legacy issue', 'Legacy description.', '## Comments', '### reader', 'Legacy reply.'],
    occurrences: { 'Legacy description.': 1, 'Legacy reply.': 1 },
  },
  {
    id: 'github-empty-issue-description',
    name: 'GitHub',
    url: 'https://github.com/acme/project/issues/9',
    html: `<main><h1><bdi data-testid="issue-title">No description</bdi></h1>
      <div data-testid="issue-body"><div data-testid="issue-body-viewer"></div></div>
      <div class="react-issue-comment"><a data-testid="avatar-link" href="/reader">reader</a>
        <div data-testid="markdown-body" class="markdown-body"><p>First actual reply.</p></div>
      </div>
    </main>`,
    ordered: ['# Issue #9: No description', '## Comments', '### reader', 'First actual reply.'],
    occurrences: { 'First actual reply.': 1 },
  },
  {
    id: 'github-empty-react-issue-without-body-viewer',
    name: 'GitHub',
    url: 'https://github.com/acme/project/issues/10',
    html: `<main><h1><bdi data-testid="issue-title">Empty issue</bdi></h1>
      <div class="react-issue-comment"><a data-testid="avatar-link" href="/first-reader">First Reader</a>
        <relative-time datetime="2026-10-04T12:00:00Z">on Oct 4, 2026</relative-time>
        <div data-testid="markdown-body" class="markdown-body"><p>First actual reply.</p></div>
      </div>
    </main>`,
    excluded: ['## Description'],
    ordered: ['# Issue #10: Empty issue', '## Comments', '### first-reader (2026-10-04T12:00:00Z)', 'First actual reply.'],
    occurrences: { 'First actual reply.': 1 },
  },
  {
    id: 'github-review-thread-comment-authors',
    name: 'GitHub',
    url: 'https://github.com/acme/project/pull/11',
    html: `<main><h1><span class="markdownTitle__aB12c">Hashed title class</span><span class="sr-only"> - #11</span></h1>
      <div class="timeline-comment"><a class="author" href="/opener">opener</a><div class="comment-body js-comment-body"><p>Description.</p></div></div>
      <div class="js-timeline-item"><review-thread-collapsible>
        <div class="timeline-comment-group review-comment"><a class="author" href="/reviewer">reviewer</a>
          <relative-time datetime="2026-10-02T12:00:00Z"></relative-time>
          <div class="comment-body js-comment-body">Please rename this.
            <div class="js-suggested-changes-blob"><table><tbody>
              <tr><td class="blob-num blob-num-deletion"></td><td class="blob-code-inner blob-code-deletion">\tif (a || b) {</td></tr>
              <tr><td class="blob-num blob-num-addition"></td><td class="blob-code-inner blob-code-addition">\t\tif (ready) {</td></tr>
            </tbody></table></div></div></div>
        <div class="timeline-comment-group review-comment"><a class="author" href="/opener">opener</a>
          <relative-time datetime="2026-10-03T12:00:00Z"></relative-time>
          <div class="comment-body js-comment-body">Renamed.
            <div class="highlight highlight-source-ts"><pre class="notranslate">const ready = true;</pre></div>
            <p><math-renderer class="js-inline-math"><math data-latex="x^2"><msup><mi>x</mi><mn>2</mn></msup></math></math-renderer></p></div></div>
      </review-thread-collapsible></div></main>`,
    expected: [
      '# Pull Request #11: Hashed title class',
      '```diff\n-\tif (a || b) {\n+\t\tif (ready) {\n```',
      '```ts\nconst ready = true;\n```', '$x^2$',
    ],
    ordered: ['### reviewer (2026-10-02T12:00:00Z)', 'Please rename this.', '### opener (2026-10-03T12:00:00Z)', 'Renamed.'],
  },
  {
    id: 'github-discussion-authors-and-answer-preview',
    name: 'GitHub',
    url: 'https://github.com/acme/project/discussions/12',
    html: `<main><h1><span class="js-issue-title">How does it work?</span></h1>
      <div class="timeline-comment-group"><div class="timeline-comment">
        <a data-hovercard-type="user" class="Link--primary" href="/asker">asker</a>
        <a class="Link--secondary" href="#q"><relative-time datetime="2026-10-01T12:00:00Z">Oct 1, 2026</relative-time></a>
        <div class="comment-body js-comment-body">Question body.</div>
        <div class="color-bg-success"><a data-hovercard-type="user" href="/helper">helper</a>
          <div class="comment-body">Use the flag.</div>
          <a class="js-discussions-goto-answer-button" href="#answer-1">View full answer</a></div>
      </div></div>
      <div class="js-timeline-item"><div class="timeline-comment-group" id="answer-1"><div class="timeline-comment">
        <a data-hovercard-type="user" class="Link--primary" href="/helper">helper</a>
        <a class="Link--secondary" href="#a"><relative-time datetime="2026-10-02T12:00:00Z">Oct 2, 2026</relative-time></a>
        <div class="comment-body js-comment-body">Use the flag.</div>
        <div class="timeline-comment-group"><div class="timeline-comment"><a class="author" href="/asker">asker</a>
          <div class="comment-body js-comment-body">Thanks.</div></div></div>
      </div></div></div></main>`,
    ordered: ['**Author:** @asker', 'Question body.', '### helper (2026-10-02T12:00:00Z)', 'Use the flag.', '### asker', 'Thanks.'],
    occurrences: { 'Use the flag.': 1 },
  },
  {
    id: 'github-compare-commits-and-rendered-diff',
    name: 'GitHub',
    url: 'https://github.com/acme/project/compare/v1...v2',
    html: `<main><h1>Comparing changes</h1>
      <div class="TimelineItem--condensed"><li class="js-commits-list-item"><div class="js-details-container">
        <p><a class="markdown-title js-navigation-open" href="/acme/project/commit/aaaaaaa1">Fix parser (</a><a class="issue-link" href="/acme/project/pull/3">#3</a><a class="markdown-title" href="/acme/project/commit/aaaaaaa1">)</a><button>…</button></p>
        <a data-hovercard-type="user" href="/writer"></a><relative-time datetime="2026-10-01T12:00:00Z"></relative-time>
      </div></li></div>
      <copilot-diff-entry data-file-path="src/a.ts"><div class="file js-file" data-tagsearch-path="src/a.ts"><table class="diff-table"><tbody>
        <tr><td class="blob-code blob-code-inner blob-code-hunk">@@ -1,2 +1,2 @@</td></tr>
        <tr><td class="blob-code blob-code-context"><span class="blob-code-inner" data-code-marker=" ">  same();</span></td></tr>
        <tr><td class="blob-code blob-code-deletion"><span class="blob-code-inner" data-code-marker="-">old();</span></td></tr>
        <tr><td class="blob-code blob-code-addition"><span class="blob-code-inner" data-code-marker="+">++count;</span></td></tr>
      </tbody></table></div></copilot-diff-entry>
      <table data-diff-anchor="diff-b" aria-label="Diff for: src/b.ts"><tbody>
        <tr><td><code class="diff-text-cell hunk"><div class="diff-text-inner">@@ -1 +1 @@</div></code></td></tr>
        <tr><td><code class="diff-text"><div class="diff-text-inner">kept</div></code></td><td><code class="diff-text"><div class="diff-text-inner">kept</div></code></td></tr>
        <tr><td><code class="diff-text deletion"><div class="diff-text-inner">before</div></code></td><td><code class="diff-text addition"><div class="diff-text-inner">after</div></code></td></tr>
      </tbody></table></main>`,
    expected: [
      '| `aaaaaaa` | Fix parser (#3) | writer | 2026-10-01T12:00:00Z |',
      '````diff\n@@ -1,2 +1,2 @@\n   same();\n-old();\n+++count;\n````',
      '### src/b.ts\n\n````diff\n@@ -1 +1 @@\n kept\n-before\n+after\n````',
    ],
    occurrences: { '### src/a.ts': 1, 'Fix parser': 1 },
  },
  {
    id: 'github-current-commit-rows',
    name: 'GitHub',
    url: 'https://github.com/acme/project/commits/main/',
    html: `<main><ul><li data-testid="commit-row-item" data-commit-link="/acme/project/commit/bbbbbbb2cccccccc">
      <div data-listview-item-title-container="true"><h4><span><a href="/acme/project/commit/bbbbbbb2cccccccc">Thank <code>deadbeef1</code> </a><a class="user-mention" data-hovercard-type="user" href="/mentioned">@mentioned</a></span></h4></div>
      <div data-testid="author-avatar"><a data-hovercard-type="user" href="/apps/dependabot"></a></div>
      <relative-time datetime="2026-10-01T12:00:00Z"></relative-time></li></ul></main>`,
    expected: ['| `bbbbbbb` | Thank deadbeef1 @mentioned | dependabot[bot] | 2026-10-01T12:00:00Z |'],
  },
  {
    id: 'github-current-repository-overview',
    name: 'GitHub',
    url: 'https://github.com/acme/project',
    html: `<main>${['NarrowOnly__a1', 'Wide__a1'].map(name => `<div class="${name}"><div class="sidebarSection__b2"><h2>About</h2><p class="description__c3">A small parser.</p>
      <a class="prc-TopicTag-TopicTag-d4" href="/topics/parser">parser</a></div></div>`).join('')}
      <ul><li class="languageListItem__e5"><a><span class="languageName__f6">Rust</span><span>99.4%</span></a></li></ul></main>`,
    expected: ['> A small parser.', '**Topics:** parser\n', '**Languages:** Rust\n'],
  },
  {
    id: 'github-patch-headers-and-totals',
    name: 'GitHub',
    url: 'https://github.com/acme/project/pull/13/files',
    html: '<main><h1><span class="markdown-title">Patch totals</span></h1></main>',
    resources: {
      '/repos/acme/project/pulls/13': {
        contentType: 'text/plain; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
        body: [
          'From 1111111111111111111111111111111111111111 Mon Sep 17 00:00:00 2001',
          'From: =?UTF-8?q?Fran=C3=A7ois=20Example?=',
          ' <francois@example.com>',
          'Date: Tue, 3 Nov 2026 21:07:50 +0100',
          'Subject: [PATCH 1/2] Add a subject that is long enough to continue on the',
          ' next line',
          '',
          '---',
          'diff --git a/a.sql b/a.sql',
          '--- a/a.sql',
          '+++ b/a.sql',
          '@@ -1,2 +1 @@',
          ' select 1;',
          '--- removed comment',
          '',
          'From 2222222222222222222222222222222222222222 Mon Sep 17 00:00:00 2001',
          'From: Ada <ada@example.com>',
          'Date: Tue, 3 Nov 2026 22:07:50 +0100',
          'Subject: [PATCH 2/2] Second',
          '',
          '- a list item in the commit message',
          '+ another one',
          '---',
          'diff --git a/a.sql b/a.sql',
          '--- a/a.sql',
          '+++ b/a.sql',
          '@@ -1 +1,2 @@',
          ' select 1;',
          '+++x;',
          '',
        ].join('\n'),
      },
    },
    expected: [
      '| François Example <francois@example.com> |',
      '| Add a subject that is long enough to continue on the next line |',
      '**Summary:** 2 commit(s), 1 file(s), +1, -1',
    ],
  },
  ...[
    {
      id: 'github-truncated-blob-without-raw-file',
      path: 'src/large.ts',
      blob: { language: 'TypeScript', truncated: true },
      rawLines: ['const first = 1;'],
      expected: ['const first = 1;', '**Partial file content from GitHub page data.**'],
      excluded: ['Full file content'],
    },
    {
      id: 'github-binary-blob',
      path: 'logo.png',
      blob: { rawBlobUrl: 'https://github.com/acme/project/raw/refs/heads/main/logo.png' },
      resources: { '/acme/project/raw/refs/heads/main/logo.png': { contentType: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]) } },
      expected: ['*Binary file. Content not copied.*', '**Raw file:** https://github.com/acme/project/raw/refs/heads/main/logo.png'],
      excluded: ['## File Contents'],
    },
  ].map(({ path, blob, rawLines, ...fixtureCase }) => ({
    name: 'GitHub',
    url: `https://github.com/acme/project/blob/main/${path}`,
    html: `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: {
      codeViewLayoutRoute: { path, refInfo: { name: 'main' }, repo: { ownerLogin: 'acme', name: 'project' } },
      codeViewBlobLayoutRoute: { path, refInfo: { name: 'main' }, blob },
      ...(rawLines ? { 'codeViewBlobLayoutRoute.StyledBlob': { rawLines } } : {}),
    } })}</script>`,
    ...fixtureCase,
  })),
  ...['issues/123', 'pull/123'].map((directory) => ({
    id: `github-blob-with-${directory.split('/')[0]}-path`,
    name: 'GitHub',
    url: `https://github.com/acme/project/blob/main/${directory}/example.ts`,
    html: `<script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload: {
      codeViewLayoutRoute: { path: `${directory}/example.ts`, refInfo: { name: 'main' }, repo: { ownerLogin: 'acme', name: 'project' } },
      codeViewBlobLayoutRoute: { path: `${directory}/example.ts`, refInfo: { name: 'main' }, blob: { language: 'TypeScript' } },
      'codeViewBlobLayoutRoute.StyledBlob': { rawLines: ['const value = 42;'] },
    } })}</script>`,
    expected: [`# acme/project/${directory}/example.ts`, 'const value = 42;'],
    excluded: ['# Issue', '# Pull Request'],
  })),
];
