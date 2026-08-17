-- Fresh install: run everything below in the Supabase SQL editor.
-- Each vertical (exercises / books / habits) owns its tables; the app's UI
-- consolidates them client-side.

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unit text not null default 'reps' check (char_length(unit) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  author text check (author is null or char_length(author) between 1 and 120),
  unit text not null default 'pages' check (unit in ('pages', 'chapters')),
  -- set when you finish it: the book leaves every widget but keeps its history
  finished_on date,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.exercise_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  amount integer not null check (amount between 1 and 10000),
  created_at timestamptz not null default now()
);

create table public.book_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  amount integer not null check (amount between 1 and 10000),
  created_at timestamptz not null default now()
);

create table public.habit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  habit_id uuid not null references public.habits (id) on delete cascade,
  done_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (habit_id, done_on) -- habits are yes/no per day at the database level
);

create index exercise_entries_user_created_idx on public.exercise_entries (user_id, created_at desc);
create index book_entries_user_created_idx on public.book_entries (user_id, created_at desc);
create index habit_entries_user_done_idx on public.habit_entries (user_id, done_on desc);

alter table public.exercises enable row level security;
alter table public.books enable row level security;
alter table public.habits enable row level security;
alter table public.exercise_entries enable row level security;
alter table public.book_entries enable row level security;
alter table public.habit_entries enable row level security;

create policy "own rows" on public.exercises for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.books for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.exercise_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.book_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.habit_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Migration from the unified activities/entries schema (2026-08). Run the
-- CREATE statements above first, then this copy block. Ids are preserved.
-- NOTE the timezone in the habit copy — adjust if you are not in US Eastern.
--
-- insert into public.exercises (id, user_id, name, unit, created_at)
--   select id, user_id, name, unit, created_at from public.activities where kind = 'exercise';
-- insert into public.books (id, user_id, name, created_at)
--   select id, user_id, name, created_at from public.activities where kind = 'book';
-- insert into public.habits (id, user_id, name, created_at)
--   select id, user_id, name, created_at from public.activities where kind = 'habit';
--
-- insert into public.exercise_entries (id, user_id, exercise_id, amount, created_at)
--   select e.id, e.user_id, e.activity_id, e.amount, e.created_at
--   from public.entries e join public.activities a on a.id = e.activity_id where a.kind = 'exercise';
-- insert into public.book_entries (id, user_id, book_id, pages, created_at)
--   select e.id, e.user_id, e.activity_id, e.amount, e.created_at
--   from public.entries e join public.activities a on a.id = e.activity_id where a.kind = 'book';
-- insert into public.habit_entries (id, user_id, habit_id, done_on, created_at)
--   select e.id, e.user_id, e.activity_id, (e.created_at at time zone 'America/New_York')::date, e.created_at
--   from public.entries e join public.activities a on a.id = e.activity_id where a.kind = 'habit'
--   on conflict (habit_id, done_on) do nothing;
--
-- After the new app is deployed and verified:
-- drop table public.entries;
-- drop table public.activities;
--
-- 2026-08: books grew a unit (pages/chapters) and book_entries.pages became amount:
-- alter table public.books add column unit text not null default 'pages' check (unit in ('pages', 'chapters'));
-- alter table public.book_entries rename column pages to amount;
--
-- 2026-08-17: books grew an author and a finished date:
-- alter table public.books add column author text check (author is null or char_length(author) between 1 and 120);
-- alter table public.books add column finished_on date;
