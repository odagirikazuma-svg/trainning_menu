// 部員の目標（年間目標・月間目標）。
// 設定タブで編集し、ヘッダーに5秒ごとに切り替えて表示する。
// DB（member_goals.term）上は long = 年間目標、short = 月間目標。

export type GoalTerm = "long" | "short";

export const goalTerms: { term: GoalTerm; label: string; hint: string }[] = [
  { term: "long", label: "年間目標", hint: "例：全日本学生選手権でメダルをとる" },
  { term: "short", label: "月間目標", hint: "例：今月中にBP100kgを挙げる" },
];

export const GOAL_MAX_LENGTH = 40;

// 目標を保存したときにヘッダーへ知らせるためのイベント名
export const GOALS_CHANGED_EVENT = "goals-changed";

export function notifyGoalsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GOALS_CHANGED_EVENT));
  }
}

// 月間目標は毎月立て直すもの。今月に入ってから保存していなければ「未設定」とみなす
export function isMonthlyGoalCurrent(updatedAt: string | null | undefined) {
  if (!updatedAt) return false;
  const u = new Date(updatedAt);
  const now = new Date();
  return u.getFullYear() === now.getFullYear() && u.getMonth() === now.getMonth();
}

export type GoalRow = { term: GoalTerm; content: string; updated_at: string };

// 未設定の目標（年間：空、月間：空 または 今月まだ保存していない）
export function missingGoalTerms(rows: GoalRow[]): GoalTerm[] {
  const long = rows.find((r) => r.term === "long");
  const short = rows.find((r) => r.term === "short");
  const missing: GoalTerm[] = [];
  if (!long?.content.trim()) missing.push("long");
  if (!short?.content.trim() || !isMonthlyGoalCurrent(short.updated_at)) missing.push("short");
  return missing;
}
