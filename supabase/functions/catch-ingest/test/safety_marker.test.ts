import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDbMarker } from '../lib/safety_marker.ts';

test('самоповреждение приоритетнее суицидальных мыслей', () => {
  assert.equal(toDbMarker(['suicidal_ideation', 'self_harm']), 'self_harm');
});

test('насилие приоритетнее дереализации', () => {
  assert.equal(toDbMarker(['derealization', 'violence']), 'violence');
});

test('суицидальные мысли и отчаяние сворачиваются в crisis', () => {
  assert.equal(toDbMarker(['hopelessness']), 'crisis');
  assert.equal(toDbMarker(['suicidal_ideation']), 'crisis');
});

test('пустой список маркеров даёт crisis по умолчанию (вызывающая сторона гарантирует непустоту)', () => {
  assert.equal(toDbMarker([]), 'crisis');
});
