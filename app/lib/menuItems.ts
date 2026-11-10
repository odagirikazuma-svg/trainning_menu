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
  | "cooldown"
  | "other";
export type MenuFormat = "all" | "rotation" | "free";
export type AmountType = "timed" | "total" | "reps";
export type SetsBasis = "total" | "per_person";

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
};

// 種別ごとのふつうの実施形式（新しい項目の初期値）
export const defaultFormat: Record<MenuCategory, MenuFormat> = {
  warmup: "all",
  conditioning: "all",
  technique: "all",
  drill: "all",
  situational: "rotation",
  spar: "free",
  cooldown: "all",
  other: "all",
};

let seq = 0;
export function newKey() {
  seq += 1;
  return `mi-${Date.now()}-${seq}`;
}

export function emptyItem(category: MenuCategory = "other"): MenuItemDraft {
  return {
    key: newKey(),
    name: "",
    category,
    format: defaultFormat[category],
    amount_type: "timed",
    unit_seconds: null,
    sets: null,
    sets_basis: "total",
    total_seconds: null,
    reps: null,
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
  } else if (d.amount_type === "total") {
    r.unit_seconds = null;
    r.sets = null;
    r.reps = null;
  } else {
    r.unit_seconds = null;
    r.total_seconds = null;
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
  if (d.amount_type === "timed") {
    if (d.unit_seconds && d.sets) {
      const basis = d.sets_basis === "per_person" ? "（1人あたり）" : "";
      main = `${formatDuration(d.unit_seconds)}×${d.sets}本${basis}`;
      if (d.sets_basis === "total") main += `（全体${formatDuration(d.unit_seconds * d.sets)}）`;
    } else if (d.unit_seconds) {
      main = formatDuration(d.unit_seconds);
    }
  } else if (d.amount_type === "total") {
    main = d.total_seconds ? formatDuration(d.total_seconds) : "";
  } else {
    main = `${d.reps ?? "MAX"}回${d.sets ? `×${d.sets}セット` : ""}`;
  }
  const group =
    d.format === "rotation" && d.group_size
      ? `${d.group_size}人組${d.active_per_group ? `・${d.active_per_group}人ずつ実施` : ""}`
      : "";
  return [group, main].filter(Boolean).join(" ");
}

// 「計算用の量」がまだ入っていない項目
export function amountMissing(d: MenuItemDraft) {
  if (d.amount_type === "timed") return !d.unit_seconds || !d.sets;
  if (d.amount_type === "total") return !d.total_seconds;
  return !d.sets && !d.reps;
}
