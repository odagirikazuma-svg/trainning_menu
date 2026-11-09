"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { GOALS_CHANGED_EVENT, missingGoalTerms, type GoalRow, type GoalTerm } from "../../lib/goals";
import { isStaffRole } from "../../lib/types";
import type { Profile } from "../AuthGate";

/**
 * 部員の「未設定の目標」（年間目標・月間目標）。
 * フッターの設定アイコンの赤丸と、マイページのタスクに使う。
 * 目標が保存されたら GOALS_CHANGED_EVENT で読み直す。
 */
export function useGoalTasks(profile: Profile | null): GoalTerm[] {
  const [missing, setMissing] = useState<GoalTerm[]>([]);

  useEffect(() => {
    if (!profile || isStaffRole(profile.role)) return;
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const { data, error } = await supabase
        .from("member_goals")
        .select("term, content, updated_at")
        .eq("author_id", profile!.id)
        .in("term", ["long", "short"]);
      if (cancelled) return;
      // テーブルがまだ無い環境では、タスクを出さない
      setMissing(error ? [] : missingGoalTerms((data ?? []) as GoalRow[]));
    }
    load();
    window.addEventListener(GOALS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(GOALS_CHANGED_EVENT, load);
    };
  }, [profile]);

  return profile && !isStaffRole(profile.role) ? missing : [];
}
