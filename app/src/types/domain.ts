/**
 * Доменные типы «Турии».
 * Источник истины — docs/ENGINE.md, раздел 6 «Форматы данных».
 * Любое расхождение с ENGINE.md считается багом здесь, а не там.
 */

/** Тип записи улова. По умолчанию продукт — про сон наяву, ночной сон частный случай. */
export type CatchKind =
  | 'image'   // выхватил глазами
  | 'return'  // мысль, к которой возвращался
  | 'repeat'  // одно и то же несколько раз за день
  | 'avert'   // то, на что не захотел смотреть
  | 'dream'   // ночной сон
  | 'scene';  // произошедшая сцена

export const WAKING_KINDS: CatchKind[] = ['image', 'return', 'repeat', 'avert'];

/** Подписи для интерфейса. Вопрос важнее названия — его человек и читает. */
export const KIND_LABEL: Record<CatchKind, { title: string; prompt: string }> = {
  image:  { title: 'Образ',   prompt: 'Что сегодня зацепило взгляд?' },
  return: { title: 'Возврат', prompt: 'К чему ты сегодня возвращался?' },
  repeat: { title: 'Повтор',  prompt: 'Что попалось не один раз?' },
  avert:  { title: 'Отвод',   prompt: 'Что ты сегодня не стал рассматривать?' },
  dream:  { title: 'Сон',     prompt: 'Что осталось от сна?' },
  scene:  { title: 'Сцена',   prompt: 'Что произошло?' },
};

export type Valence = 'negative' | 'neutral' | 'resource';
export type InputKind = 'text' | 'voice' | 'photo';

/** Контекст момента. Заполняется только для сна наяву — у ночного сна его нет. */
export interface CatchContext {
  time_of_day?: 'morning' | 'day' | 'evening' | 'night';
  place_type?: string;
  in_transit?: boolean;
  preceded_by?: string;
  with_people?: boolean;
}

export interface CatchEntities {
  images: string[];
  feelings: string[];
  actions: string[];
  people: string[];
  valence: Valence;
}

export interface CatchEntry {
  id: string;
  user_id: string;
  created_at: string;
  kind: CatchKind;
  raw_text: string;
  input: InputKind;
  audio_retained: boolean;
  context?: CatchContext;
  entities?: CatchEntities;
  day_vector?: Partial<Record<AxisName, number>>;
  linked_pattern_ids?: string[];
}

/** Шесть осей выбора. Разметка развилок — docs/ENGINE.md, раздел 2. */
export type AxisName = 'approach' | 'agency' | 'control' | 'voice' | 'loyalty' | 'novelty';
export type Pole = 'A' | 'B';

export const AXIS_LABEL: Record<AxisName, { a: string; b: string; measures: string }> = {
  approach: { a: 'подойти к напряжению', b: 'отдалиться',       measures: 'реакция на тревогу' },
  agency:   { a: 'действовать',          b: 'наблюдать и ждать', measures: 'своя роль в событиях' },
  control:  { a: 'взять управление',     b: 'отпустить',         measures: 'переносимость неопределённости' },
  voice:    { a: 'назвать вслух',        b: 'промолчать',        measures: 'право на свой голос' },
  loyalty:  { a: 'в свою пользу',        b: 'в пользу другого',  measures: 'границы и вина' },
  novelty:  { a: 'проверенное',          b: 'рискованное',       measures: 'пластичность' },
};

/** Ось не показывается пользователю, пока наблюдений меньше этого числа. Анти-апофения. */
export const MIN_OBSERVATIONS = 5;

export interface AxisMark { axis: AxisName; pole: Pole; weight: 0.5 | 1 }

export interface Choice {
  choice_id: string;
  label: string;
  axes: AxisMark[];
  /** Цена выбора. Обязательна: вариант без цены — не развилка, а декорация. */
  cost: string;
}

export interface FieldTask {
  task_id: string;
  tier: 1 | 2 | 3;
  text: string;
  unlocks_scene: string;
  axis: AxisName;
  expires_hours: number;
  /** Всегда true: заблокированный сюжет — это давление. */
  skippable: true;
}

export interface Scene {
  scene_id: string;
  run_id: string;
  index: number;
  of: number;
  text: string;
  anchor_required: boolean;
  choices: Choice[];
  field_task: FieldTask | null;
}

/** Семя истории. Хранится отдельно от прохождения — иначе перепрохождение невозможно. */
export interface Seed {
  seed_id: string;
  source_catch_id: string;
  created_at: string;
  motifs: string[];
  tone: string;
  central_conflict: string;
  archetypes: string[];
  target_axes: AxisName[];
  published: boolean;
}

export type RunMode = 'first_pass' | 'second_pass' | 'replay_after_months';

export interface Run {
  run_id: string;
  seed_id: string;
  mode: RunMode;
  engine_version: string;
  started_at: string;
  scene_ids: string[];
  recognition_score?: 1 | 2 | 3 | 4 | 5;
  completed: boolean;
  published: boolean;
}

export interface AxisValue { value: number; n: number }

export interface ChoiceProfile {
  updated_at: string;
  axes: Record<AxisName, AxisValue>;
  avoidance_rate: number;
  median_decision_ms: number;
  recognition_score: number;
}

export interface Symbol {
  symbol: string;
  meaning: string;
  confirmations: number;
  confirmed: boolean;
}
