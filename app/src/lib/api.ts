import { supabase, hasBackend } from './supabase';
import { tg } from './telegram';
import type { CatchKind, InputKind } from '../types/domain';

export interface SubmitCatchInput {
  kind: CatchKind;
  raw_text: string;
  input?: InputKind;
}

interface SafetyResponse {
  active: boolean;
  message?: string;
  checkup_at?: string;
}

export type SubmitCatchOutcome =
  | { ok: true; catchId: string; safety: SafetyResponse }
  | { ok: false; reason: 'no_backend' | 'no_telegram' | 'error'; error?: string };

/**
 * Отправляет запись в catch-ingest (supabase/functions/catch-ingest).
 * Без бэкенда или вне Telegram отдаёт понятную причину отказа — вызывающий
 * код решает, что делать (в частности, никогда не теряет черновик молча).
 */
export async function submitCatch(input: SubmitCatchInput): Promise<SubmitCatchOutcome> {
  if (!hasBackend() || !supabase) return { ok: false, reason: 'no_backend' };

  const initData = tg()?.initData;
  if (!initData) return { ok: false, reason: 'no_telegram' };

  const payload = {
    kind: input.kind,
    raw_text: input.raw_text,
    input: input.input ?? 'text',
    // getTimezoneOffset() отдаёт минуты, которые нужно ВЫЧЕСТЬ из локального
    // времени, чтобы получить UTC — знак противоположен тому, что ждёт сервер.
    tz_offset_minutes: -new Date().getTimezoneOffset(),
  };

  const { data, error } = await supabase.functions.invoke('catch-ingest', {
    body: { initData, payload },
  });

  if (error) return { ok: false, reason: 'error', error: error.message };
  if (data?.error) return { ok: false, reason: 'error', error: data.error as string };

  return {
    ok: true,
    catchId: data.catch.id as string,
    safety: data.safety as SafetyResponse,
  };
}
