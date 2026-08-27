import { FunctionsHttpError } from '@supabase/supabase-js';
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
 * supabase-js прячет тело ответа функции за FunctionsHttpError, когда статус
 * не 2xx — error.message тогда общая фраза «non-2xx status code», а конкретную
 * причину (по-русски, как её сформулировал сервер) нужно достать из
 * error.context отдельным чтением тела.
 */
async function edgeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') return body.error;
    } catch { /* тело не JSON — используем текст ошибки ниже */ }
  }
  return error instanceof Error ? error.message : 'неизвестная ошибка';
}

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

  if (error) return { ok: false, reason: 'error', error: await edgeErrorMessage(error) };
  if (data?.error) return { ok: false, reason: 'error', error: data.error as string };

  return {
    ok: true,
    catchId: data.catch.id as string,
    safety: data.safety as SafetyResponse,
  };
}

// --- run-progress (supabase/functions/run-progress) — экран чтения. ---

export interface ProjectedChoice {
  choice_id: string;
  label: string;
  cost: string;
}

export interface ProjectedFieldTask {
  tier: 1 | 2 | 3;
  text: string;
  expires_hours: number;
  skippable: boolean;
}

/**
 * Сцена так, как её видит читатель: без осей и веса — сервер их вырезал
 * (supabase/functions/run-progress/lib/scene_projection.ts). Инструментарий
 * измерения не часть того, что показывается человеку (ENGINE §8).
 */
export interface CurrentScene {
  runId: string;
  runCompleted: boolean;
  sceneId: string;
  sceneIndex: number;
  scenesTotal: number;
  text: string;
  anchorRequired: boolean;
  choices: ProjectedChoice[];
  isFinal: boolean;
  fieldTask: ProjectedFieldTask | null;
}

export type GetCurrentSceneOutcome =
  | { ok: true; scene: CurrentScene }
  | { ok: false; reason: 'no_backend' | 'no_telegram' | 'no_run' | 'error'; error?: string };

export async function getCurrentScene(runId?: string): Promise<GetCurrentSceneOutcome> {
  if (!hasBackend() || !supabase) return { ok: false, reason: 'no_backend' };

  const initData = tg()?.initData;
  if (!initData) return { ok: false, reason: 'no_telegram' };

  const { data, error } = await supabase.functions.invoke('run-progress', {
    body: { initData, action: 'get', run_id: runId },
  });

  if (error) {
    const message = await edgeErrorMessage(error);
    const isNoRun = error instanceof FunctionsHttpError && error.context.status === 404;
    return { ok: false, reason: isNoRun ? 'no_run' : 'error', error: message };
  }
  if (data?.error) return { ok: false, reason: 'error', error: data.error as string };

  return {
    ok: true,
    scene: {
      runId: data.run.id as string,
      runCompleted: data.run.completed as boolean,
      sceneId: data.scene.id as string,
      sceneIndex: data.scene.scene_index as number,
      scenesTotal: data.scene.scenes_total as number,
      text: data.scene.text as string,
      anchorRequired: data.scene.anchor_required as boolean,
      choices: data.scene.choices as ProjectedChoice[],
      isFinal: data.scene.is_final as boolean,
      fieldTask: (data.field_task ?? null) as ProjectedFieldTask | null,
    },
  };
}

export interface SubmitChoiceInput {
  runId: string;
  sceneId: string;
  /** Отсутствует при отказе выбрать (avoidance) — развилка тоже наблюдение. */
  choiceId?: string;
  avoidance?: boolean;
  decisionMs: number;
}

export type SubmitChoiceOutcome = { ok: true } | { ok: false; error: string };

export async function submitChoice(input: SubmitChoiceInput): Promise<SubmitChoiceOutcome> {
  if (!hasBackend() || !supabase) return { ok: false, error: 'бэкенд ещё не подключён' };

  const initData = tg()?.initData;
  if (!initData) return { ok: false, error: 'работает только внутри Telegram' };

  const { data, error } = await supabase.functions.invoke('run-progress', {
    body: {
      initData,
      action: 'choose',
      run_id: input.runId,
      scene_id: input.sceneId,
      choice_id: input.choiceId,
      avoidance: input.avoidance,
      decision_ms: input.decisionMs,
    },
  });

  if (error) return { ok: false, error: await edgeErrorMessage(error) };
  if (data?.error) return { ok: false, error: data.error as string };
  return { ok: true };
}

export type CompleteRunOutcome = { ok: true } | { ok: false; error: string };

export async function completeRun(runId: string, recognitionScore: 1 | 2 | 3 | 4 | 5): Promise<CompleteRunOutcome> {
  if (!hasBackend() || !supabase) return { ok: false, error: 'бэкенд ещё не подключён' };

  const initData = tg()?.initData;
  if (!initData) return { ok: false, error: 'работает только внутри Telegram' };

  const { data, error } = await supabase.functions.invoke('run-progress', {
    body: { initData, action: 'complete', run_id: runId, recognition_score: recognitionScore },
  });

  if (error) return { ok: false, error: await edgeErrorMessage(error) };
  if (data?.error) return { ok: false, error: data.error as string };
  return { ok: true };
}
