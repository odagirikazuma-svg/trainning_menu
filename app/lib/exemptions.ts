// 部員ごとの「タスク免除期間」（国際試合・慶弔などで長期間練習を休む場合に、
// 管理者が登録する）に関する共通の読み込み・判定ロジック。
//
// 免除の対象は「練習の実施報告」と「自主トレ（ラン・ウェイトなど）の記録」のみ。
// 怪我の経過報告やイベント（体重測定・試合の振り返りなど）のタスクは免除しない。
// 免除期間中の日は、その部員のタスク・提出人数の分母・未提出者一覧から外れる。

import type { createClient } from "./supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

export type ExemptionRow = {
  member_id: string;
  start_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
};

/**
 * 指定した期間（rangeStart〜rangeEnd）と重なる免除期間を読み込む。
 * memberId を渡すと、その部員の分だけに絞る。
 * テーブルがまだ無い環境などで読み込みに失敗した場合は、エラーにせず
 * 「免除なし」として扱う（免除機能が使えないだけで、既存の表示は壊さない）。
 */
export async function loadExemptions(
  supabase: SupabaseBrowserClient,
  teamId: string,
  rangeStart: string,
  rangeEnd: string,
  memberId?: string
): Promise<ExemptionRow[]> {
  let query = supabase
    .from("member_exemptions")
    .select("member_id, start_date, end_date")
    .eq("team_id", teamId)
    .lte("start_date", rangeEnd)
    .gte("end_date", rangeStart);
  if (memberId) query = query.eq("member_id", memberId);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as ExemptionRow[];
}

/** その部員が、その日（"YYYY-MM-DD"）に免除期間中かどうか */
export function isExemptOn(
  exemptions: ExemptionRow[],
  memberId: string,
  dateKey: string
): boolean {
  return exemptions.some(
    (e) =>
      e.member_id === memberId &&
      e.start_date <= dateKey &&
      dateKey <= e.end_date
  );
}

/** "2026-10-15" -> "10/15" */
export function formatExemptionDate(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}
