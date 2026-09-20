"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Profile } from "../AuthGate";
import type { Location, SessionType } from "../../lib/types";
import { useTasksChangedSignal } from "./taskRefreshBus";

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type InjuryRow = {
  id: string;
  expected_recovery_date: string | null;
  next_hospital_date: string | null;
  is_recovered: boolean;
  progress_updated_at: string | null;
};

function injuryNeedsProgressUpdate(inj: InjuryRow, todayStr: string): boolean {
  if (inj.is_recovered) return false;
  const triggerDates = [inj.expected_recovery_date, inj.next_hospital_date]
    .filter((d): d is string => !!d)
    .sort();
  if (triggerDates.length === 0) return false;
  if (triggerDates[0] > todayStr) return false;
  if (inj.progress_updated_at) {
    const updatedDateStr = toDateKey(new Date(inj.progress_updated_at));
    if (updatedDateStr >= todayStr) return false;
  }
  return true;
}

/**
 * フッターのマイページアイコンに表示する「練習タスク＋怪我タスク」の合計件数。
 * マイページ本体（MemberHome）が持つロジックの軽量版で、ヘッダー/フッター表示専用。
 */
export function useMyTaskCount(profile: Profile | null): number {
  const [count, setCount] = useState(0);
  // 提出・キャンセルなど、タスク件数に影響しうる操作があった後に再計算するための合図
  const refreshSignal = useTasksChangedSignal();

  useEffect(() => {
    if (!profile) {
      setCount(0);
      return;
    }
    if (
      profile.role === "coach" ||
      profile.role === "manager" ||
      profile.role === "ob"
    ) {
      // コーチ・マネージャーはフッターにマイページを持たないため対象外
      // OBはマイページ側の表示設定に委ねる（バッジは出さない）
      setCount(0);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    const todayStr = toDateKey(new Date());

    async function load() {
      const effectiveHomeLocation: Location | null = profile!.home_location;
      let matPendingCount = 0;
      let selfPendingCount = 0;

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      const joinedDate = toDateKey(new Date(profile!.created_at));
      const rangeStart =
        toDateKey(twoWeeksAgo) > joinedDate ? toDateKey(twoWeeksAgo) : joinedDate;

      if (effectiveHomeLocation) {
        const { data: ownMenuData } = await supabase
          .from("menus")
          .select("id, date, start_time")
          .eq("team_id", profile!.team_id)
          .eq("location", effectiveHomeLocation)
          .eq("is_off", false)
          .gte("date", rangeStart)
          .lte("date", todayStr);
        const { data: jointMenuData } = await supabase
          .from("menus")
          .select("id, date, start_time")
          .eq("team_id", profile!.team_id)
          .eq("is_joint", true)
          .eq("is_off", false)
          .gte("date", rangeStart)
          .lte("date", todayStr);

        const menuMap = new Map<
          string,
          { id: string; date: string; start_time: string | null }
        >();
        for (const m of (ownMenuData ?? []) as {
          id: string;
          date: string;
          start_time: string | null;
        }[])
          menuMap.set(m.id, m);
        for (const m of (jointMenuData ?? []) as {
          id: string;
          date: string;
          start_time: string | null;
        }[])
          menuMap.set(m.id, m);

        const openMenus = Array.from(menuMap.values()).filter((m) =>
          !m.start_time
            ? true
            : new Date() >= new Date(`${m.date}T${m.start_time}`)
        );

        if (openMenus.length > 0) {
          const { data: commentData } = await supabase
            .from("comments")
            .select("menu_id")
            .eq("author_id", profile!.id)
            .in(
              "menu_id",
              openMenus.map((m) => m.id)
            )
            .in("kind", ["report", "absent"]);
          const respondedIds = new Set(
            ((commentData ?? []) as { menu_id: string }[]).map(
              (c) => c.menu_id
            )
          );
          matPendingCount = openMenus.filter(
            (m) => !respondedIds.has(m.id)
          ).length;
        }

        const { data: scheduleData } = await supabase
          .from("schedule_days")
          .select("date, is_off, sessions:schedule_sessions(session_type)")
          .eq("team_id", profile!.team_id)
          .eq("location", effectiveHomeLocation)
          .eq("is_off", false)
          .gte("date", rangeStart)
          .lte("date", todayStr);
        const nonMatDates = (
          (scheduleData ?? []) as unknown as {
            date: string;
            sessions: { session_type: SessionType }[];
          }[]
        )
          .filter((row) => row.sessions.some((s) => s.session_type !== "mat"))
          .map((row) => row.date);

        if (nonMatDates.length > 0) {
          const { data: logData } = await supabase
            .from("weight_logs")
            .select("date")
            .eq("author_id", profile!.id)
            .gte("date", rangeStart)
            .lte("date", todayStr);
          const loggedDates = new Set(
            ((logData ?? []) as { date: string }[]).map((r) => r.date)
          );
          selfPendingCount = nonMatDates.filter(
            (d) => !loggedDates.has(d)
          ).length;
        }
      }

      const { data: injuryData } = await supabase
        .from("injuries")
        .select(
          "id, expected_recovery_date, next_hospital_date, is_recovered, progress_updated_at"
        )
        .eq("author_id", profile!.id);
      const injuryPendingCount = ((injuryData ?? []) as InjuryRow[]).filter(
        (inj) => injuryNeedsProgressUpdate(inj, todayStr)
      ).length;

      if (!cancelled) {
        setCount(matPendingCount + selfPendingCount + injuryPendingCount);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile, refreshSignal]);

  return count;
}
