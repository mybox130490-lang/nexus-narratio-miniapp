/**
 * Типы кандидата истории — то, что генератор (сейчас: LLM-вызов, см.
 * lib/anthropic.ts) обязан произвести, и ЕДИНСТВЕННОЕ, что смотрит
 * validate_story.ts. Форматы — зеркало docs/ENGINE.md §2, §4, §6, §8.
 *
 * Важное отличие от app/src/types/domain.ts: там — то, что уже лежит в
 * базе (с DB-идентификаторами). Здесь — кандидат ДО вставки, тексты и
 * choice_id придуманы моделью (например "ch_a"), а не сгенерированы БД.
 */

export type AxisName = 'approach' | 'agency' | 'control' | 'voice' | 'loyalty' | 'novelty';
export const AXIS_NAMES: readonly AxisName[] = ['approach', 'agency', 'control', 'voice', 'loyalty', 'novelty'];

export type Pole = 'A' | 'B';

/** Шесть архетипов ENGINE §4. 'self' — Самость, цель дуги, не персонаж. */
export type Archetype = 'shadow' | 'anima_animus' | 'trickster' | 'persona' | 'great_mother' | 'self';
export const ARCHETYPES: readonly Archetype[] = ['shadow', 'anima_animus', 'trickster', 'persona', 'great_mother', 'self'];

export interface AxisMarkCandidate {
  axis: AxisName;
  pole: Pole;
  weight: 0.5 | 1;
}

export interface ChoiceCandidate {
  choice_id: string;
  label: string;
  /** 1–2 отметки (ENGINE §2: «одной, максимум двумя» — иначе разметка размывается). */
  axes: AxisMarkCandidate[];
  /** Обязательна и непуста: вариант без цены — декорация, не развилка. */
  cost: string;
}

export interface FieldTaskCandidate {
  tier: 1 | 2 | 3;
  text: string;
  axis: AxisName;
  expires_hours: number;
  /** Литерально true — заблокированный сюжет запрещён (ENGINE §6.5). */
  skippable: true;
}

export interface SceneCandidate {
  /** 1-based, без пропусков, ровно scenes.length штук на всю историю. */
  scene_index: number;
  text: string;
  /** Должно быть true ⇔ scene_index — последняя сцена (ENGINE §4, §8.5). */
  anchor_required: boolean;
  /** 2–4 у всех сцен, кроме последней — там 0: там якорь, а не выбор. */
  choices: ChoiceCandidate[];
  field_task?: FieldTaskCandidate | null;
}

export interface SeedCandidate {
  motifs: string[];
  tone: string;
  central_conflict: string;
  /** Не более двух (ENGINE §4: «иначе текст превращается в аллегорию»). */
  archetypes: Archetype[];
  /**
   * В каком по счёту (1-based) индексе сцены каждый архетип впервые
   * проявляется в сюжете. Нужен, чтобы механически проверить правило
   * «Самость не вводится раньше предпоследней сцены» — без этого поля
   * validate_story не может увидеть, где именно архетип вошёл в историю.
   */
  archetype_intro_scene?: Partial<Record<Archetype, number>>;
  target_axes: AxisName[];
  blind_spot_to_seed?: string;
}

export interface StoryCandidate {
  seed: SeedCandidate;
  scenes: SceneCandidate[];
}
