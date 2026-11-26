import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { adfToMarkdown } from '../src/core/atlassian';

function paragraph(text: string, marks: Array<{ type: string }> = []) {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text, marks }],
  };
}

function cell(text: string, marks: Array<{ type: string }> = []) {
  return {
    type: 'tableCell',
    content: [paragraph(text, marks)],
  };
}

test('ADF code marks preserve literal backslashes in CommonMark code spans', () => {
  assert.equal(
    adfToMarkdown({
      type: 'doc',
      content: [paragraph('C:\\tmp', [{ type: 'code' }])],
    }),
    '`C:\\tmp`',
  );
});

test('ADF code marks choose a CommonMark delimiter around embedded backticks', () => {
  assert.equal(
    adfToMarkdown({
      type: 'doc',
      content: [paragraph('a`b', [{ type: 'code' }])],
    }),
    '``a`b``',
  );
});

test('ADF code blocks retain whitespace and outsize every embedded fence', () => {
  const code = '“Ａ”  \n\n\n````\nend  \n\n';
  assert.equal(
    adfToMarkdown({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'c++' }, content: [{ type: 'text', text: code }] }],
    }),
    '`````c++\n' + code + '`````',
  );
});

test('ADF table cells preserve child Markdown and escape only table delimiters', () => {
  assert.equal(
    adfToMarkdown({
      type: 'doc',
      content: [{
        type: 'table',
        content: [{
          type: 'tableRow',
          content: [
            cell('_literal_'),
            cell('C:\\tmp'),
            cell('C:\\tmp', [{ type: 'code' }]),
            cell('left|right'),
          ],
        }],
      }],
    }),
    [
      '| \\_literal\\_ | C:\\\\tmp | `C:\\tmp` | left\\|right |',
      '| --- | --- | --- | --- |',
    ].join('\n'),
  );
});

test('ADF nested lists indent by 2 spaces per level and empty dates stay empty', () => {
  const md = adfToMarkdown({
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph('Top item'),
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      paragraph('Level 1'),
                      {
                        type: 'bulletList',
                        content: [{ type: 'listItem', content: [paragraph('Level 2')] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'date', attrs: { timestamp: '' } }] },
    ],
  });
  assert.equal(md, '- Top item\n  - Level 1\n    - Level 2');
});

function text(value: string, ...marks: Array<Record<string, unknown>>) {
  return { type: 'text', text: value, marks };
}

function doc(...content: unknown[]) {
  return { type: 'doc', content };
}

test('ADF task and decision items keep inline content on one line and nest child lists', () => {
  assert.equal(
    adfToMarkdown(doc(
      { type: 'taskList', content: [
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [
          text('Ask '), { type: 'mention', attrs: { text: '@Ann' } }, text(' to '), text('deploy', { type: 'strong' }),
        ] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [text('Nested')] }] },
      ] },
      { type: 'decisionList', content: [
        { type: 'decisionItem', content: [text('Use '), text('Postgres', { type: 'em' })] },
      ] },
    )),
    '- [ ] Ask @Ann to **deploy**\n  - [x] Nested\n\n- Use *Postgres*',
  );
});

test('ADF ordered items indent nested blocks to the content column', () => {
  const item = (...content: unknown[]) => ({ type: 'listItem', content });
  assert.equal(
    adfToMarkdown(doc({ type: 'orderedList', attrs: { order: 10 }, content: [
      item(paragraph('Ten'), { type: 'bulletList', content: [item(paragraph('child'))] }),
      item(paragraph('First'), paragraph('Second'), { type: 'codeBlock', content: [text('a\n\n  b')] }),
    ] })),
    '10. Ten\n    - child\n11. First\n\n    Second\n    ```\n    a\n\n      b\n    ```',
  );
});

test('ADF marks keep spaces outside delimiters and join adjacent runs', () => {
  const strong = { type: 'strong' };
  assert.equal(
    adfToMarkdown(doc({ type: 'paragraph', content: [
      text('Note: ', strong), text('Triage', strong, { type: 'underline' }), text('-only', strong),
      text(' 10'), text('2', { type: 'subsup', attrs: { type: 'sup' } }), text(' *'), text('x', { type: 'em' }),
    ] })),
    '**Note:** **Triage-only** 10^(2) \\**x*',
  );
});

test('ADF tables align spanned cells and keep code indentation', () => {
  const span = (value: string, attrs: Record<string, number>) => ({ ...cell(value), attrs });
  assert.equal(
    adfToMarkdown(doc({ type: 'table', content: [
      { type: 'tableRow', content: [span('Region', { colspan: 2 }), cell('Total')] },
      { type: 'tableRow', content: [span('EU', { rowspan: 2 }), cell('FR'), cell('1')] },
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'codeBlock', content: [text('if a:\n    b')] }] },
        cell('2'),
      ] },
    ] })),
    '| Region |  | Total |\n| --- | --- | --- |\n| EU | FR | 1 |\n|  | `if a:`<br>`    b` | 2 |',
  );
});

test('ADF keeps inline media, card data, and the text of unknown nodes', () => {
  assert.equal(
    adfToMarkdown(doc(
      { type: 'paragraph', content: [
        text('See '), { type: 'mediaInline', attrs: { alt: 'report.pdf' } },
        text(' and '), { type: 'inlineCard', attrs: { data: { name: 'Plan' } } },
      ] },
      { type: 'mediaSingle', content: [
        { type: 'media', attrs: { alt: 'shot.png' } },
        { type: 'caption', content: [text('The '), text('picture', { type: 'strong' })] },
      ] },
      { type: 'futureBlock', content: [paragraph('one'), paragraph('two')] },
      { type: 'heading', attrs: { level: 2 }, content: [text('A'), { type: 'hardBreak' }, text('B')] },
    )),
    'See report.pdf and Plan\n\nshot.png\n\nThe **picture**\n\none\n\ntwo\n\n## A B',
  );
});

test('ADF links, cards, and media drop session credentials', (t) => {
  t.after(() => Reflect.deleteProperty(globalThis, 'document'));
  Object.assign(globalThis, { document: { baseURI: 'https://acme.atlassian.net/' } });
  const link = (href: string) => text('link', { type: 'link', attrs: { href } });
  const token = '?token=SECRET&Signature=SECRET#clientId=SECRET';
  assert.equal(
    adfToMarkdown(doc(
      { type: 'paragraph', content: [link(`https://media-cdn.atlassian.com/file/1/image${token}`)] },
      { type: 'paragraph', content: [link('https://media.atlassian.net/browse/A-1?focusedId=2&atl_token=SECRET')] },
      { type: 'blockCard', attrs: { data: { name: 'Plan', url: `https://api.media.atlassian-us-gov-mod.com/file/2${token}` } } },
      { type: 'media', attrs: { alt: 'shot.png', url: 'https://attachment.outlook.live.net/s/GetFileAttachment?id=3&token=SECRET' } },
    )),
    '[link](https://media-cdn.atlassian.com/file/1/image)\n\n[link](https://media.atlassian.net/browse/A-1?focusedId=2)\n\n'
      + '[Plan](https://api.media.atlassian-us-gov-mod.com/file/2)\n\nshot.png',
  );
});

test('ADF tables limit the empty cells that spans create', () => {
  const row = { type: 'tableRow', content: [{ ...cell('x'), attrs: { colspan: 1000, rowspan: 1000 } }] };
  const markdown = adfToMarkdown(doc({ type: 'table', content: Array.from({ length: 50 }, () => row) }));
  assert.equal(markdown.split('x').length - 1, 50);
  assert.ok(markdown.length < 50_000, `${markdown.length} characters`);
});

test('ADF tables process long whitespace runs within a bounded child deadline', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { adfToMarkdown } from ${JSON.stringify(new URL('../src/core/atlassian.ts', import.meta.url).href)};
    const spaces = ' '.repeat(250000);
    const value = 'start' + spaces + 'end';
    const document = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow',
      content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] }]
    }] }] };
    assert.equal(adfToMarkdown(document), '| ' + value + ' |\\n| --- |');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined, 'long whitespace runs must finish before the child deadline');
  assert.equal(result.status, 0, result.stderr);
});
