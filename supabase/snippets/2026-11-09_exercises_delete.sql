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
