/**
 * Право вето safety-guardian в коде: если сработал кризисный протокол,
 * следующие 7 дней — режим «только дневник», без трактовок (CONCEPT §16,
 * ENGINE §11). generate-scene обязан отказаться генерировать историю,
 * пока это ограничение активно, — это тот самый пункт правила вето из
 * ROADMAP.md: «генерация без прохода через проверку не публикуется».
 */

export interface MuteRow {
  mutes_interpretation_until: string | null;
}

export function isInterpretationMuted(rows: MuteRow[], now: Date = new Date()): boolean {
  return rows.some((r) => r.mutes_interpretation_until !== null && new Date(r.mutes_interpretation_until) > now);
}

export function activeMuteUntil(rows: MuteRow[], now: Date = new Date()): string | null {
  const active = rows
    .map((r) => r.mutes_interpretation_until)
    .filter((v): v is string => v !== null && new Date(v) > now)
    .sort();
  return active.length > 0 ? active[active.length - 1] : null;
}
