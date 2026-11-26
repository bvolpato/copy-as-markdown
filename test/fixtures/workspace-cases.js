// Synthetic workspace pages. Markup shapes follow the applications, but all content is invented.
const json = body => ({ contentType: 'application/json', body: JSON.stringify(body) });
const html = body => ({ contentType: 'text/html; charset=utf-8', body });

const jiraIssue = {
  key: 'API-7',
  names: { customfield_1: 'Acceptance criteria', customfield_2: 'Signature', customfield_3: 'Product area', customfield_4: 'Feedback' },
  renderedFields: {
    description: '<p>Call <tt>run()</tt></p><pre class="code-java">int x;</pre><pre>ls <tt>-la</tt> /tmp</pre>',
    updated: '18 minutes ago',
    customfield_1: '<p>Must:</p><ul><li>first</li><li>second</li></ul>',
  },
  fields: {
    summary: 'REST title',
    description: 'unused',
    updated: '2026-11-26T05:27:03.000+0000',
    customfield_1: 'unused',
    customfield_2: 'Map<String, List<Integer>> f()',
    customfield_3: { value: 'Platform', child: { value: 'Metrics' } },
    customfield_4: '<blockquote>Works</blockquote>',
    issuelinks: [{ type: { outward: 'blocks' }, outwardIssue: { key: 'API-8', fields: { summary: 'Other' } } }],
  },
};

const atlassianRenderer = `<div class="ak-renderer-document">
  <p>Read <a data-testid="lazy-render-placeholder" href="https://example.com/spec">https://example.com/spec</a>
    <span data-emoji-id="1f50d" data-emoji-text=":mag:"><img data-emoji-id="1f50d" data-emoji-text="🔍" alt="lens" src="https://example.com/1f50d.png"></span></p>
  <div class="code-block"><span data-ds--code--code-block="" data-code-lang="python"><code><span data-ds--code--row=""><span data-ds--line-number="1">1</span>def f():
</span><span data-ds--code--row=""><span data-ds--line-number="2">2</span>    return 1</span></code></span></div>
  <div data-task-list-local-id="a"><div data-task-local-id="1"><input type="checkbox" checked><div data-component="content">Parent task</div></div>
    <div data-task-list-local-id="b"><div data-task-local-id="2"><input type="checkbox"><div data-component="content">Child task</div></div></div></div>
  <div data-node-type="media" data-file-name="chart.png"><img alt="" src="https://media-cdn.atlassian.com/file/1/image?token=SECRET&amp;Signature=SECRET#clientId=SECRET"></div>
  <p><img alt="thumb" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" srcset="https://media-cdn.atlassian.com/file/2/image?token=SECRET 2x">
    <a href="https://api.media.atlassian.com/file/3/binary?token=SECRET">https://api.media.atlassian.com/file/3/binary?token=SECRET</a></p>
</div>`;
const rendererMarkdown = [
  '[https://example.com/spec](https://example.com/spec) 🔍', '```python\ndef f():\n    return 1\n```',
  '- [x] Parent task\n  - [ ] Child task', '![chart.png](https://media-cdn.atlassian.com/file/1/image)',
  '![thumb](https://media-cdn.atlassian.com/file/2/image)',
  '[https://api.media.atlassian.com/file/3/binary](https://api.media.atlassian.com/file/3/binary)',
];

const printMessage = (sender, recipients, body) => `<table class="message"><tr><td><b>${sender}</b></td><td align="right">Mon</td></tr>
  <tr><td colspan="2">${recipients}</td></tr><tr><td colspan="2"><table><tr><td>${body}</td></tr></table></td></tr></table>`;

const notionLeaf = text => `<div data-content-editable-leaf="true" style="white-space: break-spaces">${text}</div>`;
const notionItem = (type, marker, text, children = '') => `<div data-block-id="${type}-${text.length}" class="notion-selectable notion-${type}-block"><div>
  <div class="notion-list-item-box-left">${marker}</div><div>${notionLeaf(text)}${children}</div></div></div>`;
const notionNumber = value => `<span class="pseudoBefore" style='--pseudoBefore--content: "${value}."'></span>`;
const notionCell = text => `<div class="x"><div class="notion-table-view-cell"><span>${text}</span></div></div>`;

export const WORKSPACE_CASES = [
  {
    id: 'Jira project navigator keeps its context path and complete field values',
    name: 'Jira', url: 'https://host.example.com/jira/projects/API/issues/API-7?filter=allopenissues',
    html: '<main><h1>All issues</h1></main>',
    resources: { '/jira/rest/api/2/issue/API-7': json(jiraIssue) },
    expected: [
      '# API-7: REST title', 'Call `run()`', '```java\nint x;\n```', '```\nls -la /tmp\n```', '**Feedback:** > Works', '**Updated:** 2026-11-26T05:27:03.000+0000',
      '- **Acceptance Criteria:**\n  Must:\n\n  - first\n  - second', '**Signature:** Map<String, List<Integer>> f()',
      '**Product Area:** Platform - Metrics', 'https://host.example.com/jira/browse/API-8',
    ],
    excluded: ['18 minutes ago', 'All issues'],
  },
  {
    id: 'Jira Data Center fallback copies each comment once under the issue title',
    name: 'Jira', url: 'https://jira.example.com/browse/API-7',
    html: `<main><h1>All issues</h1><div id="issue-content"><h1 id="summary-val">Page title</h1></div>
      <div id="activitymodule"><div class="issue-data-block activity-comment"><div class="actionContainer">
        <div class="action-details"><a class="user-hover">Ada</a> <time datetime="2026-01-02"></time></div>
        <div class="action-body"><p>Only once.</p></div></div></div></div></main>`,
    expected: ['# API-7: Page title', '### Ada', '*2026-01-02*'],
    excluded: ['### Comment 2'], occurrences: { 'Only once.': 1 },
  },
  {
    id: 'Jira Cloud fallback keeps renderer content and comments without media tokens',
    name: 'Jira', url: 'https://acme.atlassian.net/browse/API-7',
    html: `<main><h1 data-testid="issue.views.issue-base.foundation.summary.heading">Cloud title</h1>
      <div data-testid="issue.views.field.rich-text.description">${atlassianRenderer}</div>
      <span data-testid="comment-base-item-9"><div data-testid="issue-comment-base.ui.comment.ak-comment.9-header"><h3>Grace</h3><time datetime="2026-01-03"></time></div>
        <div data-testid="issue-comment-base.ui.comment.ak-comment.9-body"><div class="ak-renderer-document"><p>Cloud comment.</p></div></div></span></main>`,
    expected: [...rendererMarkdown, '### Grace\n\n*2026-01-03*\n\nCloud comment.'], excluded: ['SECRET'],
  },
  {
    id: 'Confluence REST content keeps emoji, task state, and nested tasks',
    name: 'Confluence', url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/5/Tasks', html: '<main></main>',
    resources: { '/wiki/api/v2/pages/5': json({ id: '5', title: 'Tasks', body: { view: { value: `
      <h2><img class="emoticon emoticon-blue-star" data-emoji-id="2705" data-emoji-fallback="✅" alt="(blue star)" src="/star.png"> Actions</h2>
      <ul class="inline-task-list"><li class="checked">Done</li><li>Open</li><ul class="inline-task-list"><li>Nested</li></ul></ul>` } } }) },
    expected: ['## ✅ Actions', '- [x] Done\n- [ ] Open\n  - [ ] Nested'], excluded: ['blue star'],
  },
  {
    id: 'Confluence Cloud fallback keeps renderer content and comments without media tokens',
    name: 'Confluence', url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/6/Fallback',
    html: `<main><h1 data-testid="page-title">Fallback</h1>${atlassianRenderer}
      <div data-testid="object-comments-list-container"><div data-comment-id="8" role="article"><div data-comment-id="8">
        <div data-testid="comment-author-box"><div data-testid="comment-author"></div><a href="https://home.atlassian.com/people/1">Ali</a><span>Aug 27</span></div>
        <div class="ak-renderer-document"><p>${'Long comment text. '.repeat(40)}</p></div></div></div></div></main>`,
    expected: [...rendererMarkdown, '### Ali\n\n*Aug 27*'], excluded: ['SECRET'],
  },
  {
    id: 'Confluence uses the declared context path for REST content',
    name: 'Confluence', url: 'https://intranet.example.com/docs/pages/viewpage.action?pageId=42',
    head: '<meta name="ajs-page-id" content="42"><meta name="ajs-space-key" content="ENG"><meta name="ajs-context-path" content="/docs">',
    html: '<main></main>',
    resources: { '/docs/rest/api/content/42': json({ id: '42', title: 'Context', body: { view: { value: '<p>REST body.</p>' } } }) },
    expected: ['# Context', 'REST body.'],
  },
  {
    id: 'Confluence does not follow a context path to another origin',
    name: 'Confluence', url: 'https://intranet.example.com/docs/pages/viewpage.action?pageId=42',
    head: '<meta name="ajs-page-id" content="42"><meta name="ajs-space-key" content="ENG"><meta name="ajs-context-path" content="//other.example.com">',
    html: '<div id="main-content" class="wiki-content"><p>Own body.</p></div>',
    resources: { '/rest/api/content/42': { ...json({ id: '42', title: 'Other', body: { view: { value: '<p>Other body.</p>' } } }), headers: { 'access-control-allow-origin': '*' } } },
    expected: ['Own body.'], excluded: ['Other'],
  },
  {
    id: 'Google Docs exports keep list nesting and numbering',
    name: 'Google Docs', url: 'https://docs.google.com/document/d/lists/edit', html: '<main></main>',
    resources: { '/document/d/lists/export': html(`<body><ol class="c0 lst-kix_a-0 start" start="1"><li>One</li></ol>
      <ul class="c0 lst-kix_a-1 start"><li>Child</li></ul><ul class="c0 lst-kix_a-2 start"><li>Deep</li></ul>
      <ol class="c0 lst-kix_a-0" start="2"><li>Two</li></ol><p>Break</p><ol class="c0 lst-kix_a-0" start="3"><li>Three</li></ol></body>`) },
    expected: ['1. One\n   - Child\n     - Deep\n2. Two\n\nBreak\n\n3. Three'],
  },
  {
    id: 'Google Sheets labels whole-column ranges with their own columns',
    name: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/d/columns/edit#gid=1&range=C:E', html: '<main></main>',
    resources: { '/spreadsheets/d/columns/export': { contentType: 'text/csv', body: 'a,b,c\n' } },
    expected: ['| Row | C | D | E |\n| --- | --- | --- | --- |\n| 1 | a | b | c |'],
  },
  {
    id: 'Google Sheets HTML queries drop the empty label row',
    name: 'Google Sheets', url: 'https://docs.google.com/spreadsheets/d/labels/edit#gid=1&range=A3:A4', html: '<main></main>',
    resources: {
      '/spreadsheets/d/labels/export': { status: 403 },
      '/spreadsheets/d/labels/gviz/tq': html('<table><tr><td></td></tr><tr><td>third</td></tr><tr><td>fourth</td></tr></table>'),
    },
    expected: ['| 3 | third |\n| 4 | fourth |'],
  },
  {
    id: 'Google Slides keep nested bullets, soft breaks, repeated text, and links',
    name: 'Google Slides', url: 'https://docs.google.com/presentation/d/deck/edit', html: '<main></main>',
    resources: { '/presentation/d/deck/htmlpresent': html(`<div class="slide" title="Slide 1"><section class="slide-content">
      <div class="shape" style="top:10px;left:0"><p style="font-size:30pt">Plan�Q3</p></div>
      <div class="shape" style="top:90px;left:0"><ul><li>Outer</li><ul><li>Inner</li></ul></ul></div>
      <div class="shape" style="top:200px;left:0"><p>TBD</p></div><div class="shape" style="top:200px;left:90px"><p>TBD</p></div>
      <div class="shape" style="top:300px;left:0"><p><a href="https://www.google.com/url?q=https://example.com/a&amp;sa=D">Doc</a></p></div></section></div>
      <div class="slide" title="Slide 2"><section class="slide-content"><div class="shape" style="top:10px"><p>First line</p><p>Second line</p></div></section></div>`) },
    expected: ['## Slide 1: Plan Q3', '- Outer\n  - Inner', '[Doc](https://example.com/a)', '## Slide 2: First line\n\nSecond line'],
    excluded: ['�', 'No text on this slide'], occurrences: { TBD: 2 },
  },
  {
    id: 'Google Slides copy the slide whose page ID is open',
    name: 'Google Slides', option: 'current', url: 'https://docs.google.com/presentation/d/order/edit#slide=id.p3', html: '<main></main>',
    resources: { '/presentation/d/order/htmlpresent': html(['p', 'p3', 'p2'].map((id, index) => `<div class="slide" title="Slide ${index + 1}">
      <section class="slide-content" style="background-image:url(https://docs.google.com/viewpage?pageid=${id}&amp;rev=1)"><div class="shape" style="top:1px"><p>Slide text ${id}</p></div></section></div>`).join('')) },
    expected: ['## Slide 2: Slide text p3'], excluded: ['Slide text p2'],
  },
  {
    id: 'Gmail split panes print the open thread and separate recipient lines',
    name: 'Gmail', url: 'https://mail.google.com/mail/u/1/#inbox/FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR',
    html: `<div role="main"><span data-legacy-thread-id="1111111111111111">Other row</span>
      <h2 class="hP" data-thread-perm-id="thread-f:2" data-legacy-thread-id="2222222222222222">Plan</h2></div>`,
    afterLoad: page => page.evaluate((right, wrong) => {
      window.fetch = async url => new Response(`<div class="maincontent">${String(url).includes('th=2222222222222222') ? right : wrong}</div>`);
    }, printMessage('Ada', '<div>To: Bob</div><div>Cc: Carol</div>', '<table class="message"><tr><td>Layout</td><td>cell</td></tr></table>'),
    printMessage('Zed', '<div>To: me</div>', 'WRONG THREAD')),
    expected: ['**Messages:** 1', '**Recipients:** To: Bob Cc: Carol', '| Layout | cell |'], excluded: ['WRONG THREAD'],
  },
  {
    id: 'Gmail names attachments from their download data',
    name: 'Gmail', url: 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQgMMHLwtbqvvsLSmnmFrtzlwhR',
    html: `<h2 class="hP">Plan</h2><div class="adn ads"><span class="gD">Ada</span><div class="a3s">Body</div>
      <div class="aQH"><span download_url="application/pdf:plan%20v2.pdf:https://mail.google.com/x"><a href="?view=att"><span>Preview attachment plan v2.pdf</span><span class="aV3">plan v2.pdf</span><span>120 KB</span></a></span></div></div>`,
    expected: ['**Attachments:** plan v2.pdf\n'],
  },
  {
    id: 'Outlook drops attachment URLs that carry session credentials',
    name: 'Outlook Web', url: 'https://outlook.office.com/mail/inbox/id/1?X-OWA-CANARY=SECRET',
    html: `<div aria-label="Reading Pane"><div aria-label="Email message"><div aria-label="Message body"><p>Body text</p>
      <img alt="chart" src="https://attachments.office.net/owa/a/GetAttachmentThumbnail?id=1&amp;token=SECRET&amp;X-OWA-CANARY=SECRET">
      <picture><source srcset="https://attachment.outlook.live.net/owa/b/GetAttachmentThumbnail?id=2&amp;token=SECRET"><img alt="photo"></picture>
      <a href="/owa/service.svc/s/GetFileAttachment?id=3&amp;x-owa-canary=SECRET">report.pdf</a>
      <a href="https://forms.office.com/r/survey?token=public">Public link</a></div></div></div>`,
    expected: ['url: "https://outlook.office.com/mail/inbox/id/1"', 'Body text', 'chart', 'photo', 'report.pdf', '[Public link](https://forms.office.com/r/survey?token=public)'],
    excluded: ['SECRET', '](https://attachment', 'GetFileAttachment'],
  },
  {
    id: 'Notion keeps rendered lists, code, formulas, inline styles, and database rows',
    name: 'Notion', url: 'https://team.notion.site/Blocks',
    html: `<div class="notion-page-content"><h1>Blocks</h1>
      ${notionItem('bulleted_list', '', 'Bullet', notionItem('numbered_list', notionNumber(3), 'Third') + notionItem('numbered_list', notionNumber(4), 'Fourth'))}
      ${notionItem('to_do', '<input type="checkbox" checked>', 'Ship')}
      <div data-block-id="h">${notionLeaf('Details')}</div>
      ${notionItem('bulleted_list', '', 'Steps', ['First step', 'Second step'].map(text => `<div data-block-id="${text}" class="notion-text-block">${notionLeaf(text)}</div>`).join(''))}
      <div data-block-id="t" class="notion-text-block">${notionLeaf('Use <div class="notion-inline-code-container" style="display:inline"><span>/page</span></div> now\nnext <span style="font-weight:600">bold</span> <div class="notion-inline-code-container"><a href="https://example.com/api">linked</a></div>')}</div>
      <div data-block-id="c" class="notion-selectable notion-code-block"><div class="line-numbers notion-code-block">${notionLeaf('<span>a {</span><span>\n\tb\n</span><span>}</span>')}</div></div>
      <div data-block-id="e">${notionLeaf('Sum <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x_1</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x1</span></span>')}</div>
      <div class="notion-table-view"><div class="notion-table-view-header-row"><div><div class="notion-table-view-header-cell">Name</div></div><div><div class="notion-table-view-header-cell">Owner</div></div></div>
        <div class="notion-table-view-row"><div>${notionCell('Launch')}${notionCell('Ada')}</div></div></div></div>`,
    expected: ['- Bullet\n  3. Third\n  4. Fourth\n- [x] Ship', '- Steps\n\n  First step\n\n  Second step\n', 'Use `/page` now\nnext **bold**', '[linked](https://example.com/api)', '```\na {\n\tb\n}\n```', 'Sum $x_1$',
      '| Name | Owner |\n| --- | --- |\n| Launch | Ada |'],
  },
  {
    id: 'Slack keeps paragraph breaks, emoji names, send times, and run authors',
    name: 'Slack', url: 'https://app.slack.com/client/T1/C1',
    html: `<main data-qa="message_pane">
      <div data-qa="message_container"><button data-qa="message_sender_name">Ada</button><a class="c-timestamp" data-ts="1753790400.000100" aria-label="Today at 12:00 PM">12:00</a>
        <div data-qa="message-text">First<span class="c-mrkdwn__br" data-stringify-type="paragraph-break"></span>Second <img data-stringify-emoji=":tada:" alt=":tada:" src="https://a.slack-edge.com/1.png"></div></div>
      <div data-qa="message_container"><button data-qa="message_sender_name">Bob</button><div>Started a huddle</div></div>
      <div data-qa="message_container"><div data-qa="message-text">Continuation</div></div></main>`,
    expected: ['**Time:** 2025-07-29T12:00:00.000Z', 'First\n\nSecond :tada:', '## Bob\n\nContinuation'], excluded: ['Today at', '](https://a.slack-edge.com'],
  },
  {
    id: 'Discord keeps lines, reply authors, dates, image names, and run authors',
    name: 'Discord', url: 'https://discord.com/channels/1/2',
    html: `<style>.messageContent_x { white-space: break-spaces; }</style><main><ol data-list-id="chat-messages">
      <li id="chat-messages-1"><h3><span id="message-username-1">Ada</span><span class="timestamp_x"><time datetime="2026-07-29T12:00:00.000Z">Today</time></span></h3>
        <div id="message-content-1" class="messageContent_x">First\nSecond <img class="emoji" alt="😄" src="/1.svg"></div></li>
      <li id="chat-messages-2"><h3><span id="message-username-2">Bob</span></h3><div class="stickerAsset_x"></div></li>
      <li id="chat-messages-3"><div id="message-content-3" class="messageContent_x">Continuation</div></li>
      <li id="chat-messages-4"><div class="repliedMessage_x"><span class="username_x">Ada</span><div id="message-content-1" class="repliedTextContent_x">First</div></div>
        <h3><span id="message-username-4">Carol</span></h3><div id="message-content-4" class="messageContent_x">Reply</div></li>
      <li id="chat-messages-5"><h3><span id="message-username-5">Dan</span></h3><div class="mediaAttachmentsContainer_x">
        <a class="originalLink_x" href="https://cdn.discordapp.com/attachments/1/a.png?hm=SECRET"></a><a class="originalLink_x" href="https://cdn.discordapp.com/attachments/1/b.png?hm=SECRET"></a></div></li></ol></main>`,
    expected: ['**Time:** 2026-07-29T12:00:00.000Z', 'First\nSecond 😄', '## Bob\n\nContinuation', '**Reply to:** Ada: "First"', '**Attachments:** a.png, b.png'],
    excluded: ['SECRET'],
  },
  {
    id: 'Microsoft Teams attributes a run to its author and keeps emoji as text',
    name: 'Microsoft Teams', url: 'https://teams.microsoft.com/v2/',
    html: `<main data-tid="chat-pane-list">
      <div data-tid="chat-pane-item"><span data-tid="message-author-name">Ada</span><div data-tid="messageBodyContent">Hello <img itemtype="http://schema.skype.com/Emoji" alt="😄" src="https://example.com/1.png"></div></div>
      <div data-tid="chat-pane-item"><span data-tid="message-author-name">Bob</span><div data-tid="call-card">Call ended</div></div>
      <div data-tid="chat-pane-item"><div data-tid="messageBodyContent">Continuation</div></div></main>`,
    expected: ['Hello 😄', '## Bob\n\nContinuation'],
  },
  {
    id: 'WhatsApp keeps lines, dates, quoted authors, and group senders',
    name: 'WhatsApp', url: 'https://web.whatsapp.com/',
    html: `<style>.selectable-text { white-space: pre-wrap; }</style><div id="main"><header><span title="Group">Group</span></header>
      <div class="message-in"><div data-pre-plain-text="[10:30 AM, 8/9/2026] Ops: Ada: "><span data-testid="msg-time">10:30 AM</span><span class="selectable-text">milk\neggs</span></div></div>
      <div class="message-in"><img src="blob:https://web.whatsapp.com/1"></div>
      <div class="message-in"><span data-icon="tail-in"></span><img src="blob:https://web.whatsapp.com/2"></div>
      <div class="message-in"><span data-icon="tail-in"></span><span aria-label="Bob:"></span><img src="blob:https://web.whatsapp.com/3"></div>
      <div class="message-out"><div aria-label="Quoted message"><span>Ops: Ada</span><span class="quoted-mention">milk</span></div><span class="selectable-text">done</span></div></div>`,
    expected: ['**Ops: Ada** (10:30 AM, 8/9/2026):\nmilk\neggs', '**Ops: Ada**:\n📎 *[Image]*', '**Group**:\n📎 *[Image]*', '**Bob**:\n📎 *[Image]*', '> Replying to: Ops: Ada: milk'],
  },
  {
    id: 'Linear keeps the state of checklist items',
    name: 'Linear', url: 'https://linear.app/acme/issue/ENG-1/checklist',
    html: `<main data-testid="issue-view"><h1 aria-label="Issue title">Checklist</h1><div class="ProseMirror" aria-label="Issue description"><ul>
      <li><label><input type="checkbox" checked></label><div><p>Done</p></div></li><li><label><input type="checkbox"></label><div><p>Open</p></div></li></ul></div></main>`,
    expected: ['- [x] Done\n- [ ] Open'],
  },
  {
    id: 'Word for the web keeps heading levels and drops access tokens',
    name: 'Microsoft 365', url: 'https://word-edit.officeapps.live.com/we/frame.aspx?wopisrc=1&access_token=SECRET', head: '<title>Plan.docx</title>',
    html: '<div role="document"><p role="heading" aria-level="2"><span>Scope</span></p><p>Body text that is long enough. <img alt="logo" src="/we/ResReader.ashx?n=1&amp;access_token=SECRET"></p></div>',
    expected: ['url: "https://word-edit.officeapps.live.com/we/frame.aspx?wopisrc=1"', '## Scope\n\nBody text that is long enough.', '![logo](https://word-edit.officeapps.live.com/we/ResReader.ashx?n=1)'],
    excluded: ['SECRET'],
  },
];
