"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { useProfile } from "../../../components/shell/AppShell";
import AdminPendingTasks from "../../../components/AdminPendingTasks";
import {
  currentGrade,
  Location,
  locationLabel,
  isStaffRole,
  Role,
  roleLabel,
  trainingTypeDotColor,
  trainingTypeLabel,
  TrainingType,
} from "../../../lib/types";

type MemberInfo = {
  id: string;
  team_id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  entry_year: number | null;
  created_at: string;
};

type NextMatchInfo = {
  name: string;
  date: string;
};

type MenuInfo = {
  title: string;
  content: string;
  start_time: string | null;
};

type InjuryInfo = {
  symptom_name: string;
  body_part: string;
  expected_recovery_date: string | null;
  mat_participation: "yes" | "no" | "conditional";
  mat_participation_detail: string | null;
};

type MatchReflectionInfo = {
  eventId: string;
  eventTitle: string;
  submittedAt: string;
  matchResult: string;
  matchTitle: string;
  matchCount: number | null;
  winCount: number | null;
  lossCount: number | null;
  reflection: string;
  goodPoints: string;
  challenges: string;
  improvementPlan: string;
  teamChallenges: string;
};

const matParticipationLabel: Record<"yes" | "no" | "conditional", string> = {
  yes: "可",
  no: "非",
  conditional: "条件付きで可",
};

type DetailState = {
  menu: MenuInfo | null;
  matStatus: "not_required" | "report" | "absent" | "missing";
  matText: string | null;
  selfStatus: "not_required" | "done" | "missing";
  selfText: string | null;
  selfType: TrainingType | null;
  selfTitle: string | null;
};

// カレンダーのマス目に出す表示内容（実施したトレーニングの種類とタイトルのみ）
type DayMark = {
  isOff: boolean;
  type: TrainingType | null;
  title: string | null;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// dateStrを含む週の日曜日（Dateオブジェクト）を返す
function startOfWeek(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

// 部員のカレンダー（月間/週間を切り替えられる。表示内容は実施したトレーニングとタイトルのみ）
function MemberCalendar({
  viewMode,
  onViewModeChange,
  cursor,
  onCursorChange,
  selectedDate,
  onSelectDate,
  todayDate,
  marks,
}: {
  viewMode: "month" | "week";
  onViewModeChange: (v: "month" | "week") => void;
  cursor: Date;
  onCursorChange: (d: Date) => void;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  todayDate: string;
  marks: Map<string, DayMark>;
}) {
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
    const start = startOfWeek(toDateKey(cursor));
    cells = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    const weekEnd = cells[6] as Date;
    headerLabel =
      start.getMonth() === weekEnd.getMonth()
        ? `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日〜${weekEnd.getDate()}日`
        : `${start.getMonth() + 1}月${start.getDate()}日〜${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
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
              onClick={() => onViewModeChange(opt.v)}
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
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = toDateKey(d);
          const mark = marks.get(key);
          const isSelected = key === selectedDate;
          const isToday = key === todayDate;

          let bgClass = "bg-surface-2 text-foreground";
          if (isSelected) {
            bgClass = "bg-amber-100 dark:bg-amber-950/40 font-bold";
          } else if (mark?.isOff) {
            bgClass =
              "bg-neutral-300 dark:bg-neutral-950 text-neutral-500 dark:text-neutral-600";
          } else if (isToday) {
            bgClass = "bg-blue-100 dark:bg-blue-950/40";
          }

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex ${
                viewMode === "week" ? "min-h-[64px]" : "min-h-[52px]"
              } flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 text-xs active:bg-neutral-200 dark:active:bg-neutral-700 ${bgClass} ${
                isSelected
                  ? "border-amber-400 ring-1 ring-amber-400"
                  : isToday
                    ? "border-blue-400 ring-1 ring-blue-400 dark:border-blue-600"
                    : "border-border-color"
              }`}
            >
              <span>{d.getDate()}</span>
              {mark?.isOff ? (
                <span className="text-[length:calc(8px+var(--fs-add-mini))] text-neutral-500 dark:text-neutral-400">
                  オフ
                </span>
              ) : mark?.type ? (
                <span className="max-w-full truncate px-0.5 text-[length:calc(8px+var(--fs-add-mini))] leading-none text-neutral-500 dark:text-neutral-400">
                  {trainingTypeLabel[mark.type]}
                  {mark.title ? `・${mark.title}` : ""}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MemberDayView({
  memberId,
  date: initialDate,
}: {
  memberId: string;
  date: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  // 閲覧している人（管理者・マネージャーのときだけ、この部員の未提出タスクを表示する）
  const { profile: viewer } = useProfile();
  const isAdminViewer = isStaffRole(viewer.role);
  const recordHeadingRef = useRef<HTMLParagraphElement>(null);
  const [date, setDate] = useState(initialDate);
  const [calendarViewMode, setCalendarViewMode] = useState<"month" | "week">(
    "week"
  );
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const [y, m, d] = initialDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const [member, setMember] = useState<MemberInfo | null | undefined>(undefined);
  const [nextMatch, setNextMatch] = useState<NextMatchInfo | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [calendarMarks, setCalendarMarks] = useState<Map<string, DayMark>>(
    new Map()
  );
  const [injuries, setInjuries] = useState<InjuryInfo[]>([]);
  const [matchReflections, setMatchReflections] = useState<
    MatchReflectionInfo[]
  >([]);
  const [openMatchReflectionId, setOpenMatchReflectionId] = useState<
    string | null
  >(null);
  const [loadingMember, setLoadingMember] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 本人の基本情報・次の試合・現在の怪我・試合振り返り履歴（日付に依存しない情報）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMember(true);
      const { data: memberData, error: memberError } = await supabase
        .from("profiles")
        .select("id, team_id, display_name, role, home_location, entry_year, created_at")
        .eq("id", memberId)
        .maybeSingle();

      if (cancelled) return;
      if (memberError) {
        setErrorMsg(memberError.message);
        setLoadingMember(false);
        return;
      }
      const memberRow = memberData as MemberInfo | null;
      setMember(memberRow);
      setLoadingMember(false);
      if (!memberRow) return;

      const todayStr = toDateKey(new Date());
      const { data: matchData } = await supabase
        .from("matches")
        .select("name, date")
        .eq("team_id", memberRow.team_id)
        .eq("member_id", memberId)
        .gte("date", todayStr)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled)
        setNextMatch((matchData as NextMatchInfo | null) ?? null);

      const { data: injuryData } = await supabase
        .from("injuries")
        .select(
          "symptom_name, body_part, expected_recovery_date, mat_participation, mat_participation_detail"
        )
        .eq("author_id", memberId)
        .eq("is_recovered", false)
        .order("created_at", { ascending: false });
      if (!cancelled) setInjuries((injuryData ?? []) as InjuryInfo[]);

      const { data: reflectionData } = await supabase
        .from("team_event_submissions")
        .select(
          "event_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, event:team_events!team_event_submissions_event_id_fkey(title, type)"
        )
        .eq("author_id", memberId);
      const reflectionRows = (reflectionData ?? []) as unknown as {
        event_id: string;
        updated_at: string;
        match_result: string | null;
        match_title: string | null;
        match_count: number | null;
        win_count: number | null;
        loss_count: number | null;
        reflection: string | null;
        good_points: string | null;
        challenges: string | null;
        improvement_plan: string | null;
        team_challenges: string | null;
        event: { title: string; type: string } | null;
      }[];
      if (!cancelled) {
        setMatchReflections(
          reflectionRows
            .filter((r) => r.event?.type === "match_reflection")
            .map((r) => ({
              eventId: r.event_id,
              eventTitle: r.event?.title || r.match_title || "試合の振り返り",
              submittedAt: r.updated_at,
              matchResult: r.match_result ?? "",
              matchTitle: r.match_title ?? "",
              matchCount: r.match_count,
              winCount: r.win_count,
              lossCount: r.loss_count,
              reflection: r.reflection ?? "",
              goodPoints: r.good_points ?? "",
              challenges: r.challenges ?? "",
              improvementPlan: r.improvement_plan ?? "",
              teamChallenges: r.team_challenges ?? "",
            }))
            .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // 選択中の日付の詳細（マット・自主トレの提出内容）
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      const { data: dayData } = await supabase
        .from("schedule_days")
        .select("is_off, sessions:schedule_sessions(session_type, start_time)")
        .eq("team_id", member.team_id)
        .eq("location", member.home_location ?? "tama")
        .eq("date", date)
        .maybeSingle();

      const scheduleRow = dayData as unknown as {
        is_off: boolean;
        sessions: { session_type: string; start_time: string }[];
      } | null;
      const matSession = scheduleRow?.sessions.find(
        (s) => s.session_type === "mat"
      );
      const hasMat = !scheduleRow?.is_off && !!matSession;
      const hasNonMat =
        !scheduleRow?.is_off &&
        !!scheduleRow?.sessions.some((s) => s.session_type !== "mat");

      let matStatus: DetailState["matStatus"] = "not_required";
      let matText: string | null = null;
      let menu: MenuInfo | null = null;
      if (hasMat) {
        const { data: ownMenus } = await supabase
          .from("menus")
          .select("id, title, content, start_time")
          .eq("team_id", member.team_id)
          .eq("location", member.home_location ?? "tama")
          .eq("date", date)
          .eq("is_off", false);
        const { data: jointMenus } = await supabase
          .from("menus")
          .select("id, title, content, start_time")
          .eq("team_id", member.team_id)
          .eq("is_joint", true)
          .eq("date", date)
          .eq("is_off", false);
        const menuRows = [
          ...((ownMenus ?? []) as {
            id: string;
            title: string;
            content: string;
            start_time: string | null;
          }[]),
          ...((jointMenus ?? []) as {
            id: string;
            title: string;
            content: string;
            start_time: string | null;
          }[]),
        ];
        if (menuRows.length > 0) {
          menu = {
            title: menuRows[0].title,
            content: menuRows[0].content,
            start_time: menuRows[0].start_time ?? matSession?.start_time ?? null,
          };
          const menuIds = menuRows.map((m) => m.id);
          const { data: commentData } = await supabase
            .from("comments")
            .select("kind, text")
            .in("menu_id", menuIds)
            .eq("author_id", memberId)
            .in("kind", ["report", "absent"])
            .is("parent_id", null)
            .maybeSingle();
          const comment = commentData as { kind: string; text: string } | null;
          if (comment) {
            matStatus = comment.kind === "absent" ? "absent" : "report";
            matText = comment.text;
          } else {
            matStatus = "missing";
          }
        } else {
          menu = matSession
            ? { title: "", content: "", start_time: matSession.start_time }
            : null;
          matStatus = "missing";
        }
      }

      let selfStatus: DetailState["selfStatus"] = "not_required";
      let selfText: string | null = null;
      let selfType: TrainingType | null = null;
      let selfTitle: string | null = null;
      if (hasNonMat) {
        const { data: logData } = await supabase
          .from("weight_logs")
          .select("content, type, title")
          .eq("author_id", memberId)
          .eq("date", date)
          .maybeSingle();
        const log = logData as
          | { content: string; type: TrainingType; title: string | null }
          | null;
        if (log) {
          selfStatus = "done";
          selfText = log.content;
          selfType = log.type;
          selfTitle = log.title;
        } else {
          selfStatus = "missing";
        }
      }

      if (!cancelled) {
        setDetail({
          menu,
          matStatus,
          matText,
          selfStatus,
          selfText,
          selfType,
          selfTitle,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, date, member]);

  // カレンダーのマス目に出す表示内容（実施したトレーニングの種類とタイトルのみ）
  // 月表示/週表示の切り替え・カーソル移動・本人情報のロード完了時に取得
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      let rangeStartStr: string;
      let rangeEndStr: string;
      if (calendarViewMode === "month") {
        const y = calendarCursor.getFullYear();
        const m = calendarCursor.getMonth();
        rangeStartStr = toDateKey(new Date(y, m, 1));
        rangeEndStr = toDateKey(new Date(y, m + 1, 0));
      } else {
        const start = startOfWeek(toDateKey(calendarCursor));
        rangeStartStr = toDateKey(start);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        rangeEndStr = toDateKey(end);
      }

      const { data: dayData } = await supabase
        .from("schedule_days")
        .select("date, is_off")
        .eq("team_id", member.team_id)
        .eq("location", member.home_location ?? "tama")
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr);

      const marks = new Map<string, DayMark>();
      for (const row of (dayData ?? []) as {
        date: string;
        is_off: boolean;
      }[]) {
        marks.set(row.date, { isOff: row.is_off, type: null, title: null });
      }

      const { data: logData } = await supabase
        .from("weight_logs")
        .select("date, type, title")
        .eq("author_id", memberId)
        .gte("date", rangeStartStr)
        .lte("date", rangeEndStr);
      for (const row of (logData ?? []) as {
        date: string;
        type: TrainingType;
        title: string | null;
      }[]) {
        const existing = marks.get(row.date);
        marks.set(row.date, {
          isOff: existing?.isOff ?? false,
          type: row.type,
          title: row.title,
        });
      }

      if (!cancelled) setCalendarMarks(marks);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, calendarViewMode, calendarCursor, member]);

  if (loadingMember) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-neutral-500 dark:text-neutral-400">
        読み込み中…
      </div>
    );
  }

  if (member === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-neutral-500 dark:text-neutral-400">
        部員が見つかりませんでした。
      </div>
    );
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;
  const todayStr = toDateKey(new Date());

  // 未提出タスクの日付を押したら、カレンダーをその日に合わせて、その日の記録までスクロールする
  function jumpToDate(d: string) {
    const [y, m, day] = d.split("-").map(Number);
    setDate(d);
    setCalendarCursor(new Date(y, m - 1, day));
    requestAnimationFrame(() =>
      recordHeadingRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-background text-foreground">
      <header
        className="sticky z-10 flex items-center justify-between gap-2 border-b border-border-color bg-surface/95 px-4 py-3 backdrop-blur"
        style={{ top: "var(--app-header-height, 0px)" }}
      >
        <h1 className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          {member?.display_name}のマイページ(閲覧)
        </h1>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-border-color px-2.5 py-1.5 text-[length:calc(11px+var(--fs-add))] text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          チームページに戻る
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="rounded bg-surface-2 px-2 py-1">
            {member?.role ? roleLabel[member.role] : ""}
          </span>
          {member?.home_location && (
            <span className="rounded bg-surface-2 px-2 py-1">
              {locationLabel[member.home_location]}
            </span>
          )}
          {member?.entry_year != null && (
            <span className="rounded bg-surface-2 px-2 py-1">
              {currentGrade(member.entry_year)}年
            </span>
          )}
          {nextMatch && (
            <span className="rounded bg-amber-100 px-2.5 py-1 text-[length:calc(13px+var(--fs-add))] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              次の試合まであと{matchDays}日
              <span className="ml-1 font-normal text-amber-700/80 dark:text-amber-400/80">
                （{nextMatch.name}）
              </span>
            </span>
          )}
        </div>

        {isAdminViewer &&
          member &&
          member.role !== "coach" &&
          member.role !== "manager" &&
          member.role !== "ob" && (
          <AdminPendingTasks member={member} onSelectDate={jumpToDate} />
        )}

        {/* カレンダー（月表示/週表示を切り替え可能。ここから日付を選ぶと下の詳細が切り替わる） */}
        <MemberCalendar
          viewMode={calendarViewMode}
          onViewModeChange={setCalendarViewMode}
          cursor={calendarCursor}
          onCursorChange={setCalendarCursor}
          selectedDate={date}
          onSelectDate={setDate}
          todayDate={todayStr}
          marks={calendarMarks}
        />
        <p
          ref={recordHeadingRef}
          className="scroll-mt-32 text-center text-sm font-semibold text-foreground"
        >
          {formatMonthDay(date)}の記録
        </p>

        {/* マット（セッション時間・メニュー詳細・実施/未実施報告） */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            マット
          </h2>
          {detail?.matStatus === "not_required" ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              この日はマットのセッションはありません。
            </p>
          ) : (
            <>
              {detail?.menu && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  {detail.menu.start_time && (
                    <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                      {detail.menu.start_time.slice(0, 5)}〜
                    </p>
                  )}
                  {detail.menu.title && (
                    <p className="font-medium text-neutral-100">
                      {detail.menu.title}
                    </p>
                  )}
                  {detail.menu.content && (
                    <p className="whitespace-pre-wrap text-sm text-neutral-300">
                      {detail.menu.content}
                    </p>
                  )}
                </div>
              )}
              {detail?.matStatus === "missing" ? (
                <p className="rounded-lg bg-red-950/40 p-3 text-xs text-red-400">
                  実施報告・未実施報告ともに未提出です。
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
                  <span className="self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold text-emerald-400">
                    {detail?.matStatus === "absent" ? "未実施報告" : "実施報告"}
                  </span>
                  <p className="whitespace-pre-wrap text-sm text-neutral-100">
                    {detail?.matText}
                  </p>
                </div>
              )}
            </>
          )}
        </section>

        {/* マット以外のセッション（自主トレ） */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            トレーニング
          </h2>
          {detail?.selfStatus === "not_required" ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              この日はトレーニングの予定はありません。
            </p>
          ) : detail?.selfStatus === "missing" ? (
            <p className="rounded-lg bg-red-950/40 p-3 text-xs text-red-400">
              未提出です。
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
              <span className="flex items-center gap-1.5 self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold text-emerald-400">
                {detail?.selfType && (
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[detail.selfType]}`}
                  />
                )}
                {detail?.selfType ? trainingTypeLabel[detail.selfType] : ""}
                {detail?.selfTitle && `・${detail.selfTitle}`}
              </span>
              <p className="whitespace-pre-wrap text-sm text-neutral-100">
                {detail?.selfText}
              </p>
            </div>
          )}
        </section>

        {/* 試合の振り返り */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            試合の振り返り
          </h2>
          {matchReflections.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              まだ振り返りの提出はありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {matchReflections.map((r) => {
                const isOpen = openMatchReflectionId === r.eventId;
                return (
                  <div
                    key={r.eventId}
                    className="rounded-lg border border-neutral-800 bg-neutral-900"
                  >
                    <button
                      onClick={() =>
                        setOpenMatchReflectionId(isOpen ? null : r.eventId)
                      }
                      className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
                    >
                      <span className="font-medium text-neutral-100">
                        {r.eventTitle}の振り返り
                      </span>
                      <span className="shrink-0 text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                        提出日{formatMonthDay(r.submittedAt.slice(0, 10))}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="flex flex-col gap-2 border-t border-neutral-800 p-3 text-sm">
                        {r.matchTitle && (
                          <p>
                            <span className="text-neutral-500">
                              試合名：
                            </span>
                            {r.matchTitle}
                          </p>
                        )}
                        {r.matchResult && (
                          <p>
                            <span className="text-neutral-500">
                              試合結果：
                            </span>
                            {r.matchResult}
                          </p>
                        )}
                        {r.matchCount != null && (
                          <p>
                            <span className="text-neutral-500">
                              試合数：
                            </span>
                            {r.matchCount}試合（{r.winCount ?? 0}勝{" "}
                            {r.lossCount ?? 0}敗）
                          </p>
                        )}
                        {r.reflection && (
                          <div>
                            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                              試合の反省
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.reflection}
                            </p>
                          </div>
                        )}
                        {r.goodPoints && (
                          <div>
                            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                              良かった点
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.goodPoints}
                            </p>
                          </div>
                        )}
                        {r.challenges && (
                          <div>
                            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                              課題に感じた点
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.challenges}
                            </p>
                          </div>
                        )}
                        {r.improvementPlan && (
                          <div>
                            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                              改善方法と必要だと考えるトレーニング
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.improvementPlan}
                            </p>
                          </div>
                        )}
                        {r.teamChallenges && (
                          <div>
                            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                              当部の課題
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.teamChallenges}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 現状の怪我情報 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            現在の怪我情報
          </h2>
          {injuries.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              報告されている怪我はありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {injuries.map((inj, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm"
                >
                  <p className="font-medium text-neutral-100">
                    {inj.symptom_name}（{inj.body_part}）
                  </p>
                  <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                    マット参加：{matParticipationLabel[inj.mat_participation]}
                    {inj.mat_participation === "conditional" &&
                      inj.mat_participation_detail &&
                      `（${inj.mat_participation_detail}）`}
                  </p>
                  {inj.expected_recovery_date && (
                    <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                      完治見込み：{formatMonthDay(inj.expected_recovery_date)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="border-t border-neutral-800 pt-3 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-500">
          このページは閲覧専用です。編集はご本人のマイページから行われます。
        </p>
      </div>
    </div>
  );
}

export default function TeamMemberRoute() {
  const params = useParams<{ memberId: string }>();
  const searchParams = useSearchParams();
  const memberId = Array.isArray(params.memberId)
    ? params.memberId[0]
    : params.memberId;
  const date = searchParams.get("date") ?? toDateKey(new Date());

  return memberId ? <MemberDayView memberId={memberId} date={date} /> : null;
}
