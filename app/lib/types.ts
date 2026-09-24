export type Role = "leader" | "vice_leader" | "captain" | "coach" | "manager" | "member" | "ob";

export type Location = "tama" | "otsuka";

export type CommentKind = "opinion" | "report" | "absent";

export const commentKindLabel: Record<CommentKind, string> = {
  opinion: "意見",
  report: "実施報告",
  absent: "未実施報告",
};

export const locationLabel: Record<Location, string> = {
  tama: "多摩",
  otsuka: "大塚",
};

export const locations: Location[] = ["tama", "otsuka"];

export type TrainingType = "running" | "weight" | "other";

export const trainingTypeLabel: Record<TrainingType, string> = {
  running: "ラン",
  weight: "ウェイト",
  other: "その他",
};

// コーチが定期的に作成する「イベント」（ウェイトMAX集計以外）の種類
export type TeamEventType = "match_reflection" | "body_composition";

export const teamEventTypeLabel: Record<TeamEventType, string> = {
  match_reflection: "試合の振り返り",
  body_composition: "体組成の提出",
};

// カレンダー表示用の色（ウェイト=青、ラン=赤、その他=グレー）
export const trainingTypeDotColor: Record<TrainingType, string> = {
  running: "bg-red-500",
  weight: "bg-blue-500",
  other: "bg-neutral-400",
};

// 月間の時間割（コーチが設定するセッション）の種別
export type SessionType = "mat" | "running" | "weight";

export const sessionTypeLabel: Record<SessionType, string> = {
  mat: "マット",
  running: "ラン",
  weight: "ウェイト",
};

export const sessionTypeDotColor: Record<SessionType, string> = {
  mat: "bg-neutral-700",
  running: "bg-red-500",
  weight: "bg-blue-500",
};

// 月間の時間割における日の区分（練習・合宿・試合）
export type DayType = "practice" | "camp" | "match" | "away";

export const dayTypeLabel: Record<DayType, string> = {
  practice: "練習",
  camp: "合宿",
  match: "試合",
  away: "出稽古",
};

export const dayTypeFillColor: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-100 text-pink-700",
  match: "bg-red-100 text-red-700",
  away: "bg-purple-100 text-purple-700",
};

// 入学年から現在の学年を計算する（4月1日で繰り上がる）
export function currentGrade(entryYear: number): number {
  const now = new Date();
  // 新入生が入ってくる3月中旬（15日）を年度の区切りとする
  const newAcademicYearStarted =
    now.getMonth() > 2 || (now.getMonth() === 2 && now.getDate() >= 15);
  const academicYear = newAcademicYearStarted
    ? now.getFullYear()
    : now.getFullYear() - 1;
  return academicYear - entryYear + 1;
}

export const roleLabel: Record<Role, string> = {
  leader: "リーダー",
  vice_leader: "副主将",
  captain: "主将",
  coach: "管理者",
  manager: "マネージャー",
  member: "部員",
  ob: "OB",
};

// 管理者と同じ画面レイアウト（管理ページ・練習予定表・イベント・設定）を使うロール。
// マネージャーは管理者と同じ画面を見られるが、セクション登録・イベント作成などの編集はできない
// （編集できるのは管理者＝coach のみ。isAdminEditor で判定する）。
export const isStaffRole = (role: Role) => role === "coach" || role === "manager";
export const isAdminEditor = (role: Role) => role === "coach";

// メニューを作成できる権限を持つロール
// キャプテンはリーダーと同じ権限に加え、将来的に追加の権限を持つ想定
export const canCreateMenu = (role: Role) =>
  role === "leader" ||
  role === "vice_leader" ||
  role === "captain" ||
  role === "coach";

// トレーニングタイトルごとに割り当てる色のパレット（最大10個まで保存できるタイトルと対応）。
// 「何番目に登録されたタイトルか」（スロット番号 0〜9）によって色を決める。
// 11個目のタイトルを登録すると1個目のタイトルの登録が外れ、
// 11個目は1個目と同じスロット（＝同じ色）を引き継ぐ（10個周期でスロットを使い回す）。
export const titleColorPalette: {
  border: string;
  text: string;
  dot: string;
  fill: string;
}[] = [
  { border: "border-blue-500", text: "text-blue-400", dot: "bg-blue-500", fill: "bg-blue-950/40" },
  { border: "border-emerald-500", text: "text-emerald-400", dot: "bg-emerald-500", fill: "bg-emerald-950/40" },
  { border: "border-amber-500", text: "text-amber-400", dot: "bg-amber-500", fill: "bg-amber-950/40" },
  { border: "border-purple-500", text: "text-purple-400", dot: "bg-purple-500", fill: "bg-purple-950/40" },
  { border: "border-pink-500", text: "text-pink-400", dot: "bg-pink-500", fill: "bg-pink-950/40" },
  { border: "border-cyan-500", text: "text-cyan-400", dot: "bg-cyan-500", fill: "bg-cyan-950/40" },
  { border: "border-orange-500", text: "text-orange-400", dot: "bg-orange-500", fill: "bg-orange-950/40" },
  { border: "border-lime-500", text: "text-lime-400", dot: "bg-lime-500", fill: "bg-lime-950/40" },
  { border: "border-indigo-500", text: "text-indigo-400", dot: "bg-indigo-500", fill: "bg-indigo-950/40" },
  { border: "border-rose-500", text: "text-rose-400", dot: "bg-rose-500", fill: "bg-rose-950/40" },
];

// 保存できるタイトルの最大数（種目＝ラン/ウェイト/その他ごとに10個まで）
export const MAX_SAVED_TITLES = 10;

export type TitleColor = (typeof titleColorPalette)[number];

// スロット番号（登録された順番を10で割った余り）から色を取得する
export function getTitleColorBySlot(slot: number): TitleColor {
  return titleColorPalette[((slot % titleColorPalette.length) + titleColorPalette.length) % titleColorPalette.length];
}

// 互換用：文字列のハッシュ値から色を決める簡易版（登録順を持たない古い画面向け）
export function getTitleColor(title: string): TitleColor {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) % 997;
  }
  return titleColorPalette[hash % titleColorPalette.length];
}
