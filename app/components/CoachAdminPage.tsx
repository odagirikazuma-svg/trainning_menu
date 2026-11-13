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
} from "../lib/types";
import type { Profile } from "./AuthGate";
import { isExemptOn, loadExemptions } from "../lib/exemptions";
import { useCalendarViewPref } from "./shell/CalendarViewPrefProvider";
import { useSubNav } from "./shell/AppShell";
import SubTabBar from "./shell/SubTabBar";
import { fatigueColor } from "./FatigueSelector";
import AbsenceReviewSection from "./AbsenceReviewSection";
import PracticeCheckSection from "./PracticeCheckSection";
import { loadObligations } from "../lib/obligations";

// 日報／報告（休みの報告・練習の確認事項）／体調（疲労度・怪我の管理）
// 練習の確認事項と疲労度（負荷の試算）は監督（coach）だけに出す
type AdminSubTab = "submissions" | "reports" | "condition";
const adminSubTabItems: { value: AdminSubTab; label: string }[] = [
  { value: "submissions", label: "日報" },
  { value: "reports", label: "報告" },
  { value: "condition", label: "体調" },
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
      {loading ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-500">読み込み中…</p>
      ) : (
        <>
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
                      ? "border-neutral-400 bg-neutral-300 dark:border-neutral-600 dark:bg-neutral-800"
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
                    className={`text-[length:calc(11px+var(--fs-add))] font-semibold ${
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
                    <span className="text-[length:calc(9px+var(--fs-add-mini))] font-semibold text-neutral-700 dark:text-neutral-300">
                      全体オフ
                    </span>
                  ) : (
                    <>
                      {dayInfo && dayInfo.dayType !== "practice" && (
                        <span
                          className={`max-w-full truncate rounded px-1 text-[length:calc(9px+var(--fs-add-mini))] font-semibold ${dayTypeFillColorDark[dayInfo.dayType]}`}
                        >
                          {dayInfo.eventName || dayTypeLabel[dayInfo.dayType]}
                        </span>
                      )}
                      {count && (
                        <span
                          className={`text-[length:calc(9px+var(--fs-add-mini))] font-semibold ${
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
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[length:calc(10px+var(--fs-add))] text-neutral-500 dark:text-neutral-500">
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
              <span className="inline-block h-2.5 w-2.5 rounded bg-neutral-300 dark:bg-neutral-800" />
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
      isExempt: boolean;
      rest?: boolean;
      matStatus: "not_required" | "not_started" | "report" | "absent" | "missing";
      matText: string | null;
      selfStatus: "not_required" | "not_started" | "done" | "missing";
      selfText: string | null;
    }[]
  >([]);
  const [loadingDaySubmissionDetail, setLoadingDaySubmissionDetail] =
    useState(false);
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
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, entry_year, role")
      .eq("team_id", profile.team_id)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
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

    // 部員ごと・日ごとの提出が必要なもの（休みの報告：休養なら不要・代替なら代替メニュー）
    const realMembers = [...requiredByLoc.tama, ...requiredByLoc.otsuka].filter((m) => !m.isPending);
    const ob = await loadObligations(
      supabase,
      profile.team_id,
      realMembers.map((m) => ({ id: m.id, home_location: m.home_location ?? "tama" })),
      rangeStart,
      rangeEnd
    );

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
        let locTotal = 0;
        let locSubmitted = 0;
        for (const id of realIdsByLoc[loc]) {
          const items = ob.get(id)?.get(dateKey);
          if (!items || items.length === 0) continue;
          locTotal++;
          if (items.every((x) => x.done)) locSubmitted++;
        }
        if (locTotal === 0) continue;
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

    // 疲労度（自己評価）。テーブルが未作成の環境ではエラーになるので無視する
    supabase
      .from("daily_conditions")
      .select("author_id, fatigue")
      .eq("team_id", profile.team_id)
      .eq("date", dateStr)
      .then(({ data, error }) => {
        const m = new Map<string, number>();
        if (!error) {
          for (const r of (data ?? []) as { author_id: string; fatigue: number }[]) {
            m.set(r.author_id, r.fatigue);
          }
        }
        setFatigueByMember(m);
      });

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
    const realMembers = [...requiredByLoc.tama, ...requiredByLoc.otsuka].filter((m) => !m.isPending);
    const [dayExemptions, ob, absRes, logRes] = await Promise.all([
      loadExemptions(supabase, profile.team_id, dateStr, dateStr),
      loadObligations(
        supabase,
        profile.team_id,
        realMembers.map((m) => ({ id: m.id, home_location: m.home_location ?? "tama" })),
        dateStr,
        dateStr
      ),
      supabase
        .from("absence_requests")
        .select("author_id")
        .eq("team_id", profile.team_id)
        .eq("date", dateStr)
        .neq("status", "rejected"),
      realMembers.length > 0
        ? supabase.from("weight_logs").select("author_id, content").eq("date", dateStr).in("author_id", realMembers.map((m) => m.id))
        : Promise.resolve({ data: [] }),
    ]);
    const restIds = new Set(((absRes.data ?? []) as { author_id: string }[]).map((r) => r.author_id));
    const selfLogByAuthor = new Map<string, string[]>();
    for (const row of (logRes.data ?? []) as { author_id: string; content: string }[])
      selfLogByAuthor.set(row.author_id, [...(selfLogByAuthor.get(row.author_id) ?? []), row.content]);

    const detail: {
      memberId: string;
      displayName: string;
      location: Location;
      entryYear: number | null;
      isPending: boolean;
      isExempt: boolean;
      rest: boolean;
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
        const items = ob.get(m.id)?.get(dateStr) ?? [];
        const matItems = items.filter((x) => x.kind === "mat");
        const trItems = items.filter((x) => x.kind === "training");
        const matComment = matStatusByAuthorLoc.get(`${m.id}:${loc}`);
        const selfContent = selfLogByAuthor.get(m.id);
        detail.push({
          memberId: m.id,
          displayName: m.display_name,
          location: loc,
          entryYear: m.entry_year,
          isPending: !!m.isPending,
          isExempt: !m.isPending && isExemptOn(dayExemptions, m.id, dateStr),
          rest: restIds.has(m.id),
          matStatus:
            matItems.length > 0
              ? matItems.every((x) => x.done)
                ? matComment?.kind === "absent"
                  ? ("absent" as const)
                  : ("report" as const)
                : ("missing" as const)
              : hasMat && !day.matStarted
                ? ("not_started" as const)
                : ("not_required" as const),
          matText: matComment?.text ?? null,
          selfStatus:
            trItems.length > 0
              ? trItems.every((x) => x.done)
                ? ("done" as const)
                : ("missing" as const)
              : hasNonMat && !day.selfStarted && !restIds.has(m.id)
                ? ("not_started" as const)
                : ("not_required" as const),
          selfText: selfContent ? selfContent.join("\n") : null,
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


  const [fatigueByMember, setFatigueByMember] = useState<Map<string, number>>(
    new Map()
  );
  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loadingInjuries, setLoadingInjuries] = useState(true);
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(
    null
  );
  const [showPastInjuries, setShowPastInjuries] = useState(false);

  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>(() => {
    if (typeof window === "undefined") return "submissions";
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "injuries" || tab === "condition" || tab === "training") return "condition";
    if (tab === "reports" || window.location.hash === "#absence") return "reports";
    return "submissions";
  });
  // 「報告」タブのバッジ（承認待ちの休み申請の件数）
  const [pendingAbsences, setPendingAbsences] = useState(0);
  useEffect(() => {
    const today = toDateKey(new Date());
    supabase
      .from("absence_requests")
      .select("id", { count: "exact", head: true })
      .eq("team_id", profile.team_id)
      .eq("status", "pending")
      .gte("date", today)
      .then(({ count, error }) => setPendingAbsences(error ? 0 : count ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSubTab]);

  // フッター上のサブナビ（提出状況／怪我の報告の切り替え）を登録
  // ※ node は必ず useMemo で安定させること。毎レンダー新しいJSXを渡すと
  //   useSubNav内のuseEffectが依存配列[node]の変化を検知して毎回発火し、
  //   AppShell側の再レンダーとの間で無限ループになりうる。
  const adminSubNav = useMemo(
    () => (
      <SubTabBar
        items={adminSubTabItems.map((it) =>
          it.value === "reports" ? { ...it, badge: pendingAbsences } : it
        )}
        active={adminSubTab}
        onChange={setAdminSubTab}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminSubTab, pendingAbsences]
  );
  useSubNav(adminSubNav);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col text-foreground">
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {adminSubTab === "reports" && (
          <AbsenceReviewSection
            teamId={profile.team_id}
            reviewerId={profile.id}
            canReview={profile.role === "coach"}
            onChanged={setPendingAbsences}
          />
        )}

        {adminSubTab === "reports" && profile.role === "coach" && (
          <div className="mt-6">
            <PracticeCheckSection teamId={profile.team_id} coachId={profile.id} part="checks" />
          </div>
        )}

        {adminSubTab === "submissions" && (
        <>
        <h1 className="text-2xl font-bold tracking-tight">今日のチーム</h1>
        <section className="flex flex-col gap-3 rounded-xl border border-border-color bg-surface p-3 sm:p-4">
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

          <h3 className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            {formatMonthDay(selectedReportDate)}の提出状況
          </h3>
          {loadingDaySubmissionDetail ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : daySubmissionDetail.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-xs text-neutral-500">
              この日は報告が必要なセッションがありません（オフ、または部員が登録されていません）。
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
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
                        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
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
                            !d.isExempt &&
                            !resolved &&
                            (d.matStatus === "not_started" ||
                              d.selfStatus === "not_started");
                          const allDone =
                            !d.isPending &&
                            !d.isExempt &&
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
                              className={`flex items-center justify-between gap-1.5 min-h-11 rounded-lg border px-3 py-2 text-left text-sm ${
                                d.isPending
                                  ? "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-600"
                                  : d.isExempt
                                    ? "border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-neutral-700 dark:text-neutral-300 active:bg-amber-50 dark:active:bg-amber-950/40"
                                    : notStarted
                                    ? "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400"
                                    : allDone
                                      ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/20 text-neutral-900 dark:text-neutral-100 active:bg-emerald-50 dark:active:bg-emerald-950/40"
                                      : "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 active:bg-neutral-100 dark:active:bg-neutral-800"
                              }`}
                            >
                              <span className="truncate">
                                {d.displayName}
                              </span>
                              {fatigueByMember.has(d.memberId) && (
                                <span
                                  title="疲労度（自己評価）"
                                  className={`ml-auto shrink-0 rounded px-1 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${fatigueColor(
                                    fatigueByMember.get(d.memberId)!
                                  )}`}
                                >
                                  疲{fatigueByMember.get(d.memberId)}
                                </span>
                              )}
                              {d.isPending ? (
                                <span className="shrink-0 text-[length:calc(10px+var(--fs-add))] text-neutral-600">
                                  未登録
                                </span>
                              ) : d.isExempt ? (
                                <span className="shrink-0 rounded bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold text-amber-700 dark:text-amber-400">
                                  免除
                                </span>
                              ) : notStarted ? (
                                <span className="shrink-0 text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                                  未開始
                                </span>
                              ) : (
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold ${
                                    allDone
                                      ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                                      : "bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400"
                                  }`}
                                >
                                  {allDone ? (d.rest ? "休み" : "報告済み") : "未提出"}
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
                            className="invisible hidden min-h-11 sm:block"
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

        {adminSubTab === "condition" && (
        <>
        {profile.role === "coach" && (
          <div className="mb-6">
            <PracticeCheckSection teamId={profile.team_id} coachId={profile.id} part="load" />
          </div>
        )}
        {/* 怪我人一覧 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            怪我人一覧
          </h2>
          <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
            部員がマイページから報告した怪我の一覧です。タップすると詳細が開きます。完治してから1週間が経過した怪我は、下の「過去の怪我情報を見る」から確認できます。
          </p>
          {loadingInjuries ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : injuries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-xs text-neutral-500">
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
                    <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-xs text-neutral-500">
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
                className="self-end text-xs font-medium text-neutral-600 dark:text-neutral-400 underline"
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
              className="relative flex max-h-[85vh] w-full max-w-md flex-col gap-2 overflow-y-auto rounded-lg bg-neutral-50 dark:bg-neutral-900 p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowPastInjuries(false)}
                aria-label="閉じる"
                className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-50 dark:bg-neutral-900 text-neutral-500 shadow active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                ✕
              </button>
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
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
          ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40"
          : "border-neutral-200 dark:border-neutral-800"
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
          <span className="text-neutral-600 dark:text-neutral-400">
            {inj.symptom_name}（{inj.body_part}）
            {inj.is_recovered && (
              <span className="ml-1.5 rounded bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-medium text-emerald-700 dark:text-emerald-400">
                完治
              </span>
            )}
          </span>
        </span>
        <span className="text-neutral-600">{isOpen ? "︿" : "﹀"}</span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 px-3 py-2.5 text-xs text-foreground">
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
            <p className="rounded bg-neutral-50 dark:bg-neutral-900/60 p-2">
              最新の経過報告: {inj.progress_note}
            </p>
          )}
          {inj.progress_updated_at && (
            <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
              経過報告日:{" "}
              {formatMonthDay(toDateKey(new Date(inj.progress_updated_at)))}
            </p>
          )}
          <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            報告日: {formatMonthDay(toDateKey(new Date(inj.created_at)))}
          </p>
        </div>
      )}
    </li>
  );
}
