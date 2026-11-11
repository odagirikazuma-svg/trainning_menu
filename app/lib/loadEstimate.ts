// 負荷の試算（監督だけが見る）。
// 実測ではなく、メニューの量 × 係数 で出すおおまかな目安。係数は監督が変えられる。
//
// ■ マット練習：項目ごとに「1人あたりの実施量」× 係数
//    - 時間：1本の時間×本数（交代制は「同時に実施する人数 ÷ 組の人数」を掛ける）
//      「本数の数え方」が未確認の項目は計算に入れない（監督が確定したら入る）
//    - 距離：km × 係数（ラン・ダッシュ）
//    - 回数：10回あたり × 係数（MAXなど回数が決まっていないものは入れない）
//    - 自由参加：本人が答えた参加量（0〜100%）を掛ける。未回答は入れない
//    - 対象が「通常／重量級」の項目は、誰があたるかまだ決めていないので入れない
//    - 本人が参加範囲を答えていないときは、自由参加以外を全部参加とみなす
// ■ ウェイト：メインセットの「重量×回数」÷ 試合の階級（kg）× 係数。階級が未登録の人は入れない
// ■ 蓄積：きょうの蓄積 ＝ 前日の蓄積 × 残る割合 ＋ きょうの負荷
// ■ いつもとの比較：きょうの蓄積 ÷ その人の直近28日の蓄積の平均（人による差を相対で見る）

import { needsCheck, amountMissing, type MenuItemDraft, type MenuCategory } from "./menuItems";

export const CALC_VERSION = "v1";

export type Coefficients = Partial<Record<string, number>>;

// 係数の一覧（画面の設定欄の順番）
export const coefficientDefs: { key: string; label: string; unit: string; suggested: number }[] = [
  { key: "warmup", label: "アップ", unit: "1分あたり", suggested: 2 },
  { key: "technique", label: "技術", unit: "1分あたり", suggested: 3 },
  { key: "drill", label: "打ち込み", unit: "1分あたり", suggested: 5 },
  { key: "situational", label: "攻防（状況設定）", unit: "1分あたり", suggested: 7 },
  { key: "spar", label: "スパー", unit: "1分あたり", suggested: 10 },
  { key: "conditioning", label: "補強", unit: "1分あたり", suggested: 6 },
  { key: "run", label: "ラン", unit: "1分あたり", suggested: 5 },
  { key: "run_km", label: "ラン", unit: "1kmあたり", suggested: 25 },
  { key: "sprint", label: "ダッシュ", unit: "1分あたり", suggested: 9 },
  { key: "sprint_km", label: "ダッシュ", unit: "1kmあたり", suggested: 60 },
  { key: "cooldown", label: "ダウン", unit: "1分あたり", suggested: 1 },
  { key: "other", label: "その他", unit: "1分あたり", suggested: 4 },
  { key: "reps", label: "回数で数える項目", unit: "10回あたり", suggested: 1 },
  { key: "weight", label: "ウェイト", unit: "重量×回数÷階級 あたり", suggested: 1 },
];

export type ExcludeReason = "basis_unknown" | "amount_missing" | "target_group" | "no_coef" | "free_unanswered" | "reps_max";
export const excludeReasonLabel: Record<ExcludeReason, string> = {
  basis_unknown: "本数の数え方が未確認",
  amount_missing: "量が未入力",
  target_group: "対象が通常／重量級の項目",
  no_coef: "係数が未設定",
  free_unanswered: "自由参加の参加量が未回答",
  reps_max: "回数が決まっていない（MAXなど）",
};

export type Participation = {
  scope: "full" | "until" | "from" | "partial";
  boundary_key: string | null;
  item_keys: string[];
  free_amounts: Record<string, number>;
};

function joinedKeys(items: MenuItemDraft[], p: Participation | null): Set<string> {
  const keys = items.map((i) => i.key);
  if (!p || p.scope === "full") return new Set(keys);
  if (p.scope === "partial") return new Set(p.item_keys);
  const idx = p.boundary_key ? keys.indexOf(p.boundary_key) : -1;
  if (idx < 0) return new Set(keys);
  return new Set(p.scope === "until" ? keys.slice(0, idx + 1) : keys.slice(idx));
}

// 1項目・1人ぶんの負荷。計算に入れられないときは理由を返す
export function itemLoad(
  it: MenuItemDraft,
  coef: Coefficients,
  freeAmount: number | undefined
): { load: number } | { excluded: ExcludeReason } {
  if (it.target_group !== "all") return { excluded: "target_group" };
  if (amountMissing(it)) return { excluded: it.amount_type === "reps" ? "reps_max" : "amount_missing" };
  if (needsCheck(it)) return { excluded: "basis_unknown" };
  let ratio = 1;
  if (it.format === "free") {
    if (typeof freeAmount !== "number") return { excluded: "free_unanswered" };
    ratio = freeAmount / 100;
  }
  const rot =
    it.format === "rotation" && it.group_size && it.active_per_group && it.active_per_group < it.group_size
      ? it.active_per_group / it.group_size
      : 1;
  const cat: MenuCategory = it.category;
  if (it.amount_type === "distance") {
    const c = coef[`${cat}_km`];
    if (typeof c !== "number") return { excluded: "no_coef" };
    return { load: ((it.distance_m ?? 0) * (it.sets ?? 1)) / 1000 * c * ratio };
  }
  if (it.amount_type === "reps") {
    if (!it.reps) return { excluded: "reps_max" };
    const c = coef.reps;
    if (typeof c !== "number") return { excluded: "no_coef" };
    return { load: ((it.reps * (it.sets ?? 1)) / 10) * c * ratio };
  }
  const c = coef[cat];
  if (typeof c !== "number") return { excluded: "no_coef" };
  let sec = 0;
  if (it.amount_type === "timed") {
    sec = (it.unit_seconds ?? 0) * (it.sets ?? 1);
    // 「1人あたり」の本数は、その人が実際にやった量なので交代の割合は掛けない
    if (it.sets_basis !== "per_person") sec *= rot;
  } else {
    sec = (it.total_seconds ?? 0) * rot;
  }
  return { load: (sec / 60) * c * ratio };
}

// 1つの練習・1人ぶん
export function menuLoadFor(
  items: MenuItemDraft[],
  p: Participation | null,
  coef: Coefficients
): { load: number; excluded: Partial<Record<ExcludeReason, number>> } {
  const joined = joinedKeys(items, p);
  let load = 0;
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  for (const it of items) {
    if (!joined.has(it.key)) continue;
    const r = itemLoad(it, coef, p?.free_amounts?.[it.key]);
    if ("load" in r) load += r.load;
    else excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1;
  }
  return { load, excluded };
}

// ウェイト1日ぶん
export function weightLoad(
  sets: { weight_kg: number | null; reps: number | null; is_warmup?: boolean | null }[],
  weightClass: number | null,
  coef: Coefficients
): number | null {
  const main = sets.filter((s) => !s.is_warmup && s.weight_kg && s.reps);
  if (main.length === 0) return 0;
  if (!weightClass || typeof coef.weight !== "number") return null;
  const vol = main.reduce((a, s) => a + (s.weight_kg ?? 0) * (s.reps ?? 0), 0);
  return (vol / weightClass) * coef.weight;
}

// 日ごとの負荷（dates は古い順・すべての日）から、蓄積と「いつもとの比較」を出す
export function accumulate(dates: string[], daily: Map<string, number>, retention: number) {
  const acc = new Map<string, number>();
  let prev = 0;
  for (const d of dates) {
    prev = prev * retention + (daily.get(d) ?? 0);
    acc.set(d, prev);
  }
  return acc;
}

export function addDays(date: string, n: number) {
  const t = new Date(`${date}T00:00:00Z`).getTime() + n * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- 1人分の日ごとの負荷（監督の一覧と、本人の「今の体の状態」で同じ計算を使う） ----------
export type LoadMenu = { id: string; date: string; start_time: string | null; location: string; is_joint: boolean };
export type LoadInputs = {
  menus: LoadMenu[];
  // 練習ごとの項目（予定・実績）
  items: Map<string, { plan: MenuItemDraft[]; actual: MenuItemDraft[] }>;
  // 実施報告がある練習
  reported: Set<string>;
  // この人の出欠確認の違い（menu_id → kind）
  diffKind: Map<string, string>;
  // この人の参加範囲の回答（menu_id → 回答）
  participation: Map<string, Participation>;
  // この人が休む練習か（休みの申請・休むセクションから）
  isAbsent: (menu: LoadMenu) => boolean;
  // この人のウェイトのセット（日付つき）
  sets: { date: string; weight_kg: number | null; reps: number | null; is_warmup?: boolean | null }[];
  weightClass: number | null;
  homeLocation: string | null;
};

export function memberDailyLoads(input: LoadInputs, coef: Coefficients, countFrom?: string) {
  const daily = new Map<string, number>();
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  let unanswered = 0;
  let classMissing = false;
  for (const menu of input.menus) {
    if (!input.reported.has(menu.id)) continue;
    if (!menu.is_joint && menu.location !== input.homeLocation) continue;
    const d = input.diffKind.get(menu.id);
    const p = input.participation.get(menu.id) ?? null;
    if (d === "absent_unplanned" && !p) continue;
    if (input.isAbsent(menu) && d !== "present_unplanned" && !p) continue;
    const it = input.items.get(menu.id);
    const list = it?.actual.length ? it.actual : it?.plan ?? [];
    if (list.length === 0) continue;
    const r = menuLoadFor(list, p, coef);
    daily.set(menu.date, (daily.get(menu.date) ?? 0) + r.load);
    if (!countFrom || menu.date >= countFrom) {
      if (!p) unanswered++;
      for (const [k, v] of Object.entries(r.excluded))
        excluded[k as ExcludeReason] = (excluded[k as ExcludeReason] ?? 0) + (v ?? 0);
    }
  }
  const setsByDate = new Map<string, LoadInputs["sets"]>();
  for (const s of input.sets) {
    const l = setsByDate.get(s.date) ?? [];
    l.push(s);
    setsByDate.set(s.date, l);
  }
  for (const [date, list] of setsByDate) {
    const w = weightLoad(list, input.weightClass, coef);
    if (w === null) {
      if (!countFrom || date >= countFrom) classMissing = true;
      continue;
    }
    daily.set(date, (daily.get(date) ?? 0) + w);
  }
  return { daily, excluded, unanswered, classMissing };
}

// 蓄積と「いつもとの比較」（本人の直近28日平均比。記録が2週間分たまるまでは null）
export function fatigueState(daily: Map<string, number>, base: string, retention: number) {
  const dates = dateRange(addDays(base, -55), base);
  const acc = accumulate(dates, daily, retention);
  const today = acc.get(base) ?? 0;
  const prev28 = dates.slice(-29, -1).map((d) => acc.get(d) ?? 0);
  const avg = prev28.reduce((a, b) => a + b, 0) / (prev28.length || 1);
  const first = dates.find((d) => (daily.get(d) ?? 0) > 0);
  const enough = !!first && first <= addDays(base, -14);
  return {
    acc,
    today,
    avg,
    ratio: enough && avg > 0 ? today / avg : null,
    short: !enough,
    week7: dates.slice(-7).reduce((a, d) => a + (daily.get(d) ?? 0), 0),
  };
}
