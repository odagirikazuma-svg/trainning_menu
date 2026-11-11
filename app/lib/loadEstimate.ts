// 疲労度の試算（監督と本人だけが見る）。計算式 v2
// 実測ではなく、実績のメニューの量 × 係数 で出すおおまかな目安。係数は監督が設定で変えられる。
//
// ■ 0 ＝ 疲労なし。練習するほど積み上がる
// ■ 日付が変わると ×残る割合（標準70%）。練習のない日（オフ）は、さらに −オフの回復（標準100）。0未満は0
// ■ マット練習：項目ごとに「1人あたりの実施量（分）」× 係数
//    - スパー 1分1、打ち込み 1分0.2、アップ・ダウンは0。そのほかの種類は係数が決まるまで計算に入れない
//    - 交代制は「同時に実施する人数 ÷ 組の人数」を掛ける。「本数の数え方」が未確認の項目は入れない
//    - 自由参加：本人が答えた参加量（0〜100%）を掛ける。未回答は入れない
//    - 対象が「通常／重量級」の項目は入れない
// ■ ラン：km × 階級ごとの係数（軽量級2・中量級3・重量級4）。メニューの距離と、トレ報の「○km」「○m」の種目から
// ■ ウェイト：メインセット1セットにつき1（スクワット・デッドリフトは1.2）。アップのセットは0
// ■ 1日の負荷はセクションごとに足し算

import { needsCheck, amountMissing, type MenuItemDraft } from "./menuItems";

export const CALC_VERSION = "v2";

export type Coefficients = Partial<Record<string, number>>;

// 係数の一覧（画面の設定欄の順番）。suggested が標準値（設定がなければこれで計算する）
export type CoefDef = { key: string; label: string; unit: string; suggested: number; group: string };
export const coefficientDefs: CoefDef[] = [
  { key: "spar", label: "スパー", unit: "1分あたり", suggested: 1, group: "マット" },
  { key: "drill", label: "打ち込み", unit: "1分あたり", suggested: 0.2, group: "マット" },
  { key: "warmup", label: "アップ", unit: "1分あたり", suggested: 0, group: "マット" },
  { key: "cooldown", label: "ダウン", unit: "1分あたり", suggested: 0, group: "マット" },
  { key: "run_km_light", label: "ラン 軽量級", unit: "1kmあたり", suggested: 2, group: "ラン" },
  { key: "run_km_middle", label: "ラン 中量級", unit: "1kmあたり", suggested: 3, group: "ラン" },
  { key: "run_km_heavy", label: "ラン 重量級", unit: "1kmあたり", suggested: 4, group: "ラン" },
  { key: "class_light_max", label: "軽量級の上限", unit: "kg級まで", suggested: 65, group: "ラン" },
  { key: "class_middle_max", label: "中量級の上限", unit: "kg級まで", suggested: 86, group: "ラン" },
  { key: "weight_set", label: "ウェイト", unit: "メイン1セットあたり", suggested: 1, group: "ウェイト" },
  { key: "weight_set_heavy", label: "スクワット・デッドリフト", unit: "メイン1セットあたり", suggested: 1.2, group: "ウェイト" },
  { key: "off_minus", label: "オフの日の回復", unit: "1日で引く量", suggested: 100, group: "蓄積" },
];

// 係数が決まっていない種類（設定で数字を入れれば計算に入る）
export const pendingCategories: { key: string; label: string }[] = [
  { key: "technique", label: "技術" },
  { key: "situational", label: "攻防（状況設定）" },
  { key: "conditioning", label: "補強" },
  { key: "sprint", label: "ダッシュ" },
  { key: "run", label: "ラン（時間で書いたもの）" },
  { key: "other", label: "その他" },
];

export type LoadSettingsRow = { coefficients: Coefficients | null; retention: number | null; calc_version?: string | null } | null;

// 保存された設定と標準値を合わせる。v1 のころの係数（単位が違う）は使わない
export function resolveSettings(row: LoadSettingsRow): { coef: Coefficients; retention: number } {
  const saved = row && row.calc_version === CALC_VERSION ? row.coefficients ?? {} : {};
  const coef: Coefficients = {};
  for (const d of coefficientDefs) coef[d.key] = d.suggested;
  for (const [k, v] of Object.entries(saved)) if (typeof v === "number" && Number.isFinite(v)) coef[k] = v;
  const r = Number(row?.retention);
  return { coef, retention: Number.isFinite(r) && r > 0 && r <= 1 ? r : 0.7 };
}

export type WeightClassBand = "light" | "middle" | "heavy";
export const bandLabel: Record<WeightClassBand, string> = { light: "軽量級", middle: "中量級", heavy: "重量級" };
export function classBand(weightClass: number | null, coef: Coefficients): WeightClassBand | null {
  if (!weightClass) return null;
  if (weightClass <= (coef.class_light_max ?? 65)) return "light";
  if (weightClass <= (coef.class_middle_max ?? 86)) return "middle";
  return "heavy";
}
// 階級が未登録の人は中量級で計算する
function runCoef(weightClass: number | null, coef: Coefficients) {
  const b = classBand(weightClass, coef) ?? "middle";
  return coef[`run_km_${b}`] ?? 0;
}

// 種目名から距離（km）を読む（「3km走」「400m」など）。読めなければ null
export function distanceKmFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const n = name.replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/ｋｍ/g, "km").replace(/ｍ/g, "m");
  const m = n.match(/([0-9]+(?:\.[0-9]+)?)\s*(km|キロ|m|メートル)/i);
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v) || v <= 0) return null;
  return /^(km|キロ)$/i.test(m[2]) ? v : v / 1000;
}

export type ExcludeReason = "basis_unknown" | "amount_missing" | "target_group" | "no_coef" | "free_unanswered" | "reps_max";
export const excludeReasonLabel: Record<ExcludeReason, string> = {
  basis_unknown: "本数の数え方が未確認",
  amount_missing: "量が未入力",
  target_group: "対象が通常／重量級の項目",
  no_coef: "係数がまだ決まっていない種類（技術・攻防など）",
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
  freeAmount: number | undefined,
  weightClass: number | null = null
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
  const cat: string = it.category;
  if (it.amount_type === "distance") {
    const km = ((it.distance_m ?? 0) * (it.sets ?? 1)) / 1000;
    // ラン：階級ごとの係数。ダッシュなどは「sprint_km」が設定されていれば
    const c = cat === "run" ? runCoef(weightClass, coef) : coef[`${cat}_km`];
    if (typeof c !== "number") return { excluded: "no_coef" };
    return { load: km * c * ratio };
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
  coef: Coefficients,
  weightClass: number | null = null
): { load: number; excluded: Partial<Record<ExcludeReason, number>> } {
  const joined = joinedKeys(items, p);
  let load = 0;
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  for (const it of items) {
    if (!joined.has(it.key)) continue;
    const r = itemLoad(it, coef, p?.free_amounts?.[it.key], weightClass);
    if ("load" in r) load += r.load;
    else excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1;
  }
  return { load, excluded };
}

export type LoadSet = {
  date: string;
  weight_kg: number | null;
  reps: number | null;
  seconds?: number | null;
  is_warmup?: boolean | null;
  exercise_name?: string | null;
};

const HEAVY_SET = /(スクワット|デッド)/;

// トレ報1日ぶん：ウェイトはメインセットの数、ランは「○km」「○m」の種目の距離から
export function setsLoad(sets: LoadSet[], weightClass: number | null, coef: Coefficients): number {
  let load = 0;
  for (const s of sets) {
    if (s.is_warmup) continue;
    const km = distanceKmFromName(s.exercise_name);
    if (km !== null) {
      // 記録がある（タイムや回数が入っている）セットだけ数える
      if (s.seconds || s.reps || s.weight_kg) load += km * runCoef(weightClass, coef);
      continue;
    }
    if (!s.weight_kg && !s.reps && !s.seconds) continue;
    load += HEAVY_SET.test(s.exercise_name ?? "") ? coef.weight_set_heavy ?? 0 : coef.weight_set ?? 0;
  }
  return load;
}

// 日ごとの負荷（dates は古い順・すべての日）から蓄積を出す。
// 練習のない日（active に入っていない日）は ×残る割合 のあと −オフの回復。0未満は0
export function accumulate(
  dates: string[],
  daily: Map<string, number>,
  retention: number,
  offMinus = 0,
  active?: Set<string>
) {
  const acc = new Map<string, number>();
  let prev = 0;
  for (const d of dates) {
    const load = daily.get(d) ?? 0;
    const worked = active ? active.has(d) : load > 0;
    prev = worked ? prev * retention + load : Math.max(0, prev * retention - offMinus);
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
  // この人のトレ報のセット（日付・種目名つき）
  sets: LoadSet[];
  weightClass: number | null;
  homeLocation: string | null;
};

export function memberDailyLoads(input: LoadInputs, coef: Coefficients, countFrom?: string) {
  const daily = new Map<string, number>();
  // 練習した日（オフの判定に使う）
  const active = new Set<string>();
  const excluded: Partial<Record<ExcludeReason, number>> = {};
  let unanswered = 0;
  let classMissing = false;
  const counted = (date: string) => !countFrom || date >= countFrom;
  for (const menu of input.menus) {
    if (!input.reported.has(menu.id)) continue;
    if (!menu.is_joint && menu.location !== input.homeLocation) continue;
    const d = input.diffKind.get(menu.id);
    const p = input.participation.get(menu.id) ?? null;
    if (d === "absent_unplanned" && !p) continue;
    if (input.isAbsent(menu) && d !== "present_unplanned" && !p) continue;
    const it = input.items.get(menu.id);
    const list = it?.actual.length ? it.actual : it?.plan ?? [];
    active.add(menu.date);
    if (list.length === 0) continue;
    const r = menuLoadFor(list, p, coef, input.weightClass);
    daily.set(menu.date, (daily.get(menu.date) ?? 0) + r.load);
    if (counted(menu.date)) {
      if (!p) unanswered++;
      for (const [k, v] of Object.entries(r.excluded))
        excluded[k as ExcludeReason] = (excluded[k as ExcludeReason] ?? 0) + (v ?? 0);
      if (!input.weightClass && list.some((x) => x.category === "run" && x.amount_type === "distance")) classMissing = true;
    }
  }
  const setsByDate = new Map<string, LoadSet[]>();
  for (const s of input.sets) {
    const l = setsByDate.get(s.date) ?? [];
    l.push(s);
    setsByDate.set(s.date, l);
  }
  for (const [date, list] of setsByDate) {
    active.add(date);
    daily.set(date, (daily.get(date) ?? 0) + setsLoad(list, input.weightClass, coef));
    if (counted(date) && !input.weightClass && list.some((s) => distanceKmFromName(s.exercise_name) !== null)) classMissing = true;
  }
  return { daily, active, excluded, unanswered, classMissing };
}

// 蓄積（0＝疲労なし）と「いつもとの比較」（本人の直近28日平均比。記録が2週間分たまるまでは null）
export function fatigueState(
  daily: Map<string, number>,
  base: string,
  retention: number,
  offMinus = 0,
  active?: Set<string>
) {
  const dates = dateRange(addDays(base, -55), base);
  const acc = accumulate(dates, daily, retention, offMinus, active);
  const today = acc.get(base) ?? 0;
  const yesterday = acc.get(addDays(base, -1)) ?? 0;
  const prev28 = dates.slice(-29, -1).map((d) => acc.get(d) ?? 0);
  const avg = prev28.reduce((a, b) => a + b, 0) / (prev28.length || 1);
  const first = dates.find((d) => (daily.get(d) ?? 0) > 0 || active?.has(d));
  const enough = !!first && first <= addDays(base, -14);
  return {
    acc,
    today,
    yesterday,
    avg,
    ratio: enough && avg > 0 ? today / avg : null,
    short: !enough,
    week7: dates.slice(-7).reduce((a, d) => a + (daily.get(d) ?? 0), 0),
  };
}
