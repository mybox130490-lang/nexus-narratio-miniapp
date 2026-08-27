/**
 * Что из сцены реально видит пользователь. Оси, полюс и вес — это
 * инструментарий измерения, а не часть текста: «пользователь этого не
 * видит — он просто читает» (ENGINE §8, docs/ROADMAP.md). Здесь это
 * буквально применяется: strip убирает axes/weight перед отправкой
 * клиенту, а не полагается на то, что фронтенд их не отрисует.
 */

export interface StoredAxisMark { axis: string; pole: 'A' | 'B'; weight: 0.5 | 1 }

export interface StoredChoice {
  choice_id: string;
  label: string;
  axes: StoredAxisMark[];
  cost: string;
}

export interface ClientChoice {
  choice_id: string;
  label: string;
  cost: string;
}

export function projectChoices(stored: StoredChoice[]): ClientChoice[] {
  return stored.map(({ choice_id, label, cost }) => ({ choice_id, label, cost }));
}

export interface StoredFieldTask {
  tier: 1 | 2 | 3;
  text: string;
  axis: string;
  expires_hours: number;
  skippable: boolean;
}

export interface ClientFieldTask {
  tier: 1 | 2 | 3;
  text: string;
  expires_hours: number;
  skippable: boolean;
}

export function projectFieldTask(stored: StoredFieldTask | null | undefined): ClientFieldTask | null {
  if (!stored) return null;
  const { tier, text, expires_hours, skippable } = stored;
  return { tier, text, expires_hours, skippable };
}
