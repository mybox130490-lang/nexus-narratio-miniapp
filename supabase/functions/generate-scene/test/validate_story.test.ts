import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from '../lib/validate_story.ts';
import { validStory, filler } from './fixtures.ts';

test('образцовая история проходит без ошибок', () => {
  const r = validateStory(validStory());
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid, true);
});

test('принимает 7 сцен (верхняя граница)', () => {
  const r = validateStory(validStory(7));
  assert.equal(r.valid, true);
});

test('отклоняет 4 сцены (меньше минимума)', () => {
  const r = validateStory(validStory(4));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('4 сцен')));
});

test('отклоняет 8 сцен (больше максимума)', () => {
  const r = validateStory(validStory(8));
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('8 сцен')));
});

test('отклоняет пропущенный scene_index', () => {
  const story = validStory();
  story.scenes[2].scene_index = 99;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('пропущен scene_index 3')));
});

test('отклоняет повторяющийся scene_index', () => {
  const story = validStory();
  story.scenes[1].scene_index = story.scenes[0].scene_index;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('повторяется')));
});

test('отклоняет сцену без якоря в конце', () => {
  const story = validStory();
  story.scenes[story.scenes.length - 1].anchor_required = false;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('обязана содержать якорь')));
});

test('отклоняет якорь не в последней сцене', () => {
  const story = validStory();
  story.scenes[0].anchor_required = true;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('якорь допустим только в последней')));
});

test('отклоняет развилки в финальной сцене', () => {
  const story = validStory();
  const last = story.scenes[story.scenes.length - 1];
  last.choices = [
    { choice_id: 'ch_x', label: 'x', axes: [{ axis: 'voice', pole: 'A', weight: 1 }], cost: 'что-то' },
  ];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('только якорь')));
});

test('отклоняет одну развилку в обычной сцене (меньше минимума 2)', () => {
  const story = validStory();
  story.scenes[0].choices = [story.scenes[0].choices[0]];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('1 развилок')));
});

test('отклоняет пять развилок в обычной сцене (больше максимума 4)', () => {
  const story = validStory();
  const extra = { choice_id: 'ch_extra1', label: 'ещё', axes: [{ axis: 'loyalty' as const, pole: 'A' as const, weight: 1 as const }], cost: 'цена' };
  story.scenes[0].choices = [...story.scenes[0].choices, extra, { ...extra, choice_id: 'ch_extra2' }, { ...extra, choice_id: 'ch_extra3' }];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('развилок, нужно 2–4')));
});

test('отклоняет выбор без цены', () => {
  const story = validStory();
  story.scenes[0].choices[0].cost = '';
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('cost обязателен')));
});

test('отклоняет выбор без axes', () => {
  const story = validStory();
  story.scenes[0].choices[0].axes = [];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('хотя бы одна отметка')));
});

test('отклоняет более двух осей на выбор', () => {
  const story = validStory();
  story.scenes[0].choices[0].axes = [
    { axis: 'approach', pole: 'A', weight: 1 },
    { axis: 'agency', pole: 'A', weight: 1 },
    { axis: 'control', pole: 'B', weight: 0.5 },
  ];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('разметка размывается')));
});

test('отклоняет неизвестную ось', () => {
  const story = validStory();
  // @ts-expect-error намеренно некорректное значение для проверки валидатора
  story.scenes[0].choices[0].axes[0].axis = 'curiosity';
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('неизвестная ось')));
});

test('отклоняет вес не 0.5 и не 1', () => {
  const story = validStory();
  // @ts-expect-error намеренно некорректное значение
  story.scenes[0].choices[0].axes[0].weight = 0.7;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('вес должен быть 0.5 или 1')));
});

test('отклоняет повторяющийся choice_id внутри сцены', () => {
  const story = validStory();
  story.scenes[0].choices[1].choice_id = story.scenes[0].choices[0].choice_id;
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('повторяется')));
});

test('отклоняет сцену короче 400 слов', () => {
  const story = validStory();
  story.scenes[0].text = filler(200);
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('200 слов')));
});

test('отклоняет сцену длиннее 700 слов', () => {
  const story = validStory();
  story.scenes[0].text = filler(900);
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('900 слов')));
});

test('отклоняет более двух архетипов на семя', () => {
  const story = validStory();
  story.seed.archetypes = ['shadow', 'trickster', 'persona'];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('не больше 2')));
});

test('требует archetype_intro_scene для self', () => {
  const story = validStory();
  story.seed.archetypes = ['self'];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('archetype_intro_scene.self не указан')));
});

test('отклоняет self, введённый раньше предпоследней сцены', () => {
  const story = validStory(5); // предпоследняя = 4
  story.seed.archetypes = ['self'];
  story.seed.archetype_intro_scene = { self: 2 };
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('не раньше предпоследней')));
});

test('принимает self, введённый ровно в предпоследней сцене', () => {
  const story = validStory(5);
  story.seed.archetypes = ['self'];
  story.seed.archetype_intro_scene = { self: 4 };
  const r = validateStory(story);
  assert.equal(r.valid, true);
});

test('отклоняет повторяющуюся ось в target_axes', () => {
  const story = validStory();
  story.seed.target_axes = ['approach', 'approach'];
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('не должен повторять')));
});

test('отклоняет запрещённую формулировку в тексте сцены', () => {
  const story = validStory();
  story.scenes[0].text = 'Скоро тебя ждёт важная встреча. ' + filler(495);
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('prediction')));
});

test('отклоняет запрещённую формулировку в семени', () => {
  const story = validStory();
  story.seed.central_conflict = 'Твой Сатурн против лёгкости бабочек';
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('jyotish_leak')));
});

test('field_task с skippable=false отклоняется', () => {
  const story = validStory();
  // @ts-expect-error намеренно некорректное значение
  story.scenes[0].field_task = { tier: 1, text: 'найди три предмета', axis: 'novelty', expires_hours: 24, skippable: false };
  const r = validateStory(story);
  assert.ok(r.errors.some((e) => e.includes('skippable обязан быть true')));
});

test('валидный field_task не ломает проверку', () => {
  const story = validStory();
  story.scenes[0].field_task = { tier: 1, text: 'найди три синих предмета', axis: 'novelty', expires_hours: 24, skippable: true };
  const r = validateStory(story);
  assert.equal(r.valid, true);
});

test('собирает несколько ошибок сразу, а не только первую', () => {
  const story = validStory(4); // и число сцен неверно, и...
  story.scenes[0].choices[0].cost = ''; // ...цена пуста
  const r = validateStory(story);
  assert.ok(r.errors.length >= 2);
});
