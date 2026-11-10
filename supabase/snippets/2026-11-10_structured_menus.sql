-- ============================================
-- 追加: マット練習メニューの構造化（計算用）・テンプレート・事後報告（実績と出欠の照合）
-- 既存の menus.content（自由記述）はそのまま残す
-- ============================================

-- 0) マネージャーも練習メニューを作成・編集・削除できるようにする（OBは除く）
drop policy if exists "menus_insert_team_member" on menus;
create policy "menus_insert_team_member" on menus
  for insert with check (
    team_id in (select team_id from profiles where id = auth.uid() and role <> 'ob')
  );
drop policy if exists "menus_update_team_member" on menus;
create policy "menus_update_team_member" on menus
  for update using (
    team_id in (select team_id from profiles where id = auth.uid() and role <> 'ob')
  );
drop policy if exists "menus_delete_team_member" on menus;
create policy "menus_delete_team_member" on menus
  for delete using (
    team_id in (select team_id from profiles where id = auth.uid() and role <> 'ob')
  );

-- 部員・マネージャー・管理者（OB以外）かどうか
create or replace function is_active_team_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role <> 'ob');
$$;

-- 1) メニューの項目（予定 plan ／ 実績 actual を分けて持つ）
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete cascade,
  phase text not null check (phase in ('plan', 'actual')),
  sort_order int not null default 0,
  name text not null,
  -- 種別：warmup アップ／conditioning 補強／technique 技術／drill 打ち込み／
  --       situational 攻防（状況設定）／spar スパー／cooldown ダウン／other その他
  category text not null default 'other'
    check (category in ('warmup', 'conditioning', 'technique', 'drill', 'situational', 'spar', 'cooldown', 'other')),
  -- 実施形式：all 全員実施／rotation 均等交代／free 自由参加
  format text not null default 'all' check (format in ('all', 'rotation', 'free')),
  -- 量の表し方：timed 1本の時間×本数／total 全体時間／reps 回数×セット
  amount_type text not null default 'timed' check (amount_type in ('timed', 'total', 'reps')),
  unit_seconds int check (unit_seconds is null or unit_seconds > 0),
  sets int check (sets is null or sets > 0),
  -- 本数が「全体の本数」か「1人あたりの本数」か
  sets_basis text not null default 'total' check (sets_basis in ('total', 'per_person')),
  total_seconds int check (total_seconds is null or total_seconds > 0),
  reps int check (reps is null or reps > 0),
  group_size int check (group_size is null or group_size > 0),
  active_per_group int check (active_per_group is null or active_per_group > 0),
  rest_seconds int check (rest_seconds is null or rest_seconds >= 0),
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists menu_items_menu_idx on menu_items (menu_id, phase, sort_order);
alter table menu_items enable row level security;

drop policy if exists "menu_items_select" on menu_items;
create policy "menu_items_select" on menu_items
  for select using (team_id = get_my_team_id());
drop policy if exists "menu_items_write" on menu_items;
create policy "menu_items_write" on menu_items
  for all
  using (team_id = get_my_team_id() and is_active_team_member())
  with check (team_id = get_my_team_id() and is_active_team_member());

-- 2) テンプレート（目的別。項目は JSON で持つ）
create table if not exists menu_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  purpose text,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table menu_templates enable row level security;

drop policy if exists "menu_templates_select" on menu_templates;
create policy "menu_templates_select" on menu_templates
  for select using (team_id = get_my_team_id());
drop policy if exists "menu_templates_write" on menu_templates;
create policy "menu_templates_write" on menu_templates
  for all
  using (team_id = get_my_team_id() and is_active_team_member())
  with check (team_id = get_my_team_id() and is_active_team_member());

-- 3) 事後報告（練習ごとに1件。作成者と報告者は別の人でもよい）
create table if not exists menu_reports (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  menu_id uuid not null unique references menus(id) on delete cascade,
  -- 予定と実際の参加者が合っていたか
  attendance_matches boolean not null,
  note text,
  reported_by uuid references profiles(id) on delete set null,
  reported_at timestamptz not null default now()
);
alter table menu_reports enable row level security;

drop policy if exists "menu_reports_select" on menu_reports;
create policy "menu_reports_select" on menu_reports
  for select using (team_id = get_my_team_id());
drop policy if exists "menu_reports_write" on menu_reports;
create policy "menu_reports_write" on menu_reports
  for all
  using (team_id = get_my_team_id() and is_active_team_member())
  with check (team_id = get_my_team_id() and is_active_team_member());

-- 4) 出欠の違い（「違いがある」のときだけ、対象者ごとに記録）
create table if not exists menu_attendance_diffs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  -- absent_unplanned 参加予定だったが欠席／present_unplanned 欠席予定だったが参加／left_early 途中退出・中抜け
  kind text not null check (kind in ('absent_unplanned', 'present_unplanned', 'left_early')),
  -- 途中退出・中抜けの許可：confirmed 許可あり／unconfirmed 許可を確認できていない
  permission text check (permission in ('confirmed', 'unconfirmed')),
  recorded_by uuid references profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  unique (menu_id, member_id)
);
alter table menu_attendance_diffs enable row level security;

-- 出欠の違いは、同じチームなら見られる（練習予定表の参加者表示と同じ範囲）。
-- 監督・コーチの確認結果は、学生が書き換えられないよう別のテーブルで持つ（次の段階で追加）
drop policy if exists "menu_attendance_diffs_select" on menu_attendance_diffs;
create policy "menu_attendance_diffs_select" on menu_attendance_diffs
  for select using (team_id = get_my_team_id());
drop policy if exists "menu_attendance_diffs_write" on menu_attendance_diffs;
create policy "menu_attendance_diffs_write" on menu_attendance_diffs
  for all
  using (team_id = get_my_team_id() and is_active_team_member())
  with check (team_id = get_my_team_id() and is_active_team_member());
