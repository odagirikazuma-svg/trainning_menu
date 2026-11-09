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
