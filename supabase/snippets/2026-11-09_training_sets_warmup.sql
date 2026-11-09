-- ============================================
-- 追加: セットに「ウォーミングアップ」の印を付けられるようにする（2026-11-09）
-- 振り返りの「メインセット平均（練習の質）」「練習量」の計算から外すため
-- ============================================
alter table training_sets add column if not exists is_warmup boolean not null default false;

notify pgrst, 'reload schema';
