-- Fresh install: run everything below in the Supabase SQL editor.

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unit text not null default 'reps' check (char_length(unit) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  amount integer not null check (amount between 1 and 10000),
  created_at timestamptz not null default now()
);

create index entries_user_created_idx on public.entries (user_id, created_at desc);

alter table public.activities enable row level security;
alter table public.entries enable row level security;

create policy "own activities select" on public.activities for select using (auth.uid() = user_id);
create policy "own activities insert" on public.activities for insert with check (auth.uid() = user_id);
create policy "own activities update" on public.activities for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own activities delete" on public.activities for delete using (auth.uid() = user_id);

create policy "own entries select" on public.entries for select using (auth.uid() = user_id);
create policy "own entries insert" on public.entries for insert with check (auth.uid() = user_id);
create policy "own entries update" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own entries delete" on public.entries for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Migration from the original exercise-tracker schema (run INSTEAD of the above
-- if your database already has the exercises/entries tables):
--
-- alter table public.exercises rename to activities;
-- alter table public.entries rename column exercise_id to activity_id;
-- alter table public.entries rename column reps to amount;
--
-- If the unit column was never added:
-- alter table public.activities add column unit text not null default 'reps' check (char_length(unit) between 1 and 20);
--
-- Optional cosmetic cleanup (policy names keep working either way):
-- alter policy "own exercises select" on public.activities rename to "own activities select";
-- alter policy "own exercises insert" on public.activities rename to "own activities insert";
-- alter policy "own exercises update" on public.activities rename to "own activities update";
-- alter policy "own exercises delete" on public.activities rename to "own activities delete";
