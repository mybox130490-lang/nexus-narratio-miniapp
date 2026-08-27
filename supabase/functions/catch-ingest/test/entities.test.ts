import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from '../lib/entities.ts';

test('помечает метод извлечения и оставляет images/actions пустыми', () => {
  const r = extractEntities('у подъезда стояла собака');
  assert.equal(r.extraction_method, 'heuristic_v0');
  assert.deepEqual(r.images, []);
  assert.deepEqual(r.actions, []);
});

test('находит чувство по словарю', () => {
  const r = extractEntities('весь вечер меня не отпускала тревога');
  assert.ok(r.feelings.includes('тревога'));
});

test('не находит чувств там, где их нет', () => {
  const r = extractEntities('прошёл мимо киоска, купил хлеб');
  assert.deepEqual(r.feelings, []);
});

test('валентность: ресурсная запись', () => {
  const r = extractEntities('было очень тепло и спокойно, я благодарна этому дню');
  assert.equal(r.valence, 'resource');
});

test('валентность: негативная запись', () => {
  const r = extractEntities('весь день меня душила тревога и раздражение');
  assert.equal(r.valence, 'negative');
});

test('валентность: нейтральная запись по умолчанию', () => {
  const r = extractEntities('шёл домой, зашёл в магазин, купил молоко');
  assert.equal(r.valence, 'neutral');
});

test('при равенстве ресурсных и негативных маркеров валентность resource', () => {
  const r = extractEntities('сначала было страшно, а потом стало тепло');
  assert.equal(r.valence, 'resource');
});
