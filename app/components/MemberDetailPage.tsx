"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  roleLabel,
  TrainingType,
  trainingTypeDotColor,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

type MemberProfile = {
  id: string;
  display_name: string;
  role: Profile["role"];
  home_location: Location | null;
  entry_year: number | null;
  team_id: string;
};

type MatchRow = {
  id: string;
  name: string;
  date: string;
};

type WeightLogRow = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
};

type RecentRecord = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  isAlternative: boolean;
};

type PopupRecordRow = {
  date: string;
  content: string;
  type: TrainingType;
  isAlternative: boolean;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string) {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

export default function MemberDetailPage({
  profile,
  memberId,
}: {
  profile: Profile;
  memberId: string;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [member, setMember] = useState<MemberProfile | null | undefined>(
    undefined
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);

  const [recentLogs, setRecentLogs] = useState<RecentRecord[]>([]);
  const [loadingRecentLogs, setLoadingRecentLogs] = useState(true);

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calendarWeightLogs, setCalendarWeightLogs] = useState<
    { date: string; type: TrainingType }[]
  >([]);
  const [calendarAbsentLogs, setCalendarAbsentLogs] = useState<
    { date: string; type: TrainingType }[]
  >([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<
    string | null
  >(null);
  const [popupRecord, setPopupRecord] = useState<
    PopupRecordRow[] | null | undefined
  >(undefined);
  const [loadingPopupRecord, setLoadingPopupRecord] = useState(false);
  const [recordDates, setRecordDates] = useState<string[]>([]);

  useEffect(() => {
    loadMember();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  useEffect(() => {
    if (!member) return;
    loadNextMatch();
    loadRecentLogs();
    loadRecordDates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  useEffect(() => {
    if (!member) return;
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, calendarCursor]);

  async function loadMember() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, role, home_location, entry_year, team_id")
      .eq("id", memberId)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
      setMember(null);
    } else {
      setMember((data as MemberProfile | null) ?? null);
    }
  }

  async function loadNextMatch() {
    setLoadingMatch(true);
    const todayStr = toDateKey(new Date());
    const { data, error } = await supabase
      .from("matches")
      .select("id, name, date")
      .eq("team_id", profile.team_id)
      .eq("member_id", memberId)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
    } else {
      setNextMatch((data as MatchRow | null) ?? null);
    }
    setLoadingMatch(false);
  }

  async function loadRecentLogs() {
    setLoadingRecentLogs(true);
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 60);
    const rangeStart = toDateKey(lookbackStart);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const rangeEnd = toDateKey(yesterday);

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("id, date, content, type")
      .eq("author_id", memberId)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (logError) {
      setErrorMsg(logError.message);
      setLoadingRecentLogs(false);
      return;
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("id, text, alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", memberId)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (absentError) {
      setErrorMsg(absentError.message);
      setLoadingRecentLogs(false);
      return;
    }

    const logRecords: RecentRecord[] = (
      (logData ?? []) as WeightLogRow[]
    ).map((l) => ({
      id: l.id,
      date: l.date,
      content: l.content,
      type: l.type,
      isAlternative: false,
    }));

    const absentRows = (absentData ?? []) as unknown as {
      id: string;
      text: string;
      alt_type: TrainingType;
      menu: { date: string } | null;
    }[];
    const absentRecords: RecentRecord[] = absentRows
      .filter(
        (r) => r.menu && r.menu.date >= rangeStart && r.menu.date <= rangeEnd
      )
      .map((r) => ({
        id: r.id,
        date: r.menu!.date,
        content: r.text,
        type: r.alt_type,
        isAlternative: true,
      }));

    const merged = [...logRecords, ...absentRecords].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    const seenDates = new Set<string>();
    const limited: RecentRecord[] = [];
    for (const r of merged) {
      if (!seenDates.has(r.date)) {
        if (seenDates.size >= 3) break;
        seenDates.add(r.date);
      }
      limited.push(r);
    }

    setRecentLogs(limited);
    setLoadingRecentLogs(false);
  }

  async function loadCalendarData() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("date, type")
      .eq("author_id", memberId)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (logError) {
      setErrorMsg(logError.message);
    } else {
      setCalendarWeightLogs(
        (logData ?? []) as { date: string; type: TrainingType }[]
      );
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", memberId)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (absentError) {
      setErrorMsg(absentError.message);
      return;
    }
    const rows = (absentData ?? []) as unknown as {
      alt_type: TrainingType;
      menu: { date: string } | null;
    }[];
    setCalendarAbsentLogs(
      rows
        .filter(
          (r) => r.menu && r.menu.date >= rangeStart && r.menu.date <= rangeEnd
        )
        .map((r) => ({ date: r.menu!.date, type: r.alt_type }))
    );
  }

  async function loadRecordDates() {
    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("date")
      .eq("author_id", memberId);
    if (logError) {
      setErrorMsg(logError.message);
      return;
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", memberId)
      .eq("kind", "absent")
      .not("alt_type", "is", null);
    if (absentError) {
      setErrorMsg(absentError.message);
      return;
    }

    const dateSet = new Set<string>();
    for (const row of (logData ?? []) as { date: string }[]) {
      dateSet.add(row.date);
    }
    const absentRows = (absentData ?? []) as unknown as {
      alt_type: TrainingType;
      menu: { date: string } | null;
    }[];
    for (const row of absentRows) {
      if (row.menu) dateSet.add(row.menu.date);
    }
    setRecordDates(Array.from(dateSet).sort());
  }

  async function loadDateRecord(dateStr: string) {
    setLoadingPopupRecord(true);

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("id, date, content, type")
      .eq("author_id", memberId)
      .eq("date", dateStr)
      .maybeSingle();

    if (logError) {
      setErrorMsg(logError.message);
      setPopupRecord(null);
      setLoadingPopupRecord(false);
      return;
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("id, text, alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", memberId)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (absentError) {
      setErrorMsg(absentError.message);
      setPopupRecord(null);
      setLoadingPopupRecord(false);
      return;
    }

    const absentRows = (absentData ?? []) as unknown as {
      id: string;
      text: string;
      alt_type: TrainingType;
      menu: { date: string } | null;
    }[];
    const match = absentRows.find((r) => r.menu && r.menu.date === dateStr);

    const records: PopupRecordRow[] = [];
    if (logData) {
      const row = logData as WeightLogRow;
      records.push({
        date: row.date,
        content: row.content,
        type: row.type,
        isAlternative: false,
      });
    }
    if (match) {
      records.push({
        date: dateStr,
        content: match.text,
        type: match.alt_type,
        isAlternative: true,
      });
    }

    setPopupRecord(records.length > 0 ? records : null);
    setLoadingPopupRecord(false);
  }

  function handleSelectCalendarDate(dateStr: string) {
    setSelectedCalendarDate(dateStr);
    loadDateRecord(dateStr);
  }

  function handleCloseCalendarPopup() {
    setSelectedCalendarDate(null);
    setPopupRecord(undefined);
  }

  function handleShiftCalendarDate(direction: 1 | -1) {
    if (!selectedCalendarDate) return;
    const target =
      direction === 1
        ? recordDates.find((d) => d > selectedCalendarDate)
        : [...recordDates].reverse().find((d) => d < selectedCalendarDate);
    if (!target) return;

    setSelectedCalendarDate(target);
    loadDateRecord(target);
    const [y, m] = target.split("-").map(Number);
    if (
      y !== calendarCursor.getFullYear() ||
      m - 1 !== calendarCursor.getMonth()
    ) {
      setCalendarCursor(new Date(y, m - 1, 1));
    }
  }

  if (member === undefined) {
    return <div className="p-6 text-sm text-neutral-400">読み込み中…</div>;
  }

  if (member === null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 p-6 text-center text-neutral-900">
        <p className="text-sm text-neutral-500">
          この部員は見つかりませんでした。
        </p>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm active:bg-neutral-100"
        >
          チームページに戻る
        </button>
      </div>
    );
  }

  const gradeLabel =
    member.entry_year != null ? `${currentGrade(member.entry_year)}年` : null;
  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">
          {member.display_name}のマイページ
        </h1>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-neutral-300 px-2.5 py-1.5 text-[11px] text-neutral-500 active:bg-neutral-100"
        >
          チームページに戻る
        </button>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          {gradeLabel && (
            <span className="rounded bg-neutral-100 px-2 py-1">
              {gradeLabel}
            </span>
          )}
          {member.home_location && (
            <span className="rounded bg-neutral-100 px-2 py-1">
              {locationLabel[member.home_location]}
            </span>
          )}
          <span className="rounded bg-neutral-100 px-2 py-1">
            {roleLabel[member.role]}
          </span>
        </div>

        {/* 次の試合 */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">次の試合</h2>
          {loadingMatch ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : nextMatch ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-xs text-red-500">
                次の試合【{nextMatch.name}】まで
              </p>
              <p className="text-2xl font-bold text-red-600">
                あと{matchDays}日
              </p>
              <p className="text-xs text-red-400">
                {formatMonthDay(nextMatch.date)}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              登録されている試合はありません。
            </p>
          )}
        </section>

        {/* 直近のトレーニング記録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            直近のトレーニング記録
          </h2>
          {loadingRecentLogs ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : recentLogs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              トレーニング記録がありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recentLogs.map((log) => (
                <li
                  key={log.id}
                  className="rounded-lg border border-neutral-200 p-3"
                >
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-500">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[log.type]}`}
                    />
                    {formatMonthDay(log.date)}・{trainingTypeLabel[log.type]}
                    {log.isAlternative && (
                      <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                        代替メニュー
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">
                    {log.content}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* トレーニングカレンダー */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            トレーニングカレンダー
          </h2>
          <div className="relative">
            <MemberTrainingCalendar
              cursor={calendarCursor}
              onCursorChange={setCalendarCursor}
              weightLogs={calendarWeightLogs}
              absentLogs={calendarAbsentLogs}
              onSelectDate={handleSelectCalendarDate}
              highlightDate={selectedCalendarDate}
            />
            {selectedCalendarDate && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center p-2"
                onClick={handleCloseCalendarPopup}
              >
                <div
                  className="relative max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-neutral-300 bg-white p-4 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleCloseCalendarPopup}
                    aria-label="閉じる"
                    className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-400 shadow active:bg-neutral-100"
                  >
                    ✕
                  </button>
                  {recordDates.some((d) => d < selectedCalendarDate) && (
                    <button
                      onClick={() => handleShiftCalendarDate(-1)}
                      aria-label="前の記録"
                      className="absolute left-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm text-neutral-500 shadow active:bg-neutral-100"
                    >
                      ◀
                    </button>
                  )}
                  {recordDates.some((d) => d > selectedCalendarDate) && (
                    <button
                      onClick={() => handleShiftCalendarDate(1)}
                      aria-label="次の記録"
                      className="absolute right-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm text-neutral-500 shadow active:bg-neutral-100"
                    >
                      ▶
                    </button>
                  )}

                  {loadingPopupRecord ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      読み込み中…
                    </p>
                  ) : popupRecord === null ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      {formatMonthDay(selectedCalendarDate)}
                      のトレーニング記録はありません
                    </p>
                  ) : popupRecord ? (
                    <div className="flex max-h-80 flex-col gap-4 overflow-y-auto pr-4">
                      {popupRecord.map((r, idx) => (
                        <div
                          key={idx}
                          className={
                            idx > 0
                              ? "border-t border-neutral-100 pt-4"
                              : undefined
                          }
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-500">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[r.type]}`}
                            />
                            {formatMonthDay(r.date)}・
                            {trainingTypeLabel[r.type]}
                            {r.isAlternative && (
                              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                                代替メニュー
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-neutral-800">
                            {r.content || "(記録なし)"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">目標</h2>
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
            準備中です。
          </p>
        </section>
      </div>
    </div>
  );
}

function MemberTrainingCalendar({
  cursor,
  onCursorChange,
  weightLogs,
  absentLogs,
  onSelectDate,
  highlightDate,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  weightLogs: { date: string; type: TrainingType }[];
  absentLogs: { date: string; type: TrainingType }[];
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
}) {
  const dotsByDate = new Map<string, TrainingType[]>();
  for (const row of [...weightLogs, ...absentLogs]) {
    const list = dotsByDate.get(row.date) ?? [];
    list.push(row.type);
    dotsByDate.set(row.date, list);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-sm text-neutral-500 active:bg-neutral-100"
        >
          {"<"}
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-2 py-1 text-sm text-neutral-500 active:bg-neutral-100"
        >
          {">"}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = toDateKey(date);
          const dots = dotsByDate.get(key) ?? [];
          const isHighlighted = key === highlightDate;
          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs active:bg-neutral-100 ${
                isHighlighted
                  ? "bg-amber-50 font-bold text-amber-700 ring-2 ring-amber-400"
                  : "text-neutral-600"
              }`}
            >
              <span>{date.getDate()}</span>
              {dots.length > 0 && (
                <span className="flex flex-wrap justify-center gap-0.5">
                  {dots.map((t, idx) => (
                    <span
                      key={idx}
                      className={`inline-block rounded-full ${trainingTypeDotColor[t]} ${
                        isHighlighted
                          ? "h-2.5 w-2.5 ring-2 ring-amber-300 ring-offset-1"
                          : "h-1.5 w-1.5"
                      }`}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
        {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[t]}`}
            />
            {trainingTypeLabel[t]}
          </span>
        ))}
      </p>
    </div>
  );
}
