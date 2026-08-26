-- =====================================================================
-- 0001_init.sql — базовая схема данных «Турии»
-- Источник истины: docs/ENGINE.md разделы 6 (форматы данных) и 7
-- (хранилище и иерархия памяти), docs/CONCEPT.md разделы 13–14.
--
-- Принципы, зашитые в схему:
--   1. Дневник приватен по конструкции: у пользовательских таблиц улова,
--      аналитики и дистиллята НЕТ и не может быть флага публикации.
--      Публикуются только runs и seeds (ENGINE 9, CONCEPT 14).
--   2. Удаление аккаунта каскадное и безвозвратное: все внешние ключи
--      объявлены с ON DELETE CASCADE, корень каскада — public.users.
--   3. Семя (seeds) хранится отдельно от прохождения (runs), иначе
--      перепрохождение «та же зацепка через полгода» невозможно.
-- =====================================================================

-- extensions добавлен в search_path, потому что на Supabase расширение
-- vector по умолчанию живёт в схеме extensions, а локально — в public.
set search_path = public, extensions, pg_catalog;

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- слой 3 иерархии памяти (ENGINE 7.2)


-- ---------------------------------------------------------------------
-- Перечисления
-- ---------------------------------------------------------------------

-- Уровень калибровки трактовок (CONCEPT 6.2).
create type user_role as enum ('novice', 'explorer', 'master');

-- Шесть подтипов записи улова (ENGINE 6.1). Первые четыре — «сон наяву»,
-- dream — ночной сон, scene — произошедшая сцена.
create type catch_kind as enum ('image', 'return', 'repeat', 'avert', 'dream', 'scene');

-- Способ ввода (ENGINE 6.1, CONCEPT 5.4).
create type input_kind as enum ('text', 'voice', 'photo');

-- Валентность записи; основа индекса направленности (pattern-analytics).
create type valence as enum ('negative', 'neutral', 'resource');

-- Тип нормализованной сущности для частотной аналитики (ENGINE 7.2, слой 2).
-- Людей здесь сознательно нет: в ENGINE 6.1 они хранятся обезличенно
-- внутри catches.entities и в частотный индекс не выносятся.
create type entity_type as enum ('image', 'feeling', 'action', 'place');

-- Период свёртки (ENGINE 7.2, слой 4).
create type rollup_period as enum ('week', 'month', 'year');

-- Режим прохождения (ENGINE 6.3, правила 6–7 раздела 8).
create type run_mode as enum ('first_pass', 'second_pass', 'replay_after_months');

-- Шесть осей выбора (ENGINE 2).
create type axis_name as enum ('approach', 'agency', 'control', 'voice', 'loyalty', 'novelty');

-- Полюс оси (ENGINE 2): A — первый полюс таблицы осей, B — второй.
create type axis_pole as enum ('A', 'B');

-- Вердикт скилла safety-guardian. Право вето не отменяется ничем.
create type safety_verdict as enum ('approve', 'edit', 'veto', 'crisis_protocol');

-- сверх спецификации: перечень маркеров срабатывания. В ENGINE journal
-- безопасности не описан форматом, взято из протоколов safety-guardian.
create type safety_marker as enum (
  'crisis',              -- суицидальность, отчаяние без просвета
  'self_harm',
  'violence',
  'derealization',
  'magical_thinking',    -- «мир подаёт знак», решения «потому что бот сказал»
  'dependency',          -- нездоровая зависимость от приложения
  'teen_topic',          -- тема, не трактуемая в режиме 14–17
  'other'
);


-- ---------------------------------------------------------------------
-- Общий триггер обновления updated_at
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- users — корень каскада удаления
-- ---------------------------------------------------------------------
-- id совпадает с auth.users.id: Telegram-логин обменивается на
-- Supabase-сессию, дальше RLS работает по auth.uid().
-- Удаление строки в auth.users сносит вообще все данные пользователя.
create table users (
  id                   uuid primary key references auth.users (id) on delete cascade,
  telegram_id          bigint      not null unique,
  role                 user_role   not null default 'novice',
  -- Режим 14–17 (CONCEPT 16, safety-guardian): проще язык, нет коллективного
  -- слоя, публикация закрыта на уровне API и триггером в 0002_rls.sql.
  teen_mode            boolean     not null default false,

  -- Согласия. Все отзываемые в один клик (CONCEPT 13.3).
  consent_terms_at     timestamptz,                    -- принятие условий и рамки «я приложение, а не психолог»
  consent_collective   boolean     not null default false,  -- агрегаты сообщества, k >= 20 (ENGINE 9)
  consent_collective_at timestamptz,
  consent_biometrics   boolean     not null default false,  -- сверх спецификации: пульс/сон из pattern-analytics
  -- «Сохранять голос» — отдельная опция (CONCEPT 13.1). По умолчанию
  -- голосовое транскрибируется и удаляется.
  retain_audio         boolean     not null default false,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

comment on table users is 'Пользователи. Корень каскадного удаления: снос строки уносит весь дневник, эмбеддинги, свёртки и истории.';
comment on column users.retain_audio is 'Если false — аудио удаляется сразу после успешной транскрипции (ENGINE 7.1).';


-- ---------------------------------------------------------------------
-- catches — слой 1 иерархии памяти: сырые записи улова (ENGINE 6.1)
-- ---------------------------------------------------------------------
-- Флага публикации здесь нет и не будет: дневник приватен по конструкции
-- (CONCEPT 14.1). Это архитектурное решение, а не настройка.
create table catches (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references users (id) on delete cascade,
  kind           catch_kind  not null,
  raw_text       text        not null,
  input          input_kind  not null default 'text',
  audio_retained boolean     not null default false,

  -- Контекст момента: только для «сна наяву». Главный источник корреляций
  -- «когда и где твоё внимание ходит туда» (ENGINE 6.1, CONCEPT 5.3).
  context        jsonb       not null default '{}'::jsonb,
  -- Разбор записи моделью: images / feelings / actions / people / valence.
  entities       jsonb       not null default '{}'::jsonb,
  -- Частичный вектор по осям выбора за день (ENGINE 6.1).
  day_vector     jsonb       not null default '{}'::jsonb,
  -- сверх спецификации задачи: поле есть в ENGINE 6.1, но таблицы паттернов
  -- в задании нет, поэтому храним внешние id массивом без внешнего ключа.
  linked_pattern_ids text[]  not null default '{}',

  created_at     timestamptz not null default now(),

  -- У ночного сна контекста нет в принципе (ENGINE 6.1).
  constraint catches_dream_has_no_context
    check (kind <> 'dream' or context = '{}'::jsonb),
  -- Валентность ограничена тремя значениями индекса направленности.
  constraint catches_valence_valid
    check (
      entities->>'valence' is null
      or entities->>'valence' in ('negative', 'neutral', 'resource')
    ),
  constraint catches_raw_text_not_blank check (btrim(raw_text) <> ''),
  -- Аудио можно оставлять только с явного согласия — сверяется в приложении;
  -- здесь фиксируем сам факт хранения.
  constraint catches_audio_only_for_voice
    check (not audio_retained or input = 'voice')
);

-- Основной запрос продукта: лента и периоды пользователя.
create index catches_user_created_idx on catches (user_id, created_at desc);
-- Отчёты по подтипам: «сколько avert за месяц», «серии по dream».
create index catches_user_kind_created_idx on catches (user_id, kind, created_at desc);
-- Индекс направленности считает доли по валентности за период.
create index catches_user_valence_created_idx
  on catches (user_id, (entities->>'valence'), created_at desc);
-- Точечный поиск по разобранным сущностям и контексту.
create index catches_entities_gin_idx on catches using gin (entities jsonb_path_ops);
create index catches_context_gin_idx  on catches using gin (context  jsonb_path_ops);

comment on table catches is 'Слой 1: сырые записи. Никогда не публикуются и не удаляются, кроме как по команде пользователя (ENGINE 7.2, CONCEPT 14.1).';


-- ---------------------------------------------------------------------
-- entities_index — слой 2: нормализованные сущности (ENGINE 7.2)
-- ---------------------------------------------------------------------
-- Вся частотная аналитика считается SQL-запросами, без участия модели.
create table entities_index (
  id          bigint      generated always as identity primary key,
  catch_id    uuid        not null references catches (id) on delete cascade,
  -- сверх спецификации: user_id и occurred_at денормализованы из catches,
  -- чтобы частотные запросы и RLS не требовали join'а на каждую строку.
  user_id     uuid        not null references users (id) on delete cascade,
  occurred_at timestamptz not null,
  type        entity_type not null,
  value       text        not null,

  constraint entities_index_value_not_blank check (btrim(value) <> ''),
  -- Одна и та же сущность в одной записи учитывается один раз, иначе
  -- частоты врут при повторном разборе записи моделью.
  constraint entities_index_unique_per_catch unique (catch_id, type, value)
);

-- Топ образов/чувств/действий за период — основной аналитический запрос.
create index entities_index_user_type_time_idx on entities_index (user_id, type, occurred_at desc);
-- Серии, циклы и «когда этот образ появлялся» по конкретному значению.
create index entities_index_user_type_value_idx on entities_index (user_id, type, value, occurred_at desc);
create index entities_index_catch_idx on entities_index (catch_id);

-- Нормализация значения: нижний регистр без краевых пробелов. Делается
-- в БД, чтобы «Собака» и «собака » не разъезжались в частотах.
create or replace function normalize_entity_value()
returns trigger
language plpgsql
as $$
begin
  new.value = lower(btrim(new.value));
  return new;
end;
$$;

create trigger entities_index_normalize
  before insert or update of value on entities_index
  for each row execute function normalize_entity_value();

comment on table entities_index is 'Слой 2: нормализованные сущности для детерминированной SQL-аналитики. Не публикуется никогда.';
comment on column entities_index.type is 'place берётся из catches.context->>place_type; люди в индекс не попадают — они хранятся обезличенно в catches.entities.';


-- ---------------------------------------------------------------------
-- rollups — слой 4: свёртки, то, что уходит в промпт вместо истории
-- ---------------------------------------------------------------------
create table rollups (
  id           uuid          primary key default gen_random_uuid(),
  user_id      uuid          not null references users (id) on delete cascade,
  period       rollup_period not null,
  period_start date          not null,
  summary      text          not null,   -- недельное резюме ~500 знаков
  stats        jsonb         not null default '{}'::jsonb,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),

  constraint rollups_unique_period unique (user_id, period, period_start)
);

create index rollups_user_period_idx on rollups (user_id, period, period_start desc);

create trigger rollups_set_updated_at
  before update on rollups
  for each row execute function set_updated_at();

comment on table rollups is 'Слой 4: свёртки week/month/year. В промпт генератора сцен идут они, а не сырая история (ENGINE 7.2).';


-- ---------------------------------------------------------------------
-- embeddings — слой 3: pgvector
-- ---------------------------------------------------------------------
-- Размерность 1536 выбрана под text-embedding-3-small. Смена модели —
-- смена размерности, то есть новая миграция и переиндексация (см. README).
create table embeddings (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references users (id) on delete cascade,
  catch_id   uuid        references catches (id) on delete cascade,
  rollup_id  uuid        references rollups (id) on delete cascade,
  model      text        not null,
  embedding  vector(1536) not null,
  created_at timestamptz not null default now(),

  -- Вектор привязан ровно к одному объекту: либо к записи, либо к свёртке.
  constraint embeddings_exactly_one_source
    check (num_nonnulls(catch_id, rollup_id) = 1)
);

create unique index embeddings_catch_model_idx  on embeddings (catch_id, model)  where catch_id is not null;
create unique index embeddings_rollup_model_idx on embeddings (rollup_id, model) where rollup_id is not null;
-- ANN-индекс для семантического поиска «ты уже писал это — 4 марта и 11 июня».
-- Косинусная метрика: тексты записей разной длины.
create index embeddings_vector_idx on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_user_idx on embeddings (user_id);

comment on table embeddings is 'Слой 3: семантический поиск похожих записей и свёрток.';


-- ---------------------------------------------------------------------
-- symbols — слой 5: личный сонник (ENGINE 7.2)
-- ---------------------------------------------------------------------
-- Личный словарь имеет приоритет над общей базой архетипов (CONCEPT 6.2).
create table symbols (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references users (id) on delete cascade,
  symbol        text        not null,
  meaning       text        not null,
  confirmations integer     not null default 0,
  confirmed     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint symbols_unique_per_user unique (user_id, symbol),
  constraint symbols_confirmations_non_negative check (confirmations >= 0)
);

create index symbols_user_confirmed_idx on symbols (user_id, confirmed);

create trigger symbols_set_updated_at
  before update on symbols
  for each row execute function set_updated_at();

comment on table symbols is 'Слой 5, дистиллят: личный сонник. Всегда в контексте генерации, никогда не публикуется.';


-- ---------------------------------------------------------------------
-- figures — слой 5: карта персонажей (ENGINE 7.2)
-- ---------------------------------------------------------------------
-- сверх спецификации: формат карты персонажей в ENGINE не описан, поля
-- выведены из раздела 4 «Юнг → фигуры».
create table figures (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references users (id) on delete cascade,
  name         text        not null,     -- как фигура названа в дневнике, обезличенно
  archetype    text,                     -- shadow | anima | animus | trickster | persona | great_mother | self
  description  text,
  mentions     integer     not null default 0,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint figures_unique_per_user unique (user_id, name),
  constraint figures_mentions_non_negative check (mentions >= 0)
);

create index figures_user_archetype_idx on figures (user_id, archetype);

create trigger figures_set_updated_at
  before update on figures
  for each row execute function set_updated_at();

comment on table figures is 'Слой 5, дистиллят: карта персонажей. Не публикуется никогда.';


-- ---------------------------------------------------------------------
-- seeds — семя истории (ENGINE 6.2)
-- ---------------------------------------------------------------------
-- Неизменяемый снимок входных условий, хранится ОТДЕЛЬНО от прохождений:
-- одно семя → много runs, включая прогон через полгода.
create table seeds (
  id                   uuid        primary key default gen_random_uuid(),
  user_id              uuid        not null references users (id) on delete cascade,
  -- Отвязка, а не каскад: удаление одной зацепки не должно уносить историю,
  -- тем более опубликованную. Семя само по себе — снимок мотивов и конфликта,
  -- оно переживает исходную запись (CONCEPT 8.1, 14.2). Полное удаление
  -- аккаунта всё равно каскадит через user_id.
  source_catch_id      uuid        references catches (id) on delete set null,
  motifs               text[]      not null default '{}',
  tone                 text,
  central_conflict     text,
  themes_from_chart    text[]      not null default '{}',  -- джйотиш-темы, пользователю не показываются
  season               text,                                -- даша/антардаша: тема месяца
  archetypes           text[]      not null default '{}',
  blind_spot_to_seed   text,
  target_axes          axis_name[] not null default '{}',
  -- сверх спецификации: в ENGINE 6.2 это presets_snapshot_id вида pre_...,
  -- но таблицы снимков предустановок в задании нет — храним id без FK.
  presets_snapshot_id  uuid,
  -- Публикуемая сущность: играбельный сценарий (ENGINE 9).
  published            boolean     not null default false,
  published_at         timestamptz,
  created_at           timestamptz not null default now(),

  -- Не более двух архетипических фигур на историю (ENGINE 4).
  constraint seeds_max_two_archetypes check (cardinality(archetypes) <= 2),
  -- Целевые оси не дублируются.
  constraint seeds_target_axes_sane check (cardinality(target_axes) <= 6)
);

create index seeds_user_created_idx on seeds (user_id, created_at desc);
create index seeds_source_catch_idx on seeds (source_catch_id);
create index seeds_published_idx on seeds (published) where published;

-- Семя — неизменяемый снимок. Меняться может только состояние публикации,
-- иначе перепрохождение сравнивало бы разные условия и теряло смысл.
create or replace function seeds_immutable_snapshot()
returns trigger
language plpgsql
as $$
begin
  -- Отвязка от удалённой зацепки разрешена: её выполняет сам внешний ключ
  -- при удалении записи дневника. Переуказать источник на другую зацепку
  -- по-прежнему нельзя — это подменило бы условия перепрохождения.
  if new.source_catch_id is not null
     and new.source_catch_id is distinct from old.source_catch_id then
    raise exception 'seed %: источник нельзя переуказать', old.id
      using errcode = 'restrict_violation';
  end if;

  if (to_jsonb(new) - 'published' - 'published_at' - 'source_catch_id') is distinct from
     (to_jsonb(old) - 'published' - 'published_at' - 'source_catch_id') then
    raise exception 'seed % неизменяем: править можно только published/published_at', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger seeds_no_edit
  before update on seeds
  for each row execute function seeds_immutable_snapshot();

comment on table seeds is 'Семя истории: неизменяемый снимок входных условий (ENGINE 6.2). Публикуется без исходной зацепки и предустановок.';


-- ---------------------------------------------------------------------
-- runs — прохождение (ENGINE 6.3)
-- ---------------------------------------------------------------------
create table runs (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references users (id) on delete cascade,
  seed_id           uuid        not null references seeds (id) on delete cascade,
  mode              run_mode    not null default 'first_pass',
  engine_version    text        not null,   -- например scene-engine@1.4.0
  -- replays_scene_id заполняется только для second_pass; внешний ключ
  -- добавляется ниже, после создания таблицы scenes.
  replays_scene_id  uuid,
  recognition_score smallint,               -- «узнавание» 1–5, ставит пользователь
  completed         boolean     not null default false,
  -- Публикуемая сущность: только тексты сцен, без семени и трактовок (ENGINE 9).
  published         boolean     not null default false,
  published_at      timestamptz,
  started_at        timestamptz not null default now(),

  constraint runs_recognition_range
    check (recognition_score is null or recognition_score between 1 and 5),
  -- Второй проход всегда указывает сцену, которую переигрывают (ENGINE 8.6).
  constraint runs_second_pass_has_scene
    check (mode <> 'second_pass' or replays_scene_id is not null)
);

create index runs_user_started_idx on runs (user_id, started_at desc);
-- Сравнение двух прохождений одного семени — киллерфича «та же зацепка
-- через полгода»: выборка по seed_id с сортировкой по времени.
create index runs_seed_started_idx on runs (seed_id, started_at);
create index runs_published_idx on runs (published) where published;

comment on table runs is 'Прохождение истории. Одно семя → много runs (ENGINE 6.3).';


-- ---------------------------------------------------------------------
-- scenes — сцена (ENGINE 6.4)
-- ---------------------------------------------------------------------
create table scenes (
  id              uuid        primary key default gen_random_uuid(),
  run_id          uuid        not null references runs (id) on delete cascade,
  -- сверх спецификации: user_id денормализован ради простого RLS-предиката
  -- без join'а на runs при каждом чтении сцены.
  user_id         uuid        not null references users (id) on delete cascade,
  -- В ENGINE 6.4 поля называются index и of; index/of — слова с особым
  -- статусом в SQL, поэтому переименованы без изменения смысла.
  scene_index     smallint    not null,
  scenes_total    smallint    not null,
  text            text        not null,
  -- Последняя сцена обязана содержать якорь — возврат из L2 в L0 (ENGINE 8.5).
  anchor_required boolean     not null default false,
  -- Варианты развилки как они предъявлены: [{choice_id,label,axes[],cost}].
  -- Это часть текста сцены, а не лог поведения; сделанные выборы — в choices.
  choices         jsonb       not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),

  constraint scenes_unique_index_per_run unique (run_id, scene_index),
  constraint scenes_index_in_range check (scene_index between 1 and scenes_total),
  -- История — 5–7 сцен (ENGINE 8.1).
  constraint scenes_total_in_range check (scenes_total between 5 and 7),
  -- Развилок в сцене 2–4, у каждой цена (ENGINE 8.2, 6.4). Финальная сцена
  -- может обойтись без развилок: там якорь, а не выбор.
  constraint scenes_choices_count
    check (
      jsonb_array_length(choices) between 2 and 4
      or (scene_index = scenes_total and jsonb_array_length(choices) = 0)
    ),
  -- Якорь обязателен ровно в последней сцене.
  constraint scenes_anchor_on_last
    check (anchor_required = (scene_index = scenes_total))
);

create index scenes_run_index_idx on scenes (run_id, scene_index);
create index scenes_user_created_idx on scenes (user_id, created_at desc);

alter table runs
  add constraint runs_replays_scene_fk
  foreign key (replays_scene_id) references scenes (id) on delete cascade;

comment on table scenes is 'Сцена прохождения (ENGINE 6.4). scene_index/scenes_total = index/of спецификации.';
comment on column scenes.choices is 'Предъявленные варианты с осями и обязательной ценой. Вариант без cost переписывается (ENGINE 6.4).';


-- ---------------------------------------------------------------------
-- choices — лог сделанных выборов (ENGINE 2, 6.3 choice_log)
-- ---------------------------------------------------------------------
-- Одна строка = одна пометка оси. Вариант может нести до двух осей
-- (ENGINE 2), поэтому на один клик приходится 1–2 строки.
-- Отказ выбрать (пропуск, выход) пишется строкой с avoidance = true и
-- пустыми осями: «не выбрать» — тоже данные.
create table choices (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references users (id) on delete cascade,
  run_id      uuid        not null references runs (id) on delete cascade,
  scene_id    uuid        not null references scenes (id) on delete cascade,
  choice_id   text,                       -- id варианта внутри сцены, например ch_a
  axis        axis_name,
  pole        axis_pole,
  weight      numeric(2,1),               -- 0.5 слабое проявление, 1.0 явное
  decision_ms integer,                    -- пауза до выбора: материал для разбора
  avoidance   boolean     not null default false,
  created_at  timestamptz not null default now(),

  constraint choices_weight_valid check (weight is null or weight in (0.5, 1.0)),
  constraint choices_decision_ms_non_negative check (decision_ms is null or decision_ms >= 0),
  -- Обычный выбор размечен полностью; avoidance осей не несёт.
  constraint choices_shape check (
    (avoidance and axis is null and pole is null and weight is null and choice_id is null)
    or (not avoidance and choice_id is not null and axis is not null
        and pole is not null and weight is not null)
  )
);

-- Пересчёт профиля выбора: агрегация по осям пользователя.
create index choices_user_axis_idx on choices (user_id, axis) where not avoidance;
-- Разбор прохождения и поиск сцены с максимальным decision_ms (ENGINE 8.6).
create index choices_run_idx on choices (run_id);
create index choices_scene_idx on choices (scene_id);
create index choices_user_created_idx on choices (user_id, created_at desc);

comment on table choices is 'Лог выборов: одна строка на пометку оси. avoidance = отказ выбрать (ENGINE 2).';


-- ---------------------------------------------------------------------
-- field_tasks — полевое задание внутри истории (ENGINE 6.5)
-- ---------------------------------------------------------------------
create table field_tasks (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references users (id) on delete cascade,
  run_id           uuid        not null references runs (id) on delete cascade,
  scene_id         uuid        references scenes (id) on delete cascade,   -- сцена, в которой выдано
  tier             smallint    not null,   -- 1 насыщение, 2 переключение, 3 удержание в конфликте
  text             text        not null,
  unlocks_scene_id uuid        references scenes (id) on delete cascade,
  axis             axis_name,
  expires_hours    integer     not null default 48,
  -- Задание всегда пропускаемо: заблокированный сюжет — это давление,
  -- а давление в продукте запрещено (ENGINE 6.5). CHECK держит инвариант.
  skippable        boolean     not null default true,
  -- сверх спецификации: жизненный цикл задания (выдано / выполнено /
  -- пропущено) нужен для замера эффекта упражнений в pattern-analytics.
  issued_at        timestamptz not null default now(),
  completed_at     timestamptz,
  skipped_at       timestamptz,

  constraint field_tasks_tier_range check (tier between 1 and 3),
  constraint field_tasks_always_skippable check (skippable),
  constraint field_tasks_expires_positive check (expires_hours > 0),
  constraint field_tasks_not_both_outcomes
    check (completed_at is null or skipped_at is null)
);

create index field_tasks_user_issued_idx on field_tasks (user_id, issued_at desc);
create index field_tasks_run_idx on field_tasks (run_id);
-- Открытые задания: что ещё ждёт возврата пользователя.
create index field_tasks_open_idx on field_tasks (user_id, issued_at)
  where completed_at is null and skipped_at is null;

comment on table field_tasks is 'Полевое задание внутри истории (ENGINE 6.5). Всегда пропускаемо.';


-- ---------------------------------------------------------------------
-- choice_profiles — профиль выбора (ENGINE 6.6)
-- ---------------------------------------------------------------------
-- Одна строка на пользователя. Флага публикации нет: профиль не выходит
-- наружу ни при каких условиях (ENGINE 9, CONCEPT 14.1).
create table choice_profiles (
  user_id            uuid        primary key references users (id) on delete cascade,
  -- {"approach": {"value": 0.62, "n": 14}, ...}. Ось с n < 5 не показывается
  -- пользователю — порог проверяется в 0003_functions.sql.
  axes               jsonb       not null default '{}'::jsonb,
  avoidance_rate     numeric(4,3),
  median_decision_ms integer,
  recognition_score  numeric(3,2),
  updated_at         timestamptz not null default now(),

  constraint choice_profiles_avoidance_range
    check (avoidance_rate is null or avoidance_rate between 0 and 1),
  constraint choice_profiles_recognition_range
    check (recognition_score is null or recognition_score between 1 and 5)
);

create trigger choice_profiles_set_updated_at
  before update on choice_profiles
  for each row execute function set_updated_at();

comment on table choice_profiles is 'Профиль выбора по шести осям (ENGINE 6.6). Не публикуется никогда.';


-- ---------------------------------------------------------------------
-- safety_events — журнал срабатываний протокола безопасности
-- ---------------------------------------------------------------------
-- сверх спецификации: формата в ENGINE нет, поля выведены из протоколов
-- скилла safety-guardian (кризис, магическое мышление, режим teen, вето).
create table safety_events (
  id            uuid           primary key default gen_random_uuid(),
  user_id       uuid           not null references users (id) on delete cascade,
  marker        safety_marker  not null,
  verdict       safety_verdict not null,
  -- Где сработало: catch | interpretation | scene | choice | exercise | report.
  surface       text,
  catch_id      uuid           references catches (id) on delete cascade,
  run_id        uuid           references runs (id) on delete cascade,
  -- Детали без сырого текста записи: маркеры, чек-лист, версия протокола.
  details       jsonb          not null default '{}'::jsonb,
  -- Кризисный протокол включает режим «только дневник» на 7 дней.
  mutes_interpretation_until timestamptz,
  created_at    timestamptz    not null default now()
);

create index safety_events_user_created_idx on safety_events (user_id, created_at desc);
-- Активные ограничения трактовок: проверяются перед каждой генерацией.
create index safety_events_active_mute_idx on safety_events (user_id, mutes_interpretation_until)
  where mutes_interpretation_until is not null;

comment on table safety_events is 'Журнал срабатываний safety-guardian. Пользователь может читать, но не править: журнал не должен редактироваться его субъектом.';
