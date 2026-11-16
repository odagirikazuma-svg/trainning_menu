// 授業の時間割
// ・管理者が「前期・後期」（term）と「授業のない期間」（break：長期休みなど）を登録する
// ・部員は期間ごとに、授業のある曜日×時限を登録する
// ・練習と授業の重なり：練習の半分以上が授業なら「授業で休み」、それ未満なら「遅れて参加／早めに抜ける」

import type { SupabaseClient } from "@supabase/supabase-js";

export const PERIODS: { no: number; start: string; end: string }[] = [
  { no: 1, start: "09:00", end: "10:40" },
  { no: 2, start: "10:50", end: "12:30" },
  { no: 3, start: "13:20", end: "15:00" },
  { no: 4, start: "15:10", end: "16:50" },
  { no: 5, start: "17:00", end: "18:40" },
  { no: 6, start: "18:50", end: "20:30" },
];
export const WEEKDAYS: { no: number; label: string }[] = [
  { no: 1, label: "月" },
  { no: 2, label: "火" },
  { no: 3, label: "水" },
  { no: 4, label: "木" },
  { no: 5, label: "金" },
  { no: 6, label: "土" },
];

// 練習の長さ（分）。終わりの時刻がないので、種類ごとの標準の長さで重なりを見る
export const PRACTICE_MINUTES: Record<string, number> = { mat: 120, running: 60, weight: 90 };

// live：出席必須（練習に出られない）／vod：出席必須でない授業（オンデマンドなど。その時間も練習に参加）
export type ClassMode = "live" | "vod";
export type TeamTerm = { id: string; kind: "term" | "break"; name: string; start_date: string; end_date: string };
export type ClassImpact = { status: "absent" | "late" | "early" | "late_early"; periods: number[] };

const toMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
};

// 1=月 … 7=日
export function weekdayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

// その日に有効な前期・後期（授業のない期間に入っていれば null）
export function termOn(terms: TeamTerm[], date: string): TeamTerm | null {
  if (terms.some((t) => t.kind === "break" && t.start_date <= date && date <= t.end_date)) return null;
  return terms.find((t) => t.kind === "term" && t.start_date <= date && date <= t.end_date) ?? null;
}

// 練習（種類・開始時刻）が、その日の授業（時限）とどう重なるか
export function classImpact(sessionType: string, startTime: string | null | undefined, periods: number[]): ClassImpact | null {
  if (!startTime || periods.length === 0) return null;
  const s = toMin(startTime);
  const dur = PRACTICE_MINUTES[sessionType] ?? 90;
  const e = s + dur;
  let overlap = 0;
  let late = false;
  let early = false;
  const hit: number[] = [];
  for (const no of [...periods].sort((a, b) => a - b)) {
    const p = PERIODS.find((x) => x.no === no);
    if (!p) continue;
    const ps = toMin(p.start);
    const pe = toMin(p.end);
    const o = Math.min(e, pe) - Math.max(s, ps);
    if (o <= 0) continue;
    overlap += o;
    hit.push(no);
    if (ps <= s) late = true;
    if (pe >= e) early = true;
    if (ps > s && pe < e) early = true; // 練習の途中で抜けて戻る（まれ）
  }
  if (hit.length === 0) return null;
  if (overlap * 2 >= dur) return { status: "absent", periods: hit };
  return { status: late && early ? "late_early" : late ? "late" : "early", periods: hit };
}

export function periodsText(periods: number[]) {
  return periods.map((p) => `${p}限`).join("・");
}
export function impactText(i: ClassImpact) {
  const p = periodsText(i.periods);
  if (i.status === "absent") return `授業（${p}）で休み`;
  if (i.status === "late") return `授業（${p}）で遅れて参加`;
  if (i.status === "early") return `授業（${p}）で早めに抜ける`;
  return `授業（${p}）で遅れて参加・早めに抜ける`;
}
export function impactShort(i: ClassImpact) {
  return i.status === "absent" ? "授業" : i.status === "late" ? "遅れて参加" : i.status === "early" ? "早めに抜ける" : "遅刻・早退";
}

export type ClassLookup = (memberId: string, date: string) => number[];

/** 期間内の、部員ごと・日ごとの授業の時限を引けるようにする（表がまだ無いDBでは授業なし扱い） */
export async function loadClassLookup(
  supabase: SupabaseClient,
  teamId: string,
  memberIds: string[],
  from: string,
  to: string
): Promise<ClassLookup> {
  const none: ClassLookup = () => [];
  if (memberIds.length === 0) return none;
  const { data: termRows, error } = await supabase
    .from("team_terms")
    .select("id, kind, name, start_date, end_date")
    .eq("team_id", teamId)
    .lte("start_date", to)
    .gte("end_date", from);
  if (error || !termRows || termRows.length === 0) return none;
  const terms = termRows as TeamTerm[];
  const termIds = terms.filter((t) => t.kind === "term").map((t) => t.id);
  if (termIds.length === 0) return none;
  const rows: { author_id: string; term_id: string; weekday: number; period: number; mode?: ClassMode }[] = [];
  for (let i = 0; i < memberIds.length; i += 150) {
    // オンデマンド（mode=vod）の授業は練習に影響しないので除く
    const ids = memberIds.slice(i, i + 150);
    let { data, error }: { data: unknown[] | null; error: unknown } = await supabase
      .from("class_schedules")
      .select("author_id, term_id, weekday, period, mode")
      .in("term_id", termIds)
      .in("author_id", ids);
    // mode 列がまだ無いDB（SQL 27 の実行前）は、全部「出席必須」として読む
    if (error)
      ({ data, error } = await supabase
        .from("class_schedules")
        .select("author_id, term_id, weekday, period")
        .in("term_id", termIds)
        .in("author_id", ids));
    rows.push(...((data ?? []) as typeof rows).filter((r) => (r.mode ?? "live") === "live"));
  }
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.author_id}:${r.term_id}:${r.weekday}`;
    map.set(k, [...(map.get(k) ?? []), r.period]);
  }
  return (memberId, date) => {
    const t = termOn(terms, date);
    if (!t) return [];
    return map.get(`${memberId}:${t.id}:${weekdayOf(date)}`) ?? [];
  };
}
