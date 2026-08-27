import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInterpretationMuted, activeMuteUntil } from '../lib/mute_check.ts';

const NOW = new Date('2026-06-01T12:00:00Z');

test('без записей — не заглушено', () => {
  assert.equal(isInterpretationMuted([], NOW), false);
  assert.equal(activeMuteUntil([], NOW), null);
});

test('заглушка в прошлом уже не действует', () => {
  const rows = [{ mutes_interpretation_until: '2026-05-01T00:00:00Z' }];
  assert.equal(isInterpretationMuted(rows, NOW), false);
});

test('заглушка в будущем действует', () => {
  const rows = [{ mutes_interpretation_until: '2026-06-05T00:00:00Z' }];
  assert.equal(isInterpretationMuted(rows, NOW), true);
});

test('null не считается заглушкой', () => {
  assert.equal(isInterpretationMuted([{ mutes_interpretation_until: null }], NOW), false);
});

test('берёт самую позднюю активную дату из нескольких событий', () => {
  const rows = [
    { mutes_interpretation_until: '2026-06-02T00:00:00Z' },
    { mutes_interpretation_until: '2026-06-10T00:00:00Z' },
    { mutes_interpretation_until: '2026-05-01T00:00:00Z' }, // уже истекла
  ];
  assert.equal(activeMuteUntil(rows, NOW), '2026-06-10T00:00:00Z');
});
