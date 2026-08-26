import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatActivePatterns, formatUnderObservedAxes } from '../lib/dossier_format.ts';

test('берёт только подтверждённые паттерны, не единичные совпадения', () => {
  const rows = [
    { entity_value: 'тревога', occurrences: 6, share: 0.4, is_pattern: true },
    { entity_value: 'случайное', occurrences: 1, share: 0.07, is_pattern: false },
  ];
  const out = formatActivePatterns(rows, 'чувство');
  assert.deepEqual(out, ['чувство «тревога» — 40% записей периода']);
});

test('пустой список строк даёт пустой список паттернов', () => {
  assert.deepEqual(formatActivePatterns([], 'чувство'), []);
});

test('отбирает оси с недостаточным числом наблюдений', () => {
  const rows = [
    { axis_key: 'approach', value: 0.6, n: 14, is_visible: true },
    { axis_key: 'novelty', value: null, n: 3, is_visible: false },
    { axis_key: 'loyalty', value: null, n: 0, is_visible: false },
  ];
  assert.deepEqual(formatUnderObservedAxes(rows), ['novelty', 'loyalty']);
});

test('если все оси наблюдаемы, список пуст', () => {
  const rows = [{ axis_key: 'approach', value: 0.1, n: 10, is_visible: true }];
  assert.deepEqual(formatUnderObservedAxes(rows), []);
});
