/**
 * catch-ingest — приём улова (docs/ENGINE.md §6.1, docs/ROADMAP.md, этап 1).
 *
 * Единственная точка входа записи в дневник. Делает пять вещей по порядку:
 *   1. проверяет initData Telegram — это и есть аутентификация, отдельного
 *      логина в миниаппе нет (docs/ROADMAP.md, «открытые решения»);
 *   2. находит или заводит пользователя (Supabase Auth + public.users);
 *   3. прогоняет текст через предфильтр кризисных маркеров и магического
 *      мышления (safety-guardian) — ДО извлечения сущностей и толкования;
 *   4. извлекает контекст момента и сущности (heuristic_v0, см. lib/entities.ts);
 *   5. пишет catches (+ entities_index для надёжно извлекаемых сущностей,
 *      + safety_events при срабатывании).
 *
 * Что эта функция НЕ делает: не толкует запись и не пишет пользователю
 * художественный текст — это отдельный шаг (толкователь, symbol-interpreter),
 * получающий на входе уже сохранённую запись и обязанный сам пройти полный
 * протокол safety-guardian перед генерацией. Здесь — только приём и триаж.
 */

import { createClient } from '@supabase/supabase-js';
import { verifyInitData } from './lib/telegram.ts';
import { parseIngestPayload, ValidationError } from './lib/validate.ts';
import { buildContext } from './lib/context.ts';
import { extractEntities } from './lib/entities.ts';
import { scanCrisisMarkers, looksLikeMagicalThinking } from './lib/safety.ts';
import { toDbMarker } from './lib/safety_marker.ts';
import { CORS_HEADERS, jsonResponse } from './lib/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

// «Только дневник» на 7 дней и мягкий чекап через 2 (safety-guardian, «Протокол кризиса»).
const CRISIS_MUTE_DAYS = 7;
const CRISIS_CHECKUP_DAYS = 2;
// «3+ записи о знаках» (safety-guardian, «Протокол магического мышления»).
const MAGICAL_THINKING_THRESHOLD = 3;
const MAGICAL_THINKING_WINDOW_DAYS = 30;

interface IngestRequestBody {
  initData?: string;
  payload?: unknown;
}

function admin() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в окружении функции');
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Находит пользователя по telegram_id или заводит нового. Race двух первых
 * запросов от одного telegram_id теоретически возможен (см. README функции):
 * тогда проигравший просто переиспользует строку победителя, а его лишний
 * auth-пользователь остаётся сиротой. Для MVP это принятый компромисс.
 */
async function getOrCreateUser(
  client: ReturnType<typeof admin>,
  telegramId: number,
): Promise<{ id: string; teen_mode: boolean }> {
  const { data: existing, error: selErr } = await client
    .from('users')
    .select('id, teen_mode')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing;

  const syntheticEmail = `tg${telegramId}@users.turiya.local`;
  const { data: created, error: createErr } = await client.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: { telegram_id: telegramId },
  });
  if (createErr) throw createErr;

  const { data: inserted, error: insErr } = await client
    .from('users')
    .insert({ id: created.user.id, telegram_id: telegramId })
    .select('id, teen_mode')
    .single();

  if (insErr) {
    // 23505 = unique_violation: кто-то успел вставить ту же telegram_id первым.
    if ((insErr as { code?: string }).code === '23505') {
      const { data: raced, error: racedErr } = await client
        .from('users')
        .select('id, teen_mode')
        .eq('telegram_id', telegramId)
        .single();
      if (racedErr) throw racedErr;
      return raced;
    }
    throw insErr;
  }
  return inserted;
}

async function countRecentMagicalThinking(
  client: ReturnType<typeof admin>,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - MAGICAL_THINKING_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from('safety_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('marker', 'magical_thinking')
    .gte('created_at', since);
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'только POST' }, 405);

  let body: IngestRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'тело запроса не JSON' }, 400);
  }

  if (typeof body.initData !== 'string') {
    return jsonResponse({ error: 'нет initData' }, 401);
  }

  let verified;
  try {
    verified = await verifyInitData(body.initData, BOT_TOKEN);
  } catch (e) {
    return jsonResponse({ error: `initData не прошла проверку: ${(e as Error).message}` }, 401);
  }

  let payload;
  try {
    payload = parseIngestPayload(body.payload);
  } catch (e) {
    if (e instanceof ValidationError) return jsonResponse({ error: e.message }, 400);
    throw e;
  }

  let client: ReturnType<typeof admin>;
  try {
    client = admin();
  } catch (e) {
    // Отсутствие секретов окружения — ошибка конфигурации, а не запроса:
    // логируем полный текст, пользователю отдаём только факт неполадки.
    console.error('admin client misconfigured', e);
    return jsonResponse({ error: 'функция временно недоступна' }, 500);
  }

  let user: { id: string; teen_mode: boolean };
  try {
    user = await getOrCreateUser(client, verified.user.id);
  } catch (e) {
    console.error('getOrCreateUser failed', e);
    return jsonResponse({ error: 'не удалось определить пользователя' }, 500);
  }

  // --- Триаж безопасности: до извлечения сущностей и толкования. ---
  const crisisScan = scanCrisisMarkers(payload.raw_text);
  const magicalHit = looksLikeMagicalThinking(payload.raw_text);

  const occurredAt = new Date();
  const context = buildContext({
    kind: payload.kind,
    tzOffsetMinutes: payload.tz_offset_minutes ?? 0,
    occurredAt,
    client: payload.context,
  });
  const entities = extractEntities(payload.raw_text);

  const { data: catchRow, error: catchErr } = await client
    .from('catches')
    .insert({
      user_id: user.id,
      kind: payload.kind,
      raw_text: payload.raw_text,
      input: payload.input,
      audio_retained: payload.audio_retained ?? false,
      context,
      entities: {
        images: entities.images,
        feelings: entities.feelings,
        actions: entities.actions,
        valence: entities.valence,
      },
    })
    .select('id, created_at')
    .single();

  if (catchErr || !catchRow) {
    console.error('insert catches failed', catchErr);
    return jsonResponse({ error: 'не удалось сохранить запись' }, 500);
  }

  // Слой 2 (ENGINE 7.2): индексируем только надёжно извлечённое — чувства.
  // images/actions пока пусты (heuristic_v0), поэтому строк для них нет.
  if (entities.feelings.length > 0) {
    const rows = entities.feelings.map((value) => ({
      catch_id: catchRow.id,
      user_id: user.id,
      occurred_at: catchRow.created_at,
      type: 'feeling' as const,
      value,
    }));
    const { error: idxErr } = await client.from('entities_index').insert(rows);
    if (idxErr) console.error('entities_index insert failed (не блокирует ответ)', idxErr);
  }

  let crisisResponse: { active: boolean; message?: string; checkup_at?: string } = { active: false };

  if (crisisScan.triggered) {
    const mutesUntil = new Date(Date.now() + CRISIS_MUTE_DAYS * 24 * 60 * 60 * 1000);
    const checkupAt = new Date(Date.now() + CRISIS_CHECKUP_DAYS * 24 * 60 * 60 * 1000);
    const { error: safetyErr } = await client.from('safety_events').insert({
      user_id: user.id,
      marker: toDbMarker(crisisScan.markers),
      verdict: 'crisis_protocol',
      surface: 'catch',
      catch_id: catchRow.id,
      details: { markers: crisisScan.markers, checkup_in_days: CRISIS_CHECKUP_DAYS },
      mutes_interpretation_until: mutesUntil.toISOString(),
    });
    if (safetyErr) console.error('safety_events insert failed (кризис!)', safetyErr);

    crisisResponse = {
      active: true,
      // Признание чувств → предложение живого контакта. Без конкретных
      // номеров служб: список ресурсов по региону — отдельная, поддерживаемая
      // таблица, а не то, что можно надёжно захардкодить в этой функции.
      message:
        'Похоже, тебе сейчас очень тяжело. Это важнее любого толкования — ' +
        'пожалуйста, поговори с человеком, которому доверяешь, или со специалистом ' +
        'службы психологической помощи. Следующие дни мы просто ведём дневник, без трактовок.',
      checkup_at: checkupAt.toISOString(),
    };
  } else if (magicalHit) {
    const priorCount = await countRecentMagicalThinking(client, user.id);
    const totalCount = priorCount + 1;
    const { error: safetyErr } = await client.from('safety_events').insert({
      user_id: user.id,
      marker: 'magical_thinking',
      verdict: totalCount >= MAGICAL_THINKING_THRESHOLD ? 'edit' : 'approve',
      surface: 'catch',
      catch_id: catchRow.id,
      details: { recent_count: totalCount, window_days: MAGICAL_THINKING_WINDOW_DAYS },
    });
    if (safetyErr) console.error('safety_events insert failed (magical_thinking)', safetyErr);
  }

  return jsonResponse({
    catch: { id: catchRow.id, created_at: catchRow.created_at },
    entities,
    context,
    safety: crisisResponse,
  });
});
