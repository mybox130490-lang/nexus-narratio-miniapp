import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeOfDay, buildContext } from '../lib/context.ts';

test('границы времени суток', () => {
  assert.equal(timeOfDay(4), 'night');
  assert.equal(timeOfDay(5), 'morning');
  assert.equal(timeOfDay(11), 'morning');
  assert.equal(timeOfDay(12), 'day');
  assert.equal(timeOfDay(17), 'day');
  assert.equal(timeOfDay(18), 'evening');
  assert.equal(timeOfDay(22), 'evening');
  assert.equal(timeOfDay(23), 'night');
  assert.equal(timeOfDay(0), 'night');
});

test('у ночного сна контекста нет, даже если клиент его прислал', () => {
  const ctx = buildContext({
    kind: 'dream',
    tzOffsetMinutes: 180,
    occurredAt: new Date('2026-01-01T10:00:00Z'),
    client: { place_type: 'дом', in_transit: true },
  });
  assert.deepEqual(ctx, {});
});

test('для сна наяву считает время суток по локальному часу, не по UTC', () => {
  // 22:30 UTC + 3 часа (Москва) = 01:30 следующего дня по местному времени → night
  const ctx = buildContext({
    kind: 'image',
    tzOffsetMinutes: 180,
    occurredAt: new Date('2026-01-01T22:30:00Z'),
    client: {},
  });
  assert.equal(ctx.time_of_day, 'night');
});

test('пробрасывает контекст клиента и обрезает длинные строки', () => {
  const longText = 'а'.repeat(500);
  const ctx = buildContext({
    kind: 'return',
    tzOffsetMinutes: 0,
    occurredAt: new Date('2026-01-01T12:00:00Z'),
    client: { place_type: 'улица', preceded_by: longText, in_transit: true, with_people: false },
  });
  assert.equal(ctx.place_type, 'улица');
  assert.equal(ctx.preceded_by!.length, 200);
  assert.equal(ctx.in_transit, true);
  assert.equal(ctx.with_people, false);
  assert.equal(ctx.time_of_day, 'day');
});

test('не добавляет поля, которых клиент не прислал', () => {
  const ctx = buildContext({
    kind: 'avert',
    tzOffsetMinutes: 0,
    occurredAt: new Date('2026-01-01T12:00:00Z'),
  });
  assert.deepEqual(ctx, { time_of_day: 'day' });
});
