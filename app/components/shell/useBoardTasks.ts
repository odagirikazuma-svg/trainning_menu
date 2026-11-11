"use client";

import { absenceCoversMat } from "../../lib/absence";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Location } from "../../lib/types";
import type { Profile } from "../AuthGate";

// 練習予定表のタスク（部員向け）
// - menu：自分が参加する練習に、まだメニューが登録されていない（練習開始前）
// - report：自分が参加する練習の開始時刻を過ぎたのに、練習後の実施報告がまだ
// 休みを報告済み（取り消し以外）の日は対象外。作成・報告は参加者なら誰でもできるので、参加者全員に出す。
export type BoardTask = {
  kind: "menu" | "report";
  menuId: string;
  date: string;
  startTime: string | null;
  location: Location;
  isJoint: boolean;
};

export const BOARD_TASKS_CHANGED_EVENT = "board-tasks-changed";

function dateKey(offset: number) {
  return new Date(Date.now() + 9 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
}

export function useBoardTasks(profile: Profile | null): BoardTask[] {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const target =
    !!profile && !!profile.home_location && !["coach", "manager", "ob"].includes(profile.role);

  useEffect(() => {
    if (!profile || !target) return;
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const from = dateKey(-7);
      const to = dateKey(7);
      const [menuRes, absRes] = await Promise.all([
        supabase
          .from("menus")
          .select("id, date, start_time, location, is_joint, content")
          .eq("team_id", profile!.team_id)
          .eq("is_off", false)
          .gte("date", from)
          .lte("date", to)
          .or(`location.eq.${profile!.home_location},is_joint.eq.true`),
        supabase
          .from("absence_requests")
          .select("date, status, session_keys")
          .eq("author_id", profile!.id)
          .gte("date", from)
          .lte("date", to),
      ]);
      if (cancelled || menuRes.error) return;
      const absences = ((absRes.error ? [] : absRes.data) ?? []) as { date: string; status: string; session_keys: string[] | null }[];
      const absentFor = (m: { date: string; start_time: string | null }) =>
        absences.some((a) => a.status !== "rejected" && a.date === m.date && absenceCoversMat(a.session_keys, m.start_time));
      const menus = (menuRes.data ?? []) as {
        id: string;
        date: string;
        start_time: string | null;
        location: Location;
        is_joint: boolean;
        content: string;
      }[];
      const now = Date.now();
      const started = (m: { date: string; start_time: string | null }) =>
        new Date(`${m.date}T${m.start_time ?? "00:00:00"}+09:00`).getTime() <= now;
      const mine = menus.filter((m) => !absentFor(m));
      const startedIds = mine.filter(started).map((m) => m.id);
      const { data: reps, error: repErr } = startedIds.length
        ? await supabase.from("menu_reports").select("menu_id").in("menu_id", startedIds)
        : { data: [], error: null };
      if (cancelled) return;
      const reported = new Set(((repErr ? startedIds.map((id) => ({ menu_id: id })) : reps) ?? []).map((r: { menu_id: string }) => r.menu_id));
      const out: BoardTask[] = [];
      for (const m of mine) {
        const base = { menuId: m.id, date: m.date, startTime: m.start_time, location: m.location, isJoint: m.is_joint };
        if (!started(m)) {
          if (!m.content?.trim()) out.push({ kind: "menu", ...base });
        } else if (!reported.has(m.id)) {
          out.push({ kind: "report", ...base });
        }
      }
      out.sort((a, b) => (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? "")));
      setTasks(out);
    }
    load();
    window.addEventListener(BOARD_TASKS_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener(BOARD_TASKS_CHANGED_EVENT, load);
      window.removeEventListener("focus", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, target]);

  return target ? tasks : [];
}

export function notifyBoardTasksChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BOARD_TASKS_CHANGED_EVENT));
}
