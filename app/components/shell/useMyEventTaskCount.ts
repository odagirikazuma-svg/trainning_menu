"use client";

import type { Profile } from "../AuthGate";
import { useMyEventPendingTasks } from "./useMyEventPendingTasks";

/**
 * フッターのイベントアイコンに表示する「未提出の開催中イベント」件数。
 * カテゴリ別の詳細はuseMyEventPendingTasksが持っているので、ここではその集計のみ行う。
 */
export function useMyEventTaskCount(profile: Profile | null): number {
  const tasks = useMyEventPendingTasks(profile);
  return [tasks.weightMax, tasks.bodyComposition, tasks.matchReflection].filter(
    (t) => t != null
  ).length;
}
