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
export type ApprovalMethod = "line" | "phone";

export const approvalMethodLabel: Record<ApprovalMethod, string> = {
  line: "LINE",
  phone: "電話",
};

// 届け出だけでよい理由（監督の許可は不要）
export const noPermissionNeeded = (t: AbsenceReasonType) => t === "school";

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
  // 直接許可をくれた監督・管理者と、その方法（授業・学業は不要）
  permitted_by?: string | null;
  approval_method?: ApprovalMethod | null;
  // 体調不良のとき：行った病院と結果（あとから本人が書く）
  hospital_name?: string | null;
  hospital_result?: string | null;
  hospital_reported_at?: string | null;
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
  approved: "報告済み",
  rejected: "取り消し",
};

// 一覧に出す状態のことば（届け出／直接許可済み／取り消し）
export function absenceStateText(
  r: Pick<AbsenceRequest, "status" | "reason_type" | "approval_method">,
  permitterName?: string | null
) {
  if (r.status === "rejected") return "取り消し";
  if (r.status === "pending") return "承認待ち";
  if (noPermissionNeeded(r.reason_type)) return "届け出";
  const how = r.approval_method ? approvalMethodLabel[r.approval_method] : "";
  return `直接許可済み${permitterName || how ? `（${[permitterName, how].filter(Boolean).join("・")}）` : ""}`;
}

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

// ---------- 体調不良の病院の報告：続けて休んだ日はまとめて1回 ----------
// 体調不良の休みが続いた（間が1日以内：オフの日をはさんでもよい）ときは、
// 最初の日の病院の報告でまとめて済ませる。戻り値：休みのid → その続きの最初の日の休み
export const SICK_STREAK_GAP_DAYS = 1;

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

export function sickStreakHeads<T extends Pick<AbsenceRequest, "id" | "author_id" | "date" | "reason_type" | "status">>(
  list: T[]
): Map<string, T> {
  const out = new Map<string, T>();
  const byAuthor = new Map<string, T[]>();
  for (const r of list) {
    if (r.reason_type !== "sick" || r.status === "rejected") continue;
    const l = byAuthor.get(r.author_id) ?? [];
    l.push(r);
    byAuthor.set(r.author_id, l);
  }
  for (const l of byAuthor.values()) {
    l.sort((a, b) => a.date.localeCompare(b.date));
    let head: T | null = null;
    let prev: T | null = null;
    for (const r of l) {
      if (!prev || dayDiff(prev.date, r.date) > SICK_STREAK_GAP_DAYS + 1) head = r;
      out.set(r.id, head!);
      prev = r;
    }
  }
  return out;
}

export function hasHospitalReport(r: Pick<AbsenceRequest, "hospital_name" | "hospital_result">) {
  return !!(r.hospital_name || r.hospital_result);
}
