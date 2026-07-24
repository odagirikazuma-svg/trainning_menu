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

-- ============================================
-- 更新: コーチもメニュー作成できるようにする
-- ============================================
drop policy if exists "menus_insert_captain_only" on menus;
create policy "menus_insert_captain_only" on menus
  for insert with check (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
    )
  );

-- ============================================
-- 追加: 部員の学年
-- ============================================
alter table profiles add column if not exists grade text;

-- ============================================
-- 更新: アカウント削除時にメニュー・コメントは残し、
-- 作成者/投稿者情報だけをNULL（不明）にする
-- ============================================
alter table menus alter column created_by drop not null;
alter table menus drop constraint menus_created_by_fkey;
alter table menus add constraint menus_created_by_fkey
  foreign key (created_by) references profiles(id) on delete set null;

alter table menus drop constraint menus_last_edited_by_fkey;
alter table menus add constraint menus_last_edited_by_fkey
  foreign key (last_edited_by) references profiles(id) on delete set null;

alter table comments alter column author_id drop not null;
alter table comments drop constraint comments_author_id_fkey;
alter table comments add constraint comments_author_id_fkey
  foreign key (author_id) references profiles(id) on delete set null;

-- ============================================
-- 追加: 試合日程、個人のウェイトトレーニング記録（マイページ用）
-- ============================================
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  date date not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table matches enable row level security;

create policy "matches_select_same_team" on matches
  for select using (team_id = get_my_team_id());

create policy "matches_insert_leader_coach" on matches
  for insert with check (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
    )
  );

create policy "matches_delete_leader_coach" on matches
  for delete using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
    )
  );

create table if not exists weight_logs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  date date not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, date)
);
alter table weight_logs enable row level security;

create policy "weight_logs_select_self" on weight_logs
  for select using (author_id = auth.uid());

create policy "weight_logs_insert_self" on weight_logs
  for insert with check (author_id = auth.uid());

create policy "weight_logs_update_self" on weight_logs
  for update using (author_id = auth.uid());

-- ============================================
-- 追加: 入学年(学年を自動計算するため)、トレーニング種別
-- ============================================
alter table profiles add column if not exists entry_year int;

alter table weight_logs add column if not exists type text not null default 'weight'
  check (type in ('running', 'weight', 'other'));

alter table comments add column if not exists alt_type text
  check (alt_type in ('running', 'weight', 'other'));

-- ============================================
-- 更新: 試合を個人ごとに登録できるようにする
-- （member_idがNULLなら全員向け、指定されていれば本人専用）
-- ============================================
alter table matches add column if not exists member_id uuid references profiles(id) on delete cascade;

drop policy if exists "matches_insert_leader_coach" on matches;
create policy "matches_insert" on matches
  for insert with check (
    team_id = get_my_team_id()
    and (
      member_id = auth.uid()
      or (
        member_id is null
        and exists (
          select 1 from profiles
          where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
        )
      )
    )
  );

drop policy if exists "matches_delete_leader_coach" on matches;
create policy "matches_delete" on matches
  for delete using (
    member_id = auth.uid()
    or (
      member_id is null
      and team_id in (
        select team_id from profiles
        where id = auth.uid() and role in ('leader', 'vice_leader', 'captain', 'coach')
      )
    )
  );

-- ============================================
-- 追加: 自分の試合の日付を更新できるようにする
-- ============================================
create policy "matches_update_self" on matches
  for update using (member_id = auth.uid());

-- ============================================
-- 追加: 部員全員のウェイトMAX（自己ベスト）記録
-- ============================================
create table if not exists weight_maxes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  bench numeric,
  squat numeric,
  deadlift numeric,
  updated_at timestamptz not null default now(),
  unique (author_id)
);
alter table weight_maxes enable row level security;

create policy "weight_maxes_select_same_team" on weight_maxes
  for select using (team_id = get_my_team_id());

create policy "weight_maxes_insert_self" on weight_maxes
  for insert with check (author_id = auth.uid());

create policy "weight_maxes_update_self" on weight_maxes
  for update using (author_id = auth.uid());

-- ============================================
-- 追加: 実施報告・未実施報告など、自分のコメントの編集・削除を許可
-- ============================================
create policy "comments_update_self" on comments
  for update using (author_id = auth.uid());

create policy "comments_delete_self" on comments
  for delete using (author_id = auth.uid());
