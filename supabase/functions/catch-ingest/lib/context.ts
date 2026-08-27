/**
 * Контекст момента (ENGINE 6.1). Заполняется только для «сна наяву» —
 * у ночного сна (kind='dream') его нет в принципе, это же ограничение
 * закреплено в базе триггером catches_dream_has_no_context.
 */

export type CatchKind = 'image' | 'return' | 'repeat' | 'avert' | 'dream' | 'scene';

export const WAKING_KINDS: readonly CatchKind[] = ['image', 'return', 'repeat', 'avert'];

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

/** Клиент присылает то, что знает о моменте сам; сервер добавляет только время суток. */
export interface ClientContext {
  place_type?: string;
  in_transit?: boolean;
  preceded_by?: string;
  with_people?: boolean;
}

export interface CatchContext {
  time_of_day?: TimeOfDay;
  place_type?: string;
  in_transit?: boolean;
  preceded_by?: string;
  with_people?: boolean;
}

/** Время суток по локальному часу пользователя, не по UTC — иначе граница дня съезжает. */
export function timeOfDay(localHour: number): TimeOfDay {
  if (localHour >= 5 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 18) return 'day';
  if (localHour >= 18 && localHour < 23) return 'evening';
  return 'night';
}

export interface BuildContextInput {
  kind: CatchKind;
  /** Смещение пользователя от UTC в минутах (JS: -date.getTimezoneOffset() на клиенте). */
  tzOffsetMinutes: number;
  occurredAt: Date;
  client?: ClientContext;
}

export function buildContext({ kind, tzOffsetMinutes, occurredAt, client }: BuildContextInput): CatchContext {
  if (kind === 'dream') return {};

  const localMs = occurredAt.getTime() + tzOffsetMinutes * 60_000;
  const localHour = new Date(localMs).getUTCHours();

  const ctx: CatchContext = { time_of_day: timeOfDay(localHour) };
  if (client?.place_type) ctx.place_type = client.place_type.slice(0, 80);
  if (client?.preceded_by) ctx.preceded_by = client.preceded_by.slice(0, 200);
  if (typeof client?.in_transit === 'boolean') ctx.in_transit = client.in_transit;
  if (typeof client?.with_people === 'boolean') ctx.with_people = client.with_people;
  return ctx;
}
