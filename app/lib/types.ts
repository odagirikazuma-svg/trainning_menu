export type Role = "leader" | "vice_leader" | "captain" | "coach" | "member";

export type Location = "tama" | "otsuka";

export const locationLabel: Record<Location, string> = {
  tama: "多摩",
  otsuka: "大塚",
};

export const locations: Location[] = ["tama", "otsuka"];

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
  vice_leader: "副リーダー",
  captain: "キャプテン",
  coach: "コーチ",
  member: "部員",
};

// メニューを作成できる権限を持つロール
// キャプテンはリーダーと同じ権限に加え、将来的に追加の権限を持つ想定
export const canCreateMenu = (role: Role) =>
  role === "leader" || role === "vice_leader" || role === "captain";
