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
-- 以下の役職はもともと後から追加されたが、スキーマを最初から流し込む際に
-- 途中のポリシー定義がこれらの値を参照するため、enum作成直後にまとめて追加しておく
alter type member_role add value if not exists 'leader';
alter type member_role add value if not exists 'vice_leader';
alter type member_role add value if not exists 'manager';
alter type member_role add value if not exists 'ob';

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

-- 「自分の所属チームID」を取得するヘルパー関数
-- （以降の多くのRLSポリシーで team_id = get_my_team_id() の形で使う。
-- 　本来はここで定義していたはずだが、schema.sqlに定義文自体が
-- 　記載されておらず、本番Supabase側にのみ存在していたため、
-- 　ここで改めて定義を追加した）
--
-- 重要: security definer を付けている。付けないと、profilesテーブル自身の
-- RLSポリシー（例: profiles_select_same_team）の中からこの関数を呼んだ際に、
-- 関数内部の「select ... from profiles」がまた同じRLSポリシーの評価を要求し、
-- "infinite recursion detected in policy for relation profiles" エラーになる。
-- security definer にすると、関数はオーナー権限（RLSをバイパスする権限）で
-- 実行されるため、内部のprofiles参照がRLSを再評価せず再帰を起こさない。
-- search_path も固定して、なりすまし関数によるセキュリティホールを防ぐ。
create or replace function get_my_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select team_id from profiles where id = auth.uid()
$$;

-- 同様の理由で、「自分がcoachかどうか」を判定する関数もsecurity definerにする
-- （profiles_update_coachポリシーなど、profiles自身のポリシーから使うため）
create or replace function is_my_role_coach()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'coach')
$$;

-- 自分のプロフィールは常に閲覧可能（team_idの一致判定に頼らない）
-- 新規登録直後、自分のprofiles行をinsertしてそのままreturningで受け取る際、
-- まだ自分の行が存在しない時点でget_my_team_id()を評価すると判定できず、
-- 「insertした行を返そうとしたが閲覧ポリシーを満たせない」エラーになるため、
-- id = auth.uid() という自明な条件で常に見えるようにしておく
create policy "profiles_select_self" on profiles
  for select using (id = auth.uid());

-- 自分のプロフィールと同じチームのプロフィールは閲覧可能
create policy "profiles_select_same_team" on profiles
  for select using (
    team_id = get_my_team_id()
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
    id = get_my_team_id()
  );

-- 「自分の所属チームID」を取得するヘルパー関数
-- （以降の多くのRLSポリシーで team_id = get_my_team_id() の形で使う。
-- 　本来はここで定義していたはずだが、schema.sqlに定義文自体が
-- 　記載されておらず、本番Supabase側にのみ存在していたため、
-- 　ここで改めて定義を追加した）
create or replace function get_my_team_id()
returns uuid
language sql
stable
as $$
  select team_id from profiles where id = auth.uid()
$$;

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
drop policy if exists "matches_update_self" on matches;
create policy "matches_update_self" on matches
  for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

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

-- ============================================
-- 追加: チームページから他の部員のマイページ（トレーニング記録）を
-- 閲覧できるように、weight_logsを同じチーム内なら閲覧可能にする
-- ============================================
create policy "weight_logs_select_same_team" on weight_logs
  for select using (team_id = get_my_team_id());

-- ============================================
-- 追加: 月間の時間割（コーチが月末までに来月分を設定する、
-- 拠点・日付ごとの「オフ or 練習（1〜2セッション、各セッションの種類・開始時刻）」）
-- ============================================
create table if not exists schedule_days (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  location text not null check (location in ('tama', 'otsuka')),
  date date not null,
  is_off boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (team_id, location, date)
);
alter table schedule_days enable row level security;

create policy "schedule_days_select_same_team" on schedule_days
  for select using (team_id = get_my_team_id());

create policy "schedule_days_insert_coach" on schedule_days
  for insert with check (
    team_id = get_my_team_id()
    and exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "schedule_days_update_coach" on schedule_days
  for update using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "schedule_days_delete_coach" on schedule_days
  for delete using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create table if not exists schedule_sessions (
  id uuid primary key default gen_random_uuid(),
  schedule_day_id uuid not null references schedule_days(id) on delete cascade,
  session_no smallint not null check (session_no in (1, 2)),
  session_type text not null check (session_type in ('mat', 'running', 'weight')),
  start_time time not null,
  is_joint boolean not null default false,
  joint_location text check (joint_location in ('tama', 'otsuka')),
  unique (schedule_day_id, session_no)
);
alter table schedule_sessions enable row level security;

create policy "schedule_sessions_select_same_team" on schedule_sessions
  for select using (
    schedule_day_id in (
      select id from schedule_days where team_id = get_my_team_id()
    )
  );

create policy "schedule_sessions_insert_coach" on schedule_sessions
  for insert with check (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "schedule_sessions_update_coach" on schedule_sessions
  for update using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "schedule_sessions_delete_coach" on schedule_sessions
  for delete using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

-- ============================================
-- 追加: 部員の事前登録（名前とメールアドレスをあらかじめ紐づけておき、
-- 本人が実際にサインアップした際に自動で情報を引き継ぐ）
-- ============================================
create table if not exists member_roster (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'member' check (role in ('captain', 'vice_captain', 'coach', 'member')),
  home_location text check (home_location in ('tama', 'otsuka')),
  entry_year integer,
  claimed_by uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (team_id, email)
);
alter table member_roster enable row level security;

create policy "member_roster_select_same_team" on member_roster
  for select using (team_id = get_my_team_id());

create policy "member_roster_insert_coach" on member_roster
  for insert with check (
    team_id = get_my_team_id()
    and exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "member_roster_update_coach" on member_roster
  for update using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

create policy "member_roster_delete_coach" on member_roster
  for delete using (
    exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
  );

-- サインアップ時に自分のメールアドレスに一致する未紐付けの事前登録があれば、
-- claimed_byを自分自身に更新できるようにする（プロフィール作成時に使用）
-- ※auth.usersテーブルへの直接参照は権限エラーになるため、auth.email()を使う
--
-- 重要: with checkを指定していないと、Postgresの仕様でupdate後の行にも
-- 同じusing条件（claimed_by is null）が適用されてしまい、
-- 「claimed_byをnullから自分のIDに更新する」という本来の操作自体が
-- 常に（エラーも出さず静かに）弾かれてしまうため、with checkを明示する。
drop policy if exists "member_roster_update_self_claim" on member_roster;
create policy "member_roster_update_self_claim" on member_roster
  for update using (
    claimed_by is null
    and lower(email) = lower(auth.email())
  )
  with check (claimed_by = auth.uid());

-- 新規サインアップ時（まだ自分のprofilesが存在しない段階）でも、
-- 自分のメールアドレスに一致する事前登録だけは検索できるようにする
drop policy if exists "member_roster_select_self_email" on member_roster;
create policy "member_roster_select_self_email" on member_roster
  for select using (
    lower(email) = lower(auth.email())
  );

-- ============================================
-- 追加: 部員の事前登録時点ではメールアドレス未定のケースに対応するため、
-- member_roster.emailを必須ではなくする
-- ============================================
alter table member_roster alter column email drop not null;

-- ============================================
-- 追加: 部員の事前登録に「招待リンク」を持たせる
-- （メールアドレスが分からなくても、リンク経由で確実に紐付けできるようにする）
-- ============================================
alter table member_roster add column if not exists token uuid not null default gen_random_uuid();
alter table member_roster drop constraint if exists member_roster_token_key;
alter table member_roster add constraint member_roster_token_key unique (token);

-- 新規サインアップ時（まだ自分のprofilesが存在しない段階）でも、
-- 招待リンクのトークンで事前登録を検索・紐付けできるようにする
-- （未紐付けの行だけを対象にするため、閲覧できる情報は限定的）
drop policy if exists "member_roster_select_unclaimed" on member_roster;
create policy "member_roster_select_unclaimed" on member_roster
  for select using (claimed_by is null);

-- 同様の理由（Postgresのupdate policyはwith check省略時、更新後の行にも
-- usingを適用してしまう）で、こちらもwith checkを明示する。
drop policy if exists "member_roster_update_unclaimed_self" on member_roster;
create policy "member_roster_update_unclaimed_self" on member_roster
  for update using (claimed_by is null)
  with check (claimed_by = auth.uid());

-- ============================================
-- 追加: ウェイトのトレーニング記録にタイトルをつけられるようにする
-- ============================================
alter table weight_logs add column if not exists title text;

-- ============================================
-- 追加: 月間の時間割に「合宿」「試合」の区分を追加
-- （オフ/練習に加えて、合宿・試合の日を設定できるようにする。
-- 　合宿・試合の日は、練習セクションを入れるかどうかを任意で選べる）
-- ============================================
alter table schedule_days add column if not exists day_type text not null default 'practice' check (day_type in ('practice', 'camp', 'match'));

-- ============================================
-- 追加: 合宿・試合に名前をつけられるようにする
-- ============================================
alter table schedule_days add column if not exists event_name text;

-- ============================================
-- 追加: コーチが「ウェイトMAXを集計する」イベントを作成できるようにする
-- （締切日までに部員がBIG3のMAXを提出するタスクをやることリストに表示する）
-- ============================================
create table if not exists weight_max_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  deadline date not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table weight_max_events enable row level security;

create policy "weight_max_events_select_same_team" on weight_max_events
  for select using (team_id = get_my_team_id());

create policy "weight_max_events_insert_coach" on weight_max_events
  for insert with check (
    team_id = get_my_team_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

create policy "weight_max_events_delete_coach" on weight_max_events
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

-- ============================================
-- 追加: コーチが同じチームの部員の役職を編集できるようにする
-- ============================================
create policy "profiles_update_coach" on profiles
  for update using (
    team_id = get_my_team_id()
    and is_my_role_coach()
  );

-- ============================================
-- 追加: ウェイトMAXの計測履歴を残せるようにする
-- （集計イベントごとに記録を分けて保存し、過去の計測結果も遡って見れるようにする）
-- ============================================
alter table weight_max_events add column if not exists closed_at timestamptz;

alter table weight_maxes add column if not exists event_id uuid references weight_max_events(id) on delete set null;

-- 既存の単一レコードは、直近の集計イベントに紐付けておく（無ければ紐付けなしのまま）
update weight_maxes
set event_id = (select id from weight_max_events order by created_at desc limit 1)
where event_id is null
  and exists (select 1 from weight_max_events);

alter table weight_maxes drop constraint if exists weight_maxes_author_id_key;
alter table weight_maxes drop constraint if exists weight_maxes_author_event_unique;
alter table weight_maxes add constraint weight_maxes_author_event_unique unique (author_id, event_id);

-- ============================================
-- 追加: 怪我管理（部員がマイページから報告し、コーチが管理ページで確認できる）
-- ============================================
create table if not exists injuries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  symptom_name text not null,
  body_part text not null,
  detail text,
  expected_recovery_date date,
  surgery_possibility text not null default 'unknown' check (surgery_possibility in ('yes', 'no', 'unknown')),
  next_hospital_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table injuries enable row level security;

create policy "injuries_select_same_team" on injuries
  for select using (team_id = get_my_team_id());

create policy "injuries_insert_self" on injuries
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

create policy "injuries_update_self" on injuries
  for update using (author_id = auth.uid());

create policy "injuries_delete_self" on injuries
  for delete using (author_id = auth.uid());

-- ============================================
-- 追加: 怪我管理の拡張（マット参加の可否、完治・進捗報告）
-- ============================================
alter table injuries add column if not exists mat_participation text not null default 'no' check (mat_participation in ('yes', 'no', 'conditional'));
alter table injuries add column if not exists mat_participation_detail text;
alter table injuries add column if not exists is_recovered boolean not null default false;
alter table injuries add column if not exists progress_note text;
alter table injuries add column if not exists progress_updated_at timestamptz;

-- ============================================
-- 追加: 一度報告した怪我は削除できないようにする（編集のみ許可）
-- ============================================
drop policy if exists "injuries_delete_self" on injuries;

-- ============================================
-- 追加: プッシュ通知の購読情報を保存するテーブル
-- ============================================
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;

create policy "push_subscriptions_select_self" on push_subscriptions
  for select using (author_id = auth.uid());

create policy "push_subscriptions_insert_self" on push_subscriptions
  for insert with check (author_id = auth.uid());

create policy "push_subscriptions_delete_self" on push_subscriptions
  for delete using (author_id = auth.uid());

-- ============================================
-- 追加: 時間割の区分に「出稽古」を追加し、合宿・出稽古の練習場所を
-- 自由記述できるようにする
-- ============================================
alter table schedule_days drop constraint if exists schedule_days_day_type_check;
alter table schedule_days add constraint schedule_days_day_type_check check (day_type in ('practice', 'camp', 'match', 'away'));

alter table schedule_sessions add column if not exists location_note text;

-- ============================================
-- 追加: ウェイトMAX集計以外の「イベント」（試合の振り返り、体組成の提出 など）
-- コーチが定期的に作成し、部員がタスク一覧から提出する汎用の仕組み
-- ============================================
create table if not exists team_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  type text not null check (type in ('match_reflection', 'body_composition')),
  title text not null default '',
  deadline date not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table team_events enable row level security;

create policy "team_events_select_same_team" on team_events
  for select using (team_id = get_my_team_id());

create policy "team_events_insert_coach" on team_events
  for insert with check (
    team_id = get_my_team_id()
    and exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

create policy "team_events_update_coach" on team_events
  for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

create table if not exists team_event_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references team_events(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  content text not null default '',
  weight_kg numeric,
  body_fat_pct numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, author_id)
);
alter table team_event_submissions enable row level security;

create policy "team_event_submissions_select_same_team" on team_event_submissions
  for select using (team_id = get_my_team_id());

create policy "team_event_submissions_insert_self" on team_event_submissions
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

create policy "team_event_submissions_update_self" on team_event_submissions
  for update using (author_id = auth.uid());

-- ============================================
-- 追加: 「試合の振り返り」イベントの構造化項目
-- ============================================
alter table team_event_submissions add column if not exists match_title text;
alter table team_event_submissions add column if not exists match_count integer;
alter table team_event_submissions add column if not exists win_count integer;
alter table team_event_submissions add column if not exists loss_count integer;
alter table team_event_submissions add column if not exists reflection text;
alter table team_event_submissions add column if not exists good_points text;
alter table team_event_submissions add column if not exists challenges text;
alter table team_event_submissions add column if not exists improvement_plan text;
alter table team_event_submissions add column if not exists team_challenges text;

-- ============================================
-- 追加: イベントの対象者を限定できるようにする
-- （行が無いイベントは「全員が対象」として扱う）
-- ============================================
create table if not exists team_event_targets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references team_events(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  unique (event_id, member_id)
);
alter table team_event_targets enable row level security;

create policy "team_event_targets_select_same_team" on team_event_targets
  for select using (
    exists (
      select 1 from team_events e
      where e.id = event_id and e.team_id = get_my_team_id()
    )
  );

create policy "team_event_targets_insert_coach" on team_event_targets
  for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

create policy "team_event_targets_delete_coach" on team_event_targets
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );


-- ============================================
-- 追加: 「体組成の提出」の項目（測定日・骨格筋量・除脂肪体重）
-- ============================================
alter table team_event_submissions add column if not exists measurement_date date;
alter table team_event_submissions add column if not exists muscle_mass_kg numeric;
alter table team_event_submissions add column if not exists lean_body_mass_kg numeric;

-- ============================================
-- 追加: ウェイトMAX集計も対象者を限定できるようにする
-- （行が無いイベントは「全員が対象」として扱う）
-- ============================================
create table if not exists weight_max_event_targets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references weight_max_events(id) on delete cascade,
  member_id uuid not null references profiles(id) on delete cascade,
  unique (event_id, member_id)
);
alter table weight_max_event_targets enable row level security;

create policy "weight_max_event_targets_select_same_team" on weight_max_event_targets
  for select using (
    exists (
      select 1 from weight_max_events e
      where e.id = event_id and e.team_id = get_my_team_id()
    )
  );

create policy "weight_max_event_targets_insert_coach" on weight_max_event_targets
  for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

create policy "weight_max_event_targets_delete_coach" on weight_max_event_targets
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

-- ============================================
-- 追加: 「試合の振り返り」に試合結果（優勝・準優勝・◯回戦敗退 など）の項目を追加
-- ============================================
alter table team_event_submissions add column if not exists match_result text;

-- ============================================
-- 追加: 事前登録（member_roster）の役職に「マネージャー」「リーダー」を追加できるようにする
-- ============================================
alter table member_roster drop constraint if exists member_roster_role_check;
alter table member_roster add constraint member_roster_role_check
  check (role in ('captain', 'vice_captain', 'coach', 'manager', 'member', 'leader'));

-- ============================================
-- 追加: OBが自分のマイページのタスク一覧を表示するかどうかを選べるようにする
-- ============================================
alter table profiles add column if not exists show_task_list boolean not null default true;

-- ============================================
-- 追加: トレ報（ラン・ウェイト・その他）に、部員が任意で開始時間を記録できるようにする
-- ============================================
alter table weight_logs add column if not exists start_time time;

-- ============================================
-- 追加: マット以外（ラン・ウェイト・その他）のセクションは、
-- 時間を固定せず「各自」にできるようにする（start_timeをNULL許容に変更）
-- ============================================
alter table schedule_sessions alter column start_time drop not null;

-- ============================================
-- 追加: UIリニューアル（ヘッダー・フッター・設定ページ）対応
-- プロフィールアイコン画像のURLを保存する列を追加する
-- ============================================
alter table profiles add column if not exists icon_url text;

-- ※このプロフィールアイコン機能を使うには、Supabase側で追加のセットアップが必要です。
-- 1. Supabaseダッシュボード > Storage で、新しいバケットを作成してください。
--    - バケット名: avatars
--    - Public bucket: オン（アイコン画像を誰でも閲覧できるようにするため）
-- 2. 以下のポリシーをSQL Editorで実行し、本人だけが自分のアイコンをアップロード・更新・削除できるようにしてください。

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own" on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================
-- 追加: マイページカレンダーの「一言メモ」
-- 本人だけが閲覧・編集できる、日付ごと1件・20文字までの非公開メモ。
-- ============================================
create table if not exists personal_memos (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  content text not null default '' check (char_length(content) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (author_id, date)
);
alter table personal_memos enable row level security;

create policy "personal_memos_select_self" on personal_memos
  for select using (author_id = auth.uid());

create policy "personal_memos_insert_self" on personal_memos
  for insert with check (author_id = auth.uid());

create policy "personal_memos_update_self" on personal_memos
  for update using (author_id = auth.uid());

create policy "personal_memos_delete_self" on personal_memos
  for delete using (author_id = auth.uid());

-- ============================================
-- 追加: イベント提出（試合の振り返り等）へのコメント機能
-- コーチが部員の提出内容にコメントを残せるようにする（部員側からの返信も可）。
-- ============================================
create table if not exists team_event_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references team_event_submissions(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
alter table team_event_comments enable row level security;

create policy "team_event_comments_select_same_team" on team_event_comments
  for select using (team_id = get_my_team_id());

create policy "team_event_comments_insert_same_team" on team_event_comments
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

create policy "team_event_comments_delete_self" on team_event_comments
  for delete using (author_id = auth.uid());

-- ============================================
-- 追加: トレーニング（マット以外のセッション）の実施報告へのコメント機能
-- コーチ・本人どちらもコメントできる（管理ページの「トレーニング」タブ、
-- マイページのトレーニング記録欄から利用する）。
-- ============================================
create table if not exists weight_log_comments (
  id uuid primary key default gen_random_uuid(),
  weight_log_id uuid not null references weight_logs(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);
alter table weight_log_comments enable row level security;

create policy "weight_log_comments_select_same_team" on weight_log_comments
  for select using (team_id = get_my_team_id());

create policy "weight_log_comments_insert_same_team" on weight_log_comments
  for insert with check (
    author_id = auth.uid() and team_id = get_my_team_id()
  );

create policy "weight_log_comments_delete_self" on weight_log_comments
  for delete using (author_id = auth.uid());

-- ============================================
-- 追加: 時間割にマットのセッションが登録されたら、メニューが未作成でも
-- 「中身が空のメニュー枠」を自動で用意する（2026-11-09）
--
-- タスク・提出人数・19時の通知・管理ページの集計はすべて menus を起点にしているため、
-- 空のメニュー枠を作っておけば、リーダーがメニューを書かなくても
-- 開始時刻を過ぎた時点で部員のタスクとして表示される。
-- リーダーが後からメニューを書くと、この枠にそのまま書き込まれる。
-- ============================================

-- メニューと、それを自動で用意したセッションの紐づけ
alter table menus add column if not exists source_session_id uuid
  references schedule_sessions(id) on delete set null;
create index if not exists menus_source_session_id_idx on menus(source_session_id);

-- セッション1件分のメニュー枠を用意する（既にあれば紐づけるだけ）
create or replace function ensure_session_menu(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s schedule_sessions%rowtype;
  d schedule_days%rowtype;
  v_location text;
  v_is_joint boolean;
  v_menu_id uuid;
begin
  select * into s from schedule_sessions where id = p_session_id;
  if not found or s.session_type <> 'mat' then
    return;
  end if;

  if exists (select 1 from menus where source_session_id = s.id) then
    return;
  end if;

  select * into d from schedule_days where id = s.schedule_day_id;
  if not found or d.is_off then
    return;
  end if;

  -- 合宿・出稽古は拠点ごとに別メニュー、通常の全体練習は開催拠点に1つだけ
  if d.day_type in ('camp', 'away') then
    v_location := d.location;
    v_is_joint := false;
  elsif s.is_joint and s.joint_location is not null then
    v_location := s.joint_location;
    v_is_joint := true;
  else
    v_location := d.location;
    v_is_joint := false;
  end if;

  -- その日をリーダーが「オフ」にしている場合は作らない
  if exists (
    select 1 from menus
    where team_id = d.team_id and location = v_location
      and date = d.date and is_off
  ) then
    return;
  end if;

  -- 既にリーダーが作ったメニュー（開始時刻が同じ、または前後60分以内）があればそれを使う
  select id into v_menu_id
  from menus
  where team_id = d.team_id
    and location = v_location
    and date = d.date
    and not is_off
    and (
      start_time is null
      or s.start_time is null
      or abs(extract(epoch from (start_time - s.start_time))) <= 3600
    )
  order by (start_time is not distinct from s.start_time) desc, created_at
  limit 1;

  if v_menu_id is not null then
    update menus set source_session_id = s.id
    where id = v_menu_id and source_session_id is null;
    return;
  end if;

  insert into menus (
    team_id, date, title, content, created_by, location,
    start_time, is_joint, is_off, source_session_id
  ) values (
    d.team_id, d.date, '', '', null, v_location,
    s.start_time, v_is_joint, false, s.id
  );
end;
$$;

-- セッションが消える・マット以外に変わるときの後始末
-- （まだ空で、誰も報告していない枠だけを消す。書かれた・報告があるメニューは残す）
create or replace function release_session_menu(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from menus m
  where m.source_session_id = p_session_id
    and coalesce(m.content, '') = ''
    and not exists (select 1 from comments c where c.menu_id = m.id);

  update menus set source_session_id = null
  where source_session_id = p_session_id;
end;
$$;

create or replace function schedule_sessions_sync_menu()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_date date;
begin
  if tg_op = 'DELETE' then
    if old.session_type = 'mat' then
      -- 日付・チームは、紐づいたメニューから取る（時間割の日ごと削除された場合、
      -- schedule_days の行は先に消えているため）
      select team_id, date into v_team_id, v_date
      from menus where source_session_id = old.id limit 1;
      perform release_session_menu(old.id);
      -- 全体練習で、もう一方の拠点にも同じセッションが残っていれば、そちらで枠を用意し直す
      if old.is_joint and old.joint_location is not null then
        perform ensure_session_menu(o.id)
        from schedule_sessions o
        join schedule_days od on od.id = o.schedule_day_id
        where v_team_id is not null
          and o.id <> old.id
          and o.session_type = 'mat'
          and o.is_joint
          and o.joint_location = old.joint_location
          and od.team_id = v_team_id
          and od.date = v_date;
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.session_type = 'mat' then
    if new.session_type <> 'mat' then
      perform release_session_menu(old.id);
    else
      -- 時刻変更は、紐づいたメニューにも反映する
      update menus set start_time = new.start_time
      where source_session_id = new.id
        and start_time is distinct from new.start_time;
    end if;
  end if;

  if new.session_type = 'mat' then
    perform ensure_session_menu(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_sessions_sync_menu_before_delete on schedule_sessions;
create trigger schedule_sessions_sync_menu_before_delete
  before delete on schedule_sessions
  for each row execute function schedule_sessions_sync_menu();

drop trigger if exists schedule_sessions_sync_menu_after_write on schedule_sessions;
create trigger schedule_sessions_sync_menu_after_write
  after insert or update on schedule_sessions
  for each row execute function schedule_sessions_sync_menu();

-- 今日以降に登録済みのマットセッションにも、メニュー枠を用意しておく
select ensure_session_menu(s.id)
from schedule_sessions s
join schedule_days d on d.id = s.schedule_day_id
where s.session_type = 'mat'
  and d.date >= (now() at time zone 'Asia/Tokyo')::date;

notify pgrst, 'reload schema';

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

alter table training_sets add column if not exists is_warmup boolean not null default false;

notify pgrst, 'reload schema';

drop policy if exists "exercises_delete_creator" on exercises;
create policy "exercises_delete_creator" on exercises
  for delete using (
    created_by = auth.uid()
    and not exists (
      select 1 from training_sets t
      where t.exercise_id = exercises.id and t.author_id <> auth.uid()
    )
  );

notify pgrst, 'reload schema';

-- ============================================
-- 更新: リーダーの役職を廃止し、練習メニューの作成・編集・削除を
-- 部員なら誰でもできるようにする（マネージャーとOBは除く）
-- ============================================

-- 1) 今リーダー／副リーダーの人を「役職なし」に戻す
update profiles set role = 'member' where role = 'leader';
update member_roster set role = 'member' where role = 'leader';

-- 2) 事前登録の役職からリーダーを外す
alter table member_roster drop constraint if exists member_roster_role_check;
alter table member_roster add constraint member_roster_role_check
  check (role in ('captain', 'vice_captain', 'coach', 'manager', 'member'));

-- 3) メニューの作成・編集・削除の権限
drop policy if exists "menus_insert_captain_only" on menus;
drop policy if exists "menus_insert_team_member" on menus;
create policy "menus_insert_team_member" on menus
  for insert with check (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );

drop policy if exists "menus_update_leader_coach" on menus;
drop policy if exists "menus_update_team_member" on menus;
create policy "menus_update_team_member" on menus
  for update using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );

drop policy if exists "menus_delete_leader_coach" on menus;
drop policy if exists "menus_delete_team_member" on menus;
create policy "menus_delete_team_member" on menus
  for delete using (
    team_id in (
      select team_id from profiles
      where id = auth.uid() and role not in ('manager', 'ob')
    )
  );

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

-- ============================================
-- 追加: LINEログイン（アプリのアカウントとLINEのユーザーIDの紐付け）
-- 紐付けはサーバー側（サービスロール）でだけ書き込む
-- ============================================
alter table profiles add column if not exists line_user_id text;
alter table profiles add column if not exists line_display_name text;
create unique index if not exists profiles_line_user_id_key
  on profiles (line_user_id) where line_user_id is not null;

-- ============================================
-- 追加: 休み申請の代替メニュー（ウェイト）を、日報と同じセット記録の形で保存する
-- ============================================
alter table absence_requests add column if not exists plan_sets jsonb;

-- ============================================
-- 追加: 種目ごとに「大きい値が良い／小さい値が良い」を持たせる
-- （400m走・3km走などのタイムは、短いほど自己ベスト）
-- ============================================
alter table exercises add column if not exists better text not null default 'higher'
  check (better in ('higher', 'lower'));

-- 既存の時間の種目のうち、走る種目（名前に「走」「ランニング」「ダッシュ」や距離が入っているもの）は「小さい値が良い」にする
update exercises set better = 'lower'
where measure = 'time'
  and name ~ '(走|ランニング|ジョグ|ダッシュ|シャトル|スプリント|[0-9０-９]+ *(m|km|ｍ|ｋｍ|メートル|キロ))';

-- ============================================
-- 追加: 練習予定表の「欠席者」用。休み申請の状態（申請中・承認済み）だけを
-- 同じチームの全員が見られるようにする（理由や代替メニューは見せない）
-- ============================================
create or replace function team_absences(p_date date)
returns table (author_id uuid, status text)
language sql
stable
security definer
set search_path = public
as $$
  select a.author_id, a.status
  from absence_requests a
  where a.team_id = get_my_team_id()
    and a.date = p_date
    and a.status in ('pending', 'approved');
$$;

grant execute on function team_absences(date) to authenticated;

-- ============================================
-- 変更: 休み申請を「承認待ち」から「報告」に
-- - 授業・学業：届け出だけ（そのまま承認済み）
-- - それ以外：監督・管理者からLINEか電話で直接許可をもらい、誰から・どうやってを記録して報告
-- - 監督・管理者は、身に覚えのない報告を取り消せる（status = 'rejected'）
-- ============================================
alter table absence_requests add column if not exists permitted_by uuid references profiles(id) on delete set null;
alter table absence_requests add column if not exists approval_method text
  check (approval_method in ('line', 'phone'));

-- 本人が報告する
drop policy if exists "absence_requests_insert_self" on absence_requests;
create policy "absence_requests_insert_self" on absence_requests
  for insert with check (
    author_id = auth.uid()
    and team_id = get_my_team_id()
    and status = 'approved'
    and (
      reason_type = 'school'
      or (
        approval_method is not null
        and exists (
          select 1 from profiles p
          where p.id = permitted_by and p.role = 'coach' and p.team_id = get_my_team_id()
        )
      )
    )
  );

-- 本人は、今日以降の自分の報告を直せる（取り消された報告は直せない）
drop policy if exists "absence_requests_update_self" on absence_requests;
create policy "absence_requests_update_self" on absence_requests
  for update
  using (
    author_id = auth.uid()
    and status <> 'rejected'
    and date >= (now() at time zone 'Asia/Tokyo')::date
  )
  with check (
    author_id = auth.uid()
    and status = 'approved'
    and (
      reason_type = 'school'
      or (
        approval_method is not null
        and exists (
          select 1 from profiles p
          where p.id = permitted_by and p.role = 'coach' and p.team_id = get_my_team_id()
        )
      )
    )
  );

-- 本人は、今日以降の自分の報告を消せる（やっぱり練習に出る場合など）
drop policy if exists "absence_requests_delete_self" on absence_requests;
create policy "absence_requests_delete_self" on absence_requests
  for delete using (
    author_id = auth.uid()
    and date >= (now() at time zone 'Asia/Tokyo')::date
  );

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

-- ============================================
-- 追加: 構造化メニューに ラン・ダッシュ（距離×本数）、対象（通常／重量級）、本数の数え方「未確認」を追加
-- （2026-11-10_structured_menus.sql の後に実行）
-- ============================================
alter table menu_items drop constraint if exists menu_items_category_check;
alter table menu_items add constraint menu_items_category_check
  check (category in ('warmup', 'conditioning', 'technique', 'drill', 'situational', 'spar', 'run', 'sprint', 'cooldown', 'other'));

alter table menu_items add column if not exists distance_m int check (distance_m is null or distance_m > 0);
alter table menu_items drop constraint if exists menu_items_amount_type_check;
alter table menu_items add constraint menu_items_amount_type_check
  check (amount_type in ('timed', 'total', 'reps', 'distance'));

-- 本数が「全体」か「1人あたり」か分からないときは unknown（勝手に決めない）
alter table menu_items drop constraint if exists menu_items_sets_basis_check;
alter table menu_items alter column sets_basis set default 'unknown';
alter table menu_items add constraint menu_items_sets_basis_check
  check (sets_basis in ('total', 'per_person', 'unknown'));

-- 対象：all 全員／regular 通常／heavy 重量級（誰が重量級かは自動で決めない）
alter table menu_items add column if not exists target_group text not null default 'all'
  check (target_group in ('all', 'regular', 'heavy'));

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
