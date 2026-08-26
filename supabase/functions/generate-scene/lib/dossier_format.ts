/**
 * Форматирование сырых строк аналитических функций (0003_functions.sql)
 * в дневниковые формулировки для промпта. Разделено с index.ts, чтобы
 * логика форматирования была тестируемой отдельно от похода в базу.
 */

import type { AxisName } from './contract.ts';

export interface TopEntityRow {
  entity_value: string;
  occurrences: number;
  share: number;
  is_pattern: boolean;
}

/**
 * top_entities уже не возвращает вообще ничего, если записей в выборке
 * меньше min_pattern_entries() (см. 0003_functions.sql) — здесь только
 * отбираем то, что сама функция подтвердила как повторяющееся (is_pattern),
 * чтобы в промпт не попадали случайные единичные совпадения.
 */
export function formatActivePatterns(rows: TopEntityRow[], entityLabel: string): string[] {
  return rows
    .filter((r) => r.is_pattern)
    .map((r) => `${entityLabel} «${r.entity_value}» — ${Math.round(r.share * 100)}% записей периода`);
}

export interface ChoiceAxisRow {
  axis_key: string;
  value: number | null;
  n: number;
  is_visible: boolean;
}

/** Оси, где в профиле выбора меньше min_axis_observations() — их и нужно задеть (ENGINE §8.3). */
export function formatUnderObservedAxes(rows: ChoiceAxisRow[]): AxisName[] {
  return rows.filter((r) => !r.is_visible).map((r) => r.axis_key as AxisName);
}
