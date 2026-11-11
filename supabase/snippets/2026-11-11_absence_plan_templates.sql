-- ============================================
-- 追加: 休みの代替メニューのテンプレート（チームで共有。部員・マネージャー・管理者が作れる）
-- ============================================
create table if not exists absence_plan_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  plan_type text not null check (plan_type in ('weight', 'running', 'other')),
  plan text not null default '' check (char_length(plan) <= 300),
  plan_sets jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table absence_plan_templates enable row level security;

drop policy if exists "absence_plan_templates_select" on absence_plan_templates;
create policy "absence_plan_templates_select" on absence_plan_templates
  for select using (team_id = get_my_team_id());
drop policy if exists "absence_plan_templates_write" on absence_plan_templates;
create policy "absence_plan_templates_write" on absence_plan_templates
  for all
  using (team_id = get_my_team_id() and is_active_team_member())
  with check (team_id = get_my_team_id() and is_active_team_member());

notify pgrst, 'reload schema';
