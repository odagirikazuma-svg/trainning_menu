-- ============================================
-- 追加: トレーニングの数値記録（2026-11-09）
-- 種目は部員が自分で追加でき、チーム内で共有される（他の人が追加した種目も選べる）。
-- 1セットごとに「重量（任意）× 回数」または「重量（任意）× 時間」を記録する。
-- ============================================

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 30),
  -- reps = 回数で記録、time = 時間（秒）で記録
  measure text not null default 'reps' check (measure in ('reps', 'time')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, name)
);
alter table exercises enable row level security;

drop policy if exists "exercises_select_same_team" on exercises;
create policy "exercises_select_same_team" on exercises
  for select using (team_id = get_my_team_id());

drop policy if exists "exercises_insert_same_team" on exercises;
create policy "exercises_insert_same_team" on exercises
  for insert with check (team_id = get_my_team_id() and created_by = auth.uid());

drop policy if exists "exercises_update_creator" on exercises;
create policy "exercises_update_creator" on exercises
  for update using (created_by = auth.uid());

create table if not exists training_sets (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  weight_log_id uuid not null references weight_logs(id) on delete cascade,
  date date not null,
  exercise_id uuid not null references exercises(id) on delete cascade,
  exercise_order smallint not null default 1,
  set_no smallint not null,
  weight_kg numeric(6, 2) check (weight_kg is null or weight_kg >= 0),
  reps integer check (reps is null or reps >= 0),
  seconds integer check (seconds is null or seconds >= 0),
  created_at timestamptz not null default now()
);
create index if not exists training_sets_author_date_idx on training_sets(author_id, date);
create index if not exists training_sets_exercise_idx on training_sets(exercise_id, date);
create index if not exists training_sets_log_idx on training_sets(weight_log_id);
alter table training_sets enable row level security;

drop policy if exists "training_sets_select_same_team" on training_sets;
create policy "training_sets_select_same_team" on training_sets
  for select using (team_id = get_my_team_id());

drop policy if exists "training_sets_insert_self" on training_sets;
create policy "training_sets_insert_self" on training_sets
  for insert with check (author_id = auth.uid() and team_id = get_my_team_id());

drop policy if exists "training_sets_update_self" on training_sets;
create policy "training_sets_update_self" on training_sets
  for update using (author_id = auth.uid());

drop policy if exists "training_sets_delete_self" on training_sets;
create policy "training_sets_delete_self" on training_sets
  for delete using (author_id = auth.uid());

notify pgrst, 'reload schema';
