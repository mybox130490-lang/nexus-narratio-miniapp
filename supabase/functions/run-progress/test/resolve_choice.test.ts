import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChoice } from '../lib/resolve_choice.ts';
import type { StoredChoice } from '../lib/scene_projection.ts';

const CHOICES: StoredChoice[] = [
  { choice_id: 'ch_a', label: 'Постучать', axes: [{ axis: 'voice', pole: 'A', weight: 1 }], cost: 'разрушить видимость' },
  { choice_id: 'ch_b', label: 'Подождать', axes: [{ axis: 'control', pole: 'B', weight: 0.5 }], cost: 'ночь с догадкой' },
];

test('находит выбор и возвращает его оси из хранимых данных, не от клиента', () => {
  const r = resolveChoice(CHOICES, 'ch_b');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.axes, [{ axis: 'control', pole: 'B', weight: 0.5 }]);
    assert.equal(r.label, 'Подождать');
  }
});

test('неизвестный choice_id отклоняется с понятной ошибкой', () => {
  const r = resolveChoice(CHOICES, 'ch_z');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /не найден/);
});

test('choice без осей (повреждённые данные) отклоняется, а не проходит молча', () => {
  const broken: StoredChoice[] = [{ choice_id: 'ch_x', label: 'x', axes: [], cost: 'x' }];
  const r = resolveChoice(broken, 'ch_x');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /повреждены/);
});
