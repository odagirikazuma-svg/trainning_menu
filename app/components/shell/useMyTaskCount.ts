"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Profile } from "../AuthGate";
import type { Location } from "../../lib/types";
import { useTasksChangedSignal } from "./taskRefreshBus";
import { loadObligations } from "../../lib/obligations";

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
 * フッターのマイページアイコンに表示する「未提出の日報（日数）＋怪我タスク」の合計件数。
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
      // マット報告・トレ報は「その日の日報」としてまとめて数える（未提出の日数）
      const pendingDates = new Set<string>();

      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1); // 直近1か月分のタスクを対象にする
      if (effectiveHomeLocation) {
        const ob = await loadObligations(
          supabase,
          profile!.team_id,
          [{ id: profile!.id, home_location: effectiveHomeLocation, created_at: profile!.created_at }],
          toDateKey(oneMonthAgo),
          todayStr
        );
        for (const [d, items] of ob.get(profile!.id) ?? []) if (items.some((x) => !x.done)) pendingDates.add(d);
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
        setCount(pendingDates.size + injuryPendingCount);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile, refreshSignal]);

  return count;
}
