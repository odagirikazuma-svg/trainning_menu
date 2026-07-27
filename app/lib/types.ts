export type Role = "leader" | "vice_leader" | "captain" | "coach" | "member";

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

// 入学年から現在の学年を計算する（4月1日で繰り上がる）
export function currentGrade(entryYear: number): number {
  const now = new Date();
  const academicYear =
    now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return academicYear - entryYear + 1;
}

export type Comment = {
  id: string;
  authorName: string;
  role: Role;
  text: string;
  createdAt: string; // ISO string
};

export type TrainingMenu = {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  content: string; // メニュー詳細（自由記述）
  createdBy: string;
  createdAt: string;
  comments: Comment[];
};

export const roleLabel: Record<Role, string> = {
  leader: "リーダー",
  vice_leader: "副主将",
  captain: "主将",
  coach: "コーチ",
  member: "部員",
};

// メニューを作成できる権限を持つロール
// キャプテンはリーダーと同じ権限に加え、将来的に追加の権限を持つ想定
export const canCreateMenu = (role: Role) =>
  role === "leader" ||
  role === "vice_leader" ||
  role === "captain" ||
  role === "coach";
