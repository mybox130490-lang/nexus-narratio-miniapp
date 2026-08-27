# База данных «Турии»

Схема Supabase/Postgres для дневника внимания и интерактивных историй.
Спецификация — `docs/ENGINE.md` (разделы 6 «Форматы данных» и 7 «Хранилище
и иерархия памяти») и `docs/CONCEPT.md` (разделы 13–14). Любое расхождение
кода с этими документами считается багом здесь, а не там.

## Состав

| Файл | Что делает |
|---|---|
| `migrations/0001_init.sql` | расширения, перечисления, все таблицы, ограничения и индексы |
| `migrations/0002_rls.sql` | RLS, права ролей, политики «строка только своя», запрет публикации для 14–17 |
| `migrations/0003_functions.sql` | аналитические функции с анти-апофеническими порогами |
| `functions/catch-ingest/` | edge-функция приёма улова: initData → пользователь → триаж безопасности → запись (см. её собственный README) |
| `functions/generate-scene/` | edge-функция-драматург: досье семени → генерация → валидатор контракта с повтором → запись (см. её собственный README) |
| `functions/_shared/` | общий код обеих функций: проверка initData, CORS, минимальные типы Deno для typecheck |

Порядок применения строгий: `0001` → `0002` → `0003`. Второй файл ссылается
на таблицы первого, третий — на перечисления и таблицы первого.

## Требования

1. **PostgreSQL 14+** (используются `gen_random_uuid()` без pgcrypto-схемы,
   `generated always as identity`, `num_nonnulls`).
2. **Расширение `vector` (pgvector) обязательно** — на нём стоит слой 3
   иерархии памяти (семантический поиск похожих записей). Без него
   `0001_init.sql` не применится.
   - На Supabase: Dashboard → Database → Extensions → включить `vector`
     (устанавливается в схему `extensions`), либо `create extension if not
     exists vector with schema extensions;`.
   - Локально: пакет `postgresql-16-pgvector` (Debian/Ubuntu) или
     `docker run pgvector/pgvector:pg16`.
   - Миграции сами делают `create extension if not exists vector;` и в
     начале файла ставят `search_path = public, extensions, pg_catalog`,
     поэтому работают и когда расширение лежит в `extensions`, и когда в
     `public`.
   - Для HNSW-индекса нужен pgvector ≥ 0.5.0.
3. **Схема `auth`** (Supabase Auth): `public.users.id` ссылается на
   `auth.users(id)` c `on delete cascade` — это корень каскадного удаления
   аккаунта. Роли `anon`, `authenticated`, `service_role` должны существовать
   (на Supabase они есть из коробки).
4. **Размерность эмбеддингов — 1536** (`text-embedding-3-small`). Смена
   модели на другую размерность — это новая миграция с пересозданием
   столбца и переиндексацией, а не правка `0001`.

## Локально

С Supabase CLI (рекомендуется — миграции применяются в том же порядке, что и на проде):

```bash
supabase start            # поднимает локальный стек, auth-схема и роли уже внутри
supabase db reset         # накатывает все миграции из supabase/migrations с нуля
```

Добавление новой миграции:

```bash
supabase migration new <имя>     # создаст файл с временной меткой
supabase db reset                # проверка «с нуля», обязательна перед пушем
```

На «голом» Postgres (без CLI) — auth-схему и роли надо подставить самому:

```bash
createdb turiya
psql -d turiya <<'SQL'
create schema if not exists extensions;
create schema if not exists auth;
create extension if not exists pgcrypto;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
SQL

psql -v ON_ERROR_STOP=1 -d turiya -f supabase/migrations/0001_init.sql
psql -v ON_ERROR_STOP=1 -d turiya -f supabase/migrations/0002_rls.sql
psql -v ON_ERROR_STOP=1 -d turiya -f supabase/migrations/0003_functions.sql
```

`ON_ERROR_STOP=1` обязателен: без него psql проглотит ошибку в середине
файла и оставит схему в половинчатом состоянии.

## На проде

```bash
supabase link --project-ref <ref>
supabase db push          # применит только не применённые миграции
```

Перед `db push`:

- убедиться, что `vector` включён в проекте (пункт 2 требований);
- прогнать `supabase db reset` локально — это единственная честная проверка,
  что миграции применяются с нуля;
- миграции применяются по одной в транзакции, поэтому упавшая миграция
  откатывается целиком; чинить надо новым файлом, а не правкой применённого.

Через Dashboard → SQL Editor файлы можно выполнить руками, но тогда запись
в `supabase_migrations.schema_migrations` не появится и CLI попробует
накатить их повторно. Так делать только для разовой отладки.

## Проверка после накатывания

```sql
-- 1. RLS включён на всех таблицах: запрос обязан вернуть 0 строк
select relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 2. Стена вокруг дневника: тоже 0 строк
select table_name, column_name from information_schema.columns
 where table_schema = 'public'
   and table_name in ('catches','entities_index','rollups','symbols','figures','choice_profiles')
   and column_name in ('published','published_at','is_public','public','shared','visibility');

-- 3. Функции на месте
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and proname in ('top_entities','directedness_index','entity_streaks','choice_profile_axes');
```

## Что важно знать про эту схему

**Дневник приватен по конструкции.** У `catches`, `entities_index`,
`rollups`, `symbols`, `figures`, `choice_profiles` нет флага публикации —
и это не «пока не сделали», а стена (CONCEPT 14.1). В `0002_rls.sql` стоит
проверка, которая роняет миграцию, если такой столбец появится. Публикуемые
сущности ровно две: `seeds` (играбельный сценарий) и `runs` (текст истории).
Для аккаунтов 14–17 публикация закрыта триггером в базе, а не только в API.

**Удаление аккаунта безвозвратно.** Все внешние ключи объявлены с
`ON DELETE CASCADE`, корень — `auth.users`. `delete from auth.users where
id = …` уносит записи, сущности, эмбеддинги, свёртки, сонник, карту
персонажей, семена, прохождения, сцены, выборы, задания и профиль.
Отдельно надо чистить объектное хранилище (фото, временное аудио) — это
политика жизненного цикла бакета, а не БД.

**Аналитика считается SQL, не моделью.** `entities_index` — денормализованный
слой ровно для этого. Пороги против апофении зашиты в функции: топ не
возвращается на выборке меньше 5 записей, ось профиля не возвращает значение
при n < 5, серия — строго подряд идущие календарные дни в часовом поясе
пользователя.

**Семя неизменяемо.** Триггер на `seeds` разрешает менять только
`published`/`published_at`. Иначе перепрохождение через полгода сравнивало бы
разные входные условия и теряло смысл.
