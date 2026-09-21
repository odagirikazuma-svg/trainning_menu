"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isPushSupported, urlBase64ToUint8Array } from "../lib/push";
import {
  DayType,
  dayTypeLabel,
  getTitleColorBySlot,
  Location,
  locationLabel,
  MAX_SAVED_TITLES,
  SessionType,
  sessionTypeLabel,
  TitleColor,
  TrainingType,
  trainingTypeDotColor,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";
import TaskQueuePopup, { type QueueTask } from "./TaskQueuePopup";
import { MatReportInlineForm, SelfTrainingInlineForm } from "./TaskInlineForms";
import { useSubNav } from "./shell/AppShell";
import SubTabBar from "./shell/SubTabBar";
import { notifyTasksChanged } from "./shell/taskRefreshBus";
import { useCalendarViewPref } from "./shell/CalendarViewPrefProvider";
import {
  useCalendarDisplayPref,
  type CalendarSlotOption,
} from "./shell/CalendarDisplayPrefProvider";

type TodoMenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_off: boolean;
};

type MatchRow = {
  id: string;
  name: string;
  date: string;
  member_id: string | null;
};

type InjuryRow = {
  id: string;
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
};

const matchResultOptions = [
  "優勝",
  "準優勝",
  "3位",
  "4位",
  "5位",
  "ベスト16",
  "ベスト32",
  "3回戦敗退",
  "2回戦敗退",
  "1回戦敗退",
];

const matParticipationLabel: Record<"yes" | "no" | "conditional", string> = {
  yes: "可",
  no: "非",
  conditional: "条件付きで可",
};

type WeightLogRow = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
  start_time: string | null;
};

type RecentRecord = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
  isAlternative: boolean;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isMenuReportOpen(menu: TodoMenuRow): boolean {
  if (!menu.start_time) return true;
  const threshold = new Date(`${menu.date}T${menu.start_time}`);
  return new Date() >= threshold;
}

function formatShortDateTime(dateStr: string, startTime: string | null) {
  const [, m, d] = dateStr.split("-").map(Number);
  const base = `${m}月${d}日`;
  if (!startTime) return base;
  const [h, min] = startTime.split(":").map(Number);
  return `${base} ${h}時${String(min).padStart(2, "0")}分〜`;
}

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

const homeSubTabItems: { value: "training" | "injury"; label: string }[] = [
  { value: "training", label: "トレーニング" },
  { value: "injury", label: "怪我の記録" },
];

export default function MemberHome({
  profile,
  refreshSignal,
  isManager,
}: {
  profile: Profile;
  refreshSignal?: number;
  isManager?: boolean;
}) {
  const supabase = createClient();
  const logSectionRef = useRef<HTMLDivElement>(null);
  const isFirstRefresh = useRef(true);
  const isOb = profile.role === "ob";
  const [showTaskListPref, setShowTaskListPref] = useState(
    profile.show_task_list !== false
  );
  const [savingTaskListPref, setSavingTaskListPref] = useState(false);

  async function handleToggleTaskListPref() {
    const next = !showTaskListPref;
    setSavingTaskListPref(true);
    const { error } = await supabase
      .from("profiles")
      .update({ show_task_list: next })
      .eq("id", profile.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setShowTaskListPref(next);
    }
    setSavingTaskListPref(false);
  }
  const todayStr = toDateKey(new Date());
  // マネージャーは多摩所属として扱う(他ページの拠点制限ロジックと統一)
  const effectiveHomeLocation: Location | null =
    profile.role === "manager" ? "tama" : profile.home_location;

  const [todoMenus, setTodoMenus] = useState<TodoMenuRow[]>([]);
  const [selfTrainingPending, setSelfTrainingPending] = useState<string[]>([]);
  const [loadingTodo, setLoadingTodo] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const [weightMaxTodo, setWeightMaxTodo] = useState<{
    eventId: string;
    deadline: string;
    createdAt: string;
  } | null>(null);
  const [weightMaxTodoOpen, setWeightMaxTodoOpen] = useState(false);
  const [weightMaxBench, setWeightMaxBench] = useState("");
  const [weightMaxSquat, setWeightMaxSquat] = useState("");
  const [weightMaxDeadlift, setWeightMaxDeadlift] = useState("");
  const [savingWeightMaxTodo, setSavingWeightMaxTodo] = useState(false);

  const [teamEventTodos, setTeamEventTodos] = useState<
    {
      eventId: string;
      type: "match_reflection" | "body_composition";
      title: string;
      deadline: string;
    }[]
  >([]);
  const [openTeamEventTodoId, setOpenTeamEventTodoId] = useState<
    string | null
  >(null);
  const [matchResult, setMatchResult] = useState("");
  const [matchTitle, setMatchTitle] = useState("");
  const [matchCount, setMatchCount] = useState("");
  const [matchWinCount, setMatchWinCount] = useState("");
  const [matchLossCount, setMatchLossCount] = useState("");
  const [matchReflection, setMatchReflection] = useState("");
  const [matchGoodPoints, setMatchGoodPoints] = useState("");
  const [matchChallenges, setMatchChallenges] = useState("");
  const [matchImprovementPlan, setMatchImprovementPlan] = useState("");
  const [matchTeamChallenges, setMatchTeamChallenges] = useState("");
  const [teamEventMeasurementDate, setTeamEventMeasurementDate] =
    useState("");
  const [teamEventWeightKg, setTeamEventWeightKg] = useState("");
  const [teamEventBodyFatPct, setTeamEventBodyFatPct] = useState("");
  const [teamEventMuscleMassKg, setTeamEventMuscleMassKg] = useState("");
  const [teamEventLeanBodyMassKg, setTeamEventLeanBodyMassKg] = useState("");
  const [matchReflections, setMatchReflections] = useState<
    {
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
    }[]
  >([]);
  const [loadingMatchReflections, setLoadingMatchReflections] = useState(true);
  const [openMatchReflectionId, setOpenMatchReflectionId] = useState<
    string | null
  >(null);
  const [savingTeamEventTodo, setSavingTeamEventTodo] = useState(false);

  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loadingInjuries, setLoadingInjuries] = useState(true);
  const [showInjuryForm, setShowInjuryForm] = useState(false);
  const [editingInjuryId, setEditingInjuryId] = useState<string | null>(null);
  const [injurySymptom, setInjurySymptom] = useState("");
  const [injuryBodyPart, setInjuryBodyPart] = useState("");
  const [injuryDetail, setInjuryDetail] = useState("");
  const [injuryRecoveryDate, setInjuryRecoveryDate] = useState("");
  const [injurySurgery, setInjurySurgery] = useState<"yes" | "no" | "unknown">(
    "unknown"
  );
  const [injuryNextHospital, setInjuryNextHospital] = useState("");
  const [injuryNextHospitalUndetermined, setInjuryNextHospitalUndetermined] =
    useState(false);
  const [injuryMatParticipation, setInjuryMatParticipation] = useState<
    "yes" | "no" | "conditional"
  >("no");
  const [injuryMatDetail, setInjuryMatDetail] = useState("");
  const [savingInjury, setSavingInjury] = useState(false);

  const [progressInjuryId, setProgressInjuryId] = useState<string | null>(
    null
  );
  const [progressIsRecovered, setProgressIsRecovered] = useState(true);
  const [progressRecoveryDate, setProgressRecoveryDate] = useState("");
  const [progressNote, setProgressNote] = useState("");
  const [progressMatParticipation, setProgressMatParticipation] = useState<
    "yes" | "no" | "conditional"
  >("no");
  const [progressMatDetail, setProgressMatDetail] = useState("");
  const [savingProgress, setSavingProgress] = useState(false);

  // 次の試合の登録・編集は設定ページに移設。マイページ側は表示用（カレンダーのハイライト等）に読み取りだけ行う。
  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);

  const [todayLog, setTodayLog] = useState<WeightLogRow | null>(null);
  const [logDate, setLogDate] = useState<string>(todayStr);
  const [todayLogText, setTodayLogText] = useState("");
  const [todayLogType, setTodayLogType] = useState<TrainingType | null>(null);
  const [todayLogTitle, setTodayLogTitle] = useState("");
  const [todayLogStartTime, setTodayLogStartTime] = useState("");
  // 種目（ラン/ウェイト/その他）ごとに、保存されているタイトルの候補一覧（最大10個ずつ）
  const [titleOptionsByType, setTitleOptionsByType] = useState<
    Record<TrainingType, string[]>
  >({ running: [], weight: [], other: [] });
  // 種目ごとの「タイトル→色」マップ（保存枠(10個)から外れたタイトルは含まれない＝無色になる）
  const [titleColorByType, setTitleColorByType] = useState<
    Record<TrainingType, Map<string, TitleColor>>
  >({ running: new Map(), weight: new Map(), other: new Map() });
  const [loadingLog, setLoadingLog] = useState(true);
  const [savingLog, setSavingLog] = useState(false);
  const [todayAbsentRecords, setTodayAbsentRecords] = useState<RecentRecord[]>(
    []
  );

  // マイページカレンダーの「一言メモ」（本人のみ閲覧、日付ごと1件・20文字まで）
  const [todayMemoId, setTodayMemoId] = useState<string | null>(null);
  const [todayMemoText, setTodayMemoText] = useState("");
  const [loadingMemo, setLoadingMemo] = useState(true);
  const [savingMemo, setSavingMemo] = useState(false);
  // 日付 → メモ内容（カレンダーのマス目にプレビュー表示するため、有無だけでなく内容も持つ）
  const [calendarMemoPreviews, setCalendarMemoPreviews] = useState<
    Map<string, string>
  >(new Map());

  // カレンダー用
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
  const [calendarSchedule, setCalendarSchedule] = useState<
    Map<
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
    >
  >(new Map());
  const [otherLocationOffDates, setOtherLocationOffDates] = useState<
    Set<string>
  >(new Set());
  // 自分がまだ実施報告・未実施報告をしていないマットメニューの日付
  const [matPendingDates, setMatPendingDates] = useState<Set<string>>(
    new Set()
  );
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<
    string | null
  >(null);

  const [, forceTick] = useState(0);
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    function scheduleNextMidnightTick() {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        5
      );
      const delay = nextMidnight.getTime() - now.getTime();
      timeoutId = setTimeout(() => {
        forceTick((n) => n + 1);
        scheduleNextMidnightTick();
      }, delay);
    }
    scheduleNextMidnightTick();
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (isManager) {
      checkPushSubscription();
      setLoadingTodo(false);
      return;
    }
    if (effectiveHomeLocation) loadTodo();
    else setLoadingTodo(false);
    loadSelfTrainingTodo();
    loadNextMatch();
    loadLogForDate(todayStr);
    loadMemoForDate(todayStr);
    loadTodayAbsent();
    loadTitleOptions();
    loadWeightMaxTodo();
    loadTeamEventTodos();
    loadMatchReflections();
    loadInjuries();
    checkPushSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor]);

  useEffect(() => {
    if (isFirstRefresh.current) {
      isFirstRefresh.current = false;
      return;
    }
    if (effectiveHomeLocation) loadTodo();
    loadSelfTrainingTodo();
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  async function loadTodo() {
    setLoadingTodo(true);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const joinedDate = toDateKey(new Date(profile.created_at));
    const rangeStart =
      toDateKey(twoWeeksAgo) > joinedDate
        ? toDateKey(twoWeeksAgo)
        : joinedDate;

    const { data: ownMenuData, error: ownMenuError } = await supabase
      .from("menus")
      .select("id, date, title, content, location, start_time, is_off")
      .eq("team_id", profile.team_id)
      .eq("location", effectiveHomeLocation)
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

    const menuMap = new Map<string, TodoMenuRow>();
    for (const m of (ownMenuData ?? []) as unknown as TodoMenuRow[]) {
      menuMap.set(m.id, m);
    }
    for (const m of (jointMenuData ?? []) as unknown as TodoMenuRow[]) {
      menuMap.set(m.id, m);
    }
    const menus = Array.from(menuMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    const openMenus = menus.filter((m) => isMenuReportOpen(m));

    if (openMenus.length === 0) {
      setTodoMenus([]);
      setLoadingTodo(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, kind")
      .eq("author_id", profile.id)
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

  // マット以外のセッション(ラン・ウェイトなど)が組まれている日のうち、
  // ラン/ウェイト/その他いずれかの自主トレ記録もまだ保存していない日を集計する
  async function loadSelfTrainingTodo() {
    if (!effectiveHomeLocation) {
      setSelfTrainingPending([]);
      return;
    }
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const joinedDate = toDateKey(new Date(profile.created_at));
    const rangeStart =
      toDateKey(twoWeeksAgo) > joinedDate
        ? toDateKey(twoWeeksAgo)
        : joinedDate;

    const { data: scheduleData, error: scheduleError } = await supabase
      .from("schedule_days")
      .select(
        "date, is_off, sessions:schedule_sessions(session_type)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", effectiveHomeLocation)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (scheduleError) {
      setErrorMsg(scheduleError.message);
      return;
    }

    const nonMatDates = ((scheduleData ?? []) as unknown as {
      date: string;
      is_off: boolean;
      sessions: { session_type: SessionType }[];
    }[])
      .filter((row) => row.sessions.some((s) => s.session_type !== "mat"))
      .map((row) => row.date);

    if (nonMatDates.length === 0) {
      setSelfTrainingPending([]);
      return;
    }

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("date")
      .eq("author_id", profile.id)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (logError) {
      setErrorMsg(logError.message);
      return;
    }

    // 未実施報告の代替メニューは「マット」への代替であり、
    // 別枠のラン/ウェイトなどのセッション消化とは別物なのでここではカウントしない
    const loggedDates = new Set(
      ((logData ?? []) as { date: string }[]).map((r) => r.date)
    );

    setSelfTrainingPending(
      nonMatDates.filter((d) => !loggedDates.has(d)).sort()
    );
  }

  async function loadNextMatch() {
    setLoadingMatch(true);
    const { data, error } = await supabase
      .from("matches")
      .select("id, name, date, member_id")
      .eq("team_id", profile.team_id)
      .eq("member_id", profile.id)
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

  async function loadWeightMaxTodo() {
    if (profile.role === "coach") return;

    const { data: eventData, error: eventError } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at")
      .eq("team_id", profile.team_id)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (eventError) {
      setErrorMsg(eventError.message);
      return;
    }
    if (!eventData) {
      setWeightMaxTodo(null);
      return;
    }
    const event = eventData as {
      id: string;
      deadline: string;
      created_at: string;
    };

    const { data: targetData, error: targetError } = await supabase
      .from("weight_max_event_targets")
      .select("member_id")
      .eq("event_id", event.id);
    if (targetError) {
      setErrorMsg(targetError.message);
      return;
    }
    const targetRows = (targetData ?? []) as { member_id: string }[];
    if (
      targetRows.length > 0 &&
      !targetRows.some((r) => r.member_id === profile.id)
    ) {
      setWeightMaxTodo(null);
      return;
    }

    const { data: maxData, error: maxError } = await supabase
      .from("weight_maxes")
      .select("id")
      .eq("author_id", profile.id)
      .eq("event_id", event.id)
      .maybeSingle();

    if (maxError) {
      setErrorMsg(maxError.message);
      return;
    }

    setWeightMaxTodo(
      maxData
        ? null
        : {
            eventId: event.id,
            deadline: event.deadline,
            createdAt: event.created_at,
          }
    );
  }

  async function loadMatchReflections() {
    setLoadingMatchReflections(true);
    const { data, error } = await supabase
      .from("team_event_submissions")
      .select(
        "event_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, event:team_events!team_event_submissions_event_id_fkey(title, type)"
      )
      .eq("author_id", profile.id);

    if (error) {
      setErrorMsg(error.message);
      setLoadingMatchReflections(false);
      return;
    }

    const rows = (data ?? []) as unknown as {
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

    const reflections = rows
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
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

    setMatchReflections(reflections);
    setLoadingMatchReflections(false);
  }

  async function loadTeamEventTodos() {
    if (profile.role === "coach") return;

    const { data: eventData, error: eventError } = await supabase
      .from("team_events")
      .select("id, type, title, deadline")
      .eq("team_id", profile.team_id)
      .is("closed_at", null);

    if (eventError) {
      setErrorMsg(eventError.message);
      return;
    }
    const events = (eventData ?? []) as {
      id: string;
      type: "match_reflection" | "body_composition";
      title: string;
      deadline: string;
    }[];
    if (events.length === 0) {
      setTeamEventTodos([]);
      return;
    }

    const { data: subData, error: subError } = await supabase
      .from("team_event_submissions")
      .select("event_id")
      .eq("author_id", profile.id)
      .in(
        "event_id",
        events.map((e) => e.id)
      );

    if (subError) {
      setErrorMsg(subError.message);
      return;
    }
    const submittedIds = new Set(
      ((subData ?? []) as { event_id: string }[]).map((r) => r.event_id)
    );

    const { data: targetData, error: targetError } = await supabase
      .from("team_event_targets")
      .select("event_id, member_id")
      .in(
        "event_id",
        events.map((e) => e.id)
      );
    if (targetError) {
      setErrorMsg(targetError.message);
      return;
    }
    const targetRows = (targetData ?? []) as {
      event_id: string;
      member_id: string;
    }[];
    const eventsWithTargets = new Set(targetRows.map((r) => r.event_id));
    const myTargetedEventIds = new Set(
      targetRows.filter((r) => r.member_id === profile.id).map((r) => r.event_id)
    );

    setTeamEventTodos(
      events
        .filter((e) => !submittedIds.has(e.id))
        .filter(
          (e) => !eventsWithTargets.has(e.id) || myTargetedEventIds.has(e.id)
        )
        .map((e) => ({
          eventId: e.id,
          type: e.type,
          title: e.title,
          deadline: e.deadline,
        }))
    );
  }

  async function handleSaveTeamEventTodo(todo: {
    eventId: string;
    type: "match_reflection" | "body_composition";
  }) {
    setSavingTeamEventTodo(true);
    const payload: {
      team_id: string;
      event_id: string;
      author_id: string;
      updated_at: string;
      content?: string;
      weight_kg?: number | null;
      body_fat_pct?: number | null;
      measurement_date?: string | null;
      muscle_mass_kg?: number | null;
      lean_body_mass_kg?: number | null;
      match_result?: string;
      match_title?: string;
      match_count?: number | null;
      win_count?: number | null;
      loss_count?: number | null;
      reflection?: string;
      good_points?: string;
      challenges?: string;
      improvement_plan?: string;
      team_challenges?: string;
    } = {
      team_id: profile.team_id,
      event_id: todo.eventId,
      author_id: profile.id,
      updated_at: new Date().toISOString(),
    };
    if (todo.type === "match_reflection") {
      payload.content = "";
      payload.match_result = matchResult;
      payload.match_title = matchTitle;
      payload.match_count = matchCount ? Number(matchCount) : null;
      payload.win_count = matchWinCount ? Number(matchWinCount) : null;
      payload.loss_count = matchLossCount ? Number(matchLossCount) : null;
      payload.reflection = matchReflection;
      payload.good_points = matchGoodPoints;
      payload.challenges = matchChallenges;
      payload.improvement_plan = matchImprovementPlan;
      payload.team_challenges = matchTeamChallenges;
    } else {
      payload.content = "";
      payload.measurement_date = teamEventMeasurementDate || null;
      payload.weight_kg = teamEventWeightKg ? Number(teamEventWeightKg) : null;
      payload.body_fat_pct = teamEventBodyFatPct
        ? Number(teamEventBodyFatPct)
        : null;
      payload.muscle_mass_kg = teamEventMuscleMassKg
        ? Number(teamEventMuscleMassKg)
        : null;
      payload.lean_body_mass_kg = teamEventLeanBodyMassKg
        ? Number(teamEventLeanBodyMassKg)
        : null;
    }

    const { error } = await supabase
      .from("team_event_submissions")
      .upsert(payload, { onConflict: "event_id,author_id" });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setOpenTeamEventTodoId(null);
      setMatchResult("");
      setMatchTitle("");
      setMatchCount("");
      setMatchWinCount("");
      setMatchLossCount("");
      setMatchReflection("");
      setMatchGoodPoints("");
      setMatchChallenges("");
      setMatchImprovementPlan("");
      setMatchTeamChallenges("");
      setTeamEventMeasurementDate("");
      setTeamEventWeightKg("");
      setTeamEventBodyFatPct("");
      setTeamEventMuscleMassKg("");
      setTeamEventLeanBodyMassKg("");
      await loadTeamEventTodos();
      await loadMatchReflections();
    }
    setSavingTeamEventTodo(false);
  }

  async function handleSaveWeightMaxTodo() {
    if (!weightMaxTodo) return;
    setSavingWeightMaxTodo(true);
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));

    const { error } = await supabase.from("weight_maxes").upsert(
      {
        team_id: profile.team_id,
        author_id: profile.id,
        event_id: weightMaxTodo.eventId,
        bench: toNum(weightMaxBench),
        squat: toNum(weightMaxSquat),
        deadlift: toNum(weightMaxDeadlift),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "author_id,event_id" }
    );

    if (error) {
      setErrorMsg(error.message);
    } else {
      setWeightMaxTodo(null);
      setWeightMaxTodoOpen(false);
      setWeightMaxBench("");
      setWeightMaxSquat("");
      setWeightMaxDeadlift("");
    }
    setSavingWeightMaxTodo(false);
  }

  async function checkPushSubscription() {
    if (!isPushSupported()) {
      setPushSupported(false);
      return;
    }
    setPushSupported(true);
    try {
      const registration =
        await navigator.serviceWorker.getRegistration("/sw.js");
      const existing = await registration?.pushManager.getSubscription();
      setPushSubscribed(!!existing);
    } catch {
      setPushSubscribed(false);
    }
  }

  async function handleEnablePush() {
    if (!isPushSupported()) return;
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErrorMsg(
          "通知が許可されませんでした。端末の設定から通知を許可してください。"
        );
        setPushLoading(false);
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setErrorMsg("通知の設定が未完了です(コーチ・管理者に連絡してください)。");
        setPushLoading(false);
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const json = subscription.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          author_id: profile.id,
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" }
      );

      if (error) {
        setErrorMsg(error.message);
      } else {
        setPushSubscribed(true);
      }
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "通知の設定中にエラーが発生しました。"
      );
    }
    setPushLoading(false);
  }

  async function handleDisablePush() {
    setPushLoading(true);
    try {
      const registration =
        await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        const { error } = await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", endpoint);
        if (error) {
          setErrorMsg(error.message);
        }
      }
      setPushSubscribed(false);
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "通知の解除中にエラーが発生しました。"
      );
    }
    setPushLoading(false);
  }

  async function loadInjuries() {
    setLoadingInjuries(true);
    const { data, error } = await supabase
      .from("injuries")
      .select(
        "id, symptom_name, body_part, detail, expected_recovery_date, surgery_possibility, next_hospital_date, mat_participation, mat_participation_detail, is_recovered, progress_note, progress_updated_at, created_at"
      )
      .eq("author_id", profile.id)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setInjuries((data ?? []) as InjuryRow[]);
    }
    setLoadingInjuries(false);
  }

  function resetInjuryForm() {
    setEditingInjuryId(null);
    setInjurySymptom("");
    setInjuryBodyPart("");
    setInjuryDetail("");
    setInjuryRecoveryDate("");
    setInjurySurgery("unknown");
    setInjuryNextHospital("");
    setInjuryNextHospitalUndetermined(false);
    setInjuryMatParticipation("no");
    setInjuryMatDetail("");
  }

  function handleStartNewInjury() {
    resetInjuryForm();
    setShowInjuryForm(true);
  }

  function handleStartEditInjury(row: InjuryRow) {
    setEditingInjuryId(row.id);
    setInjurySymptom(row.symptom_name);
    setInjuryBodyPart(row.body_part);
    setInjuryDetail(row.detail ?? "");
    setInjuryRecoveryDate(row.expected_recovery_date ?? "");
    setInjurySurgery(row.surgery_possibility);
    setInjuryNextHospital(row.next_hospital_date ?? "");
    setInjuryNextHospitalUndetermined(!row.next_hospital_date);
    setInjuryMatParticipation(row.mat_participation);
    setInjuryMatDetail(row.mat_participation_detail ?? "");
    setShowInjuryForm(true);
  }

  async function handleSubmitInjury(e: React.FormEvent) {
    e.preventDefault();
    if (!injurySymptom.trim() || !injuryBodyPart.trim()) return;
    setSavingInjury(true);

    const editPayload = {
      expected_recovery_date: injuryRecoveryDate || null,
      next_hospital_date: injuryNextHospitalUndetermined
        ? null
        : injuryNextHospital || null,
      updated_at: new Date().toISOString(),
    };

    const newPayload = {
      team_id: profile.team_id,
      author_id: profile.id,
      symptom_name: injurySymptom.trim(),
      body_part: injuryBodyPart.trim(),
      detail: injuryDetail.trim() || null,
      expected_recovery_date: injuryRecoveryDate || null,
      surgery_possibility: injurySurgery,
      next_hospital_date: injuryNextHospitalUndetermined
        ? null
        : injuryNextHospital || null,
      mat_participation: injuryMatParticipation,
      mat_participation_detail:
        injuryMatParticipation === "conditional"
          ? injuryMatDetail.trim() || null
          : null,
      updated_at: new Date().toISOString(),
    };

    const { error } = editingInjuryId
      ? await supabase
          .from("injuries")
          .update(editPayload)
          .eq("id", editingInjuryId)
      : await supabase.from("injuries").insert(newPayload);

    if (error) {
      setErrorMsg(error.message);
    } else {
      resetInjuryForm();
      setShowInjuryForm(false);
      await loadInjuries();
    }
    setSavingInjury(false);
  }

  async function handleMarkRecovered(id: string) {
    if (!window.confirm("この怪我を「完治」として報告しますか？")) return;
    const { error } = await supabase
      .from("injuries")
      .update({
        is_recovered: true,
        progress_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadInjuries();
    }
  }

  function injuryNeedsProgressUpdate(inj: InjuryRow): boolean {
    if (inj.is_recovered) return false;
    const triggerDates = [inj.expected_recovery_date, inj.next_hospital_date]
      .filter((d): d is string => !!d)
      .sort();
    if (triggerDates.length === 0) return false;
    const earliestTrigger = triggerDates[0];
    if (earliestTrigger > todayStr) return false;
    if (inj.progress_updated_at) {
      const updatedDateStr = toDateKey(new Date(inj.progress_updated_at));
      if (updatedDateStr >= todayStr) return false;
    }
    return true;
  }

  function handleStartProgress(inj: InjuryRow) {
    setProgressInjuryId(inj.id);
    setProgressIsRecovered(true);
    setProgressRecoveryDate(inj.expected_recovery_date ?? "");
    setProgressNote("");
    setProgressMatParticipation(inj.mat_participation);
    setProgressMatDetail(inj.mat_participation_detail ?? "");
  }

  async function handleSubmitProgress() {
    if (!progressInjuryId) return;
    setSavingProgress(true);

    const payload = progressIsRecovered
      ? {
          is_recovered: true,
          progress_note: progressNote.trim() || null,
          progress_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      : {
          is_recovered: false,
          expected_recovery_date: progressRecoveryDate || null,
          progress_note: progressNote.trim() || null,
          mat_participation: progressMatParticipation,
          mat_participation_detail:
            progressMatParticipation === "conditional"
              ? progressMatDetail.trim() || null
              : null,
          progress_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

    const { error } = await supabase
      .from("injuries")
      .update(payload)
      .eq("id", progressInjuryId);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setProgressInjuryId(null);
      await loadInjuries();
      notifyTasksChanged();
    }
    setSavingProgress(false);
  }

  async function loadTitleOptions() {
    // 登録された順番（初めて使われた日時=created_at昇順）を知るためにcreated_atも取得する
    const { data, error } = await supabase
      .from("weight_logs")
      .select("type, title, created_at")
      .eq("author_id", profile.id)
      .not("title", "is", null)
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // 種目ごとに、タイトルが最初に使われた時刻（created_at昇順で最初に出てきたもの）を記録する
    const firstSeenByType: Record<TrainingType, Map<string, string>> = {
      running: new Map(),
      weight: new Map(),
      other: new Map(),
    };
    for (const r of (data ?? []) as {
      type: TrainingType;
      title: string | null;
      created_at: string;
    }[]) {
      if (!r.title || r.title.trim() === "") continue;
      const m = firstSeenByType[r.type];
      if (!m.has(r.title)) m.set(r.title, r.created_at);
    }

    const nextOptions: Record<TrainingType, string[]> = {
      running: [],
      weight: [],
      other: [],
    };
    const nextColors: Record<TrainingType, Map<string, TitleColor>> = {
      running: new Map(),
      weight: new Map(),
      other: new Map(),
    };

    (Object.keys(firstSeenByType) as TrainingType[]).forEach((type) => {
      // 登録された順（古い→新しい）に並べる
      const ordered = Array.from(firstSeenByType[type].entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([title]) => title);
      const total = ordered.length;
      // 直近MAX_SAVED_TITLES個だけを「保存枠」として残す（古いものは保存枠から外れる＝無色になる）
      const active = ordered.slice(Math.max(0, total - MAX_SAVED_TITLES));
      const dropped = total - active.length;
      const colorMap = new Map<string, TitleColor>();
      active.forEach((title, i) => {
        // 全体の中での登録順（0始まり）。10個周期でスロット（＝色）を使い回すことで、
        // 11個目が1個目と同じ色を引き継ぐ、という挙動になる
        const overallRank = dropped + i;
        colorMap.set(title, getTitleColorBySlot(overallRank));
      });
      nextColors[type] = colorMap;
      nextOptions[type] = active.slice().sort((a, b) => a.localeCompare(b, "ja"));
    });

    setTitleOptionsByType(nextOptions);
    setTitleColorByType(nextColors);
  }

  async function loadLogForDate(date: string) {
    setLoadingLog(true);
    setLogDate(date);
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id, date, content, type, title, start_time")
      .eq("author_id", profile.id)
      .eq("date", date)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
    } else if (data) {
      const row = data as WeightLogRow;
      setTodayLog(row);
      setTodayLogText(row.content);
      setTodayLogType(row.type);
      setTodayLogTitle(row.title ?? "");
      setTodayLogStartTime(row.start_time ? row.start_time.slice(0, 5) : "");
    } else {
      setTodayLog(null);
      setTodayLogText("");
      setTodayLogType(null);
      setTodayLogTitle("");
      setTodayLogStartTime("");
    }
    setLoadingLog(false);
  }

  async function loadMemoForDate(date: string) {
    setLoadingMemo(true);
    const { data, error } = await supabase
      .from("personal_memos")
      .select("id, content")
      .eq("author_id", profile.id)
      .eq("date", date)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
    } else if (data) {
      const row = data as { id: string; content: string };
      setTodayMemoId(row.id);
      setTodayMemoText(row.content);
    } else {
      setTodayMemoId(null);
      setTodayMemoText("");
    }
    setLoadingMemo(false);
  }

  async function handleSaveMemo() {
    setSavingMemo(true);
    const trimmed = todayMemoText.slice(0, 20);
    const { data, error } = await supabase
      .from("personal_memos")
      .upsert(
        {
          id: todayMemoId ?? undefined,
          team_id: profile.team_id,
          author_id: profile.id,
          date: logDate,
          content: trimmed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "author_id,date" }
      )
      .select("id, content")
      .single();

    if (error) {
      setErrorMsg(error.message);
    } else {
      const row = data as { id: string; content: string };
      setTodayMemoId(row.id);
      setTodayMemoText(row.content);
      await loadCalendarData();
    }
    setSavingMemo(false);
  }

  async function loadTodayAbsent() {
    const { data, error } = await supabase
      .from("comments")
      .select("id, text, alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", profile.id)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    const rows = (data ?? []) as unknown as {
      id: string;
      text: string;
      alt_type: TrainingType;
      menu: { date: string } | null;
    }[];
    const todayRecords: RecentRecord[] = rows
      .filter((r) => r.menu && r.menu.date === todayStr)
      .map((r) => ({
        id: r.id,
        date: r.menu!.date,
        content: r.text,
        type: r.alt_type,
        title: null,
        isAlternative: true,
      }));
    setTodayAbsentRecords(todayRecords);
  }

  async function handleSaveLog() {
    if (!todayLogType) return;
    if (todayLogStartTime && todayLogStartTime < "06:00") {
      setErrorMsg("開始時間はその日の6時以降で入力してください。");
      return;
    }
    setSavingLog(true);
    const trimmedTitle = todayLogTitle.trim();
    const { data, error } = await supabase
      .from("weight_logs")
      .upsert(
        {
          id: todayLog?.id,
          team_id: profile.team_id,
          author_id: profile.id,
          date: logDate,
          content: todayLogText,
          type: todayLogType,
          title: trimmedTitle ? trimmedTitle : null,
          start_time: todayLogStartTime || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "author_id,date" }
      )
      .select("id, date, content, type, title, start_time")
      .single();

    if (error) {
      setErrorMsg(error.message);
    } else {
      setTodayLog(data as WeightLogRow);
      await loadSelfTrainingTodo();
      await loadTitleOptions();
      await loadCalendarData();
      notifyTasksChanged();
    }
    setSavingLog(false);
  }

  async function loadCalendarData() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const { data: weightData, error: weightError } = await supabase
      .from("weight_logs")
      .select("date, type, title")
      .eq("author_id", profile.id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (weightError) {
      setErrorMsg(weightError.message);
    } else {
      setCalendarWeightLogs(
        (weightData ?? []) as {
          date: string;
          type: TrainingType;
          title: string | null;
        }[]
      );
    }

    const { data: memoData, error: memoError } = await supabase
      .from("personal_memos")
      .select("date, content")
      .eq("author_id", profile.id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (memoError) {
      setErrorMsg(memoError.message);
    } else {
      const map = new Map<string, string>();
      for (const r of (memoData ?? []) as {
        date: string;
        content: string;
      }[]) {
        const trimmed = r.content.trim();
        if (trimmed.length > 0) map.set(r.date, trimmed);
      }
      setCalendarMemoPreviews(map);
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", profile.id)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (absentError) {
      setErrorMsg(absentError.message);
    } else {
      const rows = (absentData ?? []) as unknown as {
        alt_type: TrainingType;
        menu: { date: string } | null;
      }[];
      const filtered = rows
        .filter(
          (r) => r.menu && r.menu.date >= rangeStart && r.menu.date <= rangeEnd
        )
        .map((r) => ({ date: r.menu!.date, type: r.alt_type, title: null }));
      setCalendarAbsentLogs(filtered);
    }

    if (effectiveHomeLocation) {
      const { data: scheduleData, error: scheduleError } = await supabase
        .from("schedule_days")
        .select(
          "date, is_off, day_type, event_name, sessions:schedule_sessions(session_type, start_time, location_note, is_joint, joint_location)"
        )
        .eq("team_id", profile.team_id)
        .eq("location", effectiveHomeLocation)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      if (scheduleError) {
        setErrorMsg(scheduleError.message);
      } else {
        const map = new Map<
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
        >();
        for (const row of (scheduleData ?? []) as unknown as {
          date: string;
          is_off: boolean;
          day_type: DayType;
          event_name: string | null;
          sessions: {
            session_type: SessionType;
            start_time: string | null;
            location_note: string | null;
            is_joint: boolean;
            joint_location: Location | null;
          }[];
        }[]) {
          const sessions = row.sessions
            .slice()
            .sort((a, b) =>
              (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99")
            )
            .map((s) => ({
              type: s.session_type,
              time: s.start_time,
              locationNote: s.location_note,
              isJoint: s.is_joint,
              jointLocation: s.joint_location,
            }));
          const hasMat = row.sessions.some((s) => s.session_type === "mat");
          map.set(row.date, {
            dayType: row.day_type,
            isOff: row.is_off,
            eventName: row.event_name,
            hasMat,
            sessions,
          });
        }
        setCalendarSchedule(map);
      }

      const otherLocation: Location =
        effectiveHomeLocation === "otsuka" ? "tama" : "otsuka";
      const { data: otherOffData, error: otherOffError } = await supabase
        .from("schedule_days")
        .select("date, is_off")
        .eq("team_id", profile.team_id)
        .eq("location", otherLocation)
        .eq("is_off", true)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      if (otherOffError) {
        setErrorMsg(otherOffError.message);
      } else {
        setOtherLocationOffDates(
          new Set(
            ((otherOffData ?? []) as { date: string }[]).map((r) => r.date)
          )
        );
      }

      // 自分がまだ実施報告・未実施報告をしていないマットメニューの日付を集計
      const { data: ownMenus } = await supabase
        .from("menus")
        .select("id, date, start_time")
        .eq("team_id", profile.team_id)
        .eq("location", effectiveHomeLocation)
        .eq("is_off", false)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      const { data: jointMenus } = await supabase
        .from("menus")
        .select("id, date, start_time")
        .eq("team_id", profile.team_id)
        .eq("is_joint", true)
        .eq("is_off", false)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);
      const menuRows = [
        ...((ownMenus ?? []) as { id: string; date: string; start_time: string | null }[]),
        ...((jointMenus ?? []) as { id: string; date: string; start_time: string | null }[]),
      ];
      const pastMenus = menuRows.filter((m) => {
        if (!m.start_time) return true;
        return new Date() >= new Date(`${m.date}T${m.start_time}`);
      });
      if (pastMenus.length > 0) {
        const { data: myComments } = await supabase
          .from("comments")
          .select("menu_id, kind")
          .eq("author_id", profile.id)
          .in(
            "menu_id",
            pastMenus.map((m) => m.id)
          )
          .in("kind", ["report", "absent"]);
        const respondedIds = new Set(
          ((myComments ?? []) as { menu_id: string }[]).map((c) => c.menu_id)
        );
        setMatPendingDates(
          new Set(
            pastMenus.filter((m) => !respondedIds.has(m.id)).map((m) => m.date)
          )
        );
      } else {
        setMatPendingDates(new Set());
      }
    }
  }


  function handleSelectCalendarDate(dateStr: string) {
    setSelectedCalendarDate(dateStr);
    loadLogForDate(dateStr);
    loadMemoForDate(dateStr);
  }

  const [homeSubTab, setHomeSubTab] = useState<"training" | "injury">(
    "training"
  );

  // フッター上のサブナビ（トレーニング／怪我の記録の切り替え）を登録
  // ※ node は必ず useMemo で安定させること。毎レンダー新しいJSXを渡すと
  //   useSubNav内のuseEffectが依存配列[node]の変化を検知して毎回発火し、
  //   AppShell側の再レンダーとの間で無限ループになりうる。
  const homeSubNav = useMemo(
    () =>
      !isManager ? (
        <SubTabBar
          items={homeSubTabItems}
          active={homeSubTab}
          onChange={setHomeSubTab}
        />
      ) : null,
    [isManager, homeSubTab]
  );
  useSubNav(homeSubNav);

  // タイトル入力欄の下の詳細ボックスは、入力途中の文字列そのままでは色を変えない
  // （キー入力のたびに色がコロコロ変わって分かりにくいため）。
  // 既に保存されている（保存枠に入っている）タイトルと完全一致した時だけ、その色を使う。
  const activeTitleColor = todayLogType
    ? titleColorByType[todayLogType].get(todayLogTitle.trim())
    : undefined;

  return (
    <>
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}

      {!isManager && (
        <>
      {/* タスク一覧（練習タスク・怪我タスク） */}
      {isOb && (
        <div className="flex items-center justify-end border-t border-neutral-800 pt-4">
          <button
            onClick={handleToggleTaskListPref}
            disabled={savingTaskListPref}
            className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 active:bg-neutral-800 disabled:opacity-50"
          >
            {showTaskListPref
              ? "タスクのポップアップを非表示にする"
              : "タスクのポップアップを表示する"}
          </button>
        </div>
      )}
      {(() => {
        if (isOb && !showTaskListPref) return null;
        const queueTasks: QueueTask[] = [];

        for (const inj of injuries.filter(injuryNeedsProgressUpdate)) {
          const isOpen = progressInjuryId === inj.id;
          queueTasks.push({
            key: `injury-${inj.id}`,
            badgeLabel: "怪我タスク：経過報告",
            title: `「${inj.symptom_name}」の経過を報告する`,
            urgent: true,
            content: (
              <div className="flex flex-col gap-2">
                {!isOpen && (
                  <button
                    onClick={() => handleStartProgress(inj)}
                    className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700"
                  >
                    経過を入力する
                  </button>
                )}
                {isOpen && (
                  <div className="flex flex-col gap-2 rounded-lg bg-neutral-800 p-3">
                    <div className="flex gap-2 rounded-lg bg-neutral-900 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setProgressIsRecovered(true)}
                        className={`flex-1 rounded-md py-2 font-medium ${
                          progressIsRecovered
                            ? "bg-red-600 text-white shadow"
                            : "text-neutral-400"
                        }`}
                      >
                        完治した
                      </button>
                      <button
                        type="button"
                        onClick={() => setProgressIsRecovered(false)}
                        className={`flex-1 rounded-md py-2 font-medium ${
                          !progressIsRecovered
                            ? "bg-red-600 text-white shadow"
                            : "text-neutral-400"
                        }`}
                      >
                        まだ完治していない
                      </button>
                    </div>
                    {!progressIsRecovered && (
                      <>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          新しい完治見込み日
                          <input
                            type="date"
                            value={progressRecoveryDate}
                            onChange={(e) =>
                              setProgressRecoveryDate(e.target.value)
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          マット参加の可否
                          <select
                            value={progressMatParticipation}
                            onChange={(e) =>
                              setProgressMatParticipation(
                                e.target.value as "yes" | "no" | "conditional"
                              )
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          >
                            <option value="no">非</option>
                            <option value="yes">可</option>
                            <option value="conditional">条件付きで可</option>
                          </select>
                        </label>
                        {progressMatParticipation === "conditional" && (
                          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                            条件の詳細
                            <textarea
                              value={progressMatDetail}
                              onChange={(e) =>
                                setProgressMatDetail(e.target.value)
                              }
                              rows={2}
                              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                            />
                          </label>
                        )}
                      </>
                    )}
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                      理由・経過（自由記述）
                      <textarea
                        value={progressNote}
                        onChange={(e) => setProgressNote(e.target.value)}
                        rows={3}
                        placeholder={
                          progressIsRecovered
                            ? "任意で記入できます"
                            : "完治していない理由や現在の状態など"
                        }
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                      />
                    </label>
                    <button
                      onClick={handleSubmitProgress}
                      disabled={savingProgress}
                      className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                    >
                      提出する
                    </button>
                  </div>
                )}
              </div>
            ),
          });
        }

        for (const m of todoMenus) {
          const isOverdue = m.date < todayStr;
          queueTasks.push({
            key: `mat-${m.id}`,
            badgeLabel: `練習タスク：実施報告 未提出${isOverdue ? "（期限切れ）" : ""}`,
            title: m.title || formatShortDateTime(m.date, m.start_time),
            urgent: isOverdue,
            content: (
              <MatReportInlineForm
                menu={m}
                onSubmitted={async () => {
                  await loadTodo();
                  notifyTasksChanged();
                }}
                onError={setErrorMsg}
                profileId={profile.id}
                supabase={supabase}
              />
            ),
          });
        }

        for (const date of selfTrainingPending) {
          const isOverdue = date < todayStr;
          queueTasks.push({
            key: `self-${date}`,
            badgeLabel: `練習タスク：トレ報 未提出${isOverdue ? "（期限切れ）" : ""}`,
            title: `${formatMonthDay(date)}の自主トレを記録する`,
            urgent: isOverdue,
            content: (
              <SelfTrainingInlineForm
                date={date}
                profile={profile}
                supabase={supabase}
                titleOptions={titleOptionsByType}
                titleColors={titleColorByType}
                onSubmitted={async () => {
                  await loadSelfTrainingTodo();
                  await loadTitleOptions();
                  await loadCalendarData();
                  if (logDate === date) await loadLogForDate(date);
                  notifyTasksChanged();
                }}
                onError={setErrorMsg}
              />
            ),
          });
        }

        return <TaskQueuePopup tasks={queueTasks} />;
      })()}
        </>
      )}

      {/* カレンダー（トレーニングの記録） */}
      {homeSubTab === "training" && (
      <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          トレーニングの記録
        </h2>
        <UnifiedCalendar
          cursor={calendarCursor}
          onCursorChange={setCalendarCursor}
          weightLogs={calendarWeightLogs}
          absentLogs={calendarAbsentLogs}
          scheduleByDate={calendarSchedule}
          matPendingDates={isManager ? new Set() : matPendingDates}
          disablePendingIndicator={isManager}
          onSelectDate={handleSelectCalendarDate}
          highlightDate={selectedCalendarDate}
          todayDate={todayStr}
          nextMatchDate={isManager ? null : (nextMatch?.date ?? null)}
          homeLocation={effectiveHomeLocation ?? "tama"}
          otherLocationOffDates={otherLocationOffDates}
          memoPreviews={calendarMemoPreviews}
          titleColorByType={titleColorByType}
        />
      </section>
      )}

      {!isManager && (
        <>
      {homeSubTab === "training" && (
      <section
        ref={logSectionRef}
        className="flex flex-col gap-2 border-t border-neutral-800 pt-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            {logDate === todayStr
              ? "本日のトレーニングメニュー"
              : `${formatMonthDay(logDate)}のトレーニングメニュー`}
          </h2>
          {logDate !== todayStr && (
            <button
              onClick={() => {
                loadLogForDate(todayStr);
                loadMemoForDate(todayStr);
              }}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
            >
              今日に戻る
            </button>
          )}
        </div>

        {loadingMemo ? null : (
          <div className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-neutral-400">
                一言メモ（自分だけが見られます・20文字まで）
              </label>
              <span className="shrink-0 text-[10px] text-neutral-500">
                {todayMemoText.length}/20
              </span>
            </div>
            <textarea
              value={todayMemoText}
              onChange={(e) => setTodayMemoText(e.target.value.slice(0, 20))}
              maxLength={20}
              rows={1}
              placeholder="例：体調良好、右膝に違和感 など"
              className="resize-none rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
            <button
              onClick={handleSaveMemo}
              disabled={savingMemo}
              className="self-end rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white active:bg-neutral-600 disabled:opacity-50"
            >
              {savingMemo ? "保存中…" : "メモを保存する"}
            </button>
          </div>
        )}

        {logDate === todayStr &&
          todayAbsentRecords.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-400">
              <span
                className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[r.type]}`}
              />
              {trainingTypeLabel[r.type]}
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-300">
                未実施報告の代替メニュー
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm text-neutral-100">
              {r.content}
            </p>
          </div>
        ))}

        {loadingLog ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
              {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTodayLogType(t)}
                  className={`flex-1 rounded-md py-2 font-medium ${
                    todayLogType === t
                      ? "bg-red-600 text-white shadow"
                      : "text-neutral-400"
                  }`}
                >
                  {trainingTypeLabel[t]}
                </button>
              ))}
            </div>
            {todayLogType && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                開始時間（任意。その日の6時以降）
                <input
                  type="time"
                  min="06:00"
                  max="23:59"
                  value={todayLogStartTime}
                  onChange={(e) => setTodayLogStartTime(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
            )}
            {todayLogType && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                タイトル（メニュー名など。任意。カレンダーにも表示できます）
                <input
                  type="text"
                  list={`${todayLogType}-title-options`}
                  value={todayLogTitle}
                  onChange={(e) => setTodayLogTitle(e.target.value)}
                  placeholder="例：BIG3、上半身の日、インターバル走 など"
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
                <datalist id={`${todayLogType}-title-options`}>
                  {titleOptionsByType[todayLogType].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                {titleOptionsByType[todayLogType].length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {titleOptionsByType[todayLogType].map((t) => {
                      const c = titleColorByType[todayLogType].get(t);
                      const selected = todayLogTitle.trim() === t;
                      return (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTodayLogTitle(t)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                            selected
                              ? `${c?.border ?? "border-neutral-600"} ${c?.fill ?? "bg-neutral-800"} ${c?.text ?? "text-neutral-200"}`
                              : "border-neutral-700 text-neutral-400 active:bg-neutral-800"
                          }`}
                        >
                          {c && (
                            <span
                              className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${c.dot}`}
                            />
                          )}
                          {t}
                        </button>
                      );
                    })}
                  </div>
                )}
              </label>
            )}
            <textarea
              value={todayLogText}
              onChange={(e) => setTodayLogText(e.target.value)}
              placeholder={
                "例：\nBP\n60・80・90・100\n110kg×7、3\n\nトレーニングしながら、その場でメモしていってOKです"
              }
              rows={10}
              className={`rounded-lg border px-3 py-2.5 text-sm text-neutral-100 ${
                !todayLog
                  ? "border-neutral-700 bg-neutral-900"
                  : activeTitleColor
                    ? `${activeTitleColor.border} ${activeTitleColor.fill}`
                    : "border-emerald-800 bg-emerald-950/40"
              }`}
            />
            <button
              onClick={handleSaveLog}
              disabled={savingLog || !todayLogType}
              className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
            >
              {todayLog ? "更新する" : "保存する"}
            </button>
            {todayLog && (
              <p className="text-[11px] text-emerald-400">
                保存済みです。内容を変えてから「更新する」を押すと上書きされます。
              </p>
            )}

            {todayLogType === "running" && !todayLogTitle.trim() && (
              <RecentTypeLogs
                supabase={supabase}
                authorId={profile.id}
                excludeDate={logDate}
                type="running"
                label="直近のランメニュー"
              />
            )}
            {todayLogType && todayLogTitle.trim() && (
              <RecentTypeLogs
                supabase={supabase}
                authorId={profile.id}
                excludeDate={logDate}
                type={todayLogType}
                title={todayLogTitle.trim()}
                label={`直近の${todayLogTitle.trim()}のトレーニングメニュー`}
              />
            )}
          </div>
        )}
      </section>
      )}

      {homeSubTab === "injury" && (
      <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          怪我の記録・復帰計画
        </h2>
        {!showInjuryForm && (
          <button
            onClick={handleStartNewInjury}
            className="self-start rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700"
          >
            ＋ 怪我を報告する
          </button>
        )}
        {showInjuryForm && (
          <form
            onSubmit={handleSubmitInjury}
            className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              怪我の症状名
              <input
                type="text"
                value={injurySymptom}
                onChange={(e) => setInjurySymptom(e.target.value)}
                disabled={!!editingInjuryId}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-60"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              部位
              <input
                type="text"
                value={injuryBodyPart}
                onChange={(e) => setInjuryBodyPart(e.target.value)}
                disabled={!!editingInjuryId}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-60"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              詳細（任意）
              <textarea
                value={injuryDetail}
                onChange={(e) => setInjuryDetail(e.target.value)}
                disabled={!!editingInjuryId}
                rows={3}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              完治見込み日（任意）
              <input
                type="date"
                value={injuryRecoveryDate}
                onChange={(e) => setInjuryRecoveryDate(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              手術の可能性
              <select
                value={injurySurgery}
                onChange={(e) =>
                  setInjurySurgery(e.target.value as "yes" | "no" | "unknown")
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="unknown">未定</option>
                <option value="no">なし</option>
                <option value="yes">あり</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-neutral-400">
              <input
                type="checkbox"
                checked={injuryNextHospitalUndetermined}
                onChange={(e) =>
                  setInjuryNextHospitalUndetermined(e.target.checked)
                }
                className="h-4 w-4"
              />
              次回通院日は未定
            </label>
            {!injuryNextHospitalUndetermined && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                次回通院日
                <input
                  type="date"
                  value={injuryNextHospital}
                  onChange={(e) => setInjuryNextHospital(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
              マット参加の可否
              <select
                value={injuryMatParticipation}
                onChange={(e) =>
                  setInjuryMatParticipation(
                    e.target.value as "yes" | "no" | "conditional"
                  )
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
              >
                <option value="no">非</option>
                <option value="yes">可</option>
                <option value="conditional">条件付きで可</option>
              </select>
            </label>
            {injuryMatParticipation === "conditional" && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                条件の詳細
                <textarea
                  value={injuryMatDetail}
                  onChange={(e) => setInjuryMatDetail(e.target.value)}
                  rows={2}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  resetInjuryForm();
                  setShowInjuryForm(false);
                }}
                className="flex-1 rounded-lg border border-neutral-700 py-2.5 text-sm text-neutral-300"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={savingInjury}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white active:bg-red-700 disabled:opacity-50"
              >
                {editingInjuryId ? "更新する" : "報告する"}
              </button>
            </div>
          </form>
        )}

        {loadingInjuries ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : injuries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
            報告されている怪我はありません。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {injuries
              .filter((inj) => !inj.is_recovered)
              .map((inj) => (
                <div
                  key={inj.id}
                  className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-100">
                      {inj.symptom_name}（{inj.body_part}）
                    </span>
                    <button
                      onClick={() => handleStartEditInjury(inj)}
                      className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
                    >
                      編集
                    </button>
                  </div>
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
                  {inj.next_hospital_date && (
                    <p className="text-[11px] text-neutral-500">
                      次回通院：{formatMonthDay(inj.next_hospital_date)}
                    </p>
                  )}
                  {inj.progress_note && (
                    <p className="whitespace-pre-wrap text-xs text-neutral-300">
                      {inj.progress_note}
                    </p>
                  )}
                  <button
                    onClick={() => handleMarkRecovered(inj.id)}
                    className="self-start rounded border border-emerald-800 px-2 py-1 text-[11px] text-emerald-400 active:bg-emerald-900/40"
                  >
                    完治として報告する
                  </button>
                </div>
              ))}
            {injuries.filter((inj) => inj.is_recovered).length > 0 && (
              <details className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
                <summary className="cursor-pointer">過去の怪我情報を見る</summary>
                <div className="mt-2 flex flex-col gap-2">
                  {injuries
                    .filter((inj) => inj.is_recovered)
                    .map((inj) => (
                      <div key={inj.id} className="rounded border border-neutral-800 p-2">
                        <p className="font-medium text-neutral-200">
                          {inj.symptom_name}（{inj.body_part}）
                        </p>
                        {inj.progress_note && (
                          <p className="whitespace-pre-wrap text-neutral-400">
                            {inj.progress_note}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>
      )}
        </>
      )}
    </>
  );
}

function RecentTypeLogs({
  supabase,
  authorId,
  excludeDate,
  type,
  title,
  label,
}: {
  supabase: ReturnType<typeof createClient>;
  authorId: string;
  excludeDate: string;
  type: TrainingType;
  title?: string;
  label: string;
}) {
  const [logs, setLogs] = useState<WeightLogRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    const timeout = setTimeout(async () => {
      let query = supabase
        .from("weight_logs")
        .select("id, date, content, type, title")
        .eq("author_id", authorId)
        .eq("type", type)
        .neq("date", excludeDate)
        .order("date", { ascending: false })
        .limit(3);
      if (type === "weight" && title) {
        query = query.eq("title", title);
      }
      const { data } = await query;
      if (!cancelled) setLogs((data ?? []) as WeightLogRow[]);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId, excludeDate, type, title]);

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
      <h3 className="text-xs font-semibold text-neutral-400">{label}</h3>
      {logs === null ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-neutral-500">まだ記録がありません。</p>
      ) : (
        logs.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <p className="mb-1 text-[11px] font-semibold text-neutral-500">
              {formatMonthDay(r.date)}
            </p>
            <p className="whitespace-pre-wrap text-sm text-neutral-100">
              {r.content}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

function UnifiedCalendar({
  cursor,
  onCursorChange,
  weightLogs,
  absentLogs,
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
  const { pref } = useCalendarDisplayPref();
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

  // マス目の「スロット」1つ分の表示内容を組み立てる。
  // マス目のスペースが限られているため、設定で選んだ最大2項目までしか表示しない
  // （それ以外の詳しい情報は日付タップ後の詳細欄で確認する）。
  function formatSessionSlot(
    s: {
      type: SessionType;
      time: string | null;
      locationNote: string | null;
      isJoint: boolean;
      jointLocation: Location | null;
    },
    schedule: { dayType: DayType } | undefined
  ) {
    const time = s.time ? s.time.slice(0, 5) : "各自";
    let loc = "";
    if (schedule?.dayType === "camp" || schedule?.dayType === "away") {
      loc = s.locationNote ? `(${s.locationNote})` : "";
    } else if (s.type === "mat") {
      loc = `(${
        locationLabel[s.isJoint ? (s.jointLocation ?? homeLocation) : homeLocation]
      })`;
    } else {
      loc = s.locationNote ? `(${s.locationNote})` : "";
    }
    return `${time}${loc}`;
  }

  function renderSlot(
    slot: CalendarSlotOption,
    slotId: string,
    key: string,
    schedule:
      | {
          dayType: DayType;
          sessions: {
            type: SessionType;
            time: string | null;
            locationNote: string | null;
            isJoint: boolean;
            jointLocation: Location | null;
          }[];
        }
      | undefined,
    title: string | undefined
  ) {
    if (slot === "none") return null;
    if (slot === "training_time") {
      const s = schedule?.sessions.find((s) => s.type !== "mat");
      if (!s) return null;
      return (
        <span
          key={slotId}
          className="flex items-center gap-0.5 max-w-full truncate"
        >
          {sessionTypeLabel[s.type]} {formatSessionSlot(s, schedule)}
        </span>
      );
    }
    if (slot === "actual_type") {
      // その日に実際に記録された種目（ラン/ウェイト/その他）を表示する。
      // 予定（スケジュール）ではなく、本人が実際にログした内容が元になる。
      const types = dotsByDate.get(key);
      const t = types?.[0];
      if (!t) return null;
      return (
        <span
          key={slotId}
          className="flex items-center gap-0.5 max-w-full truncate"
        >
          {trainingTypeLabel[t]}
        </span>
      );
    }
    if (slot === "training_content") {
      if (!title) return null;
      const truncated = title.length > 6 ? `${title.slice(0, 6)}…` : title;
      return (
        <span key={slotId} className="max-w-full truncate">
          {truncated}
        </span>
      );
    }
    if (slot === "memo_mark") {
      const memo = memoPreviews?.get(key);
      if (!memo) return null;
      const truncated = memo.length > 5 ? `${memo.slice(0, 5)}…` : memo;
      return (
        <span
          key={slotId}
          className="flex items-center gap-0.5 max-w-full truncate"
        >
          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          {truncated}
        </span>
      );
    }
    return null;
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
            pref.highlightMatch && !!nextMatchDate && key === nextMatchDate;
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
            bgClass =
              "bg-amber-100 dark:bg-amber-950/40 font-bold text-amber-700 dark:text-amber-400";
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
          }

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex ${
                viewMode === "week" ? "min-h-[84px]" : "min-h-[56px]"
              } flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 text-xs active:bg-neutral-200 dark:active:bg-neutral-700 ${bgClass} ${
                isHighlighted
                  ? "ring-2 ring-amber-400"
                  : "border-border-color"
              } ${
                isMatchDay
                  ? "ring-2 ring-red-400"
                  : isPending
                    ? "ring-2 ring-yellow-400"
                    : isToday
                      ? "ring-1 ring-neutral-400"
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
                  <span className="max-w-full truncate rounded px-1 text-[7px] font-semibold text-neutral-600 dark:text-neutral-300">
                    {schedule.eventName || dayTypeLabel[schedule.dayType]}
                  </span>
                )}
              {schedule?.isOff && (
                <span className="max-w-full truncate rounded px-1 text-[7px] font-semibold text-neutral-500 dark:text-neutral-400">
                  {otherLocationOffDates.has(key)
                    ? "全体オフ"
                    : `${locationLabel[homeLocation]}のみオフ`}
                </span>
              )}
              {(renderSlot(pref.slot1, "slot1", key, schedule, title) ||
                renderSlot(pref.slot2, "slot2", key, schedule, title)) && (
                <span className="flex flex-col items-center gap-0.5 text-[8px] leading-none text-neutral-500 dark:text-neutral-400">
                  {renderSlot(pref.slot1, "slot1", key, schedule, title)}
                  {renderSlot(pref.slot2, "slot2", key, schedule, title)}
                </span>
              )}
              {isMatchDay && (
                <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">
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
