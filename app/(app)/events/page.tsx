"use client";

import { useMemo, useState } from "react";
import { useProfile, useSubNav } from "../../components/shell/AppShell";
import SubTabBar from "../../components/shell/SubTabBar";
import TaskQueuePopup, {
  type QueueTask,
} from "../../components/TaskQueuePopup";
import {
  useMyEventPendingTasks,
  type EventPendingTask,
} from "../../components/shell/useMyEventPendingTasks";
import {
  isAdminEditor,
  isStaffRole,
  } from "../../lib/types";

import {
  EventTab,
  tabLabel,
  buildEventQueueTask,
} from "../../components/events/shared";
import { WeightMaxTab, WeightMaxCoachManagement } from "../../components/events/WeightMax";
import { BodyCompositionTab } from "../../components/events/BodyComposition";
import { TeamEventTab, TeamEventCoachManagement } from "../../components/events/TeamEvent";

export default function EventsPage() {
  const { profile } = useProfile();
  const [tab, setTab] = useState<EventTab>("weight_max");
  // 管理者・マネージャーは管理者用の画面（提出タスクなし）。イベントの作成・終了は管理者のみ
  const isCoach = isStaffRole(profile.role);
  const canEdit = isAdminEditor(profile.role);
  const pendingTasks = useMyEventPendingTasks(isCoach ? null : profile);

  const pendingByTab: Record<EventTab, EventPendingTask | null> = {
    weight_max: pendingTasks.weightMax,
    body_composition: pendingTasks.bodyComposition,
    match_reflection: pendingTasks.matchReflection,
  };

  const eventQueueTasks = useMemo(() => {
    if (isCoach) return [];
    const list: QueueTask[] = [];
    (Object.keys(tabLabel) as EventTab[]).forEach((t) => {
      const pending = pendingByTab[t];
      if (pending) list.push(buildEventQueueTask(t, pending, setTab));
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, pendingTasks]);

  // node は useMemo で安定させる（毎レンダー新しいJSXを渡すと無限ループの原因になる）
  const eventsSubNav = useMemo(
    () => (
      <SubTabBar
        items={(Object.keys(tabLabel) as EventTab[]).map((t) => ({
          value: t,
          label: tabLabel[t],
          badge: !isCoach && pendingByTab[t] ? 1 : 0,
        }))}
        active={tab}
        onChange={setTab}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, isCoach, pendingTasks]
  );
  useSubNav(eventsSubNav);

  return (
    <div className="mx-auto flex w-full flex-col gap-4 p-4 sm:p-5">
      {!isCoach && <TaskQueuePopup tasks={eventQueueTasks} />}
      {isCoach && (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          {canEdit ? "イベントを作成する" : "イベント"}
        </h2>
      )}
      {tab === "weight_max" &&
        (isCoach ? (
          <WeightMaxCoachManagement profile={profile} readOnly={!canEdit} />
        ) : (
          <WeightMaxTab profile={profile} />
        ))}
      {tab === "body_composition" &&
        (isCoach ? (
          <TeamEventCoachManagement
            type="body_composition"
            profile={profile}
            readOnly={!canEdit}
          />
        ) : (
          <BodyCompositionTab profile={profile} />
        ))}
      {tab === "match_reflection" &&
        (isCoach ? (
          <TeamEventCoachManagement
            type="match_reflection"
            profile={profile}
            readOnly={!canEdit}
          />
        ) : (
          <TeamEventTab type="match_reflection" profile={profile} />
        ))}
    </div>
  );
}

