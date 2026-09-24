"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
} from "../lib/types";

const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
  match: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  away: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ScheduleDayRow = {
  is_off: boolean;
  day_type: DayType;
  event_name: string | null;
  sessions: {
    id: string;
    session_type: SessionType;
    start_time: string | null;
    is_joint: boolean;
    joint_location: Location | null;
    location_note: string | null;
  }[];
};

/**
 * 設定ページの「セクション登録」欄で、既に登録済みの時間割を一目で確認しながら
 * 登録できるようにするための、月表示専用の簡易カレンダー（1拠点分）。
 * TeamPage.tsxのMonthlyCalendarから、提出状況の集計表示など登録には不要な部分を除いたもの。
 */
export default function ScheduleOverviewCalendar({
  teamId,
  location,
  cursor,
  onCursorChange,
  selectedDate,
  onSelectDate,
}: {
  teamId: string;
  location: Location;
  cursor: Date;
  onCursorChange: (d: Date) => void;
  selectedDate: string | null;
  onSelectDate: (dateStr: string) => void;
}) {
  const supabase = createClient();
  const [scheduleDays, setScheduleDays] = useState<Map<string, ScheduleDayRow>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));
    (async () => {
      const { data } = await supabase
        .from("schedule_days")
        .select(
          "date, is_off, day_type, event_name, sessions:schedule_sessions(id, session_type, start_time, is_joint, joint_location, location_note)"
        )
        .eq("team_id", teamId)
        .eq("location", location)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (cancelled) return;
      const map = new Map<string, ScheduleDayRow>();
      for (const row of (data ?? []) as unknown as (ScheduleDayRow & {
        date: string;
      })[]) {
        map.set(row.date, row);
      }
      setScheduleDays(map);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, location, year, month]);

  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    <div className="rounded-lg border border-border-color bg-surface p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <button
          onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          className="rounded px-1.5 py-1 text-xs text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          ＜
        </button>
        <span className="text-xs font-semibold text-foreground">
          {locationLabel[location]}・{year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-1.5 py-1 text-xs text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          ＞
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-500">
          読み込み中…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[length:calc(9px*var(--fs))]">
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
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />;
              const key = toDateKey(date);
              const day = scheduleDays.get(key);
              const isSelected = key === selectedDate;
              const isToday = key === toDateKey(new Date());
              const weekday = date.getDay();
              return (
                <button
                  key={i}
                  onClick={() => onSelectDate(key)}
                  className={`flex min-h-[46px] flex-col items-start gap-0.5 rounded border p-0.5 text-left ${
                    isSelected
                      ? "border-amber-400 bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-950/40"
                      : day?.is_off
                        ? "border-border-color bg-neutral-100 dark:bg-neutral-900"
                        : day?.day_type === "camp"
                          ? "border-pink-300 bg-pink-100 dark:border-pink-900/60 dark:bg-pink-950/40"
                          : day?.day_type === "match"
                            ? "border-red-300 bg-red-100 dark:border-red-900/60 dark:bg-red-950/40"
                            : day?.day_type === "away"
                              ? "border-purple-300 bg-purple-100 dark:border-purple-900/60 dark:bg-purple-950/40"
                              : isToday
                                ? "border-blue-400 bg-blue-100 ring-1 ring-blue-400 dark:border-blue-600 dark:bg-blue-950/40"
                                : "border-border-color bg-surface-2 active:bg-neutral-200 dark:active:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`text-[length:calc(10px*var(--fs))] font-semibold ${
                      day?.is_off
                        ? "text-neutral-400 dark:text-neutral-600"
                        : weekday === 0
                          ? "text-red-500 dark:text-red-400"
                          : weekday === 6
                            ? "text-blue-500 dark:text-blue-400"
                            : "text-foreground"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {day?.is_off && (
                    <span className="text-[length:calc(8px*var(--fs))] text-neutral-500 dark:text-neutral-500">
                      オフ
                    </span>
                  )}
                  {day &&
                    !day.is_off &&
                    (day.day_type === "camp" ||
                      day.day_type === "match" ||
                      day.day_type === "away") && (
                      <span
                        className={`max-w-full truncate rounded px-0.5 text-[length:calc(8px*var(--fs))] font-semibold ${dayTypeFillColorDark[day.day_type]}`}
                      >
                        {day.event_name || dayTypeLabel[day.day_type]}
                      </span>
                    )}
                  {day &&
                    !day.is_off &&
                    day.sessions.map((s) => (
                      <span
                        key={s.id}
                        className="flex w-full items-center gap-0.5 leading-tight"
                      >
                        <span
                          className={`inline-block h-1 w-1 shrink-0 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                        />
                        <span className="truncate text-[length:calc(8px*var(--fs))] text-neutral-600 dark:text-neutral-300">
                          {sessionTypeLabel[s.session_type]}
                          {s.start_time ? s.start_time.slice(0, 5) : "各自"}
                        </span>
                      </span>
                    ))}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
