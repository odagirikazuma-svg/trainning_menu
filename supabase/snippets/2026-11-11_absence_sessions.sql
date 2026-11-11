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
