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
