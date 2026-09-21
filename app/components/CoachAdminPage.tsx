"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  SessionType,
  TrainingType,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";
import { useCalendarViewPref } from "./shell/CalendarViewPrefProvider";
import { useSubNav } from "./shell/AppShell";
import SubTabBar from "./shell/SubTabBar";

const adminSubTabItems: {
  value: "submissions" | "training" | "injuries";
  label: string;
}[] = [
  { value: "submissions", label: "日報" },
  { value: "training", label: "トレーニング" },
  { value: "injuries", label: "怪我" },
];

type MemberRoleForEdit = "coach" | "captain" | "vice_captain" | "leader" | "vice_leader" | "manager" | "member" | "ob";

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
  role: MemberRoleForEdit;
  isPending?: boolean;
};

// member_rosterテーブルのroleカラムに入り得る値
type RosterRoleForMember = "captain" | "vice_captain" | "coach" | "member";

type InjuryRow = {
  id: string;
  author_id: string;
  symptom_name: string;
  body_part: string;
  detail: string | null;
  expected_recovery_date: string | null;
  surgery_possibility: "yes" | "no" | "unknown";
  next_hospital_date: string | null;
  mat_participation: "yes" | "no" | "conditional";
  mat_participation_detail: string | null;
  is_recovered: boolean;
  progress_note: string | null;
  progress_updated_at: string | null;
  created_at: string;
  author: { display_name: string } | null;
};

const matParticipationLabel: Record<"yes" | "no" | "conditional", string> = {
  yes: "可",
  no: "非",
  conditional: "条件付きで可",
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 合宿/試合/出稽古バッジ配色（ライト/ダーク両対応）
const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-400",
  match: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  away: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
};

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function groupDetailByGrade<T extends { entryYear: number | null }>(
  rows: T[]
): { label: string; rows: T[] }[] {
  const groups = new Map<number | null, T[]>();
  for (const r of rows) {
    const grade = r.entryYear != null ? currentGrade(r.entryYear) : null;
    const list = groups.get(grade) ?? [];
    list.push(r);
    groups.set(grade, list);
  }

  const knownGrades = Array.from(groups.keys())
    .filter((g): g is number => g !== null)
    .sort((a, b) => b - a);

  const result = knownGrades.map((grade) => ({
    label: `${grade}年`,
    rows: groups.get(grade)!,
  }));

  if (groups.has(null)) {
    result.push({ label: "学年未設定", rows: groups.get(null)! });
  }

  return result;
}

function ReportCalendar({
  cursor,
  onCursorChange,
  loading,
  submissionCounts,
  reportDayInfo,
  selectedReportDate,
  onSelectDate,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  loading: boolean;
  submissionCounts: Map<string, { submitted: number; total: number }>;
  reportDayInfo: Map<
    string,
    { isFullyOff: boolean; dayType: DayType; eventName: string | null }
  >;
  selectedReportDate: string;
  onSelectDate: (dateStr: string) => void;
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

  // 週表示に切り替わったタイミングで、選択中の日付（なければ今日）を含む週が
  // まだ表示されていなければ、その週にジャンプする
  // （月表示→週表示の切り替え・初期表示が週表示の場合の両方で効く）
  useEffect(() => {
    if (viewMode !== "week") return;
    const targetKey = selectedReportDate || toDateKey(new Date());
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
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-[11px]">
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
      {loading ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-500">読み込み中…</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
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
              const isHighlighted = key === selectedReportDate;
              const isToday = key === toDateKey(new Date());
              const weekday = date.getDay();
              const count = submissionCounts.get(key);
              const dayInfo = reportDayInfo.get(key);
              const isFullySubmitted =
                !!count && count.total > 0 && count.submitted === count.total;
              return (
                <button
                  key={i}
                  onClick={() => onSelectDate(key)}
                  className={`flex ${
                    viewMode === "week" ? "min-h-[88px]" : "min-h-[52px]"
                  } flex-col items-start gap-0.5 rounded-lg border p-1 text-left ${
                    dayInfo?.isFullyOff
                      ? "border-border-color bg-neutral-100 dark:bg-neutral-900"
                      : isFullySubmitted
                        ? "border-emerald-300 bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/60"
                        : isHighlighted
                          ? "border-amber-400 bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-950/40"
                          : isToday
                            ? "border-blue-400 bg-blue-100 ring-1 ring-blue-400 dark:border-blue-600 dark:bg-blue-950/40"
                            : "border-border-color bg-surface-2 active:bg-neutral-200 dark:active:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`text-[11px] font-semibold ${
                      !isHighlighted && !isToday && weekday === 0
                        ? "border-b-2 border-red-500 text-red-500 dark:text-red-400"
                        : !isHighlighted && !isToday && weekday === 6
                          ? "border-b-2 border-blue-500 text-blue-500 dark:text-blue-400"
                          : "text-foreground"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {dayInfo?.isFullyOff ? (
                    <span className="text-[9px] text-neutral-500 dark:text-neutral-500">
                      全体オフ
                    </span>
                  ) : (
                    <>
                      {dayInfo && dayInfo.dayType !== "practice" && (
                        <span
                          className={`max-w-full truncate rounded px-1 text-[9px] font-semibold ${dayTypeFillColorDark[dayInfo.dayType]}`}
                        >
                          {dayInfo.eventName || dayTypeLabel[dayInfo.dayType]}
                        </span>
                      )}
                      {count && (
                        <span
                          className={`text-[9px] font-semibold ${
                            isFullySubmitted
                              ? "text-emerald-600 dark:text-emerald-300"
                              : "text-neutral-600 dark:text-neutral-300"
                          }`}
                        >
                          {count.submitted}/{count.total}人
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500 dark:text-neutral-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-emerald-100 ring-1 ring-emerald-400 dark:bg-emerald-900/60 dark:ring-emerald-700" />
              全員提出済み
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-pink-100 dark:bg-pink-950/40" />
              合宿
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-red-100 dark:bg-red-950/40" />
              試合
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-neutral-200 dark:bg-neutral-900" />
              オフ
            </span>
          </p>
        </>
      )}
    </div>
  );
}

export default function CoachAdminPage({
  profile,
}: {
  profile: Profile;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [members, setMembers] = useState<MemberRow[]>([]);

  // 報告状況一覧（日報・トレ報の提出状況カレンダー）
  const [reportCalendarCursor, setReportCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedReportDate, setSelectedReportDate] = useState<string>(() =>
    toDateKey(new Date())
  );
  const [submissionCounts, setSubmissionCounts] = useState<
    Map<string, { submitted: number; total: number }>
  >(new Map());
  const [submissionCountsByLoc, setSubmissionCountsByLoc] = useState<
    Map<string, Record<Location, { submitted: number; total: number } | null>>
  >(new Map());
  const [reportDayInfo, setReportDayInfo] = useState<
    Map<string, { isFullyOff: boolean; dayType: DayType; eventName: string | null }>
  >(new Map());
  const [loadingSubmissionCounts, setLoadingSubmissionCounts] =
    useState(true);
  const [daySubmissionDetail, setDaySubmissionDetail] = useState<
    {
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
      isPending: boolean;
      matStatus: "not_required" | "not_started" | "report" | "absent" | "missing";
      matText: string | null;
      selfStatus: "not_required" | "not_started" | "done" | "missing";
      selfText: string | null;
    }[]
  >([]);
  const [loadingDaySubmissionDetail, setLoadingDaySubmissionDetail] =
    useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadMembers();
    loadInjuries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthSubmissionCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportCalendarCursor, members]);

  useEffect(() => {
    if (selectedReportDate) loadDaySubmissionDetail(selectedReportDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members]);

  function handleSelectReportDate(dateStr: string) {
    setSelectedReportDate(dateStr);
    loadDaySubmissionDetail(dateStr);
  }

  async function loadInjuries() {
    setLoadingInjuries(true);
    const { data, error } = await supabase
      .from("injuries")
      .select(
        "id, author_id, symptom_name, body_part, detail, expected_recovery_date, surgery_possibility, next_hospital_date, mat_participation, mat_participation_detail, is_recovered, progress_note, progress_updated_at, created_at, author:profiles!injuries_author_id_fkey(display_name)"
      )
      .eq("team_id", profile.team_id)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setInjuries((data ?? []) as unknown as InjuryRow[]);
    }
    setLoadingInjuries(false);
  }

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, entry_year, role")
      .eq("team_id", profile.team_id)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
      setLoadingMembers(false);
      return;
    }

    const realMembers = (data ?? []) as MemberRow[];

    // まだ本人がサインアップしていない「事前登録」の部員も、
    // 参考として一覧に含める（案内中であることが分かるようにする）
    const { data: rosterData, error: rosterError } = await supabase
      .from("member_roster")
      .select("id, display_name, role, home_location, entry_year")
      .eq("team_id", profile.team_id)
      .is("claimed_by", null);

    if (rosterError) {
      setErrorMsg(rosterError.message);
      setMembers(realMembers);
      setLoadingMembers(false);
      return;
    }

    const pendingMembers: MemberRow[] = (
      (rosterData ?? []) as {
        id: string;
        display_name: string;
        role: RosterRoleForMember;
        home_location: Location | null;
        entry_year: number | null;
      }[]
    ).map((r) => ({
      id: `pending:${r.id}`,
      display_name: r.display_name,
      role: (r.role === "vice_captain" ? "vice_leader" : r.role) as MemberRoleForEdit,
      home_location: r.home_location,
      entry_year: r.entry_year,
      isPending: true,
    }));

    setMembers(
      [...realMembers, ...pendingMembers].sort((a, b) =>
        a.display_name.localeCompare(b.display_name, "ja")
      )
    );
    setLoadingMembers(false);
  }

  function requiredMembersForLocation(loc: Location): MemberRow[] {
    return members.filter(
      (m) =>
        m.role !== "coach" &&
        m.role !== "manager" &&
        m.role !== "ob" &&
        (m.home_location === loc || (loc === "tama" && m.home_location == null))
    );
  }

  // カレンダー全体（表示中の月・拠点）の日ごとの提出状況（◯人／◯人）を集計する
  async function loadMonthSubmissionCounts() {
    setLoadingSubmissionCounts(true);
    const year = reportCalendarCursor.getFullYear();
    const month = reportCalendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const requiredByLoc: Record<Location, MemberRow[]> = {
      tama: requiredMembersForLocation("tama"),
      otsuka: requiredMembersForLocation("otsuka"),
    };
    const realIdsByLoc: Record<Location, string[]> = {
      tama: requiredByLoc.tama.filter((m) => !m.isPending).map((m) => m.id),
      otsuka: requiredByLoc.otsuka.filter((m) => !m.isPending).map((m) => m.id),
    };

    if (requiredByLoc.tama.length === 0 && requiredByLoc.otsuka.length === 0) {
      setSubmissionCounts(new Map());
      setSubmissionCountsByLoc(new Map());
      setReportDayInfo(new Map());
      setLoadingSubmissionCounts(false);
      return;
    }

    // 両拠点のスケジュール（オフ・区分・セッション種別）を取得
    const { data: scheduleData, error: scheduleErrorAll } = await supabase
      .from("schedule_days")
      .select(
        "date, location, is_off, day_type, event_name, sessions:schedule_sessions(session_type)"
      )
      .eq("team_id", profile.team_id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (scheduleErrorAll) {
      setErrorMsg(scheduleErrorAll.message);
      setLoadingSubmissionCounts(false);
      return;
    }

    const scheduleByLocDate = new Map<
      string,
      { isOff: boolean; hasMat: boolean; hasNonMat: boolean }
    >();
    const dayInfoByDate = new Map<
      string,
      { isFullyOff: boolean; dayType: DayType; eventName: string | null }
    >();
    const dayTypePriority: Record<DayType, number> = {
      match: 3,
      camp: 2,
      away: 1,
      practice: 0,
    };
    for (const row of (scheduleData ?? []) as unknown as {
      date: string;
      location: Location;
      is_off: boolean;
      day_type: DayType;
      event_name: string | null;
      sessions: { session_type: SessionType }[];
    }[]) {
      scheduleByLocDate.set(`${row.location}:${row.date}`, {
        isOff: row.is_off,
        hasMat: row.sessions.some((s) => s.session_type === "mat"),
        hasNonMat: row.sessions.some((s) => s.session_type !== "mat"),
      });

      const existing = dayInfoByDate.get(row.date);
      const isFullyOff = existing
        ? existing.isFullyOff && row.is_off
        : row.is_off;
      const useThisRow =
        !existing ||
        dayTypePriority[row.day_type] > dayTypePriority[existing.dayType];
      dayInfoByDate.set(row.date, {
        isFullyOff,
        dayType: useThisRow ? row.day_type : existing!.dayType,
        eventName: useThisRow ? row.event_name : existing!.eventName,
      });
    }
    setReportDayInfo(dayInfoByDate);

    // 両拠点＋全体のマットメニュー
    const { data: menuData, error: menuError } = await supabase
      .from("menus")
      .select("id, date, location, is_joint")
      .eq("team_id", profile.team_id)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (menuError) {
      setErrorMsg(menuError.message);
      setLoadingSubmissionCounts(false);
      return;
    }

    // menu_id -> その日報が「どの拠点の必要提出」に関係するか
    const menuLocsById = new Map<string, Location[]>();
    const menuDateById = new Map<string, string>();
    for (const m of (menuData ?? []) as {
      id: string;
      date: string;
      location: Location;
      is_joint: boolean;
    }[]) {
      menuDateById.set(m.id, m.date);
      menuLocsById.set(m.id, m.is_joint ? ["tama", "otsuka"] : [m.location]);
    }
    const allMenuIds = Array.from(menuDateById.keys());

    // key: `${authorId}:${loc}:${date}`
    const submittedMatKeys = new Set<string>();
    if (allMenuIds.length > 0) {
      const { data: commentData, error: commentError } = await supabase
        .from("comments")
        .select("menu_id, author_id, kind")
        .in("menu_id", allMenuIds)
        .in("kind", ["report", "absent"])
        .is("parent_id", null);
      if (commentError) {
        setErrorMsg(commentError.message);
        setLoadingSubmissionCounts(false);
        return;
      }
      for (const row of (commentData ?? []) as {
        menu_id: string;
        author_id: string | null;
      }[]) {
        if (!row.author_id) continue;
        const date = menuDateById.get(row.menu_id);
        const locs = menuLocsById.get(row.menu_id) ?? [];
        if (!date) continue;
        for (const loc of locs) {
          submittedMatKeys.add(`${row.author_id}:${loc}:${date}`);
        }
      }
    }

    const allRealIds = [...realIdsByLoc.tama, ...realIdsByLoc.otsuka];
    const selfLoggedKeys = new Set<string>();
    if (allRealIds.length > 0) {
      const { data: logData, error: logError } = await supabase
        .from("weight_logs")
        .select("author_id, date")
        .in("author_id", allRealIds)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (logError) {
        setErrorMsg(logError.message);
        setLoadingSubmissionCounts(false);
        return;
      }
      for (const row of (logData ?? []) as {
        author_id: string;
        date: string;
      }[]) {
        selfLoggedKeys.add(`${row.author_id}:${row.date}`);
      }
    }

    const counts = new Map<string, { submitted: number; total: number }>();
    const countsByLoc = new Map<
      string,
      Record<Location, { submitted: number; total: number } | null>
    >();
    const cursor = new Date(year, month, 1);
    while (cursor.getMonth() === month) {
      const dateKey = toDateKey(cursor);
      let submitted = 0;
      let total = 0;
      const byLoc: Record<Location, { submitted: number; total: number } | null> =
        { tama: null, otsuka: null };
      for (const loc of ["tama", "otsuka"] as Location[]) {
        const day = scheduleByLocDate.get(`${loc}:${dateKey}`);
        if (!day || day.isOff) continue;
        if (!day.hasMat && !day.hasNonMat) continue;
        const locTotal = requiredByLoc[loc].length;
        let locSubmitted = 0;
        for (const id of realIdsByLoc[loc]) {
          const matOk =
            !day.hasMat || submittedMatKeys.has(`${id}:${loc}:${dateKey}`);
          const selfOk = !day.hasNonMat || selfLoggedKeys.has(`${id}:${dateKey}`);
          if (matOk && selfOk) locSubmitted++;
        }
        byLoc[loc] = { submitted: locSubmitted, total: locTotal };
        total += locTotal;
        submitted += locSubmitted;
      }
      if (total > 0) counts.set(dateKey, { submitted, total });
      countsByLoc.set(dateKey, byLoc);
      cursor.setDate(cursor.getDate() + 1);
    }
    setSubmissionCounts(counts);
    setSubmissionCountsByLoc(countsByLoc);
    setLoadingSubmissionCounts(false);
  }

  // 選択した日の、部員ごとの提出状況の詳細一覧を読み込む
  async function loadDaySubmissionDetail(dateStr: string) {
    setLoadingDaySubmissionDetail(true);

    const { data: scheduleData } = await supabase
      .from("schedule_days")
      .select(
        "location, is_off, sessions:schedule_sessions(session_type, start_time)"
      )
      .eq("team_id", profile.team_id)
      .eq("date", dateStr);

    const now = new Date();
    const scheduleByLoc = new Map<
      Location,
      {
        isOff: boolean;
        hasMat: boolean;
        hasNonMat: boolean;
        matStarted: boolean;
        selfStarted: boolean;
      }
    >();
    for (const row of (scheduleData ?? []) as unknown as {
      location: Location;
      is_off: boolean;
      sessions: { session_type: SessionType; start_time: string }[];
    }[]) {
      const matSession = row.sessions.find((s) => s.session_type === "mat");
      const nonMatSessions = row.sessions.filter(
        (s) => s.session_type !== "mat"
      );
      const earliestNonMat = nonMatSessions
        .map((s) => s.start_time)
        .sort()[0];
      scheduleByLoc.set(row.location, {
        isOff: row.is_off,
        hasMat: !!matSession,
        hasNonMat: nonMatSessions.length > 0,
        matStarted: matSession
          ? now >= new Date(`${dateStr}T${matSession.start_time}`)
          : true,
        selfStarted: earliestNonMat
          ? now >= new Date(`${dateStr}T${earliestNonMat}`)
          : true,
      });
    }

    const { data: menuData } = await supabase
      .from("menus")
      .select("id, location, is_joint")
      .eq("team_id", profile.team_id)
      .eq("date", dateStr)
      .eq("is_off", false);
    const menuRows = (menuData ?? []) as {
      id: string;
      location: Location;
      is_joint: boolean;
    }[];
    const menuIds = menuRows.map((m) => m.id);
    const menuLocsById = new Map<string, Location[]>();
    for (const m of menuRows) {
      menuLocsById.set(m.id, m.is_joint ? ["tama", "otsuka"] : [m.location]);
    }

    // key: `${authorId}:${loc}`
    const matStatusByAuthorLoc = new Map<string, { kind: string; text: string }>();
    if (menuIds.length > 0) {
      const { data: commentData } = await supabase
        .from("comments")
        .select("author_id, kind, text, menu_id")
        .in("menu_id", menuIds)
        .in("kind", ["report", "absent"])
        .is("parent_id", null);
      for (const row of (commentData ?? []) as {
        author_id: string | null;
        kind: string;
        text: string;
        menu_id: string;
      }[]) {
        if (!row.author_id) continue;
        const locs = menuLocsById.get(row.menu_id) ?? [];
        for (const loc of locs) {
          matStatusByAuthorLoc.set(`${row.author_id}:${loc}`, {
            kind: row.kind,
            text: row.text,
          });
        }
      }
    }

    const requiredByLoc: Record<Location, MemberRow[]> = {
      tama: requiredMembersForLocation("tama"),
      otsuka: requiredMembersForLocation("otsuka"),
    };
    const allRealIds = [
      ...requiredByLoc.tama.filter((m) => !m.isPending).map((m) => m.id),
      ...requiredByLoc.otsuka.filter((m) => !m.isPending).map((m) => m.id),
    ];
    let selfLogByAuthor = new Map<string, string>();
    if (allRealIds.length > 0) {
      const { data: logData } = await supabase
        .from("weight_logs")
        .select("author_id, content")
        .eq("date", dateStr)
        .in("author_id", allRealIds);
      for (const row of (logData ?? []) as {
        author_id: string;
        content: string;
      }[]) {
        selfLogByAuthor.set(row.author_id, row.content);
      }
    }

    const detail: {
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
      isPending: boolean;
      matStatus: "not_required" | "not_started" | "report" | "absent" | "missing";
      matText: string | null;
      selfStatus: "not_required" | "not_started" | "done" | "missing";
      selfText: string | null;
    }[] = [];

    for (const loc of ["tama", "otsuka"] as Location[]) {
      const day = scheduleByLoc.get(loc);
      const hasMat = !!day && !day.isOff && day.hasMat;
      const hasNonMat = !!day && !day.isOff && day.hasNonMat;
      if (!day || day.isOff || (!hasMat && !hasNonMat)) continue;

      for (const m of requiredByLoc[loc]) {
        const matComment = matStatusByAuthorLoc.get(`${m.id}:${loc}`);
        const selfContent = selfLogByAuthor.get(m.id);
        detail.push({
          memberId: m.id,
          displayName: m.display_name,
          location: loc,
          entryYear: m.entry_year,
          isPending: !!m.isPending,
          matStatus: !hasMat
            ? ("not_required" as const)
            : !day.matStarted
              ? ("not_started" as const)
              : matComment
                ? matComment.kind === "absent"
                  ? ("absent" as const)
                  : ("report" as const)
                : ("missing" as const),
          matText: matComment?.text ?? null,
          selfStatus: !hasNonMat
            ? ("not_required" as const)
            : !day.selfStarted
              ? ("not_started" as const)
              : selfContent
                ? ("done" as const)
                : ("missing" as const),
          selfText: selfContent ?? null,
        });
      }
    }

    detail.sort((a, b) => {
      if (a.location !== b.location) return a.location.localeCompare(b.location);
      return a.displayName.localeCompare(b.displayName, "ja");
    });

    setDaySubmissionDetail(detail);
    setLoadingDaySubmissionDetail(false);
  }


  // トレーニング（マット以外のセッション）の提出状況
  const [trainingCalendarCursor, setTrainingCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedTrainingDate, setSelectedTrainingDate] = useState<string>(
    () => toDateKey(new Date())
  );
  const [trainingCounts, setTrainingCounts] = useState<
    Map<string, { submitted: number; total: number }>
  >(new Map());
  const [trainingDayInfo, setTrainingDayInfo] = useState<
    Map<string, { isFullyOff: boolean; dayType: DayType; eventName: string | null }>
  >(new Map());
  const [loadingTrainingCounts, setLoadingTrainingCounts] = useState(true);
  const [trainingDayDetail, setTrainingDayDetail] = useState<{
    missing: {
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
    }[];
    submitted: {
      id: string;
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
      type: TrainingType;
      title: string | null;
      content: string;
    }[];
  }>({ missing: [], submitted: [] });
  const [loadingTrainingDayDetail, setLoadingTrainingDayDetail] =
    useState(false);
  const [expandedTrainingIds, setExpandedTrainingIds] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    loadTrainingMonthCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainingCalendarCursor, members]);

  useEffect(() => {
    if (selectedTrainingDate) loadTrainingDayDetail(selectedTrainingDate);
    setExpandedTrainingIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, selectedTrainingDate]);

  function handleSelectTrainingDate(dateStr: string) {
    setSelectedTrainingDate(dateStr);
  }

  // カレンダー全体（表示中の月）の日ごとのトレーニング提出状況（◯人／◯人）を集計する
  async function loadTrainingMonthCounts() {
    setLoadingTrainingCounts(true);
    const year = trainingCalendarCursor.getFullYear();
    const month = trainingCalendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const requiredByLoc: Record<Location, MemberRow[]> = {
      tama: requiredMembersForLocation("tama"),
      otsuka: requiredMembersForLocation("otsuka"),
    };
    const realIdsByLoc: Record<Location, string[]> = {
      tama: requiredByLoc.tama.filter((m) => !m.isPending).map((m) => m.id),
      otsuka: requiredByLoc.otsuka.filter((m) => !m.isPending).map((m) => m.id),
    };

    if (requiredByLoc.tama.length === 0 && requiredByLoc.otsuka.length === 0) {
      setTrainingCounts(new Map());
      setTrainingDayInfo(new Map());
      setLoadingTrainingCounts(false);
      return;
    }

    const { data: scheduleData, error: scheduleError } = await supabase
      .from("schedule_days")
      .select(
        "date, location, is_off, day_type, event_name, sessions:schedule_sessions(session_type)"
      )
      .eq("team_id", profile.team_id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (scheduleError) {
      setErrorMsg(scheduleError.message);
      setLoadingTrainingCounts(false);
      return;
    }

    const scheduleByLocDate = new Map<
      string,
      { isOff: boolean; hasNonMat: boolean }
    >();
    const dayInfoByDate = new Map<
      string,
      { isFullyOff: boolean; dayType: DayType; eventName: string | null }
    >();
    const dayTypePriority: Record<DayType, number> = {
      match: 3,
      camp: 2,
      away: 1,
      practice: 0,
    };
    for (const row of (scheduleData ?? []) as unknown as {
      date: string;
      location: Location;
      is_off: boolean;
      day_type: DayType;
      event_name: string | null;
      sessions: { session_type: SessionType }[];
    }[]) {
      scheduleByLocDate.set(`${row.location}:${row.date}`, {
        isOff: row.is_off,
        hasNonMat: row.sessions.some((s) => s.session_type !== "mat"),
      });

      const existing = dayInfoByDate.get(row.date);
      const isFullyOff = existing
        ? existing.isFullyOff && row.is_off
        : row.is_off;
      const useThisRow =
        !existing ||
        dayTypePriority[row.day_type] > dayTypePriority[existing.dayType];
      dayInfoByDate.set(row.date, {
        isFullyOff,
        dayType: useThisRow ? row.day_type : existing!.dayType,
        eventName: useThisRow ? row.event_name : existing!.eventName,
      });
    }
    setTrainingDayInfo(dayInfoByDate);

    const allRealIds = [...realIdsByLoc.tama, ...realIdsByLoc.otsuka];
    const selfLoggedKeys = new Set<string>();
    if (allRealIds.length > 0) {
      const { data: logData, error: logError } = await supabase
        .from("weight_logs")
        .select("author_id, date")
        .in("author_id", allRealIds)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (logError) {
        setErrorMsg(logError.message);
        setLoadingTrainingCounts(false);
        return;
      }
      for (const row of (logData ?? []) as {
        author_id: string;
        date: string;
      }[]) {
        selfLoggedKeys.add(`${row.author_id}:${row.date}`);
      }
    }

    const counts = new Map<string, { submitted: number; total: number }>();
    const cursor = new Date(year, month, 1);
    while (cursor.getMonth() === month) {
      const dateKey = toDateKey(cursor);
      let submitted = 0;
      let total = 0;
      for (const loc of ["tama", "otsuka"] as Location[]) {
        const day = scheduleByLocDate.get(`${loc}:${dateKey}`);
        if (!day || day.isOff || !day.hasNonMat) continue;
        const ids = realIdsByLoc[loc];
        total += ids.length;
        for (const id of ids) {
          if (selfLoggedKeys.has(`${id}:${dateKey}`)) submitted++;
        }
      }
      if (total > 0) counts.set(dateKey, { submitted, total });
      cursor.setDate(cursor.getDate() + 1);
    }
    setTrainingCounts(counts);
    setLoadingTrainingCounts(false);
  }

  // 選択した日の、トレーニング（マット以外）の提出状況の詳細を読み込む
  async function loadTrainingDayDetail(dateStr: string) {
    setLoadingTrainingDayDetail(true);

    const { data: scheduleData } = await supabase
      .from("schedule_days")
      .select(
        "location, is_off, sessions:schedule_sessions(session_type, start_time)"
      )
      .eq("team_id", profile.team_id)
      .eq("date", dateStr);

    const now = new Date();
    const scheduleByLoc = new Map<
      Location,
      { isOff: boolean; hasNonMat: boolean; selfStarted: boolean }
    >();
    for (const row of (scheduleData ?? []) as unknown as {
      location: Location;
      is_off: boolean;
      sessions: { session_type: SessionType; start_time: string | null }[];
    }[]) {
      const nonMatSessions = row.sessions.filter(
        (s) => s.session_type !== "mat"
      );
      const earliestNonMat = nonMatSessions
        .map((s) => s.start_time)
        .filter((t): t is string => !!t)
        .sort()[0];
      scheduleByLoc.set(row.location, {
        isOff: row.is_off,
        hasNonMat: nonMatSessions.length > 0,
        selfStarted: earliestNonMat
          ? now >= new Date(`${dateStr}T${earliestNonMat}`)
          : true,
      });
    }

    const requiredByLoc: Record<Location, MemberRow[]> = {
      tama: requiredMembersForLocation("tama"),
      otsuka: requiredMembersForLocation("otsuka"),
    };
    const targetLocs = (["tama", "otsuka"] as Location[]).filter((loc) => {
      const day = scheduleByLoc.get(loc);
      return day && !day.isOff && day.hasNonMat;
    });

    if (targetLocs.length === 0) {
      setTrainingDayDetail({ missing: [], submitted: [] });
      setLoadingTrainingDayDetail(false);
      return;
    }

    const targetMembers = targetLocs.flatMap((loc) =>
      requiredByLoc[loc]
        .filter((m) => !m.isPending)
        .map((m) => ({ ...m, location: loc }))
    );
    const targetIds = targetMembers.map((m) => m.id);

    const logByAuthor = new Map<
      string,
      { id: string; type: TrainingType; title: string | null; content: string }
    >();
    if (targetIds.length > 0) {
      const { data: logData, error: logError } = await supabase
        .from("weight_logs")
        .select("id, author_id, type, title, content")
        .eq("date", dateStr)
        .in("author_id", targetIds);
      if (logError) {
        setErrorMsg(logError.message);
        setLoadingTrainingDayDetail(false);
        return;
      }
      for (const row of (logData ?? []) as {
        id: string;
        author_id: string;
        type: TrainingType;
        title: string | null;
        content: string;
      }[]) {
        logByAuthor.set(row.author_id, {
          id: row.id,
          type: row.type,
          title: row.title,
          content: row.content,
        });
      }
    }

    const missing: {
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
    }[] = [];
    const submitted: {
      id: string;
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
      type: TrainingType;
      title: string | null;
      content: string;
    }[] = [];

    for (const m of targetMembers) {
      const day = scheduleByLoc.get(m.location)!;
      const log = logByAuthor.get(m.id);
      if (log) {
        submitted.push({
          id: log.id,
          memberId: m.id,
          displayName: m.display_name,
          location: m.location,
          entryYear: m.entry_year,
          type: log.type,
          title: log.title,
          content: log.content,
        });
      } else if (day.selfStarted) {
        missing.push({
          memberId: m.id,
          displayName: m.display_name,
          location: m.location,
          entryYear: m.entry_year,
        });
      }
    }

    missing.sort(
      (a, b) =>
        a.location.localeCompare(b.location) ||
        a.displayName.localeCompare(b.displayName, "ja")
    );
    submitted.sort(
      (a, b) =>
        a.location.localeCompare(b.location) ||
        a.displayName.localeCompare(b.displayName, "ja")
    );

    setTrainingDayDetail({ missing, submitted });
    setLoadingTrainingDayDetail(false);
  }

  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loadingInjuries, setLoadingInjuries] = useState(true);
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(
    null
  );
  const [showPastInjuries, setShowPastInjuries] = useState(false);

  const [adminSubTab, setAdminSubTab] = useState<
    "submissions" | "training" | "injuries"
  >("submissions");

  // フッター上のサブナビ（提出状況／怪我の報告の切り替え）を登録
  // ※ node は必ず useMemo で安定させること。毎レンダー新しいJSXを渡すと
  //   useSubNav内のuseEffectが依存配列[node]の変化を検知して毎回発火し、
  //   AppShell側の再レンダーとの間で無限ループになりうる。
  const adminSubNav = useMemo(
    () => (
      <SubTabBar
        items={adminSubTabItems}
        active={adminSubTab}
        onChange={setAdminSubTab}
      />
    ),
    [adminSubTab]
  );
  useSubNav(adminSubNav);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col text-neutral-200">
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {adminSubTab === "submissions" && (
        <>
        {/* 日報の提出状況 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            日報の提出状況
          </h2>

          <ReportCalendar
            cursor={reportCalendarCursor}
            onCursorChange={setReportCalendarCursor}
            loading={loadingSubmissionCounts}
            submissionCounts={submissionCounts}
            reportDayInfo={reportDayInfo}
            selectedReportDate={selectedReportDate}
            onSelectDate={handleSelectReportDate}
          />
          {!loadingSubmissionCounts && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(["tama", "otsuka"] as Location[]).map((loc) => {
                const c = submissionCountsByLoc.get(selectedReportDate)?.[loc];
                return (
                  <div
                    key={loc}
                    className="flex items-center justify-between rounded-lg border border-border-color bg-surface px-3 py-2"
                  >
                    <span className="font-medium text-foreground">
                      {locationLabel[loc]}
                    </span>
                    {c ? (
                      <span
                        className={`font-semibold ${
                          c.total > 0 && c.submitted === c.total
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-neutral-600 dark:text-neutral-300"
                        }`}
                      >
                        {c.submitted}/{c.total}人提出
                      </span>
                    ) : (
                      <span className="text-neutral-500 dark:text-neutral-500">
                        該当なし
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <h3 className="text-xs font-semibold text-neutral-300">
            {formatMonthDay(selectedReportDate)}の提出状況
          </h3>
          {loadingDaySubmissionDetail ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : daySubmissionDetail.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              この日は報告が必要なセッションがありません（オフ、または部員が登録されていません）。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {(() => {
                // 学年ごとの区切りが多摩・大塚で縦にずれないよう、両拠点を合わせた
                // 学年一覧を基準に、各拠点の行数の差だけ高さの揃った空白行を
                // 差し込んで、次の学年の開始位置を揃える
                const gradeGroups = groupDetailByGrade(daySubmissionDetail).map(
                  (group) => ({
                    label: group.label,
                    tamaRows: group.rows.filter((d) => d.location === "tama"),
                    otsukaRows: group.rows.filter(
                      (d) => d.location === "otsuka"
                    ),
                  })
                );
                return (["tama", "otsuka"] as Location[]).map((loc) => (
                <div key={loc} className="flex flex-col gap-3">
                  <p className="text-xs font-semibold text-neutral-400">
                    {locationLabel[loc]}
                  </p>
                  {gradeGroups.map((group) => {
                      const rowsForLoc =
                        loc === "tama" ? group.tamaRows : group.otsukaRows;
                      const maxRows = Math.max(
                        group.tamaRows.length,
                        group.otsukaRows.length
                      );
                      return (
                      <div key={group.label} className="flex flex-col gap-1">
                        <p className="text-[10px] text-neutral-500">
                          {group.label}
                        </p>
                        {rowsForLoc.map((d) => {
                          const resolved =
                            d.matStatus === "missing" ||
                            d.matStatus === "report" ||
                            d.matStatus === "absent" ||
                            d.selfStatus === "missing" ||
                            d.selfStatus === "done";
                          const notStarted =
                            !d.isPending &&
                            !resolved &&
                            (d.matStatus === "not_started" ||
                              d.selfStatus === "not_started");
                          const allDone =
                            !d.isPending &&
                            !notStarted &&
                            (d.matStatus === "not_required" ||
                              d.matStatus !== "missing") &&
                            (d.selfStatus === "not_required" ||
                              d.selfStatus === "done");
                          return (
                            <button
                              key={d.memberId}
                              disabled={d.isPending}
                              onClick={() =>
                                router.push(
                                  `/team/${d.memberId}?date=${selectedReportDate}`
                                )
                              }
                              className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                                d.isPending
                                  ? "border-neutral-800 bg-neutral-900 text-neutral-600"
                                  : notStarted
                                    ? "border-neutral-800 bg-neutral-900 text-neutral-400"
                                    : allDone
                                      ? "border-emerald-900/60 bg-emerald-950/20 text-neutral-100 active:bg-emerald-950/40"
                                      : "border-neutral-800 bg-neutral-900 text-neutral-100 active:bg-neutral-800"
                              }`}
                            >
                              <span className="truncate">
                                {d.displayName}
                              </span>
                              {d.isPending ? (
                                <span className="shrink-0 text-[10px] text-neutral-600">
                                  未登録
                                </span>
                              ) : notStarted ? (
                                <span className="shrink-0 text-[10px] text-neutral-500">
                                  未開始
                                </span>
                              ) : (
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                    allDone
                                      ? "bg-emerald-950/40 text-emerald-400"
                                      : "bg-red-950/40 text-red-400"
                                  }`}
                                >
                                  {allDone ? "済" : "未"}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {Array.from({
                          length: maxRows - rowsForLoc.length,
                        }).map((_, i) => (
                          <div
                            key={`spacer-${i}`}
                            aria-hidden="true"
                            className="invisible flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs"
                          >
                            <span>&nbsp;</span>
                          </div>
                        ))}
                      </div>
                      );
                    })}
                </div>
                ));
              })()}
            </div>
          )}
        </section>
        </>
        )}

        {adminSubTab === "training" && (
        <>
        {/* トレーニング（マット以外のセッション）の提出状況 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            トレーニングの提出状況
          </h2>
          <p className="text-[11px] text-neutral-500">
            マット以外のセッション（ラン・ウェイトなど）がある日の、各自のトレーニング記録の提出状況です。
          </p>

          <ReportCalendar
            cursor={trainingCalendarCursor}
            onCursorChange={setTrainingCalendarCursor}
            loading={loadingTrainingCounts}
            submissionCounts={trainingCounts}
            reportDayInfo={trainingDayInfo}
            selectedReportDate={selectedTrainingDate}
            onSelectDate={handleSelectTrainingDate}
          />

          <h3 className="text-xs font-semibold text-neutral-300">
            {formatMonthDay(selectedTrainingDate)}のトレーニング
          </h3>
          {loadingTrainingDayDetail ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : trainingDayDetail.missing.length === 0 &&
            trainingDayDetail.submitted.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              この日はマット以外のセッションがありません。
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {trainingDayDetail.missing.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-semibold text-red-500">
                    未提出（{trainingDayDetail.missing.length}人）
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {trainingDayDetail.missing.map((m) => (
                      <button
                        key={m.memberId}
                        onClick={() =>
                          router.push(
                            `/team/${m.memberId}?date=${selectedTrainingDate}`
                          )
                        }
                        className="rounded-full border border-red-900/60 bg-red-950/20 px-2.5 py-1 text-[11px] font-medium text-red-300 active:bg-red-950/40"
                      >
                        {locationLabel[m.location]}・{m.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {trainingDayDetail.submitted.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-emerald-500">
                      提出済み（{trainingDayDetail.submitted.length}人）
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTrainingIds((prev) =>
                          prev.size === trainingDayDetail.submitted.length
                            ? new Set()
                            : new Set(
                                trainingDayDetail.submitted.map((s) => s.id)
                              )
                        )
                      }
                      className="shrink-0 text-[11px] font-medium text-neutral-400 underline"
                    >
                      {expandedTrainingIds.size ===
                      trainingDayDetail.submitted.length
                        ? "すべて閉じる"
                        : "全員の詳細を表示"}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {trainingDayDetail.submitted.map((s) => {
                      const isOpen = expandedTrainingIds.has(s.id);
                      return (
                        <div
                          key={s.id}
                          className="rounded-lg border border-emerald-900/60 bg-emerald-950/10"
                        >
                          <button
                            onClick={() =>
                              setExpandedTrainingIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              })
                            }
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs active:bg-black/5"
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="font-medium text-foreground">
                                {locationLabel[s.location]}・{s.displayName}
                              </span>
                              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">
                                {trainingTypeLabel[s.type]}
                              </span>
                              {s.title && (
                                <span className="text-[10px] text-neutral-500">
                                  {s.title}
                                </span>
                              )}
                            </span>
                            <span className="text-neutral-600">
                              {isOpen ? "詳細を閉じる ︿" : "詳細を見る ﹀"}
                            </span>
                          </button>
                          {isOpen && (
                            <div className="flex flex-col gap-2 border-t border-emerald-900/60 px-3 py-2.5">
                              <p className="whitespace-pre-wrap text-xs text-foreground">
                                {s.content || "（内容の記載なし）"}
                              </p>
                              <TrainingCommentThread
                                weightLogId={s.id}
                                profile={profile}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
        </>
        )}

        {adminSubTab === "injuries" && (
        <>
        {/* 怪我人一覧 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            怪我人一覧
          </h2>
          <p className="text-[11px] text-neutral-500">
            部員がマイページから報告した怪我の一覧です。タップすると詳細が開きます。完治してから1週間が経過した怪我は、下の「過去の怪我情報を見る」から確認できます。
          </p>
          {loadingInjuries ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : injuries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              報告されている怪我はありません。
            </p>
          ) : (
            <>
              {(() => {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                const activeInjuries = injuries.filter((inj) => {
                  if (!inj.is_recovered) return true;
                  if (!inj.progress_updated_at) return true;
                  return new Date(inj.progress_updated_at) >= oneWeekAgo;
                });

                if (activeInjuries.length === 0) {
                  return (
                    <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                      現在対応中の怪我はありません。
                    </p>
                  );
                }

                return (
                  <ul className="flex flex-col gap-2">
                    {activeInjuries.map((inj) => (
                      <InjuryListItem
                        key={inj.id}
                        inj={inj}
                        isOpen={expandedInjuryId === inj.id}
                        onToggle={() =>
                          setExpandedInjuryId(
                            expandedInjuryId === inj.id ? null : inj.id
                          )
                        }
                      />
                    ))}
                  </ul>
                );
              })()}
              <button
                onClick={() => setShowPastInjuries(true)}
                className="self-end text-xs font-medium text-neutral-400 underline"
              >
                過去の怪我情報を見る
              </button>
            </>
          )}
        </section>

        {showPastInjuries && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
            onClick={() => setShowPastInjuries(false)}
          >
            <div
              className="relative flex max-h-[85vh] w-full max-w-md flex-col gap-2 overflow-y-auto rounded-lg bg-neutral-900 p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowPastInjuries(false)}
                aria-label="閉じる"
                className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-neutral-500 shadow active:bg-neutral-800"
              >
                ✕
              </button>
              <h3 className="text-sm font-semibold text-neutral-200">
                過去の怪我情報
              </h3>
              {injuries.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  報告されている怪我はありません。
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {injuries.map((inj) => (
                    <InjuryListItem
                      key={inj.id}
                      inj={inj}
                      isOpen={expandedInjuryId === inj.id}
                      onToggle={() =>
                        setExpandedInjuryId(
                          expandedInjuryId === inj.id ? null : inj.id
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

function InjuryListItem({
  inj,
  isOpen,
  onToggle,
}: {
  inj: InjuryRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={`rounded-lg border ${
        inj.is_recovered
          ? "border-emerald-900/60 bg-emerald-950/40"
          : "border-neutral-800"
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs active:bg-black/5"
      >
        <span className="flex flex-col">
          <span className="font-medium text-foreground">
            {inj.author?.display_name ?? "不明"}
          </span>
          <span className="text-neutral-400">
            {inj.symptom_name}（{inj.body_part}）
            {inj.is_recovered && (
              <span className="ml-1.5 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                完治
              </span>
            )}
          </span>
        </span>
        <span className="text-neutral-600">{isOpen ? "︿" : "﹀"}</span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-1 border-t border-neutral-800 px-3 py-2.5 text-xs text-foreground">
          {inj.detail && <p className="whitespace-pre-wrap">{inj.detail}</p>}
          <p>
            完治見込み日:{" "}
            {inj.expected_recovery_date
              ? formatMonthDay(inj.expected_recovery_date)
              : "未定"}
          </p>
          <p>
            次回通院日:{" "}
            {inj.next_hospital_date
              ? formatMonthDay(inj.next_hospital_date)
              : "未定"}
          </p>
          <p>
            手術の可能性:{" "}
            {inj.surgery_possibility === "yes"
              ? "あり"
              : inj.surgery_possibility === "no"
                ? "なし"
                : "未定"}
          </p>
          <p>
            マット参加の可否: {matParticipationLabel[inj.mat_participation]}
          </p>
          {inj.mat_participation === "conditional" &&
            inj.mat_participation_detail && (
              <p>条件: {inj.mat_participation_detail}</p>
            )}
          {inj.progress_note && (
            <p className="rounded bg-neutral-900/60 p-2">
              最新の経過報告: {inj.progress_note}
            </p>
          )}
          {inj.progress_updated_at && (
            <p className="text-[10px] text-neutral-500">
              経過報告日:{" "}
              {formatMonthDay(toDateKey(new Date(inj.progress_updated_at)))}
            </p>
          )}
          <p className="text-[10px] text-neutral-500">
            報告日: {formatMonthDay(toDateKey(new Date(inj.created_at)))}
          </p>
        </div>
      )}
    </li>
  );
}

type TrainingCommentRow = {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
  author: { display_name: string } | null;
};

// トレーニング（マット以外）記録に対するコメントスレッド。
// コーチ・本人どちらからもコメントでき、お互いのフィードバックに使える。
function TrainingCommentThread({
  weightLogId,
  profile,
}: {
  weightLogId: string;
  profile: Profile;
}) {
  const supabase = createClient();
  const [comments, setComments] = useState<TrainingCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("weight_log_comments")
      .select(
        "id, author_id, text, created_at, author:profiles!weight_log_comments_author_id_fkey(display_name)"
      )
      .eq("weight_log_id", weightLogId)
      .order("created_at", { ascending: true });
    if (error) setErrorMsg(error.message);
    setComments((data ?? []) as unknown as TrainingCommentRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightLogId]);

  async function handlePost() {
    if (!text.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("weight_log_comments").insert({
      weight_log_id: weightLogId,
      team_id: profile.team_id,
      author_id: profile.id,
      text: text.trim(),
    });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setText("");
      await load();
    }
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-emerald-900/60 pt-2">
      <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
        コメント
      </p>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-neutral-500">まだコメントはありません。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {comments.map((c) => {
            const name =
              c.author_id === profile.id
                ? "自分"
                : (c.author?.display_name ?? "（不明）");
            return (
              <div
                key={c.id}
                className="rounded-lg border border-border-color bg-background p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="text-[10px] text-neutral-500">
                    {formatMonthDay(c.created_at.slice(0, 10))}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
                  {c.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-[11px] text-red-400">
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="コメントを入力"
          className="flex-1 rounded-lg border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
}

