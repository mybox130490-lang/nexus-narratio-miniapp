import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanBannedContent } from '../lib/banned_phrases.ts';

test('ловит предсказание будущего', () => {
  const hits = scanBannedContent('Скоро тебя ждёт важная встреча');
  assert.ok(hits.some((h) => h.category === 'prediction'));
});

test('ловит утечку джйотиш-механики', () => {
  const hits = scanBannedContent('Твой Сатурн сейчас в трудном положении');
  assert.ok(hits.some((h) => h.category === 'jyotish_leak'));
});

test('ловит насилие как решение конфликта', () => {
  const hits = scanBannedContent('Он решил ударить, чтобы решить спор раз и навсегда');
  assert.ok(hits.some((h) => h.category === 'violence_resolution'));
});

test('ловит мистическое разрушение рамки', () => {
  const hits = scanBannedContent('Вселенная тебе послала этот образ неслучайно');
  assert.ok(hits.some((h) => h.category === 'frame_break_mystical'));
});

test('ловит обесценивающее разрушение рамки', () => {
  const hits = scanBannedContent('Это просто игра, расслабься');
  assert.ok(hits.some((h) => h.category === 'frame_break_dismissive'));
});

test('ловит диагноз', () => {
  const hits = scanBannedContent('Судя по всему, у тебя депрессия');
  assert.ok(hits.some((h) => h.category === 'diagnosis'));
});

test('обычный текст сцены не даёт срабатываний', () => {
  const hits = scanBannedContent('Герой подошёл к двери и на секунду замер, прежде чем постучать');
  assert.deepEqual(hits, []);
});
