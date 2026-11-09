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
