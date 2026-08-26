-- =====================================================================
-- 0003_functions.sql — аналитические функции
-- Вся кросс-дневная аналитика считается SQL-запросами, без участия
-- модели: дёшево и детерминированно (ENGINE 7.2, слой 2).
--
-- Анти-апофенические пороги (CONCEPT 7, скилл pattern-analytics):
--   * паттерн — от 5 записей в выборке;
--   * цикл — от 3 повторов;
--   * серия — строго подряд идущие календарные дни;
--   * ось профиля выбора показывается только при n >= 5 (ENGINE 2, 6.6).
-- Порог не косметика: бот, который видит паттерны там, где их нет,
-- кормит магическое мышление. Поэтому функции возвращают не «красивое
-- число любой ценой», а честный признак недостаточности данных.
--
-- Все функции — SECURITY INVOKER и STABLE: они работают поверх RLS,
-- поэтому чужие строки не увидят даже при подставленном чужом p_user_id.
-- =====================================================================

set search_path = public, extensions, pg_catalog;


-- ---------------------------------------------------------------------
-- Пороги одним местом, чтобы они не разъезжались по коду
-- ---------------------------------------------------------------------
create or replace function min_pattern_entries() returns integer
  language sql immutable parallel safe as $$ select 5 $$;

create or replace function min_cycle_repeats() returns integer
  language sql immutable parallel safe as $$ select 3 $$;

create or replace function min_axis_observations() returns integer
  language sql immutable parallel safe as $$ select 5 $$;

comment on function min_pattern_entries() is 'Паттерн — от 5 записей в выборке (pattern-analytics).';
comment on function min_cycle_repeats() is 'Цикл — от 3 повторов (pattern-analytics).';
comment on function min_axis_observations() is 'Ось профиля выбора показывается только при n >= 5 (ENGINE 2).';


-- ---------------------------------------------------------------------
-- 1. Топ-N образов / чувств / действий за период
-- ---------------------------------------------------------------------
-- Если за период меньше 5 записей улова — не возвращаем ничего: на такой
-- выборке любое «самое частое» будет шумом, а честный ответ продукта —
-- «данных пока мало, продолжай вести записи».
-- Флаг is_pattern отделяет «это уже паттерн» (>= 5 упоминаний) от
-- «просто верхняя строка списка»: в тексте отчёта это разные утверждения.
create or replace function top_entities(
  p_type    entity_type,
  p_from    timestamptz default now() - interval '7 days',
  p_to      timestamptz default now(),
  p_limit   integer     default 5,
  p_user_id uuid        default auth.uid()
)
returns table (
  entity_value text,
  occurrences  bigint,
  share        numeric,     -- доля записей периода, где сущность встретилась
  is_pattern   boolean
)
language plpgsql
stable
security invoker
set search_path = public, pg_catalog
as $$
declare
  v_sample integer;
begin
  select count(*) into v_sample
  from catches c
  where c.user_id = p_user_id
    and c.created_at >= p_from
    and c.created_at < p_to;

  if v_sample < min_pattern_entries() then
    return;  -- данных пока мало
  end if;

  return query
  select
    e.value,
    count(distinct e.catch_id) as cnt,
    round(count(distinct e.catch_id)::numeric / v_sample, 3),
    count(distinct e.catch_id) >= min_pattern_entries()
  from entities_index e
  where e.user_id = p_user_id
    and e.type = p_type
    and e.occurred_at >= p_from
    and e.occurred_at < p_to
  group by e.value
  order by cnt desc, e.value
  limit greatest(p_limit, 1);
end;
$$;

comment on function top_entities(entity_type, timestamptz, timestamptz, integer, uuid)
  is 'Топ-N сущностей за период. Пустой результат = выборка меньше 5 записей.';


-- ---------------------------------------------------------------------
-- 2. Индекс направленности
-- ---------------------------------------------------------------------
-- Доли negative / neutral / resource за период. Записи без разобранной
-- валентности в знаменатель не идут: иначе индекс поедет от того, что
-- разбор ещё не отработал, а не от того, что изменилось внимание.
create or replace function directedness_index(
  p_from    timestamptz default now() - interval '7 days',
  p_to      timestamptz default now(),
  p_user_id uuid        default auth.uid()
)
returns table (
  total          bigint,
  negative_share numeric,
  neutral_share  numeric,
  resource_share numeric,
  is_significant boolean   -- false = порог не набран, показывать доли нельзя
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with scored as (
    select c.entities->>'valence' as v
    from catches c
    where c.user_id = p_user_id
      and c.created_at >= p_from
      and c.created_at < p_to
      and c.entities->>'valence' is not null
  ),
  agg as (
    select
      count(*)::bigint as n,
      count(*) filter (where v = 'negative')::numeric as neg,
      count(*) filter (where v = 'neutral')::numeric  as neu,
      count(*) filter (where v = 'resource')::numeric as res
    from scored
  )
  select
    a.n,
    case when a.n >= min_pattern_entries() then round(a.neg / a.n, 3) end,
    case when a.n >= min_pattern_entries() then round(a.neu / a.n, 3) end,
    case when a.n >= min_pattern_entries() then round(a.res / a.n, 3) end,
    a.n >= min_pattern_entries()
  from agg a;
$$;

comment on function directedness_index(timestamptz, timestamptz, uuid)
  is 'Доли negative/neutral/resource за период. При is_significant = false доли не заполняются.';


-- ---------------------------------------------------------------------
-- 3. Серии подряд идущих дней
-- ---------------------------------------------------------------------
-- «4 дня подряд» означает ровно 4 календарных дня без пропуска. День
-- считается в часовом поясе пользователя: серия — про его сутки, а не
-- про UTC. Классические gaps-and-islands: у подряд идущих дат разность
-- «дата минус её номер в окне» постоянна.
-- p_value = null → серии считаются по каждому значению этого типа.
create or replace function entity_streaks(
  p_type     entity_type,
  p_value    text        default null,
  p_from     timestamptz default now() - interval '90 days',
  p_to       timestamptz default now(),
  p_min_days integer     default 3,   -- два дня подряд — ещё не серия
  p_tz       text        default 'UTC',
  p_user_id  uuid        default auth.uid()
)
returns table (
  entity_value text,
  streak_start date,
  streak_end   date,
  days         integer
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with day_hits as (
    select
      e.value as v,
      (e.occurred_at at time zone p_tz)::date as d
    from entities_index e
    where e.user_id = p_user_id
      and e.type = p_type
      and (p_value is null or e.value = lower(btrim(p_value)))
      and e.occurred_at >= p_from
      and e.occurred_at < p_to
    group by 1, 2
  ),
  islands as (
    select
      v,
      d,
      d - (row_number() over (partition by v order by d))::integer as island
    from day_hits
  )
  select
    v,
    min(d),
    max(d),
    count(*)::integer
  from islands
  group by v, island
  having count(*) >= greatest(p_min_days, 2)
  order by count(*) desc, min(d);
$$;

comment on function entity_streaks(entity_type, text, timestamptz, timestamptz, integer, text, uuid)
  is 'Серии строго подряд идущих дней по сущности. Дни считаются в часовом поясе p_tz.';


-- ---------------------------------------------------------------------
-- 4. Профиль выбора по осям с порогом видимости
-- ---------------------------------------------------------------------
-- сверх спецификации задачи: четвёртая функция, но без неё порог
-- «ось показывается только при n >= 5» (ENGINE 2, 6.6) пришлось бы
-- дублировать в каждом клиенте. Значение оси при n < 5 не возвращается
-- вообще — то, чего нет в ответе, невозможно случайно нарисовать.
-- value = среднее по наблюдениям, полюс A даёт +weight, полюс B −weight,
-- диапазон −1…+1.
create or replace function choice_profile_axes(
  p_user_id uuid default auth.uid()
)
returns table (
  axis_key   axis_name,
  value      numeric,
  n          bigint,
  is_visible boolean
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with marks as (
    select
      ch.axis as a,
      case ch.pole when 'A' then ch.weight else -ch.weight end as signed_weight
    from choices ch
    where ch.user_id = p_user_id
      and not ch.avoidance
      and ch.axis is not null
  ),
  agg as (
    select a, avg(signed_weight) as val, count(*)::bigint as cnt
    from marks
    group by a
  )
  -- Оси без единого наблюдения тоже нужны в ответе: движок добирает
  -- наблюдения именно по осям с малым n (ENGINE 8.3).
  select
    x.axis_key,
    case when coalesce(agg.cnt, 0) >= min_axis_observations()
         then round(agg.val, 3) end,
    coalesce(agg.cnt, 0),
    coalesce(agg.cnt, 0) >= min_axis_observations()
  from unnest(enum_range(null::axis_name)) as x(axis_key)
  left join agg on agg.a = x.axis_key
  order by x.axis_key;
$$;

comment on function choice_profile_axes(uuid)
  is 'Профиль выбора по шести осям. При n < 5 значение оси не возвращается (анти-апофения).';


-- ---------------------------------------------------------------------
-- Права на вызов
-- ---------------------------------------------------------------------
grant execute on function min_pattern_entries()  to authenticated;
grant execute on function min_cycle_repeats()    to authenticated;
grant execute on function min_axis_observations() to authenticated;
grant execute on function top_entities(entity_type, timestamptz, timestamptz, integer, uuid) to authenticated;
grant execute on function directedness_index(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function entity_streaks(entity_type, text, timestamptz, timestamptz, integer, text, uuid) to authenticated;
grant execute on function choice_profile_axes(uuid) to authenticated;
