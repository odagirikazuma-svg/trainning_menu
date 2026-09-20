"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
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

// 週カレンダーのマス目に出す簡易ステータス（提出済み/未提出/オフをひと目で分かるようにする）
type DayMark = {
  isOff: boolean;
  matStatus: "not_required" | "report" | "absent" | "missing";
  selfStatus: "not_required" | "done" | "missing";
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

// 部員の週カレンダー（常に週表示のみ。設定の月/週表示切り替えとは独立）
function MemberWeekStrip({
  weekCursor,
  onWeekCursorChange,
  selectedDate,
  onSelectDate,
  todayDate,
  marks,
}: {
  weekCursor: Date;
  onWeekCursorChange: (d: Date) => void;
  selectedDate: string;
  onSelectDate: (dateStr: string) => void;
  todayDate: string;
  marks: Map<string, DayMark>;
}) {
  const start = startOfWeek(toDateKey(weekCursor));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const weekEnd = days[6];
  const headerLabel =
    start.getMonth() === weekEnd.getMonth()
      ? `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日〜${weekEnd.getDate()}日`
      : `${start.getMonth() + 1}月${start.getDate()}日〜${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;

  function handlePrev() {
    const d = new Date(weekCursor);
    d.setDate(d.getDate() - 7);
    onWeekCursorChange(d);
  }
  function handleNext() {
    const d = new Date(weekCursor);
    d.setDate(d.getDate() + 7);
    onWeekCursorChange(d);
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
        {days.map((d, i) => {
          const key = toDateKey(d);
          const mark = marks.get(key);
          const isSelected = key === selectedDate;
          const isToday = key === todayDate;
          const hasMissing =
            !!mark &&
            (mark.matStatus === "missing" || mark.selfStatus === "missing");
          const hasAny =
            !!mark &&
            (mark.matStatus !== "not_required" ||
              mark.selfStatus !== "not_required");

          let bgClass = "bg-surface-2 text-foreground";
          if (isSelected) {
            bgClass =
              "bg-amber-100 dark:bg-amber-950/40 font-bold text-amber-700 dark:text-amber-400";
          } else if (mark?.isOff) {
            bgClass =
              "bg-neutral-100 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-500";
          }

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex min-h-[56px] flex-col items-center justify-start gap-1 rounded-lg border pt-1 text-xs active:bg-neutral-200 dark:active:bg-neutral-700 ${bgClass} ${
                isSelected
                  ? "ring-2 ring-amber-400"
                  : isToday
                    ? "ring-1 ring-neutral-400"
                    : "border-border-color"
              }`}
            >
              <span>{d.getDate()}</span>
              {mark?.isOff ? (
                <span className="text-[8px] text-neutral-500 dark:text-neutral-400">
                  オフ
                </span>
              ) : hasMissing ? (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : hasAny ? (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
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
  const [date, setDate] = useState(initialDate);
  const [weekCursor, setWeekCursor] = useState(() => {
    const [y, m, d] = initialDate.split("-").map(Number);
    return new Date(y, m - 1, d);
  });
  const [member, setMember] = useState<MemberInfo | null | undefined>(undefined);
  const [nextMatch, setNextMatch] = useState<NextMatchInfo | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [weekMarks, setWeekMarks] = useState<Map<string, DayMark>>(new Map());
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
        .select("id, team_id, display_name, role, home_location, entry_year")
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

  // 週カレンダーのマス目に出す簡易ステータス（週替わり・本人情報のロード完了時に取得）
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    (async () => {
      const start = startOfWeek(toDateKey(weekCursor));
      const weekStartStr = toDateKey(start);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const weekEndStr = toDateKey(end);

      const { data: dayData } = await supabase
        .from("schedule_days")
        .select("date, is_off, sessions:schedule_sessions(session_type)")
        .eq("team_id", member.team_id)
        .eq("location", member.home_location ?? "tama")
        .gte("date", weekStartStr)
        .lte("date", weekEndStr);

      const scheduleRows = (dayData ?? []) as unknown as {
        date: string;
        is_off: boolean;
        sessions: { session_type: string }[];
      }[];

      const marks = new Map<string, DayMark>();
      const matDatesNeeded: string[] = [];
      const selfDatesNeeded: string[] = [];
      for (const row of scheduleRows) {
        const hasMat =
          !row.is_off && row.sessions.some((s) => s.session_type === "mat");
        const hasNonMat =
          !row.is_off && row.sessions.some((s) => s.session_type !== "mat");
        marks.set(row.date, {
          isOff: row.is_off,
          matStatus: hasMat ? "missing" : "not_required",
          selfStatus: hasNonMat ? "missing" : "not_required",
        });
        if (hasMat) matDatesNeeded.push(row.date);
        if (hasNonMat) selfDatesNeeded.push(row.date);
      }

      if (matDatesNeeded.length > 0) {
        const { data: ownMenus } = await supabase
          .from("menus")
          .select("id, date")
          .eq("team_id", member.team_id)
          .eq("location", member.home_location ?? "tama")
          .eq("is_off", false)
          .in("date", matDatesNeeded);
        const { data: jointMenus } = await supabase
          .from("menus")
          .select("id, date")
          .eq("team_id", member.team_id)
          .eq("is_joint", true)
          .eq("is_off", false)
          .in("date", matDatesNeeded);
        const menuRows = [
          ...((ownMenus ?? []) as { id: string; date: string }[]),
          ...((jointMenus ?? []) as { id: string; date: string }[]),
        ];
        const menuIdToDate = new Map(menuRows.map((m) => [m.id, m.date]));
        const menuIds = menuRows.map((m) => m.id);
        if (menuIds.length > 0) {
          const { data: commentData } = await supabase
            .from("comments")
            .select("menu_id, kind")
            .in("menu_id", menuIds)
            .eq("author_id", memberId)
            .in("kind", ["report", "absent"]);
          for (const c of (commentData ?? []) as {
            menu_id: string;
            kind: string;
          }[]) {
            const d = menuIdToDate.get(c.menu_id);
            if (!d) continue;
            const mark = marks.get(d);
            if (mark) mark.matStatus = c.kind === "absent" ? "absent" : "report";
          }
        }
      }

      if (selfDatesNeeded.length > 0) {
        const { data: logData } = await supabase
          .from("weight_logs")
          .select("date")
          .eq("author_id", memberId)
          .in("date", selfDatesNeeded);
        const loggedDates = new Set(
          ((logData ?? []) as { date: string }[]).map((r) => r.date)
        );
        for (const d of selfDatesNeeded) {
          const mark = marks.get(d);
          if (mark && loggedDates.has(d)) mark.selfStatus = "done";
        }
      }

      if (!cancelled) setWeekMarks(marks);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, weekCursor, member]);

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
          className="rounded border border-border-color px-2.5 py-1.5 text-[11px] text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
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
            <span className="rounded bg-amber-100 px-2.5 py-1 text-[13px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              次の試合まであと{matchDays}日
              <span className="ml-1 font-normal text-amber-700/80 dark:text-amber-400/80">
                （{nextMatch.name}）
              </span>
            </span>
          )}
        </div>

        {/* 週カレンダー（常に週表示。ここから日付を選ぶと下の詳細が切り替わる） */}
        <MemberWeekStrip
          weekCursor={weekCursor}
          onWeekCursorChange={setWeekCursor}
          selectedDate={date}
          onSelectDate={setDate}
          todayDate={todayStr}
          marks={weekMarks}
        />
        <p className="text-center text-sm font-semibold text-foreground">
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
                    <p className="text-[11px] text-neutral-500">
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
                  <span className="self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
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
            マット以外のセッション(自主トレ)
          </h2>
          {detail?.selfStatus === "not_required" ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              この日はマット以外のセッションはありません。
            </p>
          ) : detail?.selfStatus === "missing" ? (
            <p className="rounded-lg bg-red-950/40 p-3 text-xs text-red-400">
              未提出です。
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
              <span className="flex items-center gap-1.5 self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
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
                      <span className="shrink-0 text-[11px] text-neutral-500">
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
                            <p className="text-[11px] text-neutral-500">
                              試合の反省
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.reflection}
                            </p>
                          </div>
                        )}
                        {r.goodPoints && (
                          <div>
                            <p className="text-[11px] text-neutral-500">
                              良かった点
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.goodPoints}
                            </p>
                          </div>
                        )}
                        {r.challenges && (
                          <div>
                            <p className="text-[11px] text-neutral-500">
                              課題に感じた点
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.challenges}
                            </p>
                          </div>
                        )}
                        {r.improvementPlan && (
                          <div>
                            <p className="text-[11px] text-neutral-500">
                              改善方法と必要だと考えるトレーニング
                            </p>
                            <p className="whitespace-pre-wrap text-neutral-100">
                              {r.improvementPlan}
                            </p>
                          </div>
                        )}
                        {r.teamChallenges && (
                          <div>
                            <p className="text-[11px] text-neutral-500">
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
                  <p className="text-[11px] text-neutral-500">
                    マット参加：{matParticipationLabel[inj.mat_participation]}
                    {inj.mat_participation === "conditional" &&
                      inj.mat_participation_detail &&
                      `（${inj.mat_participation_detail}）`}
                  </p>
                  {inj.expected_recovery_date && (
                    <p className="text-[11px] text-neutral-500">
                      完治見込み：{formatMonthDay(inj.expected_recovery_date)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="border-t border-neutral-800 pt-3 text-[11px] text-neutral-600 dark:text-neutral-500">
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
