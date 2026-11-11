"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import {
  CommentKind,
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
  } from "../../lib/types";
import type { Profile } from "../AuthGate";
import { useCalendarViewPref } from "../shell/CalendarViewPrefProvider";

// 練習予定表の部品（報告スレッド・カレンダー・時刻選択など）

export const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
  match: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  away: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
};

export type MenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_joint: boolean;
  is_off: boolean;
  created_at: string;
  created_by: string;
  creator: { display_name: string } | null;
  last_edited_by: string | null;
  last_edited_at: string | null;
  editor: { display_name: string } | null;
};

export type CommentRow = {
  id: string;
  text: string;
  kind: CommentKind;
  parent_id: string | null;
  created_at: string;
  author_id: string;
  alt_type: "running" | "weight" | "other" | null;
  author: { display_name: string; role: Profile["role"] } | null;
};

export function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function MenuCalendar({
  menus,
  viewDate,
  onSelect,
  jointElsewhere,
  onSelectJoint,
  onSelectEmpty,
  teamId,
  location,
  refreshKey,
}: {
  menus: MenuRow[];
  viewDate: string;
  onSelect: (id: string) => void;
  jointElsewhere: Map<string, { menuId: string; location: Location }>;
  onSelectJoint: (date: string) => void;
  onSelectEmpty: (date: string) => void;
  teamId: string;
  location: Location;
  refreshKey: number;
}) {
  const supabase = createClient();
  const { defaultCalendarView } = useCalendarViewPref();
  const [viewMode, setViewMode] = useState<"month" | "week">(
    defaultCalendarView
  );
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // 設定で初期表示（月/週）が変更された場合に反映する
  useEffect(() => {
    setViewMode(defaultCalendarView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCalendarView]);

  // 上部の◀▶で日付を移動して月・週をまたいだ場合や表示モード切替時、下のカレンダーの表示も追従させる
  // （週表示に切り替えたときは、選択中の日付（viewDate）を含む週を表示する）
  useEffect(() => {
    const [y, m, d] = viewDate.split("-").map(Number);
    if (viewMode === "week") {
      setCursor(new Date(y, m - 1, d));
    } else if (y !== cursor.getFullYear() || m - 1 !== cursor.getMonth()) {
      setCursor(new Date(y, m - 1, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, viewMode]);

  const [scheduleByDate, setScheduleByDate] = useState<
    Map<
      string,
      {
        is_off: boolean;
        day_type: DayType;
        event_name: string | null;
        sessions: {
          session_type: SessionType;
          start_time: string | null;
          is_joint: boolean;
          joint_location: Location | null;
          location_note: string | null;
        }[];
      }
    >
  >(new Map());

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  let cells: (Date | null)[];
  let headerLabel: string;
  let rangeStart: string;
  let rangeEnd: string;
  if (viewMode === "month") {
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay(); // 0=日
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    headerLabel = `${year}年${month + 1}月`;
    rangeStart = toDateKey(new Date(year, month, 1));
    rangeEnd = toDateKey(new Date(year, month + 1, 0));
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
    rangeStart = toDateKey(weekStart);
    rangeEnd = toDateKey(weekEnd);
  }

  useEffect(() => {
    // 表示する週・月がすぐ切り替わると、前の範囲の結果が後から届いて上書きすることがある。
    // 古い範囲の結果は捨てる
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("schedule_days")
        .select(
          "date, is_off, day_type, event_name, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location, location_note)"
        )
        .eq("team_id", teamId)
        .eq("location", location)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      const map = new Map<
        string,
        {
          is_off: boolean;
          day_type: DayType;
          event_name: string | null;
          sessions: {
            session_type: SessionType;
            start_time: string | null;
            is_joint: boolean;
            joint_location: Location | null;
            location_note: string | null;
          }[];
        }
      >();
      for (const row of (data ?? []) as unknown as {
        date: string;
        is_off: boolean;
        day_type: DayType;
        event_name: string | null;
        sessions: {
          session_type: SessionType;
          start_time: string | null;
          is_joint: boolean;
          joint_location: Location | null;
          location_note: string | null;
        }[];
      }[]) {
        map.set(row.date, {
          is_off: row.is_off,
          day_type: row.day_type,
          event_name: row.event_name,
          sessions: row.sessions,
        });
      }
      if (!cancelled) setScheduleByDate(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd, location, refreshKey]);

  const menusByDate = new Map<string, MenuRow[]>();
  for (const m of menus) {
    const list = menusByDate.get(m.date) ?? [];
    list.push(m);
    menusByDate.set(m.date, list);
  }

  const todayKey = toDateKey(new Date());

  function handlePrev() {
    if (viewMode === "month") {
      setCursor(new Date(year, month - 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(d.getDate() - 7);
      setCursor(d);
    }
  }

  function handleNext() {
    if (viewMode === "month") {
      setCursor(new Date(year, month + 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(d.getDate() + 7);
      setCursor(d);
    }
  }

  return (
    <div className="rounded-lg border border-border-color bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
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
          const dayMenus = menusByDate.get(key) ?? [];
          const hasMenu = dayMenus.length > 0;
          const isOff = dayMenus.some((m) => m.is_off);
          const jointInfo = !hasMenu ? jointElsewhere.get(key) : undefined;
          const schedule = scheduleByDate.get(key);
          const isToday = key === todayKey;
          const isViewDate = key === viewDate;
          const weekday = date.getDay();
          return (
            <button
              key={i}
              onClick={() => {
                if (hasMenu) onSelect(dayMenus[0].id);
                else if (jointInfo) onSelectJoint(key);
                else onSelectEmpty(key);
              }}
              className={`relative flex ${
                viewMode === "week" ? "min-h-[88px]" : "min-h-[56px]"
              } flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 text-xs ${
                // 今日・表示中の日の見せ方は他のカレンダーと共通：
                // 表示中の日＝黄色（アンバー）の枠と背景、今日＝青の枠（背景色が他に無ければ青の背景）
                isViewDate
                  ? "border-amber-400 bg-amber-100 font-semibold ring-1 ring-amber-400 dark:bg-amber-950/40"
                  : isToday
                    ? "border-blue-400 ring-1 ring-blue-400 dark:border-blue-600"
                    : "border-border-color"
              } ${
                isViewDate
                  ? "text-neutral-900 dark:text-neutral-100"
                  : isOff || schedule?.is_off
                    ? "bg-neutral-200 font-medium text-neutral-600 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-400 dark:active:bg-neutral-700"
                    : schedule?.day_type === "camp"
                      ? "bg-pink-100 font-medium text-pink-700 active:bg-pink-200 dark:bg-pink-950/40 dark:text-pink-400 dark:active:bg-pink-900/40"
                      : schedule?.day_type === "match"
                        ? "bg-red-100 font-medium text-red-700 active:bg-red-200 dark:bg-red-950/40 dark:text-red-400 dark:active:bg-red-900/40"
                        : hasMenu
                          ? "bg-blue-100 font-medium text-blue-700 active:bg-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:active:bg-blue-900/40"
                          : jointInfo
                            ? "bg-purple-100 font-medium text-purple-700 active:bg-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:active:bg-purple-900/40"
                            : isToday
                              ? "bg-blue-100 text-neutral-700 dark:bg-blue-950/40 dark:text-neutral-300"
                              : "bg-surface-2 text-neutral-700 active:bg-neutral-200 dark:text-neutral-300 dark:active:bg-neutral-700"
              }`}
            >
              <span
                className={
                  !isViewDate && !hasMenu && !isOff && !schedule?.is_off
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
              {schedule && schedule.is_off && (
                <span className="text-[length:calc(8px+var(--fs-add-mini))] font-medium text-neutral-500 dark:text-neutral-500">
                  オフ
                </span>
              )}
              {schedule &&
                !schedule.is_off &&
                (schedule.day_type === "camp" ||
                  schedule.day_type === "match" ||
                  schedule.day_type === "away") && (
                  <span
                    className={`max-w-full truncate rounded px-1 text-[length:calc(8px+var(--fs-add-mini))] font-semibold ${dayTypeFillColorDark[schedule.day_type]}`}
                  >
                    {schedule.event_name || dayTypeLabel[schedule.day_type]}
                  </span>
                )}
              {schedule &&
                !schedule.is_off &&
                schedule.sessions.length > 0 && (
                  <span className="flex flex-col items-center gap-0.5 px-0.5">
                    {[...schedule.sessions]
                      .sort((a, b) =>
                        (a.start_time ?? "99:99").localeCompare(
                          b.start_time ?? "99:99"
                        )
                      )
                      .map((s, idx) => (
                        <span
                          key={idx}
                          className="flex items-center gap-0.5 text-[length:calc(8px+var(--fs-add-mini))] leading-none text-neutral-500 dark:text-neutral-400"
                        >
                          <span
                            className={`inline-block h-1 w-1 shrink-0 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                          />
                          {sessionTypeLabel[s.session_type]}
                          {s.start_time ? s.start_time.slice(0, 5) : "各自"}
                          {schedule.day_type === "camp" ||
                          schedule.day_type === "away"
                            ? s.is_joint
                              ? "(全体)"
                              : `(${locationLabel[location]})`
                            : s.location_note
                              ? `(${s.location_note})`
                              : s.is_joint &&
                                (s.joint_location &&
                                s.joint_location !== location
                                  ? `(${locationLabel[s.joint_location]})`
                                  : "(全体)")}
                        </span>
                      ))}
                  </span>
                )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 10分刻みのプルダウンで時刻を選ぶ（ブラウザ標準のtime inputはstep指定が
// 効かない場合があるため、hour/minuteそれぞれをselectで選ばせる方式にしている）
export function TimeSelect({
  value,
  onChange,
}: {
  value: string; // "HH:MM" or ""
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value ? value.split(":") : ["", ""];
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "10", "20", "30", "40", "50"];

  function update(nextHour: string, nextMinute: string) {
    if (!nextHour || !nextMinute) {
      onChange("");
      return;
    }
    onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <div className="flex gap-2">
      <select
        value={hour}
        onChange={(e) => update(e.target.value, minute || "00")}
        className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"
      >
        <option value="">--</option>
        {hours.map((h) => (
          <option key={h} value={h}>
            {h}時
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => update(hour || "00", e.target.value)}
        className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"
      >
        <option value="">--</option>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </div>
  );
}

