-- ============================================
-- 追加: 休み申請（前日までに理由と代替メニューの予定を出し、監督・コーチが承認する）
-- ============================================
create table if not exists absence_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  reason_type text not null
    check (reason_type in ('sick', 'injury', 'school', 'away', 'job', 'other')),
  reason text not null default '',
  plan_type text not null
    check (plan_type in ('weight', 'running', 'other', 'none')),
  plan text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  review_comment text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, date)
);
alter table absence_requests enable row level security;

-- 見られるのは本人と、同じチームの管理者・マネージャー
drop policy if exists "absence_requests_select" on absence_requests;
create policy "absence_requests_select" on absence_requests
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

-- 本人が申請する（承認待ちとしてのみ作れる）
drop policy if exists "absence_requests_insert_self" on absence_requests;
create policy "absence_requests_insert_self" on absence_requests
  for insert with check (
    author_id = auth.uid()
    and team_id = get_my_team_id()
    and status = 'pending'
  );

-- 本人は、承認待ち・差し戻しの申請を直して出し直せる（承認待ちに戻る）
drop policy if exists "absence_requests_update_self" on absence_requests;
create policy "absence_requests_update_self" on absence_requests
  for update
  using (author_id = auth.uid() and status in ('pending', 'rejected'))
  with check (author_id = auth.uid() and status = 'pending');

-- 管理者（コーチ）が承認・差し戻しする
drop policy if exists "absence_requests_update_coach" on absence_requests;
create policy "absence_requests_update_coach" on absence_requests
  for update
  using (
    team_id = get_my_team_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  )
  with check (
    team_id = get_my_team_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

-- 本人は、承認前の申請を取り消せる
drop policy if exists "absence_requests_delete_self" on absence_requests;
create policy "absence_requests_delete_self" on absence_requests
  for delete using (author_id = auth.uid() and status in ('pending', 'rejected'));
