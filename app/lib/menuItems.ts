// マット練習メニューの構造化（計算用）の型と表示用のことば
// 既存の menus.content（自由記述）は残し、計算用にこちらを追加で持つ

export type MenuPhase = "plan" | "actual";
export type MenuCategory =
  | "warmup"
  | "conditioning"
  | "technique"
  | "drill"
  | "situational"
  | "spar"
  | "run"
  | "sprint"
  | "cooldown"
  | "other";
export type MenuFormat = "all" | "rotation" | "free";
export type AmountType = "timed" | "total" | "reps" | "distance";
export type SetsBasis = "total" | "per_person" | "unknown";
export type TargetGroup = "all" | "regular" | "heavy";

export const targetGroupLabel: Record<TargetGroup, string> = {
  all: "全員",
  regular: "通常",
  heavy: "重量級",
};

// 画面で編集する1項目（DBの列と同じ名前。id は保存済みのときだけ）
export type MenuItemDraft = {
  key: string;
  name: string;
  category: MenuCategory;
  format: MenuFormat;
  amount_type: AmountType;
  unit_seconds: number | null;
  sets: number | null;
  sets_basis: SetsBasis;
  total_seconds: number | null;
  reps: number | null;
  distance_m: number | null;
  target_group: TargetGroup;
  group_size: number | null;
  active_per_group: number | null;
  rest_seconds: number | null;
  note: string;
};

export const categoryLabel: Record<MenuCategory, string> = {
  warmup: "アップ",
  conditioning: "補強",
  technique: "技術",
  drill: "打ち込み",
  situational: "攻防（状況設定）",
  spar: "スパー",
  run: "ラン",
  sprint: "ダッシュ",
  cooldown: "ダウン",
  other: "その他",
};

export const formatLabel: Record<MenuFormat, string> = {
  all: "全員実施",
  rotation: "均等交代",
  free: "自由参加",
};

export const amountTypeLabel: Record<AmountType, string> = {
  timed: "1本の時間×本数",
  total: "全体の時間",
  reps: "回数×セット",
  distance: "距離×本数",
};

// 種別ごとのふつうの実施形式（新しい項目の初期値）
export const defaultFormat: Record<MenuCategory, MenuFormat> = {
  warmup: "all",
  conditioning: "all",
  technique: "all",
  drill: "all",
  situational: "rotation",
  spar: "free",
  run: "all",
  sprint: "all",
  cooldown: "all",
  other: "all",
};

let seq = 0;
export function newKey() {
  seq += 1;
  return `mi-${Date.now()}-${seq}`;
}

// 種別ごとのふつうの量の表し方
export const defaultAmountType: Record<MenuCategory, AmountType> = {
  warmup: "total",
  conditioning: "reps",
  technique: "total",
  drill: "timed",
  situational: "timed",
  spar: "timed",
  run: "distance",
  sprint: "distance",
  cooldown: "total",
  other: "timed",
};

export function emptyItem(category: MenuCategory = "other"): MenuItemDraft {
  return {
    key: newKey(),
    name: "",
    category,
    format: defaultFormat[category],
    amount_type: defaultAmountType[category],
    unit_seconds: null,
    sets: null,
    // スパーは「チーム全体で時計を回す本数」。それ以外は、分からなければ「未確認」
    sets_basis: category === "spar" ? "total" : "unknown",
    total_seconds: null,
    reps: null,
    distance_m: null,
    target_group: "all",
    group_size: null,
    active_per_group: null,
    rest_seconds: null,
    note: "",
  };
}

const ITEM_COLUMNS = [
  "name",
  "category",
  "format",
  "amount_type",
  "unit_seconds",
  "sets",
  "sets_basis",
  "total_seconds",
  "reps",
  "distance_m",
  "target_group",
  "group_size",
  "active_per_group",
  "rest_seconds",
  "note",
] as const;

// DBの行（またはテンプレートのJSON）→ 画面の項目
export function toDraft(row: Record<string, unknown>): MenuItemDraft {
  const base = emptyItem((row.category as MenuCategory) ?? "other");
  const out: MenuItemDraft = { ...base };
  for (const c of ITEM_COLUMNS) {
    if (row[c] !== undefined && row[c] !== null) (out as Record<string, unknown>)[c] = row[c];
  }
  out.note = (row.note as string | null) ?? "";
  return out;
}

// 画面の項目 → 保存する値（テンプレートのJSONにも使う）
export function toRow(d: MenuItemDraft) {
  const r: Record<string, unknown> = {};
  for (const c of ITEM_COLUMNS) r[c] = (d as Record<string, unknown>)[c];
  r.name = d.name.trim();
  r.note = d.note.trim() || null;
  // 量の表し方に関係ない値は消しておく（あとで計算するときに紛れないように）
  if (d.amount_type === "timed") {
    r.total_seconds = null;
    r.reps = null;
    r.distance_m = null;
  } else if (d.amount_type === "total") {
    r.unit_seconds = null;
    r.sets = null;
    r.reps = null;
    r.distance_m = null;
  } else if (d.amount_type === "reps") {
    r.unit_seconds = null;
    r.total_seconds = null;
    r.distance_m = null;
  } else {
    r.unit_seconds = null;
    r.total_seconds = null;
    r.reps = null;
  }
  if (d.format !== "rotation") {
    r.group_size = null;
    r.active_per_group = null;
  }
  return r;
}

export function formatDuration(sec: number) {
  if (sec % 60 === 0) return `${sec / 60}分`;
  if (sec < 60) return `${sec}秒`;
  return `${Math.floor(sec / 60)}分${sec % 60}秒`;
}

// 例：「3分×10セット（全体30分）」「4人組6分（2人ずつ交代）」「シコ50回×1」
export function describeAmount(d: MenuItemDraft) {
  let main = "";
  if (d.amount_type === "distance") {
    const dist = d.distance_m ? (d.distance_m >= 1000 && d.distance_m % 100 === 0 ? `${d.distance_m / 1000}km` : `${d.distance_m}m`) : "";
    main = `${dist}${d.sets && d.sets > 1 ? `×${d.sets}本` : ""}`;
  } else if (d.amount_type === "timed") {
    if (d.unit_seconds && d.sets) {
      const basis = d.sets_basis === "per_person" ? "（1人あたり）" : d.sets_basis === "unknown" ? "（全体か個人か未確認）" : "";
      main = `${formatDuration(d.unit_seconds)}×${d.sets}本${basis}`;
      if (d.sets_basis === "total") main += `（全体${formatDuration(d.unit_seconds * d.sets)}）`;
    } else if (d.unit_seconds) {
      main = formatDuration(d.unit_seconds);
    }
  } else if (d.amount_type === "total") {
    main = d.total_seconds ? formatDuration(d.total_seconds) : "";
  } else {
    main = `${d.reps ? `${d.reps}回` : "MAX"}${d.sets ? `×${d.sets}セット` : ""}`;
  }
  const group =
    d.format === "rotation" && d.group_size
      ? `${d.group_size}人組${d.active_per_group ? `・${d.active_per_group}人ずつ実施` : ""}`
      : "";
  const target = d.target_group !== "all" ? `［${targetGroupLabel[d.target_group]}］` : "";
  return [target, group, main].filter(Boolean).join(" ");
}

// 計算の前に確認が必要な点（本数の数え方が未確認など）
export function needsCheck(d: MenuItemDraft) {
  return d.amount_type === "timed" && !!d.sets && d.sets > 1 && d.sets_basis === "unknown";
}

// 「計算用の量」がまだ入っていない項目
export function amountMissing(d: MenuItemDraft) {
  if (d.amount_type === "timed") return !d.unit_seconds || !d.sets;
  if (d.amount_type === "total") return !d.total_seconds;
  if (d.amount_type === "distance") return !d.distance_m;
  return !d.sets && !d.reps;
}
