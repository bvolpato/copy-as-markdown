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
