-- Run in the Supabase SQL editor. Idempotent-ish: fails loudly if tables already exist.

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  unit text not null default 'reps' check (char_length(unit) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Migration for databases created before the unit column existed:
-- alter table public.exercises add column unit text not null default 'reps' check (char_length(unit) between 1 and 20);

create table public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  reps integer not null check (reps between 1 and 10000),
  created_at timestamptz not null default now()
);

create index entries_user_created_idx on public.entries (user_id, created_at desc);

alter table public.exercises enable row level security;
alter table public.entries enable row level security;

create policy "own exercises select" on public.exercises for select using (auth.uid() = user_id);
create policy "own exercises insert" on public.exercises for insert with check (auth.uid() = user_id);
create policy "own exercises update" on public.exercises for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own exercises delete" on public.exercises for delete using (auth.uid() = user_id);

create policy "own entries select" on public.entries for select using (auth.uid() = user_id);
create policy "own entries insert" on public.entries for insert with check (auth.uid() = user_id);
create policy "own entries update" on public.entries for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own entries delete" on public.entries for delete using (auth.uid() = user_id);
