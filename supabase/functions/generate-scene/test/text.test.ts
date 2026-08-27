import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords } from '../lib/text.ts';

test('считает слова через пробелы', () => {
  assert.equal(countWords('раз два три'), 3);
});

test('не путается в лишних пробелах и переносах строк', () => {
  assert.equal(countWords('  раз   два\nтри\n\nчетыре  '), 4);
});

test('пустая строка — ноль слов', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
});
