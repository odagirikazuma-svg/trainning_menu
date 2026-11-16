"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { isStaffRole } from "../../lib/types";
import { jstDate } from "../../lib/obligations";
import type { TeamTerm } from "../../lib/classSchedule";
import type { Profile } from "../AuthGate";

// 時間割を保存したときに出すイベント（設定アイコンの赤丸を消すため）
export const CLASS_SCHEDULE_CHANGED_EVENT = "class-schedule-changed";

const today = () => jstDate(new Date());
function shift(d: string, n: number) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

// 登録が必要な期間：今の期間と、2週間以内に始まる期間
function termsToRegister(terms: TeamTerm[]) {
  const t = today();
  const soon = shift(t, 14);
  return terms.filter((x) => x.kind === "term" && x.end_date >= t && x.start_date <= soon);
}

export function useClassScheduleMissing(profile: Profile | null): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!profile || isStaffRole(profile.role) || profile.role === "ob") return;
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const { data: terms, error } = await supabase
        .from("team_terms")
        .select("id, kind, name, start_date, end_date")
        .eq("team_id", profile!.team_id);
      if (cancelled || error) return;
      const need = termsToRegister((terms ?? []) as TeamTerm[]);
      if (need.length === 0) return setMissing(false);
      const { data: regs } = await supabase
        .from("class_term_registrations")
        .select("term_id")
        .eq("author_id", profile!.id)
        .in("term_id", need.map((x) => x.id));
      if (cancelled) return;
      const done = new Set(((regs ?? []) as { term_id: string }[]).map((r) => r.term_id));
      setMissing(need.some((x) => !done.has(x.id)));
    }
    load();
    window.addEventListener(CLASS_SCHEDULE_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CLASS_SCHEDULE_CHANGED_EVENT, load);
    };
  }, [profile]);
  return !!profile && !isStaffRole(profile.role) && profile.role !== "ob" && missing;
}

