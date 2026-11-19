// Synthetic routing fixtures; these are not captured Google pages.
const publishedPages = [
  {
    id: 'published-google-doc',
    path: 'document',
    endpoint: 'pub',
    html: '<main id="contents"><h1>Published planning notes</h1><p>Read the public document.</p><pre><code class="language-js">\tconst value = 42;  \n\n\n\treturn value;  \n</code></pre></main>',
    contains: ['# Published planning notes', 'Read the public document.', '\tconst value = 42;  \n\n\n\treturn value;  '],
    excludes: ['Could not export this Google Doc'],
  },
  {
    id: 'published-google-sheet',
    path: 'spreadsheets',
    endpoint: 'pubhtml',
    html: '<main><h1>Published results</h1><table><tr><th>Name</th><th>Value</th></tr><tr><td>Visible result</td><td>42</td></tr></table></main>',
    contains: ['# Published results', '| Name | Value |', '| Visible result | 42 |'],
  },
  {
    id: 'published-google-slides',
    path: 'presentation',
    endpoint: 'embed',
    html: '<main><section class="slide"><h2>Visible published slide</h2><p>This slide text is rendered on the page.</p></section></main>',
    contains: ['## Visible published slide', 'This slide text is rendered on the page.'],
  },
];

export const WORKSPACE_MATCHER_CASES = [
  ...publishedPages.flatMap(({ id, path, endpoint, ...content }) => [
    {
      id,
      url: `https://docs.google.com/${path}/d/e/published-content/${endpoint}`,
      extractor: null,
      ...content,
    },
    {
      id: `${id}-account`,
      url: `https://docs.google.com/${path}/u/2/d/e/published-content/${endpoint}?embedded=true`,
      extractor: null,
    },
  ]),
  ...[
    ['document', 'Google Docs'],
    ['spreadsheets', 'Google Sheets'],
    ['presentation', 'Google Slides'],
  ].flatMap(([path, extractor]) => [
    {
      id: `${path}-editor`,
      url: `https://docs.google.com/${path}/d/editor-id/edit`,
      extractor,
    },
    {
      id: `${path}-account-editor`,
      url: `https://docs.google.com/${path}/u/2/d/editor-id/edit`,
      extractor,
    },
  ]),
];
