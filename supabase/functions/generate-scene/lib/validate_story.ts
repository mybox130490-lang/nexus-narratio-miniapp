/**
 * Страж контракта генерации. Проверяет кандидата истории ДО того, как он
 * дойдёт до базы, — по тем же правилам, что зашиты триггерами в
 * supabase/migrations/0001_init.sql (scenes_total_in_range,
 * scenes_choices_count, scenes_anchor_on_last, choices_shape и т.д.),
 * плюс те правила ENGINE.md §2–10, которые в схему не переносятся
 * (объём сцены, банальные фразы, правило Самости).
 *
 * Собирает ВСЕ ошибки, а не первую: если генерацию нужно повторить с
 * замечаниями, модель должна получить полный список сразу, а не чинить
 * по одной за прогон.
 */

import { AXIS_NAMES, ARCHETYPES, type StoryCandidate, type SceneCandidate, type ChoiceCandidate } from './contract.ts';
import { countWords } from './text.ts';
import { scanBannedContent } from './banned_phrases.ts';

export const SCENE_COUNT_MIN = 5;
export const SCENE_COUNT_MAX = 7;
export const CHOICE_COUNT_MIN = 2;
export const CHOICE_COUNT_MAX = 4;
export const SCENE_WORDS_MIN = 400;
export const SCENE_WORDS_MAX = 700;
export const MAX_ARCHETYPES_PER_SEED = 2;
export const MAX_AXES_PER_CHOICE = 2;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isAxisName(v: unknown): v is (typeof AXIS_NAMES)[number] {
  return typeof v === 'string' && (AXIS_NAMES as readonly string[]).includes(v);
}

function validateChoice(choice: ChoiceCandidate, sceneIndex: number, errors: string[]): void {
  const where = `сцена ${sceneIndex}, выбор "${choice.choice_id || '(без id)'}"`;

  if (!choice.choice_id || !choice.choice_id.trim()) {
    errors.push(`${where}: choice_id пуст`);
  }
  if (!choice.label || !choice.label.trim()) {
    errors.push(`${where}: label пуст`);
  }
  if (!choice.cost || !choice.cost.trim()) {
    errors.push(`${where}: cost обязателен — вариант без цены не развилка, а декорация (ENGINE §6.4)`);
  }

  if (!Array.isArray(choice.axes) || choice.axes.length === 0) {
    errors.push(`${where}: нужна хотя бы одна отметка axes`);
  } else if (choice.axes.length > MAX_AXES_PER_CHOICE) {
    errors.push(`${where}: axes.length=${choice.axes.length} > ${MAX_AXES_PER_CHOICE} — разметка размывается (ENGINE §2)`);
  } else {
    for (const mark of choice.axes) {
      if (!isAxisName(mark.axis)) errors.push(`${where}: неизвестная ось "${mark.axis}"`);
      if (mark.pole !== 'A' && mark.pole !== 'B') errors.push(`${where}: полюс должен быть A или B, получено "${mark.pole}"`);
      if (mark.weight !== 0.5 && mark.weight !== 1) errors.push(`${where}: вес должен быть 0.5 или 1, получено ${mark.weight}`);
    }
  }

  const bannedInLabel = scanBannedContent(choice.label ?? '');
  const bannedInCost = scanBannedContent(choice.cost ?? '');
  for (const hit of [...bannedInLabel, ...bannedInCost]) {
    errors.push(`${where}: запрещённая формулировка (${hit.category}): "${hit.phrase}"`);
  }
}

function validateScene(scene: SceneCandidate, isLast: boolean, errors: string[]): void {
  const where = `сцена ${scene.scene_index}`;

  const words = countWords(scene.text ?? '');
  if (words < SCENE_WORDS_MIN || words > SCENE_WORDS_MAX) {
    errors.push(`${where}: ${words} слов, нужно ${SCENE_WORDS_MIN}–${SCENE_WORDS_MAX} (ENGINE §8.1)`);
  }

  if (scene.anchor_required !== isLast) {
    errors.push(
      isLast
        ? `${where}: последняя сцена обязана содержать якорь (anchor_required=true, ENGINE §8.5)`
        : `${where}: якорь допустим только в последней сцене`,
    );
  }

  const choiceCount = Array.isArray(scene.choices) ? scene.choices.length : 0;
  if (isLast) {
    if (choiceCount !== 0) errors.push(`${where}: в финальной сцене нет развилок, только якорь (получено ${choiceCount})`);
  } else if (choiceCount < CHOICE_COUNT_MIN || choiceCount > CHOICE_COUNT_MAX) {
    errors.push(`${where}: ${choiceCount} развилок, нужно ${CHOICE_COUNT_MIN}–${CHOICE_COUNT_MAX} (ENGINE §8.2)`);
  }

  if (Array.isArray(scene.choices)) {
    const ids = new Set<string>();
    for (const choice of scene.choices) {
      validateChoice(choice, scene.scene_index, errors);
      if (choice.choice_id) {
        if (ids.has(choice.choice_id)) errors.push(`${where}: choice_id "${choice.choice_id}" повторяется`);
        ids.add(choice.choice_id);
      }
    }
  }

  if (scene.field_task) {
    const ft = scene.field_task;
    if (![1, 2, 3].includes(ft.tier)) errors.push(`${where}: field_task.tier должен быть 1, 2 или 3`);
    if (!ft.text || !ft.text.trim()) errors.push(`${where}: field_task.text пуст`);
    if (!isAxisName(ft.axis)) errors.push(`${where}: field_task.axis "${ft.axis}" неизвестна`);
    if (!(ft.expires_hours > 0)) errors.push(`${where}: field_task.expires_hours должен быть положительным`);
    if (ft.skippable !== true) errors.push(`${where}: field_task.skippable обязан быть true — заблокированный сюжет запрещён (ENGINE §6.5)`);
  }

  for (const hit of scanBannedContent(scene.text ?? '')) {
    errors.push(`${where}: запрещённая формулировка (${hit.category}): "${hit.phrase}"`);
  }
}

export function validateStory(candidate: StoryCandidate): ValidationResult {
  const errors: string[] = [];
  const { seed, scenes } = candidate;

  // --- Семя ---
  if (!Array.isArray(seed.archetypes) || seed.archetypes.length > MAX_ARCHETYPES_PER_SEED) {
    errors.push(`семя: архетипов не больше ${MAX_ARCHETYPES_PER_SEED} на историю (ENGINE §4)`);
  }
  for (const a of seed.archetypes ?? []) {
    if (!(ARCHETYPES as readonly string[]).includes(a)) errors.push(`семя: неизвестный архетип "${a}"`);
  }
  if (!Array.isArray(seed.target_axes) || seed.target_axes.some((a) => !isAxisName(a))) {
    errors.push('семя: target_axes содержит неизвестную ось');
  } else if (new Set(seed.target_axes).size !== seed.target_axes.length) {
    errors.push('семя: target_axes не должен повторять одну и ту же ось');
  }

  // --- Число и нумерация сцен ---
  const total = Array.isArray(scenes) ? scenes.length : 0;
  if (total < SCENE_COUNT_MIN || total > SCENE_COUNT_MAX) {
    errors.push(`история: ${total} сцен, нужно ${SCENE_COUNT_MIN}–${SCENE_COUNT_MAX} (ENGINE §8.1)`);
  }

  if (Array.isArray(scenes)) {
    const seenIndexes = new Set<number>();
    for (const scene of scenes) {
      if (seenIndexes.has(scene.scene_index)) errors.push(`история: scene_index ${scene.scene_index} повторяется`);
      seenIndexes.add(scene.scene_index);
    }
    for (let i = 1; i <= total; i++) {
      if (!seenIndexes.has(i)) errors.push(`история: пропущен scene_index ${i}`);
    }

    for (const scene of scenes) {
      validateScene(scene, scene.scene_index === total, errors);
    }
  }

  // --- Правило Самости: не раньше предпоследней сцены (ENGINE §4) ---
  if (seed.archetypes?.includes('self')) {
    const introAt = seed.archetype_intro_scene?.self;
    if (introAt === undefined) {
      errors.push('семя: архетип "self" присутствует, но archetype_intro_scene.self не указан');
    } else if (total > 0 && introAt < total - 1) {
      errors.push(`семя: "self" введён в сцене ${introAt}, а не раньше предпоследней (${total - 1}) — ENGINE §4`);
    }
  }

  for (const hit of scanBannedContent(seed.tone ?? '') .concat(scanBannedContent(seed.central_conflict ?? ''))) {
    errors.push(`семя: запрещённая формулировка (${hit.category}): "${hit.phrase}"`);
  }

  return { valid: errors.length === 0, errors };
}
