"use client";

import { useEffect, useState } from "react";
import {
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  SessionType,
  sessionTypeLabel,
  TitleColor,
  TrainingType,
  trainingTypeLabel,
} from "../../lib/types";
import { useCalendarViewPref } from "../shell/CalendarViewPrefProvider";

// マイページ「振り返り」タブのカレンダー。
// 過ぎた日は実績（休み・マット・その日に記録したトレーニング）、これからの日は予定
// （所属拠点の時間割。休みを申請していれば「休み」と代替メニュー）を出す。表示内容は固定。

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function UnifiedCalendar({
  cursor,
  onCursorChange,
  weightLogs,
  absentLogs,
  matDoneDates,
  absenceByDate,
  scheduleByDate,
  matPendingDates,
  disablePendingIndicator,
  onSelectDate,
  highlightDate,
  todayDate,
  nextMatchDate,
  homeLocation,
  otherLocationOffDates,
  memoPreviews,
  titleColorByType,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  weightLogs: { date: string; type: TrainingType; title: string | null }[];
  absentLogs: { date: string; type: TrainingType; title: string | null }[];
  matDoneDates?: Set<string>;
  absenceByDate?: Map<string, { reason: string; plan: string; sessionKeys?: string[] | null }>;
  disablePendingIndicator?: boolean;
  scheduleByDate: Map<
    string,
    {
      dayType: DayType;
      isOff: boolean;
      eventName: string | null;
      hasMat: boolean;
      sessions: {
        type: SessionType;
        time: string | null;
        locationNote: string | null;
        isJoint: boolean;
        jointLocation: Location | null;
      }[];
    }
  >;
  matPendingDates: Set<string>;
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
  todayDate?: string;
  nextMatchDate?: string | null;
  homeLocation: Location;
  otherLocationOffDates: Set<string>;
  memoPreviews?: Map<string, string>;
  titleColorByType: Record<TrainingType, Map<string, TitleColor>>;
}) {
  const { defaultCalendarView } = useCalendarViewPref();
  const [viewMode, setViewMode] = useState<"month" | "week">(
    defaultCalendarView
  );
  // 設定で初期表示（月/週）が変更された場合に反映する
  useEffect(() => {
    setViewMode(defaultCalendarView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCalendarView]);

  // 週表示になったタイミング（トグル操作・初期表示が週表示の場合のいずれも）で、
  // 選択中の日付（なければ今日）を含む週がまだ表示されていなければ、その週にジャンプする
  useEffect(() => {
    if (viewMode !== "week") return;
    const targetKey = highlightDate ?? todayDate;
    if (!targetKey) return;
    const [ty, tm, td] = targetKey.split("-").map(Number);
    const target = new Date(ty, tm - 1, td);
    const weekStart = new Date(cursor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    if (target >= weekStart && target <= weekEnd) return;
    onCursorChange(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const dotsByDate = new Map<string, TrainingType[]>();
  const titleByDate = new Map<string, string>();
  const titleTypeByDate = new Map<string, TrainingType>();
  const selfLoggedDates = new Set<string>();
  for (const row of weightLogs) {
    selfLoggedDates.add(row.date);
  }
  for (const row of [...weightLogs, ...absentLogs]) {
    const list = dotsByDate.get(row.date) ?? [];
    list.push(row.type);
    dotsByDate.set(row.date, list);
    if (row.title && !titleByDate.has(row.date)) {
      titleByDate.set(row.date, row.title);
      titleTypeByDate.set(row.date, row.type);
    }
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  let cells: (Date | null)[];
  let headerLabel: string;
  if (viewMode === "month") {
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    headerLabel = `${year}年${month + 1}月`;
  } else {
    const weekStart = new Date(cursor);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
    const weekEnd = cells[6] as Date;
    headerLabel =
      weekStart.getMonth() === weekEnd.getMonth()
        ? `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日〜${weekEnd.getDate()}日`
        : `${weekStart.getMonth() + 1}月${weekStart.getDate()}日〜${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
  }

  function handlePrev() {
    if (viewMode === "month") {
      onCursorChange(new Date(year, month - 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(d.getDate() - 7);
      onCursorChange(d);
    }
  }

  function handleNext() {
    if (viewMode === "month") {
      onCursorChange(new Date(year, month + 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(d.getDate() + 7);
      onCursorChange(d);
    }
  }

  // マス目に出す行（固定）
  function cellLines(
    key: string,
    schedule: { isOff: boolean; dayType: DayType; sessions: { type: SessionType; time: string | null }[] } | undefined
  ): { text: string; cls: string }[] {
    const abs = absenceByDate?.get(key);
    const absText = abs ? `休(${abs.reason.split("・")[0]})` : "";
    const actualCls = "font-semibold text-neutral-700 dark:text-neutral-200";
    const planCls = "text-neutral-400 dark:text-neutral-500";
    const absCls = "font-semibold text-red-600 dark:text-red-400";
    // 実績
    const actual: { text: string; cls: string }[] = [];
    if (abs) actual.push({ text: absText, cls: absCls });
    if (matDoneDates?.has(key)) actual.push({ text: "マット", cls: actualCls });
    for (const t of [...new Set(dotsByDate.get(key) ?? [])]) actual.push({ text: trainingTypeLabel[t], cls: actualCls });
    const past = !!todayDate && key < todayDate;
    const hasRecord = actual.some((l) => l.cls === actualCls);
    if (past || (key === todayDate && hasRecord)) return actual;
    // 予定（今日の記録がまだない日・これからの日）
    // 一部のセクションだけ休むときは、出るセクションの予定も出す
    const partial = !!abs?.sessionKeys && abs.sessionKeys.length > 0;
    if (abs && !partial) return [{ text: absText, cls: absCls }, { text: abs.plan, cls: planCls }];
    if (!schedule || schedule.isOff) return abs ? [{ text: absText, cls: absCls }] : [];
    const sessions = partial
      ? schedule.sessions.filter((s) => !abs!.sessionKeys!.includes(`${s.type}@${s.time ? s.time.slice(0, 5) : ""}`))
      : schedule.sessions;
    // 狭いマスでも切れないように、種目と時刻を2行に分ける
    return [...(abs ? [{ text: absText, cls: absCls }] : []), ...sessions.flatMap((s) => [
      { text: sessionTypeLabel[s.type], cls: planCls },
      ...(s.time ? [{ text: s.time.slice(0, 5), cls: `${planCls} text-[length:calc(7px+var(--fs-add-mini))]` }] : []),
    ])];
  }

  return (
    <div className="rounded-lg border border-border-color bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={handlePrev}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          ＜
        </button>
        <span className="text-sm font-semibold text-foreground">
          {headerLabel}
        </span>
        <button
          onClick={handleNext}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          ＞
        </button>
      </div>
      <div className="mb-2 flex justify-center">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-[length:calc(11px+var(--fs-add))]">
          {(
            [
              { v: "month", label: "月表示" },
              { v: "week", label: "週表示" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setViewMode(opt.v)}
              className={`rounded-md px-3 py-1 font-medium ${
                viewMode === opt.v
                  ? "bg-red-600 text-white shadow"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[length:calc(10px+var(--fs-add))]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w, idx) => (
          <div
            key={w}
            className={
              idx === 0
                ? "font-semibold text-red-500 dark:text-red-400"
                : idx === 6
                  ? "font-semibold text-blue-500 dark:text-blue-400"
                  : "text-neutral-500 dark:text-neutral-500"
            }
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = toDateKey(date);
          const title = titleByDate.get(key);
          const titleType = titleTypeByDate.get(key);
          // 保存枠（最大10個）から外れた古いタイトルは、内容はカレンダーに残るが無色になる
          const titleColor =
            title && titleType
              ? (titleColorByType[titleType].get(title) ?? null)
              : null;
          const isHighlighted = key === highlightDate;
          const isToday = key === todayDate;
          const isMatchDay =
            !!nextMatchDate && key === nextMatchDate;
          const schedule = scheduleByDate.get(key);
          const isAway = schedule?.dayType === "away" && !schedule.isOff;
          const isCamp = schedule?.dayType === "camp" && !schedule.isOff;
          const isPast = !todayDate || key <= todayDate;
          const needsSelfLog =
            !!schedule &&
            !schedule.isOff &&
            schedule.sessions.some((s) => s.type !== "mat");
          const isPending =
            !disablePendingIndicator &&
            isPast &&
            !schedule?.isOff &&
            (matPendingDates.has(key) ||
              (needsSelfLog && !selfLoggedDates.has(key)));
          const weekday = date.getDay();

          let bgClass = "bg-surface-2 text-foreground";
          if (isHighlighted) {
            bgClass = "bg-amber-100 dark:bg-amber-950/40 font-bold";
          } else if (schedule?.isOff) {
            bgClass =
              "bg-neutral-300 dark:bg-neutral-950 text-neutral-500 dark:text-neutral-600";
          } else if (isAway) {
            bgClass =
              "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300";
          } else if (isCamp) {
            bgClass =
              "bg-pink-100 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300";
          } else if (titleColor) {
            bgClass = `${titleColor.fill} text-neutral-800 dark:text-neutral-200`;
          } else if (isToday) {
            bgClass = "bg-blue-100 dark:bg-blue-950/40";
          }

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex ${
                viewMode === "week" ? "min-h-[84px]" : "min-h-[56px]"
              } flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 text-xs active:bg-neutral-200 dark:active:bg-neutral-700 ${bgClass} ${
                isHighlighted
                  ? "border-amber-400 ring-1 ring-amber-400"
                  : isToday
                    ? "border-blue-400 ring-1 ring-blue-400 dark:border-blue-600"
                    : "border-border-color"
              } ${
                isMatchDay
                  ? "ring-2 ring-red-400"
                  : isPending
                    ? "ring-2 ring-yellow-400"
                    : ""
              }`}
              title={title ?? undefined}
            >
              <span
                className={
                  !isHighlighted && !titleColor && !isAway && !isCamp
                    ? weekday === 0
                      ? "border-b-2 border-red-500 px-1 text-red-500 dark:text-red-400"
                      : weekday === 6
                        ? "border-b-2 border-blue-500 px-1 text-blue-500 dark:text-blue-400"
                        : ""
                    : ""
                }
              >
                {date.getDate()}
              </span>
              {schedule &&
                !schedule.isOff &&
                (schedule.dayType === "camp" || schedule.dayType === "away") && (
                  <span className="max-w-full truncate rounded text-[length:calc(7px+var(--fs-add-mini))] font-semibold text-neutral-600 dark:text-neutral-300">
                    {schedule.eventName || dayTypeLabel[schedule.dayType]}
                  </span>
                )}
              {schedule?.isOff && (
                <span className="max-w-full truncate rounded text-[length:calc(7px+var(--fs-add-mini))] font-semibold text-neutral-500 dark:text-neutral-400">
                  {otherLocationOffDates.has(key)
                    ? "全体オフ"
                    : `${locationLabel[homeLocation]}のみオフ`}
                </span>
              )}
              {(() => {
                const lines = cellLines(key, schedule);
                if (lines.length === 0) return null;
                const max = viewMode === "week" ? 4 : 3;
                return (
                  <span className="flex w-full flex-col items-center gap-0.5 px-0.5 text-[length:calc(8px+var(--fs-add-mini))] leading-none">
                    {lines.slice(0, max).map((l, i) => (
                      <span key={i} className={`max-w-full truncate ${l.cls}`}>
                        {l.text}
                      </span>
                    ))}
                  </span>
                );
              })()}
              {isMatchDay && (
                <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1 text-[length:calc(8px+var(--fs-add-mini))] font-bold text-white">
                  試合
                </span>
              )}
              {isPending && !isMatchDay && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-yellow-400" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
