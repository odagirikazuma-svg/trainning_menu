-- ============================================
-- 追加: LINEログイン（アプリのアカウントとLINEのユーザーIDの紐付け）
-- 紐付けはサーバー側（サービスロール）でだけ書き込む
-- ============================================
alter table profiles add column if not exists line_user_id text;
alter table profiles add column if not exists line_display_name text;
create unique index if not exists profiles_line_user_id_key
  on profiles (line_user_id) where line_user_id is not null;
