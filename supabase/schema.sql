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
drop policy if exists "member_roster_update_self_claim" on member_roster;
create policy "member_roster_update_self_claim" on member_roster
  for update using (
    claimed_by is null
    and lower(email) = lower(auth.email())
  );

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

drop policy if exists "member_roster_update_unclaimed_self" on member_roster;
create policy "member_roster_update_unclaimed_self" on member_roster
  for update using (claimed_by is null);

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
-- 追加: 部員の役職に「リーダー」「副リーダー」を追加できるようにする
-- （主将・副主将に加えて、学年やグループ単位のリーダーなどを設定できるようにする）
-- ============================================
alter type member_role add value if not exists 'leader';
alter type member_role add value if not exists 'vice_leader';

-- ============================================
-- 追加: コーチが同じチームの部員の役職を編集できるようにする
-- ============================================
create policy "profiles_update_coach" on profiles
  for update using (
    team_id = get_my_team_id()
    and exists (
      select 1 from profiles where id = auth.uid() and role = 'coach'
    )
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
-- 追加: 部員の役職に「マネージャー」を追加する
-- （マイページを持たず、掲示板・チームページを閲覧のみできる立場）
-- ============================================
alter type member_role add value if not exists 'manager';

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
-- 追加: 部員の役職に「OB」を追加する
-- （引退した部員が、これまでの提出記録だけを閲覧できる立場）
-- ============================================
alter type member_role add value if not exists 'ob';

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
