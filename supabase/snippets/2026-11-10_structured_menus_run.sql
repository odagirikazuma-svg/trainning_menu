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
