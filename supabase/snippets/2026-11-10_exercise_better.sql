-- ============================================
-- 追加: 種目ごとに「大きい値が良い／小さい値が良い」を持たせる
-- （400m走・3km走などのタイムは、短いほど自己ベスト）
-- ============================================
alter table exercises add column if not exists better text not null default 'higher'
  check (better in ('higher', 'lower'));

-- 既存の時間の種目のうち、走る種目（名前に「走」「ラン」「ダッシュ」や距離が入っているもの）は「小さい値が良い」にする
update exercises set better = 'lower'
where measure = 'time'
  and name ~ '(走|ラン|ダッシュ|シャトル|スプリント|[0-9０-９]+ *(m|km|ｍ|ｋｍ|メートル|キロ))';
