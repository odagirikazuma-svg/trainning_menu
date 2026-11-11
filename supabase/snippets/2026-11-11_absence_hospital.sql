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
