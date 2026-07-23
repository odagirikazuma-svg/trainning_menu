export type Role = "captain" | "vice_captain" | "coach" | "member";

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
  captain: "キャプテン",
  vice_captain: "副キャプテン",
  coach: "コーチ",
  member: "部員",
};

// メニューを作成できる権限を持つロール
export const canCreateMenu = (role: Role) =>
  role === "captain" || role === "vice_captain";
