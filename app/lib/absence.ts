import type { TrainingType } from "./types";
import type { ExerciseBlock, SetDraft } from "../components/SetLogger";

// 代替メニュー（ウェイト）の予定。日報のセット記録と同じ形（keyなどの画面用の情報は除く）
export type PlanBlock = {
  exercise: ExerciseBlock["exercise"];
  sets: SetDraft[];
};

export function blocksToPlan(blocks: ExerciseBlock[]): PlanBlock[] {
  return blocks.map((b) => ({ exercise: b.exercise, sets: b.sets }));
}

let planKey = 0;
export function planToBlocks(plan: PlanBlock[] | null | undefined): ExerciseBlock[] {
  return (plan ?? []).map((b) => {
    planKey += 1;
    return { key: `plan-${Date.now()}-${planKey}`, exercise: b.exercise, sets: b.sets.map((x) => ({ ...x })) };
  });
}

export type AbsenceReasonType = "sick" | "injury" | "school" | "away" | "job" | "other";
export type AbsencePlanType = "weight" | "running" | "other" | "none";
export type AbsenceStatus = "pending" | "approved" | "rejected";

export type AbsenceRequest = {
  id: string;
  team_id: string;
  author_id: string;
  date: string;
  reason_type: AbsenceReasonType;
  reason: string;
  plan_type: AbsencePlanType;
  plan: string;
  plan_sets?: PlanBlock[] | null;
  status: AbsenceStatus;
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const absenceReasonLabel: Record<AbsenceReasonType, string> = {
  sick: "体調不良",
  injury: "怪我",
  school: "授業・学業",
  away: "出稽古",
  job: "就活",
  other: "その他",
};

export const absencePlanLabel: Record<AbsencePlanType, string> = {
  weight: "ウェイト",
  running: "ラン",
  other: "その他",
  none: "なし（安静）",
};

export const absenceStatusLabel: Record<AbsenceStatus, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "差し戻し",
};

export const absenceStatusCls: Record<AbsenceStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
};

// 日報の「休み（未実施報告）」の代替メニュー種別に変換する
export function planToTrainingType(p: AbsencePlanType): TrainingType | null {
  return p === "none" ? "other" : p;
}

export function absenceReasonText(r: Pick<AbsenceRequest, "reason_type" | "reason">) {
  const base = absenceReasonLabel[r.reason_type];
  return r.reason.trim() ? `${base}（${r.reason.trim()}）` : base;
}

export function absencePlanText(r: Pick<AbsenceRequest, "plan_type" | "plan">) {
  const base = absencePlanLabel[r.plan_type];
  return r.plan.trim() ? `${base}：${r.plan.trim()}` : base;
}
