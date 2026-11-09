-- ============================================
-- 追加: 日報へのリアクション・個人の目標（2026-11-09）
-- Supabase の SQL Editor に貼り付けて、そのまま実行してください。
-- 何度実行しても壊れないように書いています。
-- ============================================

-- --------------------------------------------
-- 1) 日報（実施報告・未実施報告）へのリアクション
--    練習予定表で 👍🔥💪👏 を付けられるようにする
-- --------------------------------------------
create table if not exists comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references comments(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '🔥', '💪', '👏')),
  created_at timestamptz not null default now(),
  unique (comment_id, author_id, emoji)
);
create index if not exists comment_reactions_comment_id_idx on comment_reactions(comment_id);
alter table comment_reactions enable row level security;

drop policy if exists "comment_reactions_select_same_team" on comment_reactions;
create policy "comment_reactions_select_same_team" on comment_reactions
  for select using (team_id = get_my_team_id());

drop policy if exists "comment_reactions_insert_self" on comment_reactions;
create policy "comment_reactions_insert_self" on comment_reactions
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

drop policy if exists "comment_reactions_delete_self" on comment_reactions;
create policy "comment_reactions_delete_self" on comment_reactions
  for delete using (author_id = auth.uid());

-- --------------------------------------------
-- 2) 個人の目標（長期・中期・短期）
--    マイページ「トレーニング」タブで設定する
-- --------------------------------------------
create table if not exists member_goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  term text not null check (term in ('long', 'mid', 'short')),
  content text not null default '',
  target_date date,
  updated_at timestamptz not null default now(),
  unique (author_id, term)
);
alter table member_goals enable row level security;

drop policy if exists "member_goals_select_same_team" on member_goals;
create policy "member_goals_select_same_team" on member_goals
  for select using (team_id = get_my_team_id());

drop policy if exists "member_goals_insert_self" on member_goals;
create policy "member_goals_insert_self" on member_goals
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

drop policy if exists "member_goals_update_self" on member_goals;
create policy "member_goals_update_self" on member_goals
  for update using (author_id = auth.uid());

notify pgrst, 'reload schema';
