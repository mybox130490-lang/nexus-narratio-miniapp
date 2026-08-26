import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanCrisisMarkers, looksLikeMagicalThinking } from '../lib/safety.ts';

test('распознаёт суицидальные мысли', () => {
  const r = scanCrisisMarkers('Иногда думаю, что не хочу жить дальше');
  assert.equal(r.triggered, true);
  assert.ok(r.markers.includes('suicidal_ideation'));
});

test('распознаёт самоповреждение', () => {
  const r = scanCrisisMarkers('Вчера вечером я порезалась, стало легче');
  assert.equal(r.triggered, true);
  assert.ok(r.markers.includes('self_harm'));
});

test('распознаёт острую дереализацию', () => {
  const r = scanCrisisMarkers('Весь день как будто я не в своём теле, мир ненастоящий');
  assert.equal(r.triggered, true);
  assert.ok(r.markers.includes('derealization'));
});

test('обычная запись не триггерит кризисный протокол', () => {
  const r = scanCrisisMarkers('У подъезда стояла чужая собака и смотрела прямо на меня');
  assert.equal(r.triggered, false);
  assert.deepEqual(r.markers, []);
});

test('не путает бытовую усталость с отчаянием', () => {
  const r = scanCrisisMarkers('Устала сегодня, но ничего, завтра будет полегче');
  assert.equal(r.triggered, false);
});

test('распознаёт магическое мышление', () => {
  assert.equal(looksLikeMagicalThinking('Это точно знак, вселенная мне отвечает'), true);
  assert.equal(looksLikeMagicalThinking('Просто увидела бабочку по дороге домой'), false);
});
