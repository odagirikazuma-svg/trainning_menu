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
