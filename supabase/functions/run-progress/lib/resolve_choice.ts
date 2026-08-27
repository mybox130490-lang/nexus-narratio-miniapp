/**
 * Клиент присылает только choice_id — какой вариант нажал человек.
 * Оси, полюс и вес берутся ИСКЛЮЧИТЕЛЬНО из того, что сервер сам сохранил
 * в scenes.choices при генерации; клиентским данным здесь не доверяют
 * (иначе подделанный запрос мог бы вписать в профиль выбора любые оси).
 */

import type { StoredChoice, StoredAxisMark } from './scene_projection.ts';

export type ResolvedChoice =
  | { ok: true; axes: StoredAxisMark[]; label: string }
  | { ok: false; error: string };

export function resolveChoice(storedChoices: StoredChoice[], choiceId: string): ResolvedChoice {
  const found = storedChoices.find((c) => c.choice_id === choiceId);
  if (!found) {
    return { ok: false, error: `выбор "${choiceId}" не найден в этой сцене` };
  }
  if (!Array.isArray(found.axes) || found.axes.length === 0) {
    return { ok: false, error: `выбор "${choiceId}" сохранён без осевых отметок — данные повреждены` };
  }
  return { ok: true, axes: found.axes, label: found.label };
}
