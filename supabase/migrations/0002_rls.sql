-- =====================================================================
-- 0002_rls.sql — Row Level Security
-- ENGINE.md 7.4 «Приватность в схеме», CONCEPT.md 14 «Дневник приватен
-- по конструкции».
--
-- Модель доступа простая и одинаковая для всех таблиц:
--   строка видна и изменяема только своему владельцу, то есть
--   user_id = auth.uid(). Никаких «расшаренных» строк, никаких флагов
--   видимости у дневника.
--
-- auth.uid() завёрнут в (select ...), чтобы планировщик вычислял его
-- один раз на запрос, а не на каждую строку.
-- =====================================================================

set search_path = public, extensions, pg_catalog;


-- ---------------------------------------------------------------------
-- 1. Включаем RLS на всех таблицах с пользовательскими данными
-- ---------------------------------------------------------------------
alter table users           enable row level security;
alter table catches         enable row level security;
alter table entities_index  enable row level security;
alter table embeddings      enable row level security;
alter table rollups         enable row level security;
alter table symbols         enable row level security;
alter table figures         enable row level security;
alter table seeds           enable row level security;
alter table runs            enable row level security;
alter table scenes          enable row level security;
alter table choices         enable row level security;
alter table field_tasks     enable row level security;
alter table choice_profiles enable row level security;
alter table safety_events   enable row level security;


-- ---------------------------------------------------------------------
-- 2. Права ролей
-- ---------------------------------------------------------------------
-- Анонимной роли в дневнике делать нечего: доступ только после
-- обмена Telegram-логина на сессию.
revoke all on all tables in schema public from anon;

grant select, insert, update, delete on
  users, catches, entities_index, embeddings, rollups, symbols, figures,
  seeds, runs, scenes, choices, field_tasks, choice_profiles
  to authenticated;

-- Журнал безопасности пользователь читает, но не правит: запись о
-- срабатывании протокола не должна редактироваться своим субъектом.
-- Пишет и гасит его сервер (service_role, минуя RLS).
grant select on safety_events to authenticated;


-- ---------------------------------------------------------------------
-- 3. Политики: «строка только своя»
-- ---------------------------------------------------------------------

create policy users_own_row on users
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy catches_own_row on catches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy entities_index_own_row on entities_index
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy embeddings_own_row on embeddings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy rollups_own_row on rollups
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy symbols_own_row on symbols
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy figures_own_row on figures
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy seeds_own_row on seeds
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy runs_own_row on runs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy scenes_own_row on scenes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy choices_own_row on choices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy field_tasks_own_row on field_tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy choice_profiles_own_row on choice_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy safety_events_own_row_readonly on safety_events
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Публичной ленты в схеме нет намеренно. Опубликованные runs и seeds
-- отдаются наружу не расширением RLS на чужие строки (это утащило бы
-- user_id, даты и служебные поля), а отдельной витриной после модерации:
-- только тексты сцен, без семени, трактовок и дат (ENGINE 9). Витрина —
-- задача отдельной миграции, когда публикация войдёт в объём.


-- ---------------------------------------------------------------------
-- 4. Стена вокруг дневника
-- ---------------------------------------------------------------------
-- Дневник, аналитика и дистиллят не имеют флага публикации. Это не
-- настройка, а конструкция (CONCEPT 14.1): если человек знает, что
-- зацепку прочитают, он начинает писать её для читателя, и прибор ломается.
-- Проверка ниже роняет миграцию, если такой флаг когда-нибудь появится.
do $$
declare
  offender text;
begin
  select format('%s.%s', table_name, column_name)
    into offender
  from information_schema.columns
  where table_schema = 'public'
    and table_name in (
      'catches', 'entities_index', 'rollups', 'symbols', 'figures', 'choice_profiles'
    )
    and column_name in ('published', 'published_at', 'is_public', 'public', 'shared', 'visibility')
  limit 1;

  if offender is not null then
    raise exception
      'Дневник приватен по конструкции: у % не может быть флага публикации (CONCEPT 14.1, ENGINE 9)',
      offender;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Публикация: только seeds и runs, и то не всем
-- ---------------------------------------------------------------------
-- Для аккаунтов 14–17 публикация закрыта полностью (CONCEPT 14.3,
-- ENGINE 9). На уровне API это тоже проверяется, но запрет такого класса
-- обязан жить в базе: клиент можно обойти, триггер — нет.
create or replace function forbid_teen_publication()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.published and coalesce(
       (select u.teen_mode from users u where u.id = new.user_id), false) then
    raise exception 'Публикация недоступна в режиме 14–17'
      using errcode = 'insufficient_privilege';
  end if;

  -- Дата публикации проставляется базой, а не клиентом.
  if new.published and new.published_at is null then
    new.published_at = now();
  elsif not new.published then
    new.published_at = null;
  end if;

  return new;
end;
$$;

create trigger seeds_teen_publication_guard
  before insert or update of published on seeds
  for each row execute function forbid_teen_publication();

create trigger runs_teen_publication_guard
  before insert or update of published on runs
  for each row execute function forbid_teen_publication();
