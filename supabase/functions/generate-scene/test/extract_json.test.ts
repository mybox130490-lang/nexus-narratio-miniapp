import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../lib/extract_json.ts';

test('парсит чистый JSON без обрамления', () => {
  const r = extractJson('{"a":1}');
  assert.deepEqual(r, { a: 1 });
});

test('достаёт JSON, обрамлённый пояснением модели вопреки просьбе', () => {
  const r = extractJson('Вот твоя история:\n{"a":1,"b":[1,2]}\nНадеюсь, подойдёт!');
  assert.deepEqual(r, { a: 1, b: [1, 2] });
});

test('обрезает пробелы и переносы строк по краям', () => {
  const r = extractJson('\n\n  {"a":1}  \n');
  assert.deepEqual(r, { a: 1 });
});

test('бросает понятную ошибку, если JSON не найден вообще', () => {
  assert.throws(() => extractJson('совсем не JSON'), /не найден JSON-объект/);
});

test('переносит вложенные фигурные скобки корректно (берёт крайние)', () => {
  const r = extractJson('текст {"a":{"b":{"c":1}}} текст');
  assert.deepEqual(r, { a: { b: { c: 1 } } });
});
