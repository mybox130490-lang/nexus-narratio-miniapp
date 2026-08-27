import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScenePrompt, type SeedDossier } from '../lib/prompt.ts';

function baseDossier(overrides: Partial<SeedDossier> = {}): SeedDossier {
  return {
    sourceCatchText: 'у подъезда стояла чужая собака и смотрела прямо на меня',
    sourceKind: 'image',
    distillateSymbols: [],
    distillateFigures: [],
    activePatterns: [],
    chartThemes: [],
    showMechanics: false,
    underObservedAxes: [],
    ...overrides,
  };
}

test('системный промпт называет жёсткие числа формы', () => {
  const { system } = buildScenePrompt(baseDossier());
  assert.match(system, /5–7 сцен/);
  assert.match(system, /400–700 слов/);
  assert.match(system, /2–4 развилки/);
  assert.match(system, /cost/);
});

test('по умолчанию механика джйотиш скрыта', () => {
  const { system } = buildScenePrompt(baseDossier({ showMechanics: false }));
  assert.match(system, /не называются пользователю/);
});

test('включённый тумблер явно снимает запрет', () => {
  const { system } = buildScenePrompt(baseDossier({ showMechanics: true }));
  assert.match(system, /можно называть темы карты/);
});

test('пользовательский промпт содержит саму зацепку дословно', () => {
  const { user } = buildScenePrompt(baseDossier({ sourceCatchText: 'бабочки по дороге домой' }));
  assert.match(user, /бабочки по дороге домой/);
});

test('для kind=repeat добавляется предупреждение против трактовки как знака', () => {
  const { user } = buildScenePrompt(baseDossier({ sourceKind: 'repeat' }));
  assert.match(user, /класс «синхроний»/);
  assert.match(user, /не должно звучать, что/);
});

test('для остальных kind предупреждение о repeat не добавляется', () => {
  const { user } = buildScenePrompt(baseDossier({ sourceKind: 'image' }));
  assert.doesNotMatch(user, /класс «синхроний»/);
});

test('личный словарь символов попадает в промпт', () => {
  const { user } = buildScenePrompt(
    baseDossier({ distillateSymbols: [{ symbol: 'собака', meaning: 'настороженность' }] }),
  );
  assert.match(user, /собака: настороженность/);
});

test('пустые секции не оставляют в промпте пустых заголовков', () => {
  const { user } = buildScenePrompt(baseDossier());
  assert.doesNotMatch(user, /Личный словарь символов/);
  assert.doesNotMatch(user, /Карта персонажей/);
  assert.doesNotMatch(user, /Активные паттерны/);
});

test('недостающие оси профиля перечисляются с просьбой их задеть', () => {
  const { user } = buildScenePrompt(baseDossier({ underObservedAxes: ['novelty', 'loyalty'] }));
  assert.match(user, /novelty, loyalty/);
  assert.match(user, /целенаправленно построй/i);
});
