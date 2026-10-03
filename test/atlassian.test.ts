import assert from 'node:assert/strict';
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
