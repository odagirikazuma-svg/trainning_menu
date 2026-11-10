-- ============================================
-- 追加: 学生の日報での「参加範囲」と「自由参加スパーの参加量（概算）」
-- ============================================

-- 1) メニュー項目に、編集しても変わらない目印（item_key）を付ける
--    予定→実績の引き継ぎや後日の修正で、本人の報告との対応が崩れないようにする
alter table menu_items add column if not exists item_key text not null default gen_random_uuid()::text;
create index if not exists menu_items_item_key_idx on menu_items (menu_id, item_key);

-- 2) 本人の参加範囲・参加量
create table if not exists menu_participation (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  menu_id uuid not null references menus(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  -- full 全メニュー参加／until 途中まで参加／from 遅れて参加／partial 一部だけ参加・中抜け
  -- （不参加は、これまでどおり日報の「実施できなかった」で報告する）
  scope text not null check (scope in ('full', 'until', 'from', 'partial')),
  -- until：最後に参加したメニュー／from：最初に参加したメニュー（item_key）
  boundary_key text,
  -- partial：参加したメニュー（item_key の一覧）
  item_keys text[] not null default '{}',
  -- 自由参加の項目の概算参加量（item_key → 0/25/50/75/100）。実測の本数ではない
  free_amounts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (menu_id, member_id)
);
alter table menu_participation enable row level security;

-- 見られるのは本人と、同じチームの管理者・マネージャー
drop policy if exists "menu_participation_select" on menu_participation;
create policy "menu_participation_select" on menu_participation
  for select using (
    member_id = auth.uid()
    or (
      team_id = get_my_team_id()
      and exists (select 1 from profiles where id = auth.uid() and role in ('coach', 'manager'))
    )
  );

-- 書けるのは本人だけ
drop policy if exists "menu_participation_write_self" on menu_participation;
create policy "menu_participation_write_self" on menu_participation
  for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid() and team_id = get_my_team_id());
