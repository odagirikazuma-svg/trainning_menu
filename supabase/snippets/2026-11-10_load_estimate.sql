-- ============================================
-- 追加: 監督の「要確認」の確認結果と、負荷の試算の設定（監督だけが見られる）
-- ============================================

-- 1) 出欠の「要確認」に対する監督の確認結果
--    学生が書く menu_attendance_diffs とは分けて持つ（学生からは見えない・書けない）
--    kind：absent_unplanned 申請なしの欠席／left_early 許可未確認の途中退出／
--          present_unplanned 休み報告があったが参加／mismatch 本人の報告と出欠確認が合わない
create table if not exists attendance_reviews (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('absent_unplanned', 'left_early', 'present_unplanned', 'mismatch')),
  -- ok：問題なし（許可あり・連絡済み）／ng：許可なし・無断
  decision text not null check (decision in ('ok', 'ng')),
  note text check (note is null or char_length(note) <= 200),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  unique (menu_id, member_id, kind)
);
alter table attendance_reviews enable row level security;

drop policy if exists "attendance_reviews_coach" on attendance_reviews;
create policy "attendance_reviews_coach" on attendance_reviews
  for all
  using (team_id = get_my_team_id() and is_my_role_coach())
  with check (team_id = get_my_team_id() and is_my_role_coach());

-- 2) 負荷の試算の設定（チームに1行）
--    coefficients：{"spar": 1.0, "run_km": 6, ...}。入っていない係数の項目は計算対象外
--    retention：前日までの蓄積が翌日に残る割合（0〜1）
--    calc_version：計算式を変えたときに上げる。画面に表示して、いつの式の数字か分かるようにする
create table if not exists load_settings (
  team_id uuid primary key references teams(id) on delete cascade,
  coefficients jsonb not null default '{}'::jsonb,
  retention numeric(4, 3) not null default 0.7 check (retention >= 0 and retention < 1),
  calc_version text not null default 'v1',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table load_settings enable row level security;

drop policy if exists "load_settings_coach" on load_settings;
create policy "load_settings_coach" on load_settings
  for all
  using (team_id = get_my_team_id() and is_my_role_coach())
  with check (team_id = get_my_team_id() and is_my_role_coach());

notify pgrst, 'reload schema';
