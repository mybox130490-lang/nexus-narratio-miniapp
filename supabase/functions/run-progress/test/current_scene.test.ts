import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCurrentScene } from '../lib/current_scene.ts';

test('ни одна сцена не пройдена — показываем первую', () => {
  const r = resolveCurrentScene({ scenesTotal: 5, resolvedSceneCount: 0 });
  assert.equal(r.sceneIndex, 1);
  assert.equal(r.isFinal, false);
  assert.equal(r.overflow, false);
});

test('пройдено N-1 сцен — показываем последнюю (якорь)', () => {
  const r = resolveCurrentScene({ scenesTotal: 5, resolvedSceneCount: 4 });
  assert.equal(r.sceneIndex, 5);
  assert.equal(r.isFinal, true);
});

test('пройдены все сцены включая последнюю — overflow, но индекс не уезжает за пределы', () => {
  const r = resolveCurrentScene({ scenesTotal: 5, resolvedSceneCount: 5 });
  assert.equal(r.sceneIndex, 5);
  assert.equal(r.isFinal, true);
  assert.equal(r.overflow, true);
});

test('промежуточная сцена', () => {
  const r = resolveCurrentScene({ scenesTotal: 7, resolvedSceneCount: 2 });
  assert.equal(r.sceneIndex, 3);
  assert.equal(r.isFinal, false);
});
