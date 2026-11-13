"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { isStaffRole } from "../../lib/types";
import type { Profile } from "../AuthGate";

// 設定で階級を保存したときに出すイベント（設定アイコンの赤丸を消すため）
export const WEIGHT_CLASS_CHANGED_EVENT = "weight-class-changed";

// 部員が階級を入れていなければ true（設定の「階級」をタスクとして出す）
export function useWeightClassMissing(profile: Profile | null): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!profile || isStaffRole(profile.role)) return;
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const { data, error } = await supabase.from("profiles").select("weight_class").eq("id", profile!.id).maybeSingle();
      if (cancelled) return;
      setMissing(!error && (data as { weight_class: number | null } | null)?.weight_class == null);
    }
    load();
    window.addEventListener(WEIGHT_CLASS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(WEIGHT_CLASS_CHANGED_EVENT, load);
    };
  }, [profile]);
  return !!profile && !isStaffRole(profile.role) && missing;
}
