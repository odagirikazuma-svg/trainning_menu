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
  // 監督の許可を取ったか（授業・学業以外）
  permission_ok?: boolean | null;
  approval_method?: ApprovalMethod | null;
  // 体調不良のとき：行った病院と結果（あとから本人が書く）
  hospital_name?: string | null;
  hospital_result?: string | null;
  hospital_reported_at?: string | null;
  // 休むセクション（null は終日）
  session_keys?: string[] | null;
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
  none: "休養（代替なし）",
};

// 一覧に出す状態のことば（届け出／監督の許可済み／取り消し）
export function absenceStateText(r: Pick<AbsenceRequest, "status" | "reason_type">) {
  if (r.status === "rejected") return "取り消し";
  if (r.status === "pending") return "承認待ち";
  if (noPermissionNeeded(r.reason_type)) return "届け出";
  return "監督の許可済み";
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
  if (r.plan_type === "none") return base;
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

// ---------- 休むセクション ----------
// セクションの目印「種類@開始時刻」（例 mat@17:00）。時刻がないセクションは「mat@」
export function sessionKey(type: string, time: string | null | undefined) {
  return `${type}@${time ? time.slice(0, 5) : ""}`;
}
const SESSION_TYPE_LABEL: Record<string, string> = { mat: "マット", weight: "ウェイト", running: "ラン", other: "その他" };
export function sessionKeyLabel(key: string) {
  const [type, time] = key.split("@");
  return `${SESSION_TYPE_LABEL[type] ?? type}${time ? ` ${time}` : ""}`;
}
// 休むセクションの表示（null・空は「終日」）
export function absenceSessionsText(keys: string[] | null | undefined) {
  if (!keys || keys.length === 0) return "終日";
  return keys.map(sessionKeyLabel).join("・");
}
// この休みが、開始時刻 startTime のマット練習を含むか
export function absenceCoversMat(keys: string[] | null | undefined, startTime: string | null | undefined) {
  if (!keys || keys.length === 0) return true;
  const mats = keys.filter((k) => k.startsWith("mat@"));
  if (mats.length === 0) return false;
  if (!startTime) return true;
  return mats.includes(sessionKey("mat", startTime)) || mats.includes("mat@");
}

// ---------- 代替メニューのテンプレート ----------
export type AbsencePlanTemplate = {
  id: string;
  name: string;
  plan_type: Exclude<AbsencePlanType, "none">;
  plan: string;
  plan_sets: PlanBlock[] | null;
};
