-- ============================================================
-- 本番（東京 afqhlsxclsntnbyyyfzg）にまだ入れていない変更をまとめたSQL
--
-- ・staging（ムンバイ）ではすべて実行済み
-- ・本番に出すときに、このファイルを上から順に1回だけ実行する
--   （何度実行しても壊れないように書いてある）
-- ・実行したら中身を空にして（このヘッダーだけ残して）、次の変更はここに足していく
-- ・データベース全体の最新の形は supabase/schema.sql
-- ============================================================


-- ############################################################
-- 01. 2026-11-09_session_auto_menus.sql
-- ############################################################
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


-- ############################################################
-- 02. 2026-11-09_daily_report_reactions_goals.sql
-- ############################################################
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


-- ############################################################
-- 03. 2026-11-09_training_sets.sql
-- ############################################################
-- ============================================
-- 追加: トレーニングの数値記録（2026-11-09）
-- 種目は部員が自分で追加でき、チーム内で共有される（他の人が追加した種目も選べる）。
-- 1セットごとに「重量（任意）× 回数」または「重量（任意）× 時間」を記録する。
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


-- ############################################################
-- 04. 2026-11-09_training_sets_warmup.sql
-- ############################################################
-- ============================================
-- 追加: セットに「ウォーミングアップ」の印を付けられるようにする（2026-11-09）
-- 振り返りの「メインセット平均（練習の質）」「練習量」の計算から外すため
-- ============================================
alter table training_sets add column if not exists is_warmup boolean not null default false;

notify pgrst, 'reload schema';


-- ############################################################
-- 05. 2026-11-09_exercises_delete.sql
-- ############################################################
-- ============================================
-- 追加: 自分が追加した種目を削除できるようにする（2026-11-09）
-- 他の部員がすでに記録に使っている種目は消せない（その人の記録まで消えてしまうため）
-- ============================================
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


-- ############################################################
-- 06. 2026-11-10_remove_leader_role.sql
-- ############################################################
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


-- ############################################################
-- 07. 2026-11-10_fatigue_weight_class.sql
-- ############################################################
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


-- ############################################################
-- 08. 2026-11-10_absence_requests.sql
-- ############################################################
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


-- ############################################################
-- 09. 2026-11-10_line_login.sql
-- ############################################################
-- ============================================
-- 追加: LINEログイン（アプリのアカウントとLINEのユーザーIDの紐付け）
-- 紐付けはサーバー側（サービスロール）でだけ書き込む
-- ============================================
alter table profiles add column if not exists line_user_id text;
alter table profiles add column if not exists line_display_name text;
create unique index if not exists profiles_line_user_id_key
  on profiles (line_user_id) where line_user_id is not null;


-- ############################################################
-- 10. 2026-11-10_absence_plan_sets.sql
-- ############################################################
-- ============================================
-- 追加: 休み申請の代替メニュー（ウェイト）を、日報と同じセット記録の形で保存する
-- ============================================
alter table absence_requests add column if not exists plan_sets jsonb;


-- ############################################################
-- 11. 2026-11-10_exercise_better.sql
-- ############################################################
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


-- ############################################################
-- 12. 2026-11-10_absence_direct_permission.sql
-- ############################################################
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


-- ############################################################
-- 13. 2026-11-10_structured_menus.sql
-- ############################################################
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


-- ############################################################
-- 14. 2026-11-10_structured_menus_run.sql
-- ############################################################
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


-- ############################################################
-- 15. 2026-11-10_menu_participation.sql
-- ############################################################
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


-- ############################################################
-- 16. 2026-11-10_load_estimate.sql
-- ############################################################
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


-- ############################################################
-- 17. 2026-11-11_absence_hospital.sql
-- ############################################################
-- ============================================
-- 追加: 体調不良で休んだときの「病院の報告」（どこの病院に行って、結果はどうだったか）
-- 休みの日を過ぎてからも書けるように、本人用の関数で病院の欄だけ更新する
-- ============================================
alter table absence_requests add column if not exists hospital_name text
  check (hospital_name is null or char_length(hospital_name) <= 60);
alter table absence_requests add column if not exists hospital_result text
  check (hospital_result is null or char_length(hospital_result) <= 300);
alter table absence_requests add column if not exists hospital_reported_at timestamptz;

create or replace function report_absence_hospital(p_id uuid, p_hospital text, p_result text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update absence_requests
     set hospital_name = nullif(trim(p_hospital), ''),
         hospital_result = nullif(trim(p_result), ''),
         hospital_reported_at = case when nullif(trim(p_hospital), '') is null and nullif(trim(p_result), '') is null then null else now() end,
         updated_at = now()
   where id = p_id
     and author_id = auth.uid()
     and reason_type = 'sick';
  if not found then
    raise exception 'この休みの報告には病院の報告を書けません';
  end if;
end;
$$;
revoke all on function report_absence_hospital(uuid, text, text) from public;
grant execute on function report_absence_hospital(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';


-- ############################################################
-- 18. 2026-11-11_absence_sessions.sql
-- ############################################################
-- ============================================
-- 追加: 休みの申請で「どのセクションを休むか」を選べるようにする
-- session_keys：休むセクション（例 {"mat@17:00","weight@19:00"}）。null は「その日全部」
-- ============================================
alter table absence_requests add column if not exists session_keys text[];

-- 練習予定表の欠席者表示用の関数も、休むセクションを返すようにする（戻り値が変わるので作り直す）
drop function if exists team_absences(date);
create or replace function team_absences(p_date date)
returns table (author_id uuid, status text, session_keys text[])
language sql
stable
security definer
set search_path = public
as $$
  select a.author_id, a.status, a.session_keys
  from absence_requests a
  where a.team_id = get_my_team_id()
    and a.date = p_date
    and a.status in ('pending', 'approved');
$$;
grant execute on function team_absences(date) to authenticated;

notify pgrst, 'reload schema';


-- ############################################################
-- 19. 2026-11-11_absence_plan_templates.sql
-- ############################################################
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


-- ############################################################
-- 20. 2026-11-11 振り返り：疲労度を本人にも見せる・代表種目
-- ############################################################
-- 負荷の試算の係数は、本人の「今の体の状態」の計算にも使うので、同じチームなら読めるようにする（変更は監督だけ）
drop policy if exists "load_settings_coach" on load_settings;
drop policy if exists "load_settings_select" on load_settings;
create policy "load_settings_select" on load_settings
  for select using (team_id = get_my_team_id());
drop policy if exists "load_settings_write_coach" on load_settings;
create policy "load_settings_write_coach" on load_settings
  for all
  using (team_id = get_my_team_id() and is_my_role_coach())
  with check (team_id = get_my_team_id() and is_my_role_coach());

-- 代表種目：振り返りの「種目ごとの記録」で固定して出す種目（将来のチーム内ランキングにも使う）。監督が選ぶ
create table if not exists team_featured_exercises (
  team_id uuid not null references teams(id) on delete cascade,
  exercise_id uuid not null references exercises(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (team_id, exercise_id)
);
alter table team_featured_exercises enable row level security;
drop policy if exists "team_featured_exercises_select" on team_featured_exercises;
create policy "team_featured_exercises_select" on team_featured_exercises
  for select using (team_id = get_my_team_id());
drop policy if exists "team_featured_exercises_write_coach" on team_featured_exercises;
create policy "team_featured_exercises_write_coach" on team_featured_exercises
  for all
  using (team_id = get_my_team_id() and is_my_role_coach())
  with check (team_id = get_my_team_id() and is_my_role_coach());

notify pgrst, 'reload schema';


-- ############################################################
-- 21. 2026-11-11 代替メニューのテンプレートは本人だけのものにする（チームで共有しない）
-- ############################################################
drop policy if exists "absence_plan_templates_select" on absence_plan_templates;
drop policy if exists "absence_plan_templates_write" on absence_plan_templates;
drop policy if exists "absence_plan_templates_own" on absence_plan_templates;
create policy "absence_plan_templates_own" on absence_plan_templates
  for all
  using (created_by = auth.uid())
  with check (created_by = auth.uid() and team_id = get_my_team_id());

notify pgrst, 'reload schema';


-- ############################################################
-- 22. 2026-11-12 トレーニングの記録をセクションごとに（1日に2つのセクションがあっても別々に記録）
--     session_key：'weight@13:00' 'running@16:00' など。マットの代替メニューは 'mat@17:00'。null は予定外の自主トレ
-- ############################################################
alter table weight_logs add column if not exists session_key text;

-- 今までの記録は、その日の（本人の拠点の）最初のマット以外のセクションに割り当てる
update weight_logs w set session_key = sub.k
from (
  select w2.id,
    (select ss.session_type || '@' || to_char(ss.start_time, 'HH24:MI')
       from profiles p
       join schedule_days sd on sd.team_id = w2.team_id and sd.date = w2.date and sd.location = p.home_location and not sd.is_off
       join schedule_sessions ss on ss.schedule_day_id = sd.id and ss.session_type <> 'mat'
      where p.id = w2.author_id
      order by ss.start_time
      limit 1) as k
  from weight_logs w2
  where w2.session_key is null
) sub
where w.id = sub.id and sub.k is not null;

-- 「1人1日1件」の制約を外して「1人1日1セクション1件」にする
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'weight_logs'::regclass and con.contype = 'u'
  loop
    execute format('alter table weight_logs drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists weight_logs_author_date_session_key
  on weight_logs (author_id, date, session_key) nulls not distinct;

notify pgrst, 'reload schema';
