/**
 * generate-scene — драматург (docs/ENGINE.md §2–10, docs/ROADMAP.md, этап 2).
 *
 * Берёт одну зацепку (catch_id), собирает вокруг неё семя из дистиллята,
 * подтверждённых паттернов и недостающих осей профиля, зовёт модель по
 * контракту lib/prompt.ts и НЕ пускает результат в базу, пока он не
 * пройдёт lib/validate_story.ts — тот же набор правил, что продублирован
 * триггерами в 0001_init.sql. Отклонённый ответ уходит на повтор с
 * перечнем конкретных нарушений, а не молча чинится и не проходит как есть.
 *
 * Право вето: если у пользователя активен кризисный протокол
 * (safety_events.mutes_interpretation_until в будущем), генерация
 * отклоняется на входе, ещё до обращения к модели.
 *
 * Что функция НЕ делает: не строит темы драматургии из джйотиш-карты
 * (chartThemes уходит пустым списком, пока карта не подключена — см.
 * README) и не создаёт «replay_after_months»/«second_pass» — повторные
 * прогоны существующего семени через месяцы это отдельная точка входа,
 * здесь только первое прохождение (mode='first_pass').
 */

import { createClient } from '@supabase/supabase-js';
import { verifyInitData } from '../_shared/telegram.ts';
import { CORS_HEADERS, jsonResponse } from '../_shared/cors.ts';
import { buildScenePrompt, type SeedDossier, type SourceKind } from './lib/prompt.ts';
import { callAnthropic } from './lib/anthropic.ts';
import { extractJson } from './lib/extract_json.ts';
import { validateStory } from './lib/validate_story.ts';
import { isInterpretationMuted } from './lib/mute_check.ts';
import { formatActivePatterns, formatUnderObservedAxes, type TopEntityRow, type ChoiceAxisRow } from './lib/dossier_format.ts';
import type { StoryCandidate } from './lib/contract.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const MAX_GENERATION_ATTEMPTS = 3;
const ENGINE_VERSION = 'scene-engine@0.1.0';

function admin() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в окружении функции');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface RequestBody {
  initData?: string;
  catch_id?: string;
}

async function buildDossier(
  client: ReturnType<typeof admin>,
  userId: string,
  catchText: string,
  catchKind: SourceKind,
): Promise<SeedDossier> {
  const [{ data: symbols }, { data: figures }, feelings, images, actions, axes] = await Promise.all([
    client.from('symbols').select('symbol, meaning').eq('user_id', userId).eq('confirmed', true).limit(20),
    client.from('figures').select('name, archetype').eq('user_id', userId).limit(20),
    client.rpc('top_entities', { p_type: 'feeling', p_user_id: userId }),
    client.rpc('top_entities', { p_type: 'image', p_user_id: userId }),
    client.rpc('top_entities', { p_type: 'action', p_user_id: userId }),
    client.rpc('choice_profile_axes', { p_user_id: userId }),
  ]);

  const patterns = [
    ...formatActivePatterns((feelings.data ?? []) as TopEntityRow[], 'чувство'),
    ...formatActivePatterns((images.data ?? []) as TopEntityRow[], 'образ'),
    ...formatActivePatterns((actions.data ?? []) as TopEntityRow[], 'действие'),
  ];

  return {
    sourceCatchText: catchText,
    sourceKind: catchKind,
    distillateSymbols: (symbols ?? []).map((s: { symbol: string; meaning: string }) => ({ symbol: s.symbol, meaning: s.meaning })),
    distillateFigures: (figures ?? [])
      .filter((f: { archetype: string | null }) => f.archetype)
      .map((f: { name: string; archetype: string }) => ({ name: f.name, archetype: f.archetype })),
    activePatterns: patterns,
    chartThemes: [], // джйотиш-движок ещё не подключён — см. README функции
    showMechanics: false, // тумблер «показать механику»; настройка на уровне пользователя — задел на будущее
    underObservedAxes: formatUnderObservedAxes((axes.data ?? []) as ChoiceAxisRow[]),
  };
}

async function generateValidStory(
  dossier: SeedDossier,
): Promise<{ story: StoryCandidate; attempts: number } | { story: null; attempts: number; lastErrors: string[] }> {
  const { system, user: baseUser } = buildScenePrompt(dossier);
  let lastErrors: string[] = [];

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const userPrompt =
      attempt === 1
        ? baseUser
        : `${baseUser}\n\nПредыдущая попытка не прошла проверку. Поправь и пришли снова целиком:\n` +
          lastErrors.map((e) => `— ${e}`).join('\n');

    let candidate: StoryCandidate;
    try {
      const { text } = await callAnthropic({ system, user: userPrompt });
      candidate = extractJson(text) as StoryCandidate;
    } catch (e) {
      lastErrors = [`попытка ${attempt}: ответ модели не удалось разобрать — ${(e as Error).message}`];
      continue;
    }

    const result = validateStory(candidate);
    if (result.valid) return { story: candidate, attempts: attempt };
    lastErrors = result.errors;
  }

  return { story: null, attempts: MAX_GENERATION_ATTEMPTS, lastErrors };
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
  if (typeof body.catch_id !== 'string' || !body.catch_id) return jsonResponse({ error: 'нет catch_id' }, 400);

  let verified;
  try {
    verified = await verifyInitData(body.initData, BOT_TOKEN);
  } catch (e) {
    return jsonResponse({ error: `initData не прошла проверку: ${(e as Error).message}` }, 401);
  }

  let client: ReturnType<typeof admin>;
  try {
    client = admin();
  } catch (e) {
    console.error('admin client misconfigured', e);
    return jsonResponse({ error: 'функция временно недоступна' }, 500);
  }

  const { data: user, error: userErr } = await client
    .from('users')
    .select('id')
    .eq('telegram_id', verified.user.id)
    .maybeSingle();
  if (userErr) {
    console.error('user lookup failed', userErr);
    return jsonResponse({ error: 'не удалось определить пользователя' }, 500);
  }
  if (!user) {
    return jsonResponse({ error: 'пользователь ещё не сделал ни одной записи улова' }, 404);
  }

  // --- Право вето: кризисный протокол глушит трактовки и генерацию на 7 дней. ---
  const { data: mutes, error: mutesErr } = await client
    .from('safety_events')
    .select('mutes_interpretation_until')
    .eq('user_id', user.id)
    .not('mutes_interpretation_until', 'is', null);
  if (mutesErr) {
    console.error('safety_events lookup failed', mutesErr);
    return jsonResponse({ error: 'не удалось проверить ограничения безопасности' }, 500);
  }
  if (isInterpretationMuted(mutes ?? [])) {
    return jsonResponse(
      { error: 'сейчас режим «только дневник» — истории приостановлены', muted: true },
      403,
    );
  }

  const { data: catchRow, error: catchErr } = await client
    .from('catches')
    .select('id, kind, raw_text')
    .eq('id', body.catch_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (catchErr) {
    console.error('catch lookup failed', catchErr);
    return jsonResponse({ error: 'не удалось найти запись' }, 500);
  }
  if (!catchRow) return jsonResponse({ error: 'запись не найдена' }, 404);

  const dossier = await buildDossier(client, user.id, catchRow.raw_text, catchRow.kind as SourceKind);

  const generated = await generateValidStory(dossier);
  if (!generated.story) {
    console.error('generation failed after retries', generated.lastErrors);
    return jsonResponse(
      { error: 'не удалось сгенерировать историю, прошедшую проверку', details: generated.lastErrors },
      502,
    );
  }

  const { story, attempts } = generated;

  const { data: seedRow, error: seedErr } = await client
    .from('seeds')
    .insert({
      user_id: user.id,
      source_catch_id: catchRow.id,
      motifs: story.seed.motifs,
      tone: story.seed.tone,
      central_conflict: story.seed.central_conflict,
      archetypes: story.seed.archetypes,
      target_axes: story.seed.target_axes,
      blind_spot_to_seed: story.seed.blind_spot_to_seed ?? null,
      themes_from_chart: [],
      season: null,
    })
    .select('id')
    .single();
  if (seedErr || !seedRow) {
    console.error('insert seeds failed', seedErr);
    return jsonResponse({ error: 'не удалось сохранить семя' }, 500);
  }

  const { data: runRow, error: runErr } = await client
    .from('runs')
    .insert({
      seed_id: seedRow.id,
      user_id: user.id,
      engine_version: ENGINE_VERSION,
      mode: 'first_pass',
      completed: false,
    })
    .select('id')
    .single();
  if (runErr || !runRow) {
    console.error('insert runs failed', runErr);
    return jsonResponse({ error: 'не удалось сохранить прохождение' }, 500);
  }

  const scenesTotal = story.scenes.length;
  const sceneInsert = story.scenes
    .slice()
    .sort((a, b) => a.scene_index - b.scene_index)
    .map((scene) => ({
      run_id: runRow.id,
      user_id: user.id,
      scene_index: scene.scene_index,
      scenes_total: scenesTotal,
      text: scene.text,
      anchor_required: scene.anchor_required,
      choices: scene.choices,
    }));

  const { data: insertedScenes, error: scenesErr } = await client
    .from('scenes')
    .insert(sceneInsert)
    .select('id, scene_index');
  if (scenesErr || !insertedScenes) {
    console.error('insert scenes failed (нарушение инварианта, которое должен был поймать validateStory)', scenesErr);
    return jsonResponse({ error: 'не удалось сохранить сцены' }, 500);
  }

  const sceneIdByIndex = new Map(insertedScenes.map((s: { id: string; scene_index: number }) => [s.scene_index, s.id]));

  const fieldTaskInsert = story.scenes
    .filter((scene) => scene.field_task)
    .map((scene) => {
      const ft = scene.field_task!;
      return {
        user_id: user.id,
        run_id: runRow.id,
        scene_id: sceneIdByIndex.get(scene.scene_index) ?? null,
        // Задание, показанное в сцене N, по умолчанию открывает сцену N+1 —
        // контракт кандидата не даёт иного адресата (см. комментарий вверху файла).
        unlocks_scene_id: sceneIdByIndex.get(scene.scene_index + 1) ?? null,
        tier: ft.tier,
        text: ft.text,
        axis: ft.axis,
        expires_hours: ft.expires_hours,
        skippable: true,
      };
    });

  if (fieldTaskInsert.length > 0) {
    const { error: ftErr } = await client.from('field_tasks').insert(fieldTaskInsert);
    if (ftErr) console.error('insert field_tasks failed (не блокирует ответ)', ftErr);
  }

  return jsonResponse({
    seed: { id: seedRow.id },
    run: { id: runRow.id, mode: 'first_pass' },
    scenes: insertedScenes,
    generation_attempts: attempts,
  });
});
