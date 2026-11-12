// 日報の「提出が必要なもの」を決める共通ルール（日報画面・未提出の件数・通知・管理ページで同じ考え方を使う）
//
// ■ マット練習：メニューごとに1件（開始時刻を過ぎたら）
// ■ ラン・ウェイト：時間割のセクションごとに1件（同じ種類が2つあってもそれぞれ）
// ■ 休みの報告を出したセクション
//    - 休養（代替メニューなし）：提出なし
//    - 代替メニュー：休んだセクションの最初の1つの代わりに「代替メニューの記録」を1件
// ■ トレーニングの記録は weight_logs.session_key でセクションとひもづける
//    （'weight@13:00'、マットの代わりの代替メニューは 'mat@17:00'。null は予定外の自主トレ）

import type { SupabaseClient } from "@supabase/supabase-js";
import { absenceCoversMat, sessionKey } from "./absence";
import { isExemptOn, loadExemptions } from "./exemptions";

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
  covered?: { type: ObSessionType; time: string | null }[];
};

export type DayPlan<M extends ObMenu = ObMenu> = {
  mats: { menu: M; absent: boolean }[];
  slots: TrainingSlot[];
  // 休みの報告（差し戻し以外）があり、休養か
  rest: boolean;
};

const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);

export function planDay<M extends ObMenu>(menus: M[], sessions: ObSession[], absence: ObAbsence | null): DayPlan<M> {
  const abs = absence && absence.status !== "rejected" ? absence : null;
  const all = !abs?.session_keys || abs.session_keys.length === 0;
  const covers = (type: ObSessionType, time: string | null) => {
    if (!abs) return false;
    if (type === "mat") return absenceCoversMat(abs.session_keys, time);
    return all || abs.session_keys!.includes(sessionKey(type, time));
  };
  const mats = menus
    .slice()
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    .map((menu) => ({ menu, absent: covers("mat", menu.start_time) }));
  const coveredList: { type: ObSessionType; time: string | null }[] = mats
    .filter((m) => m.absent)
    .map((m) => ({ type: "mat" as const, time: t5(m.menu.start_time) }));
  const slots: TrainingSlot[] = [];
  for (const s of sessions) {
    if (s.session_type === "mat") continue;
    const time = t5(s.start_time);
    if (covers(s.session_type, time)) coveredList.push({ type: s.session_type, time });
    else slots.push({ key: sessionKey(s.session_type, time), kind: "session", sessionType: s.session_type, time });
  }
  if (abs && abs.plan_type !== "none" && coveredList.length > 0) {
    coveredList.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
    const first = coveredList[0];
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
    return `代替メニュー（${(s.covered ?? []).map((c) => `${typeLabel[c.type]}${c.time ? ` ${c.time}` : ""}`).join("・")} の代わり）`;
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
  const logs = new Set(
    ((logRes.data ?? []) as { author_id: string; date: string; session_key: string | null }[]).map(
      (r) => `${r.author_id}:${r.date}:${r.session_key ?? ""}`
    )
  );
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
      const plan = planDay(dayMenus, off ? [] : day?.sessions ?? [], absences.get(`${mem.id}:${date}`) ?? null);
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
