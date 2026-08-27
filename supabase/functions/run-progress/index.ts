/**
 * run-progress — движение по уже сгенерированному прохождению
 * (docs/ENGINE.md §6–8, docs/ROADMAP.md, этап 2, «экран чтения»).
 *
 * Три действия одной функции, объединённые общей моделью данных:
 *  - get:      какую сцену показать сейчас (без осей/веса — см. lib/scene_projection.ts);
 *  - choose:   записать сделанный выбор (или отказ выбрать — avoidance);
 *  - complete: закрыть прохождение якорем и «узнаванием» (1–5).
 *
 * Курсора прохождения в базе нет: текущая сцена всегда выводится из того,
 * сколько сцен уже получили хотя бы одну строку в choices
 * (lib/current_scene.ts). Это же используется как защита от «choose» не по
 * текущей сцене — в прошлое не перезаписать, вперёд не перескочить.
 *
 * Оси, полюс и вес выбора клиент никогда не присылает и никогда не видит:
 * choose получает только choice_id, а сервер сам находит, какие оси этому
 * choice_id соответствуют, в scenes.choices, которые он же сохранил при
 * генерации (lib/resolve_choice.ts). Подделать запрос и вписать себе
 * произвольную ось в профиль выбора нельзя — сервер её не спрашивает.
 */

import { createClient } from '@supabase/supabase-js';
import { verifyInitData } from '../_shared/telegram.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { resolveCurrentScene } from './lib/current_scene.ts';
import { projectChoices, projectFieldTask, type StoredChoice, type StoredFieldTask } from './lib/scene_projection.ts';
import { resolveChoice } from './lib/resolve_choice.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

function admin() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в окружении функции');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

type Client = ReturnType<typeof admin>;

interface RequestBody {
  initData?: string;
  action?: 'get' | 'choose' | 'complete';
  run_id?: string;
  scene_id?: string;
  choice_id?: string;
  decision_ms?: number;
  avoidance?: boolean;
  recognition_score?: number;
}

interface SceneRow {
  id: string;
  scene_index: number;
  scenes_total: number;
  text: string;
  anchor_required: boolean;
  choices: StoredChoice[];
}

async function findUser(client: Client, telegramId: number) {
  const { data, error } = await client.from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
  if (error) throw new Error(`user lookup failed: ${error.message}`);
  return data as { id: string } | null;
}

/** Прохождение по run_id (проверяя владельца) либо последнее незакрытое прохождение пользователя. */
async function resolveRun(client: Client, userId: string, runId: string | undefined) {
  const query = client.from('runs').select('id, completed').eq('user_id', userId);
  const { data, error } = runId
    ? await query.eq('id', runId).maybeSingle()
    : await query.eq('completed', false).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`run lookup failed: ${error.message}`);
  return data as { id: string; completed: boolean } | null;
}

async function fetchScenes(client: Client, runId: string): Promise<SceneRow[]> {
  const { data, error } = await client
    .from('scenes')
    .select('id, scene_index, scenes_total, text, anchor_required, choices')
    .eq('run_id', runId)
    .order('scene_index', { ascending: true });
  if (error) throw new Error(`scenes lookup failed: ${error.message}`);
  return (data ?? []) as SceneRow[];
}

async function countResolvedScenes(client: Client, runId: string): Promise<number> {
  const { data, error } = await client.from('choices').select('scene_id').eq('run_id', runId);
  if (error) throw new Error(`choices lookup failed: ${error.message}`);
  return new Set((data ?? []).map((c: { scene_id: string }) => c.scene_id)).size;
}

async function fetchFieldTask(client: Client, sceneId: string): Promise<StoredFieldTask | null> {
  const { data, error } = await client
    .from('field_tasks')
    .select('tier, text, axis, expires_hours, skippable')
    .eq('scene_id', sceneId)
    .order('issued_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`field_tasks lookup failed: ${error.message}`);
  return (data ?? null) as StoredFieldTask | null;
}

async function handleGet(client: Client, userId: string, body: RequestBody) {
  const run = await resolveRun(client, userId, body.run_id);
  if (!run) return jsonResponse({ error: 'прохождение не найдено' }, 404);

  const scenes = await fetchScenes(client, run.id);
  if (scenes.length === 0) return jsonResponse({ error: 'у прохождения нет сцен' }, 500);

  const resolvedSceneCount = await countResolvedScenes(client, run.id);
  const current = resolveCurrentScene({ scenesTotal: scenes[0].scenes_total, resolvedSceneCount });
  if (current.overflow) {
    console.error('run overflow: больше отмеченных сцен, чем всего сцен', { runId: run.id, resolvedSceneCount });
  }

  const scene = scenes.find((s) => s.scene_index === current.sceneIndex);
  if (!scene) return jsonResponse({ error: 'не удалось определить текущую сцену' }, 500);

  const fieldTask = await fetchFieldTask(client, scene.id);

  return jsonResponse({
    run: { id: run.id, completed: run.completed },
    scene: {
      id: scene.id,
      scene_index: scene.scene_index,
      scenes_total: scene.scenes_total,
      text: scene.text,
      anchor_required: scene.anchor_required,
      choices: projectChoices(scene.choices),
      is_final: current.isFinal,
    },
    field_task: projectFieldTask(fieldTask),
  });
}

async function handleChoose(client: Client, userId: string, body: RequestBody) {
  if (typeof body.run_id !== 'string' || !body.run_id) return jsonResponse({ error: 'нет run_id' }, 400);
  if (typeof body.scene_id !== 'string' || !body.scene_id) return jsonResponse({ error: 'нет scene_id' }, 400);
  const decisionMs = body.decision_ms;
  if (decisionMs !== undefined && (typeof decisionMs !== 'number' || decisionMs < 0)) {
    return jsonResponse({ error: 'decision_ms должен быть неотрицательным числом' }, 400);
  }

  const run = await resolveRun(client, userId, body.run_id);
  if (!run) return jsonResponse({ error: 'прохождение не найдено' }, 404);
  if (run.completed) return jsonResponse({ error: 'прохождение уже завершено' }, 409);

  const scenes = await fetchScenes(client, run.id);
  const scene = scenes.find((s) => s.id === body.scene_id);
  if (!scene) return jsonResponse({ error: 'сцена не найдена в этом прохождении' }, 404);

  const resolvedSceneCount = await countResolvedScenes(client, run.id);
  const current = resolveCurrentScene({ scenesTotal: scene.scenes_total, resolvedSceneCount });
  if (scene.scene_index !== current.sceneIndex) {
    return jsonResponse({ error: 'это не текущая сцена прохождения' }, 409);
  }

  if (body.avoidance === true) {
    const { error } = await client.from('choices').insert({
      user_id: userId,
      run_id: run.id,
      scene_id: scene.id,
      avoidance: true,
      decision_ms: decisionMs ?? null,
    });
    if (error) {
      console.error('insert avoidance choice failed', error);
      return jsonResponse({ error: 'не удалось сохранить отказ от выбора' }, 500);
    }
    return jsonResponse({ ok: true });
  }

  if (typeof body.choice_id !== 'string' || !body.choice_id) return jsonResponse({ error: 'нет choice_id' }, 400);

  const resolved = resolveChoice(scene.choices, body.choice_id);
  if (!resolved.ok) return jsonResponse({ error: resolved.error }, 400);

  const rows = resolved.axes.map((mark) => ({
    user_id: userId,
    run_id: run.id,
    scene_id: scene.id,
    choice_id: body.choice_id,
    axis: mark.axis,
    pole: mark.pole,
    weight: mark.weight,
    decision_ms: decisionMs ?? null,
    avoidance: false,
  }));

  const { error } = await client.from('choices').insert(rows);
  if (error) {
    console.error('insert choice failed', error);
    return jsonResponse({ error: 'не удалось сохранить выбор' }, 500);
  }

  return jsonResponse({ ok: true });
}

async function handleComplete(client: Client, userId: string, body: RequestBody) {
  if (typeof body.run_id !== 'string' || !body.run_id) return jsonResponse({ error: 'нет run_id' }, 400);
  const score = body.recognition_score;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return jsonResponse({ error: 'recognition_score должен быть целым числом от 1 до 5' }, 400);
  }

  const run = await resolveRun(client, userId, body.run_id);
  if (!run) return jsonResponse({ error: 'прохождение не найдено' }, 404);
  if (run.completed) return jsonResponse({ error: 'прохождение уже завершено' }, 409);

  const scenes = await fetchScenes(client, run.id);
  if (scenes.length === 0) return jsonResponse({ error: 'у прохождения нет сцен' }, 500);

  const resolvedSceneCount = await countResolvedScenes(client, run.id);
  const current = resolveCurrentScene({ scenesTotal: scenes[0].scenes_total, resolvedSceneCount });
  if (!current.isFinal) {
    return jsonResponse({ error: 'прохождение ещё не дошло до финальной сцены' }, 409);
  }

  const { error } = await client
    .from('runs')
    .update({ completed: true, recognition_score: score })
    .eq('id', run.id)
    .eq('user_id', userId);
  if (error) {
    console.error('complete run failed', error);
    return jsonResponse({ error: 'не удалось завершить прохождение' }, 500);
  }

  return jsonResponse({ ok: true });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'только POST' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'тело запроса не JSON' }, 400);
  }

  if (typeof body.initData !== 'string') return jsonResponse({ error: 'нет initData' }, 401);
  if (body.action !== 'get' && body.action !== 'choose' && body.action !== 'complete') {
    return jsonResponse({ error: 'action должен быть get, choose или complete' }, 400);
  }

  let verified;
  try {
    verified = await verifyInitData(body.initData, BOT_TOKEN);
  } catch (e) {
    return jsonResponse({ error: `initData не прошла проверку: ${(e as Error).message}` }, 401);
  }

  let client: Client;
  try {
    client = admin();
  } catch (e) {
    console.error('admin client misconfigured', e);
    return jsonResponse({ error: 'функция временно недоступна' }, 500);
  }

  let user: { id: string } | null;
  try {
    user = await findUser(client, verified.user.id);
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: 'не удалось определить пользователя' }, 500);
  }
  if (!user) return jsonResponse({ error: 'пользователь ещё не сделал ни одной записи улова' }, 404);

  try {
    if (body.action === 'get') return await handleGet(client, user.id, body);
    if (body.action === 'choose') return await handleChoose(client, user.id, body);
    return await handleComplete(client, user.id, body);
  } catch (e) {
    console.error('run-progress failed', e);
    return jsonResponse({ error: 'не удалось обработать запрос' }, 500);
  }
});
