/**
 * Соответствие детальных маркеров предфильтра (lib/safety.ts) перечислению
 * safety_marker в базе (0001_init.sql). Приоритет на случай, если сработало
 * сразу несколько: самоповреждение и насилие важнее общего 'crisis'.
 */
import type { CrisisMarker } from './safety.ts';

export type DbSafetyMarker = 'crisis' | 'self_harm' | 'violence' | 'derealization' | 'magical_thinking';

const PRIORITY: CrisisMarker[] = ['self_harm', 'violence', 'derealization', 'suicidal_ideation', 'hopelessness'];

export function toDbMarker(markers: CrisisMarker[]): DbSafetyMarker {
  for (const m of PRIORITY) {
    if (markers.includes(m)) {
      if (m === 'suicidal_ideation' || m === 'hopelessness') return 'crisis';
      return m;
    }
  }
  return 'crisis';
}
