-- ============================================
-- チーム
-- ============================================
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ============================================
-- プロフィール（auth.usersに1:1で紐づく）
-- role: captain / vice_captain / coach / member
-- ============================================
create type member_role as enum ('captain', 'vice_captain', 'coach', 'member');

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id uuid references teams(id) on delete set null,
  display_name text not null,
  role member_role not null default 'member',
  created_at timestamptz not null default now()
);

-- ============================================
-- 練習メニュー
-- ============================================
create table if not exists menus (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  date date not null,
  title text not null,
  content text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- ============================================
-- コメント
-- ============================================
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus(id) on delete cascade,
  author_id uuid not null references profiles(id),
  text text not null,
  created_at timestamptz not null default now()
);

-- ============================================
-- Row Level Security
-- 「同じチームのメンバーだけが見える／書ける」を徹底する
-- ============================================
alter table teams enable row level security;
alter table profiles enable row level security;
alter table menus enable row level security;
alter table comments enable row level security;

-- 自分のプロフィールと同じチームのプロフィールは閲覧可能
create policy "profiles_select_same_team" on profiles
  for select using (
    team_id in (select team_id from profiles where id = auth.uid())
  );

-- 自分のプロフィールは自分で更新可能（roleの自己昇格は防ぎたいので、
-- role変更はSupabase管理画面 or 別途管理用関数で行う運用を推奨）
create policy "profiles_update_self" on profiles
  for update using (id = auth.uid());

create policy "profiles_insert_self" on profiles
  for insert with check (id = auth.uid());

-- チームは所属メンバーのみ閲覧可能
create policy "teams_select_member" on teams
  for select using (
    id in (select team_id from profiles where id = auth.uid())
  );

-- メニューは同じチームのメンバーのみ閲覧可能
create policy "menus_select_same_team" on menus
  for select using (
    team_id in (select team_id from profiles where id = auth.uid())
  );

-- メニュー作成はcaptain / vice_captainのみ、かつ自分のチーム宛てのみ
create policy "menus_insert_captain_only" on menus
  for insert with check (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('captain', 'vice_captain')
    )
  );

-- コメントは同じチームのメンバーのみ閲覧可能
create policy "comments_select_same_team" on comments
  for select using (
    menu_id in (
      select id from menus where team_id in (
        select team_id from profiles where id = auth.uid()
      )
    )
  );

-- コメント投稿は同じチームのメンバーなら誰でも可能
create policy "comments_insert_same_team" on comments
  for insert with check (
    author_id = auth.uid()
    and menu_id in (
      select id from menus where team_id in (
        select team_id from profiles where id = auth.uid()
      )
    )
  );

-- 修正: 新規ユーザーが初回参加時にteamsを閲覧できるよう、
-- ログイン済みユーザーなら誰でもteamsを閲覧可能にする
create policy "teams_select_authenticated" on teams
  for select using (auth.role() = 'authenticated');

-- ============================================
-- 追加: 拠点（多摩・大塚）
-- ============================================
alter table menus add column if not exists location text not null default 'tama'
  check (location in ('tama', 'otsuka'));

-- ============================================
-- 追加: 練習の開始・終了時刻、コメントの種別（意見/報告）
-- ============================================
alter table menus add column if not exists start_time time;
alter table menus add column if not exists end_time time;

alter table comments add column if not exists kind text not null default 'opinion'
  check (kind in ('opinion', 'report'));

-- ============================================
-- 追加: コメントの返信スレッド機能（実施報告への振り返りコメント用）
-- ============================================
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;

-- ============================================
-- 追加: 未実施報告（授業・通院等で参加できなかった場合の報告）
-- ============================================
alter table comments drop constraint if exists comments_kind_check;
alter table comments add constraint comments_kind_check check (kind in ('opinion', 'report', 'absent'));

-- ============================================
-- 追加: 部員の所属拠点、メニューの全体練習フラグ
-- ============================================
alter table profiles add column if not exists home_location text check (home_location in ('tama', 'otsuka'));
alter table menus add column if not exists is_joint boolean not null default false;

-- ============================================
-- 追加: メニューの編集履歴（誰がいつ編集したか）、更新権限
-- ============================================
alter table menus add column if not exists last_edited_by uuid references profiles(id);
alter table menus add column if not exists last_edited_at timestamptz;

create policy "menus_update_leader_coach" on menus
  for update using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
    )
  );

-- ============================================
-- 追加: オフの日（練習なし）、メニューの削除権限
-- ============================================
alter table menus add column if not exists is_off boolean not null default false;

create policy "menus_delete_leader_coach" on menus
  for delete using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
    )
  );
