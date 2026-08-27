import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectChoices, projectFieldTask } from '../lib/scene_projection.ts';

test('снимает оси и вес с развилок, оставляя только то, что читает человек', () => {
  const out = projectChoices([
    { choice_id: 'ch_a', label: 'Постучать', axes: [{ axis: 'voice', pole: 'A', weight: 1 }], cost: 'разрушить видимость' },
  ]);
  assert.deepEqual(out, [{ choice_id: 'ch_a', label: 'Постучать', cost: 'разрушить видимость' }]);
  assert.ok(!('axes' in out[0]));
});

test('пустой список развилок остаётся пустым (финальная сцена)', () => {
  assert.deepEqual(projectChoices([]), []);
});

test('field_task без оси, если задание есть', () => {
  const out = projectFieldTask({ tier: 1, text: 'найди три синих предмета', axis: 'novelty', expires_hours: 24, skippable: true });
  assert.deepEqual(out, { tier: 1, text: 'найди три синих предмета', expires_hours: 24, skippable: true });
  assert.ok(!('axis' in (out as object)));
});

test('field_task=null остаётся null', () => {
  assert.equal(projectFieldTask(null), null);
  assert.equal(projectFieldTask(undefined), null);
});
