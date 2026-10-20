export const DISCUSSION_CASES = [
  {
    id: 'hacker-news-ask-post',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=42000001',
    head: '<title>Ask HN: What makes a useful parser fixture?</title>',
    html: `<main>
      <table>
        <tr class="athing" id="42000001"><td class="title"><span class="titleline">
          <a href="https://engineering.example/parser-fixtures">Ask HN: What makes a useful parser fixture?</a>
        </span></td></tr>
        <tr><td><span class="score">37 points</span> by <a class="hnuser">fixture_author</a>
          <span class="age"><a>2 hours ago</a></span></td></tr>
        <tr class="fatitem"><td><div class="toptext">
          <p>I am checking that rendered discussion details survive conversion into Markdown.</p>
          <p>Should a fixture preserve <strong>emphasis</strong> and each example?</p>
          <ul><li>Keep the first example.</li><li>Keep the second example.</li></ul>
        </div></td></tr>
      </table>
      <nav class="site-nav">New | Past | Ask | Show | Jobs</nav>
    </main>`,
    expected: [
      '# Ask HN: What makes a useful parser fixture?',
      '**Link:** https://engineering.example/parser-fixtures',
      '**Score:** 37 points',
      '**Author:** fixture_author',
      '**Posted:** 2 hours ago',
      '## Post',
      'I am checking that rendered discussion details survive conversion into Markdown.',
      'Should a fixture preserve **emphasis** and each example?',
      '- Keep the first example.',
      '- Keep the second example.',
    ],
    excluded: ['New | Past | Ask | Show | Jobs'],
    ordered: [
      '# Ask HN: What makes a useful parser fixture?',
      '**Link:** https://engineering.example/parser-fixtures',
      '**Score:** 37 points',
      '**Author:** fixture_author',
      '**Posted:** 2 hours ago',
      '## Post',
      'I am checking that rendered discussion details survive conversion into Markdown.',
      '- Keep the first example.',
    ],
    occurrences: { '## Post': 1, 'Keep the first example.': 1 },
  },
  {
    id: 'hacker-news-thread-with-deleted-comment',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/item?id=42000002',
    head: '<title>Threaded comments - Hacker News</title>',
    html: `<main>
      <table>
        <tr class="athing" id="42000002"><td class="title"><span class="titleline">
          <a href="https://research.example/notes">Notes on small parser tests</a>
        </span></td></tr>
        <tr><td><span class="score">12 points</span> by <a class="hnuser">post_writer</a>
          <span class="age"><a>3 hours ago</a></span></td></tr>
      </table>
      <table class="comment-tree">
        <tr class="comtr" id="comment-1"><td><table><tr>
          <td class="ind"><img width="0" height="1"></td>
          <td><div class="comment"><span class="comhead"><a class="hnuser">top_reader</a>
            <span class="age"><a>1 hour ago</a></span></span>
            <div class="commtext">A top-level comment with <em>one useful detail</em>.</div>
          </div></td>
        </tr></table></td></tr>
        <tr class="comtr" id="comment-2"><td><table><tr>
          <td class="ind"><img width="40" height="1"></td>
          <td><div class="comment"><span class="comhead"><a class="hnuser">nested_reader</a>
            <span class="age"><a>50 minutes ago</a></span></span>
            <div class="commtext">A nested reply with <code>specific evidence</code>.</div>
          </div></td>
        </tr></table></td></tr>
        <tr class="comtr" id="comment-deleted"><td><table><tr>
          <td class="ind"><img width="40" height="1"></td>
          <td><div class="comment"><span class="comhead"><a class="hnuser">[deleted]</a>
            <span class="age"><a>40 minutes ago</a></span></span>
            <div class="commtext"></div>
          </div></td>
        </tr></table></td></tr>
      </table>
      <aside>More discussion links</aside>
    </main>`,
    expected: [
      '# Notes on small parser tests',
      '**Score:** 12 points',
      '**Author:** post_writer',
      '## Comments (3)',
      '- **top_reader** (1 hour ago):',
      'A top-level comment with *one useful detail*.',
      '  - **nested_reader** (50 minutes ago):',
      '  A nested reply with `specific evidence`.',
    ],
    excluded: ['[deleted]', 'comment-deleted', 'More discussion links'],
    ordered: [
      '## Comments (3)',
      '- **top_reader** (1 hour ago):',
      'A top-level comment with *one useful detail*.',
      '  - **nested_reader** (50 minutes ago):',
      '  A nested reply with `specific evidence`.',
    ],
    occurrences: { '## Comments (3)': 1, 'top_reader': 1, 'nested_reader': 1 },
  },
  {
    id: 'medium-rich-article',
    name: 'Medium',
    url: 'https://medium.com/@fixture_author/testing-rendered-articles-42000003',
    head: '<title>Testing rendered articles - Medium</title>',
    html: `<main>
      <header class="storyHeader">
        <h1 data-testid="storyTitle">Testing rendered articles</h1>
        <h2 data-testid="storySubtitle">A fabricated article for extraction coverage</h2>
        <div data-testid="authorName">Morgan Example</div>
        <div data-testid="publicationName">Field Notes</div>
        <span data-testid="publishedAt">Oct 18, 2026</span>
        <span data-testid="storyReadTime">6 min read</span>
      </header>
      <article>
        <section>
          <h2>What the fixture covers</h2>
          <p>The article body should keep <strong>useful emphasis</strong>, inline <code>code</code>, and <a href="https://docs.example/markup">a reference link</a>.</p>
          <blockquote><p>Keep the quotation with the article that contains it.</p></blockquote>
          <ol><li>Preserve ordered steps.</li><li>Keep the final step.</li></ol>
          <table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody><tr><td>Body</td><td>Present</td></tr></tbody></table>
          <pre><code class="language-js">const fixtureCount = 3;</code></pre>
          <figure><img src="https://images.example/article-figure.png" alt="A fabricated chart"><figcaption>Chart caption belongs to the article.</figcaption></figure>
          <button data-testid="headerClapButton">Clap control text</button>
          <button data-testid="headerSocialShareButton">Share control text</button>
          <button class="pw-multi-vote-count">842</button>
          <div role="button">Save and follow controls</div>
        </section>
      </article>
      <aside><h2>More from Field Notes</h2><p>Off-article recommendation noise.</p></aside>
    </main>`,
    expected: [
      '# Testing rendered articles',
      '*A fabricated article for extraction coverage*',
      '**Author:** Morgan Example',
      '**Publication:** Field Notes',
      '**Date:** Oct 18, 2026',
      '**Reading time:** 6 min read',
      '**Claps:** 842',
      '## What the fixture covers',
      'The article body should keep **useful emphasis**, inline `code`',
      '[a reference link](https://docs.example/markup)',
      '> Keep the quotation with the article that contains it.',
      '1. Preserve ordered steps.',
      '2. Keep the final step.',
      '| Check | Result |',
      'const fixtureCount = 3;',
      'Chart caption belongs to the article.',
    ],
    excluded: [
      'Clap control text', 'Share control text', 'Save and follow controls',
      'Off-article recommendation noise', 'More from Field Notes',
    ],
    ordered: [
      '# Testing rendered articles',
      '*A fabricated article for extraction coverage*',
      '**Author:** Morgan Example',
      '**Publication:** Field Notes',
      '**Date:** Oct 18, 2026',
      '**Reading time:** 6 min read',
      '**Claps:** 842',
      '## What the fixture covers',
      'The article body should keep **useful emphasis**',
      '> Keep the quotation with the article that contains it.',
      '| Check | Result |',
      'const fixtureCount = 3;',
      'Chart caption belongs to the article.',
    ],
    occurrences: { '842': 1, 'What the fixture covers': 1, 'Chart caption belongs to the article.': 1 },
  },
  {
    id: 'medium-metered-content-controls',
    name: 'Medium',
    url: 'https://medium.com/design-notes/compact-story-42000004',
    head: '<title>Compact story - Medium</title>',
    html: `<main>
      <header><h1 data-testid="storyTitle">A compact metered story</h1>
        <div data-testid="authorName">Riley Writer</div></header>
      <article>
        <div class="meteredContent">
          <p>The metered article text starts here and must remain intact.</p>
          <p>Second paragraph with <em>italic detail</em>.</p>
          <button data-testid="headerClapButton">Clap toolbar label</button>
          <div data-testid="headerSocialShareButton">Share toolbar label</div>
          <span class="pw-multi-vote-count">64</span>
          <div role="button">Bookmark toolbar label</div>
        </div>
      </article>
      <aside><p>Suggested story outside the article.</p></aside>
    </main>`,
    expected: [
      '# A compact metered story',
      '**Author:** Riley Writer',
      '**Claps:** 64',
      'The metered article text starts here and must remain intact.',
      'Second paragraph with *italic detail*.',
    ],
    excluded: [
      'Clap toolbar label', 'Share toolbar label',
      'Bookmark toolbar label', 'Suggested story outside the article.',
    ],
    ordered: ['# A compact metered story', '**Author:** Riley Writer', 'The metered article text starts here', 'Second paragraph with *italic detail*.'],
    occurrences: { '64': 1, 'The metered article text starts here': 1 },
  },
  {
    id: 'medium-article-fallback',
    name: 'Medium',
    url: 'https://medium.com/@fixture_author/unsectioned-story-42000005',
    head: '<title>Unsectioned story - Medium</title>',
    html: `<main>
      <article>
        <h1>Unsectioned story body</h1>
        <p>This older rendering has no section or meteredContent wrapper.</p>
        <p>Its paragraphs still belong to the article.</p>
        <button role="button">Article action noise</button>
      </article>
      <aside><p>Unrelated sidebar article.</p></aside>
    </main>`,
    expected: [
      '# Unsectioned story body',
      'This older rendering has no section or meteredContent wrapper.',
      'Its paragraphs still belong to the article.',
    ],
    excluded: ['Article action noise', 'Unrelated sidebar article.'],
    ordered: ['# Unsectioned story body', 'This older rendering has no section or meteredContent wrapper.', 'Its paragraphs still belong to the article.'],
    occurrences: { 'Its paragraphs still belong to the article.': 1 },
  },
];
