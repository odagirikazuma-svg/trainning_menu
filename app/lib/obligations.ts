// 日報の「提出が必要なもの」を決める共通ルール（日報画面・未提出の件数・通知・管理ページで同じ考え方を使う）
//
// ■ マット練習：メニューごとに1件（開始時刻を過ぎたら）
// ■ ラン・ウェイト：時間割のセクションごとに1件（同じ種類が2つあってもそれぞれ）
// ■ 休みの報告を出したセクション
//    - 休養（代替メニューなし）：提出なし
//    - 代替メニュー：休んだセクションの最初の1つの代わりに「代替メニューの記録」を1件
// ■ トレーニングの記録は weight_logs.session_key でセクションとひもづける
//    （'weight@13:00'、マットの代わりの代替メニューは 'mat@17:00'。null は予定外の自主トレ）
// ■ 授業の時間割：練習の半分以上が授業なら休み申請なしで欠席（代替メニューの記録が必要）。
//    半分未満の重なりは「遅れて参加／早めに抜ける」として参加扱い

import type { SupabaseClient } from "@supabase/supabase-js";
import { absenceCoversMat, sessionKey } from "./absence";
import { isExemptOn, loadExemptions } from "./exemptions";
import { classImpact, loadClassLookup, type ClassImpact } from "./classSchedule";

export type ObSessionType = "mat" | "running" | "weight";
export type ObSession = { session_type: ObSessionType; start_time: string | null };
export type ObMenu = { id: string; date: string; location: string; start_time: string | null; is_joint: boolean };
export type ObAbsence = { session_keys?: string[] | null; plan_type: string; status: string };

export type TrainingSlot = {
  key: string;
  kind: "session" | "alt";
  sessionType: ObSessionType;
  time: string | null;
  // 代替メニューのとき：休んだセクション（表示用）
  covered?: { type: ObSessionType; time: string | null; byClass?: boolean }[];
  // 授業で遅れて参加・早めに抜ける（参加扱い）
  classNote?: ClassImpact;
};

export type DayPlan<M extends ObMenu = ObMenu> = {
  // byClass：授業で休み（absent=true）、または遅れて参加・早めに抜ける（absent=false）
  mats: { menu: M; absent: boolean; byClass?: ClassImpact }[];
  slots: TrainingSlot[];
  // 休みの報告（差し戻し以外）があり、休養か
  rest: boolean;
};

const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

// loggedKeys：その日にもう出ているトレーニングの記録の session_key。
// 代替メニューは、休んだセクションのどれかの記録がすでにあればそれを代替メニューの記録とみなす（以前の1日1件の記録との互換）
export function planDay<M extends ObMenu>(
  menus: M[],
  sessions: ObSession[],
  absence: ObAbsence | null,
  loggedKeys?: Set<string>,
  // その日の授業の時限（時間割から）
  classPeriods?: number[]
): DayPlan<M> {
  const abs = absence && absence.status !== "rejected" ? absence : null;
  const all = !abs?.session_keys || abs.session_keys.length === 0;
  const covers = (type: ObSessionType, time: string | null) => {
    if (!abs) return false;
    if (type === "mat") return absenceCoversMat(abs.session_keys, time);
    return all || abs.session_keys!.includes(sessionKey(type, time));
  };
  const cls = (type: ObSessionType, time: string | null) => classImpact(type, time, classPeriods ?? []);
  const mats = menus
    .slice()
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    .map((menu) => {
      if (covers("mat", menu.start_time)) return { menu, absent: true };
      const c = cls("mat", menu.start_time);
      return c ? { menu, absent: c.status === "absent", byClass: c } : { menu, absent: false };
    });
  type Cov = { type: ObSessionType; time: string | null; byClass?: boolean };
  const absCovered: Cov[] = [];
  const classCovered: Cov[] = [];
  for (const m of mats) {
    if (!m.absent) continue;
    const c = { type: "mat" as const, time: t5(m.menu.start_time) };
    if (m.byClass) classCovered.push({ ...c, byClass: true });
    else absCovered.push(c);
  }
  const slots: TrainingSlot[] = [];
  for (const s of sessions) {
    if (s.session_type === "mat") continue;
    const time = t5(s.start_time);
    if (covers(s.session_type, time)) {
      absCovered.push({ type: s.session_type, time });
      continue;
    }
    const c = cls(s.session_type, time);
    if (c?.status === "absent") {
      classCovered.push({ type: s.session_type, time, byClass: true });
      continue;
    }
    slots.push({
      key: sessionKey(s.session_type, time),
      kind: "session",
      sessionType: s.session_type,
      time,
      ...(c ? { classNote: c } : {}),
    });
  }
  const coveredList = [...(abs && abs.plan_type !== "none" ? absCovered : []), ...classCovered];
  if (coveredList.length > 0) {
    coveredList.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    const first =
      coveredList.find((c) => loggedKeys?.has(sessionKey(c.type, c.time))) ?? coveredList[0];
    slots.push({ key: sessionKey(first.type, first.time), kind: "alt", sessionType: first.type, time: first.time, covered: coveredList });
  }
  slots.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));
  return { mats, slots, rest: !!abs && abs.plan_type === "none" };
}

// 開始時刻（日本時間）を過ぎたか
export function isOpenAt(date: string, time: string | null, now: Date = new Date()) {
  if (!time) return new Date(`${date}T00:00:00+09:00`) <= now;
  return new Date(`${date}T${time.slice(0, 5)}:00+09:00`) <= now;
}

const typeLabel: Record<ObSessionType, string> = { mat: "マット", running: "ラン", weight: "ウェイト" };
export function slotLabel(s: TrainingSlot) {
  const base = `${typeLabel[s.sessionType]}${s.time ? ` ${s.time}` : ""}`;
  if (s.kind === "alt")
    return `代替メニュー（${(s.covered ?? [])
      .map((c) => `${c.byClass ? "授業で休んだ" : ""}${typeLabel[c.type]}${c.time ? ` ${c.time}` : ""}`)
      .join("・")} の代わり）`;
  return base;
}

// ---------- まとめて読み込む（未提出の件数・通知・管理ページ用） ----------
export type PendingItem =
  | { kind: "mat"; date: string; menu: ObMenu; done: boolean }
  | { kind: "training"; date: string; slot: TrainingSlot; done: boolean };

export type ObMember = { id: string; home_location: string | null; created_at?: string | null };

/**
 * 部員ごと・日ごとの「提出が必要なもの」（開始時刻を過ぎたものだけ）と、出したかどうか。
 * 免除の日・入部前の日・時間割でオフにした日（自拠点）は入れない。
 */
export async function loadObligations(
  supabase: SupabaseClient,
  teamId: string,
  members: ObMember[],
  from: string,
  to: string,
  now: Date = new Date()
): Promise<Map<string, Map<string, PendingItem[]>>> {
  const out = new Map<string, Map<string, PendingItem[]>>();
  const ids = members.map((m) => m.id);
  if (ids.length === 0) return out;
  const [schedRes, menuRes, logRes, absRes, exemptions] = await Promise.all([
    supabase
      .from("schedule_days")
      .select("date, location, is_off, sessions:schedule_sessions(session_type, start_time)")
      .eq("team_id", teamId)
      .gte("date", from)
      .lte("date", to),
    supabase
      .from("menus")
      .select("id, date, location, start_time, is_joint")
      .eq("team_id", teamId)
      .eq("is_off", false)
      .gte("date", from)
      .lte("date", to),
    supabase.from("weight_logs").select("author_id, date, session_key").in("author_id", ids).gte("date", from).lte("date", to),
    supabase
      .from("absence_requests")
      .select("author_id, date, session_keys, plan_type, status")
      .in("author_id", ids)
      .neq("status", "rejected")
      .gte("date", from)
      .lte("date", to),
    loadExemptions(supabase, teamId, from, to),
  ]);
  const classOf = await loadClassLookup(supabase, teamId, ids, from, to);
  const menus = (menuRes.data ?? []) as ObMenu[];
  const reported = new Set<string>();
  if (menus.length > 0) {
    // メニューが多いときは分けて読む
    for (let i = 0; i < menus.length; i += 150) {
      const { data } = await supabase
        .from("comments")
        .select("menu_id, author_id")
        .in("menu_id", menus.slice(i, i + 150).map((m) => m.id))
        .in("kind", ["report", "absent"])
        .is("parent_id", null);
      for (const r of (data ?? []) as { menu_id: string; author_id: string | null }[])
        if (r.author_id) reported.add(`${r.author_id}:${r.menu_id}`);
    }
  }
  const sched = new Map<string, { is_off: boolean; sessions: ObSession[] }>();
  for (const r of (schedRes.data ?? []) as unknown as { date: string; location: string; is_off: boolean; sessions: ObSession[] }[])
    sched.set(`${r.location}:${r.date}`, r);
  const logRows = (logRes.data ?? []) as { author_id: string; date: string; session_key: string | null }[];
  const logs = new Set(logRows.map((r) => `${r.author_id}:${r.date}:${r.session_key ?? ""}`));
  const logKeysByMemberDate = new Map<string, Set<string>>();
  for (const r of logRows) {
    if (!r.session_key) continue;
    const k = `${r.author_id}:${r.date}`;
    if (!logKeysByMemberDate.has(k)) logKeysByMemberDate.set(k, new Set());
    logKeysByMemberDate.get(k)!.add(r.session_key);
  }
  const absences = new Map<string, ObAbsence>();
  for (const r of (absRes.data ?? []) as (ObAbsence & { author_id: string; date: string })[])
    absences.set(`${r.author_id}:${r.date}`, r);
  const menusByDate = new Map<string, ObMenu[]>();
  for (const m of menus) menusByDate.set(m.date, [...(menusByDate.get(m.date) ?? []), m]);

  const dates: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) dates.push(d);

  for (const mem of members) {
    const loc = mem.home_location;
    if (!loc) continue;
    const joined = mem.created_at ? jstDate(new Date(mem.created_at)) : null;
    const byDate = new Map<string, PendingItem[]>();
    for (const date of dates) {
      if (joined && date < joined) continue;
      if (isExemptOn(exemptions, mem.id, date)) continue;
      const day = sched.get(`${loc}:${date}`);
      const off = !!day?.is_off;
      const dayMenus = (menusByDate.get(date) ?? []).filter((m) => m.is_joint || (m.location === loc && !off));
      const plan = planDay(
        dayMenus,
        off ? [] : day?.sessions ?? [],
        absences.get(`${mem.id}:${date}`) ?? null,
        logKeysByMemberDate.get(`${mem.id}:${date}`),
        classOf(mem.id, date)
      );
      const items: PendingItem[] = [];
      for (const m of plan.mats) {
        if (m.absent || !isOpenAt(date, m.menu.start_time, now)) continue;
        items.push({ kind: "mat", date, menu: m.menu, done: reported.has(`${mem.id}:${m.menu.id}`) });
      }
      for (const s of plan.slots) {
        if (!isOpenAt(date, s.time, now)) continue;
        items.push({ kind: "training", date, slot: s, done: logs.has(`${mem.id}:${date}:${s.key}`) });
      }
      if (items.length > 0) byDate.set(date, items);
    }
    out.set(mem.id, byDate);
  }
  return out;
}

function nextDay(d: string) {
  const [y, m, dd] = d.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, dd + 1));
  return x.toISOString().slice(0, 10);
}
export function jstDate(d: Date) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
