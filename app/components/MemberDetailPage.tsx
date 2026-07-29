"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  getTitleColor,
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
  title: string | null;
};

type RecentRecord = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
  isAlternative: boolean;
};

type PopupRecordRow = {
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
  isAlternative: boolean;
};

type MenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_off: boolean;
};

function isReportOpen(menu: MenuRow): boolean {
  if (!menu.start_time) return true;
  const threshold = new Date(`${menu.date}T${menu.start_time}`);
  return new Date() >= threshold;
}

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

  const [todoMenus, setTodoMenus] = useState<MenuRow[]>([]);
  const [loadingTodo, setLoadingTodo] = useState(true);

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calendarWeightLogs, setCalendarWeightLogs] = useState<
    { date: string; type: TrainingType; title: string | null }[]
  >([]);
  const [calendarAbsentLogs, setCalendarAbsentLogs] = useState<
    { date: string; type: TrainingType; title: string | null }[]
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
    loadTodo();
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

  async function loadTodo() {
    if (!member || !member.home_location) {
      setLoadingTodo(false);
      return;
    }
    setLoadingTodo(true);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const rangeStart = toDateKey(twoWeeksAgo);
    const todayStr = toDateKey(new Date());

    const { data: ownMenuData, error: ownMenuError } = await supabase
      .from("menus")
      .select("id, date, title, content, location, start_time, is_off")
      .eq("team_id", profile.team_id)
      .eq("location", member.home_location)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (ownMenuError) {
      setErrorMsg(ownMenuError.message);
      setLoadingTodo(false);
      return;
    }

    const { data: jointMenuData, error: jointMenuError } = await supabase
      .from("menus")
      .select("id, date, title, content, location, start_time, is_off")
      .eq("team_id", profile.team_id)
      .eq("is_joint", true)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (jointMenuError) {
      setErrorMsg(jointMenuError.message);
      setLoadingTodo(false);
      return;
    }

    const menuMap = new Map<string, MenuRow>();
    for (const m of (ownMenuData ?? []) as unknown as MenuRow[]) {
      menuMap.set(m.id, m);
    }
    for (const m of (jointMenuData ?? []) as unknown as MenuRow[]) {
      menuMap.set(m.id, m);
    }
    const menus = Array.from(menuMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    const openMenus = menus.filter((m) => isReportOpen(m));

    if (openMenus.length === 0) {
      setTodoMenus([]);
      setLoadingTodo(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, kind")
      .eq("author_id", memberId)
      .in(
        "menu_id",
        openMenus.map((m) => m.id)
      )
      .in("kind", ["report", "absent"]);

    if (commentError) {
      setErrorMsg(commentError.message);
      setLoadingTodo(false);
      return;
    }

    const respondedIds = new Set(
      ((commentData ?? []) as { menu_id: string }[]).map((c) => c.menu_id)
    );
    setTodoMenus(openMenus.filter((m) => !respondedIds.has(m.id)));
    setLoadingTodo(false);
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
      .select("id, date, content, type, title")
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
      title: l.title,
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
        title: null,
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
      .select("date, type, title")
      .eq("author_id", memberId)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (logError) {
      setErrorMsg(logError.message);
    } else {
      setCalendarWeightLogs(
        (logData ?? []) as {
          date: string;
          type: TrainingType;
          title: string | null;
        }[]
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
        .map((r) => ({ date: r.menu!.date, type: r.alt_type, title: null }))
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
      .select("id, date, content, type, title")
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
        title: row.title,
        isAlternative: false,
      });
    }
    if (match) {
      records.push({
        date: dateStr,
        content: match.text,
        type: match.alt_type,
        title: null,
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
    return <div className="p-6 text-sm text-neutral-500">読み込み中…</div>;
  }

  if (member === null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-3 bg-neutral-950 p-6 text-center text-neutral-200">
        <p className="text-sm text-neutral-400">
          この部員は見つかりませんでした。
        </p>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm active:bg-neutral-800"
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
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          {member.display_name}のマイページ
        </h1>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-400 active:bg-neutral-800"
        >
          チームページに戻る
        </button>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          {gradeLabel && (
            <span className="rounded bg-neutral-800 px-2 py-1">
              {gradeLabel}
            </span>
          )}
          {member.home_location && (
            <span className="rounded bg-neutral-800 px-2 py-1">
              {locationLabel[member.home_location]}
            </span>
          )}
          <span className="rounded bg-neutral-800 px-2 py-1">
            {roleLabel[member.role]}
          </span>
        </div>

        {/* 次の試合 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            次の試合
          </h2>
          {loadingMatch ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : nextMatch ? (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-center">
              <p className="text-xs text-red-500">
                次の試合【{nextMatch.name}】まで
              </p>
              <p className="text-2xl font-bold text-red-400">
                あと{matchDays}日
              </p>
              <p className="text-xs text-red-400">
                {formatMonthDay(nextMatch.date)}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              登録されている試合はありません。
            </p>
          )}
        </section>

        {/* タスク一覧 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            タスク一覧
          </h2>
          <p className="text-[11px] text-neutral-500">
            閲覧専用です。ここから編集や提出はできません。
          </p>
          {!member.home_location ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              所属拠点が設定されていません。
            </p>
          ) : loadingTodo ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : todoMenus.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              未報告の練習メニューはありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todoMenus.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col rounded-lg border border-amber-200 bg-amber-950/40 p-3 text-left text-sm"
                >
                  <span className="text-[11px] text-amber-400">
                    {locationLabel[m.location]}・実施報告 未提出
                  </span>
                  <span className="font-medium text-neutral-100">
                    {m.title || formatMonthDay(m.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 直近のトレーニング記録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            直近のトレーニング記録
          </h2>
          {loadingRecentLogs ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : recentLogs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              トレーニング記録がありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recentLogs.map((log) => {
                const titleColor = log.title ? getTitleColor(log.title) : null;
                return (
                  <li
                    key={log.id}
                    className={`rounded-lg p-3 ${
                      titleColor ? titleColor.fill : "border border-neutral-800"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-400">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[log.type]}`}
                      />
                      {formatMonthDay(log.date)}・{trainingTypeLabel[log.type]}
                      {log.title && (
                        <span
                          className={`rounded bg-neutral-900/60 px-1.5 py-0.5 text-[10px] font-medium ${titleColor?.text}`}
                        >
                          {log.title}
                        </span>
                      )}
                      {log.isAlternative && (
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                          代替メニュー
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-100">
                      {log.content}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 記録カレンダー */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            記録カレンダー
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
                  className="relative max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleCloseCalendarPopup}
                    aria-label="閉じる"
                    className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-neutral-500 shadow active:bg-neutral-800"
                  >
                    ✕
                  </button>
                  {recordDates.some((d) => d < selectedCalendarDate) && (
                    <button
                      onClick={() => handleShiftCalendarDate(-1)}
                      aria-label="前の記録"
                      className="absolute left-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-sm text-neutral-400 shadow active:bg-neutral-800"
                    >
                      ◀
                    </button>
                  )}
                  {recordDates.some((d) => d > selectedCalendarDate) && (
                    <button
                      onClick={() => handleShiftCalendarDate(1)}
                      aria-label="次の記録"
                      className="absolute right-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-sm text-neutral-400 shadow active:bg-neutral-800"
                    >
                      ▶
                    </button>
                  )}

                  {loadingPopupRecord ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
                      読み込み中…
                    </p>
                  ) : popupRecord === null ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
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
                              ? "border-t border-neutral-800 pt-4"
                              : undefined
                          }
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-neutral-400">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[r.type]}`}
                            />
                            {formatMonthDay(r.date)}・
                            {trainingTypeLabel[r.type]}
                            {r.title && (
                              <span
                                className={`rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium ${getTitleColor(r.title).text}`}
                              >
                                {r.title}
                              </span>
                            )}
                            {r.isAlternative && (
                              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                                代替メニュー
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-neutral-100">
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

        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            目標
          </h2>
          <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
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
  weightLogs: { date: string; type: TrainingType; title: string | null }[];
  absentLogs: { date: string; type: TrainingType; title: string | null }[];
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
}) {
  const dotsByDate = new Map<string, TrainingType[]>();
  const titleByDate = new Map<string, string>();
  for (const row of [...weightLogs, ...absentLogs]) {
    const list = dotsByDate.get(row.date) ?? [];
    list.push(row.type);
    dotsByDate.set(row.date, list);
    if (row.title && !titleByDate.has(row.date)) {
      titleByDate.set(row.date, row.title);
    }
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
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-sm text-neutral-400 active:bg-neutral-800"
        >
          {"<"}
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-2 py-1 text-sm text-neutral-400 active:bg-neutral-800"
        >
          {">"}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
        {["日", "月", "火", "水", "木", "金", "土"].map((w, idx) => (
          <div
            key={w}
            className={
              idx === 0
                ? "font-semibold text-red-400"
                : idx === 6
                  ? "font-semibold text-blue-400"
                  : "text-neutral-500"
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
          const dots = dotsByDate.get(key) ?? [];
          const title = titleByDate.get(key);
          const titleColor = title ? getTitleColor(title) : null;
          const isHighlighted = key === highlightDate;
          const weekday = date.getDay();
          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`flex min-h-[56px] flex-col items-center justify-start gap-0.5 rounded-lg border border-neutral-700 pt-1 text-xs active:bg-neutral-700 ${
                isHighlighted
                  ? "bg-amber-950/40 font-bold text-amber-400 ring-2 ring-amber-400"
                  : titleColor
                    ? `${titleColor.fill} text-neutral-200`
                    : "bg-neutral-800 text-neutral-300"
              }`}
              title={title ?? undefined}
            >
              <span
                className={
                  !isHighlighted && !titleColor
                    ? weekday === 0
                      ? "border-b-2 border-red-500 px-1 text-red-400"
                      : weekday === 6
                        ? "border-b-2 border-blue-500 px-1 text-blue-400"
                        : ""
                    : ""
                }
              >
                {date.getDate()}
              </span>
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
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
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
