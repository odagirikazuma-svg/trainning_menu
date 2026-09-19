"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Profile } from "../AuthGate";

export type EventPendingTask = {
  id: string;
  title: string | null;
  deadline: string;
  overdue: boolean;
};

export type EventPendingTasks = {
  weightMax: EventPendingTask | null;
  bodyComposition: EventPendingTask | null;
  matchReflection: EventPendingTask | null;
};

const EMPTY: EventPendingTasks = {
  weightMax: null,
  bodyComposition: null,
  matchReflection: null,
};

/**
 * イベントページ用：自分がまだ提出していない、開催中のイベントをカテゴリ別に返す。
 * サブタブのバッジ・ページ内ポップアップ（EventTaskQueuePopup）で共有して使う。
 * フッターのイベントアイコンのバッジ数（useMyEventTaskCount）とロジックは共通。
 */
export function useMyEventPendingTasks(
  profile: Profile | null
): EventPendingTasks {
  const [tasks, setTasks] = useState<EventPendingTasks>(EMPTY);

  useEffect(() => {
    if (
      !profile ||
      profile.role === "coach" ||
      profile.role === "manager" ||
      profile.role === "ob"
    ) {
      // コーチ・マネージャー・OBは提出対象ではない
      setTasks(EMPTY);
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    const todayStr = new Date().toISOString().slice(0, 10);

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
      const next: EventPendingTasks = {
        weightMax: null,
        bodyComposition: null,
        matchReflection: null,
      };

      const { data: wmEvent } = await supabase
        .from("weight_max_events")
        .select("id, deadline")
        .eq("team_id", profile!.team_id)
        .is("closed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (wmEvent) {
        const ev = wmEvent as { id: string; deadline: string };
        if (await isTargeted("weight_max_event_targets", ev.id)) {
          const { data: mine } = await supabase
            .from("weight_maxes")
            .select("author_id")
            .eq("event_id", ev.id)
            .eq("author_id", profile!.id)
            .maybeSingle();
          if (!mine) {
            next.weightMax = {
              id: ev.id,
              title: null,
              deadline: ev.deadline,
              overdue: ev.deadline < todayStr,
            };
          }
        }
      }

      const { data: teEvents } = await supabase
        .from("team_events")
        .select("id, type, title, deadline")
        .eq("team_id", profile!.team_id)
        .is("closed_at", null);
      for (const e of (teEvents ?? []) as {
        id: string;
        type: "match_reflection" | "body_composition";
        title: string | null;
        deadline: string;
      }[]) {
        if (!(await isTargeted("team_event_targets", e.id))) continue;
        const { data: mine } = await supabase
          .from("team_event_submissions")
          .select("author_id")
          .eq("event_id", e.id)
          .eq("author_id", profile!.id)
          .maybeSingle();
        if (mine) continue;
        const task: EventPendingTask = {
          id: e.id,
          title: e.title,
          deadline: e.deadline,
          overdue: e.deadline < todayStr,
        };
        if (e.type === "body_composition") next.bodyComposition = task;
        else next.matchReflection = task;
      }

      if (!cancelled) setTasks(next);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile]);

  return tasks;
}
