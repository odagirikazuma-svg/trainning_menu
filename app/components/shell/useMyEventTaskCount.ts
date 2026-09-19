"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Profile } from "../AuthGate";

/**
 * フッターのイベントアイコンに表示する「未提出の開催中イベント」件数。
 * ウェイトMAX集計・チームイベント（体組成・マット振り返りなど）のうち、
 * 自分が対象（ターゲット指定がない、または自分が指定されている）で、
 * まだ提出していないものの数を数える。
 */
export function useMyEventTaskCount(profile: Profile | null): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (
      !profile ||
      profile.role === "coach" ||
      profile.role === "manager" ||
      profile.role === "ob"
    ) {
      // コーチ・マネージャー・OBは提出対象ではないためバッジは出さない
      setCount(0);
      return;
    }
    let cancelled = false;
    const supabase = createClient();

    async function isTargeted(
      table: "weight_max_event_targets" | "team_event_targets",
      eventId: string
    ): Promise<boolean> {
      const { data: targets } = await supabase
        .from(table)
        .select("member_id")
        .eq("event_id", eventId);
      const rows = (targets ?? []) as { member_id: string }[];
      if (rows.length === 0) return true;
      return rows.some((t) => t.member_id === profile!.id);
    }

    async function load() {
      let pending = 0;

      const { data: wmEvent } = await supabase
        .from("weight_max_events")
        .select("id")
        .eq("team_id", profile!.team_id)
        .is("closed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (wmEvent) {
        const eventId = (wmEvent as { id: string }).id;
        if (await isTargeted("weight_max_event_targets", eventId)) {
          const { data: mine } = await supabase
            .from("weight_maxes")
            .select("author_id")
            .eq("event_id", eventId)
            .eq("author_id", profile!.id)
            .maybeSingle();
          if (!mine) pending++;
        }
      }

      const { data: teEvents } = await supabase
        .from("team_events")
        .select("id")
        .eq("team_id", profile!.team_id)
        .is("closed_at", null);
      for (const e of (teEvents ?? []) as { id: string }[]) {
        if (!(await isTargeted("team_event_targets", e.id))) continue;
        const { data: mine } = await supabase
          .from("team_event_submissions")
          .select("author_id")
          .eq("event_id", e.id)
          .eq("author_id", profile!.id)
          .maybeSingle();
        if (!mine) pending++;
      }

      if (!cancelled) setCount(pending);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  return count;
}
