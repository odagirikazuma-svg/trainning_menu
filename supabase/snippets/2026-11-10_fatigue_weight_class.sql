-- ============================================
-- 追加: 日報の「今日の疲労度」（1〜10の自己評価・参考値）と、試合に出る階級
-- ============================================

-- 1) 階級（kg）
alter table profiles add column if not exists weight_class int
  check (weight_class is null or (weight_class between 20 and 200));

-- 2) 1日1件の疲労度（本人と管理者・マネージャーだけが見られる）
create table if not exists daily_conditions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  fatigue smallint not null check (fatigue between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, date)
);
alter table daily_conditions enable row level security;

drop policy if exists "daily_conditions_select" on daily_conditions;
create policy "daily_conditions_select" on daily_conditions
  for select using (
    author_id = auth.uid()
    or (
      team_id = get_my_team_id()
      and exists (
        select 1 from profiles
        where id = auth.uid() and role in ('coach', 'manager')
      )
    )
  );

drop policy if exists "daily_conditions_insert_self" on daily_conditions;
create policy "daily_conditions_insert_self" on daily_conditions
  for insert with check (author_id = auth.uid() and team_id = get_my_team_id());

drop policy if exists "daily_conditions_update_self" on daily_conditions;
create policy "daily_conditions_update_self" on daily_conditions
  for update using (author_id = auth.uid());

drop policy if exists "daily_conditions_delete_self" on daily_conditions;
create policy "daily_conditions_delete_self" on daily_conditions
  for delete using (author_id = auth.uid());
