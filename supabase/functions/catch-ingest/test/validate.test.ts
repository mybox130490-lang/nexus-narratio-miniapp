import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngestPayload, ValidationError } from '../lib/validate.ts';

const base = { kind: 'image', raw_text: 'бабочки по дороге домой', input: 'text' };

test('принимает минимально корректный payload', () => {
  const p = parseIngestPayload(base);
  assert.equal(p.kind, 'image');
  assert.equal(p.raw_text, 'бабочки по дороге домой');
  assert.equal(p.input, 'text');
  assert.equal(p.audio_retained, false);
});

test('отклоняет неизвестный kind', () => {
  assert.throws(() => parseIngestPayload({ ...base, kind: 'nightmare' }), ValidationError);
});

test('отклоняет пустой raw_text', () => {
  assert.throws(() => parseIngestPayload({ ...base, raw_text: '   ' }), ValidationError);
});

test('отклоняет слишком длинный raw_text', () => {
  assert.throws(() => parseIngestPayload({ ...base, raw_text: 'а'.repeat(4001) }), ValidationError);
});

test('обрезает пробелы вокруг raw_text', () => {
  const p = parseIngestPayload({ ...base, raw_text: '  текст с пробелами  ' });
  assert.equal(p.raw_text, 'текст с пробелами');
});

test('отклоняет audio_retained=true при input="text"', () => {
  assert.throws(() => parseIngestPayload({ ...base, audio_retained: true }), ValidationError);
});

test('разрешает audio_retained=true при input="voice"', () => {
  const p = parseIngestPayload({ ...base, input: 'voice', audio_retained: true });
  assert.equal(p.audio_retained, true);
});

test('отклоняет непустой контекст у dream', () => {
  assert.throws(
    () => parseIngestPayload({ ...base, kind: 'dream', context: { place_type: 'дом' } }),
    ValidationError,
  );
});

test('разрешает dream с пустым или отсутствующим контекстом', () => {
  assert.doesNotThrow(() => parseIngestPayload({ ...base, kind: 'dream', context: {} }));
  assert.doesNotThrow(() => parseIngestPayload({ ...base, kind: 'dream' }));
});

test('отклоняет tz_offset_minutes вне диапазона часовых поясов', () => {
  assert.throws(() => parseIngestPayload({ ...base, tz_offset_minutes: 2000 }), ValidationError);
});

test('отклоняет тело запроса не-объект', () => {
  assert.throws(() => parseIngestPayload(null), ValidationError);
  assert.throws(() => parseIngestPayload('строка'), ValidationError);
});
