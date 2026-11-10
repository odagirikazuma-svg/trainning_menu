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
