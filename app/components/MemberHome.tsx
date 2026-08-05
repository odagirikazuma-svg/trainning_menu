"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isPushSupported, urlBase64ToUint8Array } from "../lib/push";
import {
  DayType,
  dayTypeLabel,
  getTitleColor,
  Location,
  locationLabel,
  SessionType,
  sessionTypeDotColor,
  teamEventTypeLabel,
  TeamEventType,
  TrainingType,
  trainingTypeDotColor,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

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

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function MemberHome({
  profile,
  signOut,
  practiceMenuSlot,
  onGoToMenu,
  onCalendarDateSelect,
  refreshSignal,
  isManager,
}: {
  profile: Profile;
  signOut: () => void;
  practiceMenuSlot: React.ReactNode;
  onGoToMenu: (location: Location, date: string) => void;
  onCalendarDateSelect?: (date: string) => void;
  refreshSignal?: number;
  isManager?: boolean;
}) {
  const supabase = createClient();
  const logSectionRef = useRef<HTMLDivElement>(null);
  const isFirstRefresh = useRef(true);
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

  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [newMatchName, setNewMatchName] = useState("");
  const [newMatchDate, setNewMatchDate] = useState("");
  const [editingMatch, setEditingMatch] = useState(false);
  const [editMatchDate, setEditMatchDate] = useState("");

  const [todayLog, setTodayLog] = useState<WeightLogRow | null>(null);
  const [logDate, setLogDate] = useState<string>(todayStr);
  const [todayLogText, setTodayLogText] = useState("");
  const [todayLogType, setTodayLogType] = useState<TrainingType | null>(null);
  const [todayLogTitle, setTodayLogTitle] = useState("");
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [savingLog, setSavingLog] = useState(false);
  const [todayAbsentRecords, setTodayAbsentRecords] = useState<RecentRecord[]>(
    []
  );

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
          time: string;
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
    const rangeStart = toDateKey(twoWeeksAgo);

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
    const rangeStart = toDateKey(twoWeeksAgo);

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

  async function handleAddMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newMatchName.trim() || !newMatchDate) return;
    const { error } = await supabase.from("matches").insert({
      team_id: profile.team_id,
      name: newMatchName.trim(),
      date: newMatchDate,
      created_by: profile.id,
      member_id: profile.id,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewMatchName("");
    setNewMatchDate("");
    setShowMatchForm(false);
    await loadNextMatch();
  }

  function startEditingMatch() {
    if (!nextMatch) return;
    setEditMatchDate(nextMatch.date);
    setEditingMatch(true);
  }

  async function handleUpdateMatchDate(e: React.FormEvent) {
    e.preventDefault();
    if (!nextMatch || !editMatchDate) return;
    const { data, error } = await supabase
      .from("matches")
      .update({ date: editMatchDate })
      .eq("id", nextMatch.id)
      .select("id");
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg(
        "試合日を更新できませんでした。データベース側の権限設定（matches_update_selfポリシー）が未反映の可能性があります。"
      );
      return;
    }
    setEditingMatch(false);
    await loadNextMatch();
  }

  async function handleDeleteMatch() {
    if (!nextMatch) return;
    const { error } = await supabase
      .from("matches")
      .delete()
      .eq("id", nextMatch.id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setEditingMatch(false);
    await loadNextMatch();
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
    }
    setSavingProgress(false);
  }

  async function loadTitleOptions() {
    const { data, error } = await supabase
      .from("weight_logs")
      .select("title")
      .eq("author_id", profile.id)
      .eq("type", "weight")
      .not("title", "is", null);

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const titles = Array.from(
      new Set(
        ((data ?? []) as { title: string | null }[])
          .map((r) => r.title)
          .filter((t): t is string => !!t && t.trim() !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "ja"));
    setTitleOptions(titles);
  }

  async function loadLogForDate(date: string) {
    setLoadingLog(true);
    setLogDate(date);
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id, date, content, type, title")
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
    } else {
      setTodayLog(null);
      setTodayLogText("");
      setTodayLogType(null);
      setTodayLogTitle("");
    }
    setLoadingLog(false);
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
          title: todayLogType === "weight" && trimmedTitle ? trimmedTitle : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "author_id,date" }
      )
      .select("id, date, content, type, title")
      .single();

    if (error) {
      setErrorMsg(error.message);
    } else {
      setTodayLog(data as WeightLogRow);
      await loadSelfTrainingTodo();
      await loadTitleOptions();
      await loadCalendarData();
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
              time: string;
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
            start_time: string;
            location_note: string | null;
            is_joint: boolean;
            joint_location: Location | null;
          }[];
        }[]) {
          const sessions = row.sessions
            .slice()
            .sort((a, b) => a.start_time.localeCompare(b.start_time))
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
    onCalendarDateSelect?.(dateStr);
    loadLogForDate(dateStr);
  }

  function goToMenu(m: TodoMenuRow) {
    onGoToMenu(m.location, m.date);
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;

  return (
    <>
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}

      {!isManager && (
        <>
      {/* 次の試合まで */}
      <section className="flex flex-col gap-2">
        {loadingMatch ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : nextMatch ? (
          <div className="relative rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-center">
            <p className="text-xs text-red-400">
              次の試合【{nextMatch.name}】まで
            </p>
            <p className="text-3xl font-bold text-red-500">あと{matchDays}日</p>
            <p className="text-[11px] text-red-500">
              {formatMonthDay(nextMatch.date)}
            </p>

            {editingMatch ? (
              <form
                onSubmit={handleUpdateMatchDate}
                className="mt-3 flex flex-col items-center gap-2"
              >
                <input
                  type="date"
                  value={editMatchDate}
                  onChange={(e) => setEditMatchDate(e.target.value)}
                  className="rounded-lg border border-red-800 bg-neutral-900 px-3 py-2 text-sm"
                  required
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                  >
                    日付を更新
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteMatch}
                    className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 active:bg-red-900/40"
                  >
                    削除する
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingMatch(false)}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                  >
                    閉じる
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={startEditingMatch}
                className="absolute bottom-2 right-2 rounded border border-red-900/60 bg-neutral-900 px-2 py-1 text-[10px] text-red-500 active:bg-red-900/40"
              >
                編集
              </button>
            )}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-center text-xs text-neutral-500">
            次の試合はまだ登録されていません。
          </p>
        )}

        <button
          onClick={() => setShowMatchForm((v) => !v)}
          className="self-start text-[11px] font-medium text-red-400 active:text-red-900"
        >
          {showMatchForm ? "キャンセル" : "＋ 試合を登録する"}
        </button>
        {showMatchForm && (
          <form
            onSubmit={handleAddMatch}
            className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <input
              type="text"
              placeholder="試合名（例：全日本学生選手権）"
              value={newMatchName}
              onChange={(e) => setNewMatchName(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              required
            />
            <input
              type="date"
              value={newMatchDate}
              onChange={(e) => setNewMatchDate(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              required
            />
            <button
              type="submit"
              className="rounded-lg bg-red-600 py-2 text-sm font-medium text-white active:bg-red-700"
            >
              登録する
            </button>
          </form>
        )}
      </section>

      {/* タスク一覧 */}
      <section className="flex flex-col gap-3 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          タスク一覧
        </h2>
        <p className="text-[11px] text-neutral-500">
          提出・完了するまで一覧から消えません。期日を過ぎたタスクは赤く強調表示されます。
        </p>

        {weightMaxTodo &&
          (() => {
            const isOverdue = todayStr > weightMaxTodo.deadline;
            return (
              <div
                className={`flex flex-col rounded-lg border p-3 text-sm ${
                  isOverdue
                    ? "border-red-600 bg-red-600 text-white shadow-lg ring-2 ring-red-400"
                    : "border-amber-900/60 bg-amber-950/40 text-left"
                }`}
              >
                <button
                  onClick={() => setWeightMaxTodoOpen((v) => !v)}
                  className="flex w-full flex-col text-left"
                >
                  <span
                    className={`text-[11px] ${isOverdue ? "text-white" : "text-amber-400"}`}
                  >
                    {isOverdue
                      ? `期限切れ！(${weightMaxTodo.deadline}まで)`
                      : `${weightMaxTodo.deadline}までに提出`}
                  </span>
                  <span
                    className={`font-medium ${isOverdue ? "text-white" : "text-neutral-100"}`}
                  >
                    ウェイトMAX(BIG3)を提出する
                  </span>
                </button>
                {weightMaxTodoOpen && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg bg-neutral-900 p-3 text-neutral-100">
                    <div className="grid grid-cols-3 gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        ベンチプレス(kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          value={weightMaxBench}
                          onChange={(e) => setWeightMaxBench(e.target.value)}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        スクワット(kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          value={weightMaxSquat}
                          onChange={(e) => setWeightMaxSquat(e.target.value)}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        デッドリフト(kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          value={weightMaxDeadlift}
                          onChange={(e) => setWeightMaxDeadlift(e.target.value)}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                    </div>
                    <button
                      onClick={handleSaveWeightMaxTodo}
                      disabled={savingWeightMaxTodo}
                      className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                    >
                      提出する
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

        {teamEventTodos.map((todo) => {
          const isOverdue = todayStr > todo.deadline;
          const isOpen = openTeamEventTodoId === todo.eventId;
          return (
            <div
              key={todo.eventId}
              className={`flex flex-col rounded-lg border p-3 text-sm ${
                isOverdue
                  ? "border-red-600 bg-red-600 text-white shadow-lg ring-2 ring-red-400"
                  : "border-amber-900/60 bg-amber-950/40 text-left"
              }`}
            >
              <button
                onClick={() =>
                  setOpenTeamEventTodoId(isOpen ? null : todo.eventId)
                }
                className="flex w-full flex-col text-left"
              >
                <span
                  className={`text-[11px] ${isOverdue ? "text-white" : "text-amber-400"}`}
                >
                  {isOverdue
                    ? `期限切れ！(${todo.deadline}まで)`
                    : `${todo.deadline}までに提出`}
                </span>
                <span
                  className={`font-medium ${isOverdue ? "text-white" : "text-neutral-100"}`}
                >
                  {teamEventTypeLabel[todo.type]}
                  {todo.title && `：${todo.title}`}
                  を提出する
                </span>
              </button>
              {isOpen && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-neutral-900 p-3 text-neutral-100">
                  {todo.type === "match_reflection" ? (
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        出場した試合名
                        <input
                          type="text"
                          value={matchTitle}
                          onChange={(e) => setMatchTitle(e.target.value)}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        試合結果
                        <select
                          value={matchResult}
                          onChange={(e) => setMatchResult(e.target.value)}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        >
                          <option value="">選択してください</option>
                          {matchResultOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          試合数
                          <input
                            type="number"
                            inputMode="numeric"
                            value={matchCount}
                            onChange={(e) => setMatchCount(e.target.value)}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          勝ち
                          <input
                            type="number"
                            inputMode="numeric"
                            value={matchWinCount}
                            onChange={(e) => setMatchWinCount(e.target.value)}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          負け
                          <input
                            type="number"
                            inputMode="numeric"
                            value={matchLossCount}
                            onChange={(e) => setMatchLossCount(e.target.value)}
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        試合の反省
                        <textarea
                          value={matchReflection}
                          onChange={(e) => setMatchReflection(e.target.value)}
                          rows={3}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        良かった点
                        <textarea
                          value={matchGoodPoints}
                          onChange={(e) => setMatchGoodPoints(e.target.value)}
                          rows={2}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        課題に感じた点
                        <textarea
                          value={matchChallenges}
                          onChange={(e) => setMatchChallenges(e.target.value)}
                          rows={2}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        改善方法と必要だと考えるトレーニング
                        <textarea
                          value={matchImprovementPlan}
                          onChange={(e) =>
                            setMatchImprovementPlan(e.target.value)
                          }
                          rows={2}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        当部の課題
                        <textarea
                          value={matchTeamChallenges}
                          onChange={(e) =>
                            setMatchTeamChallenges(e.target.value)
                          }
                          rows={2}
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                        測定日
                        <input
                          type="date"
                          value={teamEventMeasurementDate}
                          onChange={(e) =>
                            setTeamEventMeasurementDate(e.target.value)
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          体重(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={teamEventWeightKg}
                            onChange={(e) =>
                              setTeamEventWeightKg(e.target.value)
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          体脂肪率(%)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={teamEventBodyFatPct}
                            onChange={(e) =>
                              setTeamEventBodyFatPct(e.target.value)
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          骨格筋量(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={teamEventMuscleMassKg}
                            onChange={(e) =>
                              setTeamEventMuscleMassKg(e.target.value)
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          除脂肪体重(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={teamEventLeanBodyMassKg}
                            onChange={(e) =>
                              setTeamEventLeanBodyMassKg(e.target.value)
                            }
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                          />
                        </label>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => handleSaveTeamEventTodo(todo)}
                    disabled={savingTeamEventTodo}
                    className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                  >
                    提出する
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {injuries.filter(injuryNeedsProgressUpdate).map((inj) => {
          const isOpen = progressInjuryId === inj.id;
          return (
            <div
              key={inj.id}
              className="flex flex-col rounded-lg border border-red-600 bg-red-600 p-3 text-sm text-white shadow-lg ring-2 ring-red-400"
            >
              <button
                onClick={() =>
                  isOpen ? setProgressInjuryId(null) : handleStartProgress(inj)
                }
                className="flex w-full flex-col text-left"
              >
                <span className="text-[11px] text-white">
                  完治見込み日・通院日が到来しています
                </span>
                <span className="font-medium text-white">
                  「{inj.symptom_name}」の経過を報告する
                </span>
              </button>
              {isOpen && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-neutral-900 p-3 text-neutral-100">
                  <div className="flex gap-2 rounded-lg bg-neutral-800 p-1 text-xs">
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
          );
        })}

        {!effectiveHomeLocation ? (
          <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
            所属拠点(多摩/大塚)がまだ設定されていません。設定されると、未報告の練習メニューがここに表示されます。
          </p>
        ) : loadingTodo ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : todoMenus.length === 0 && selfTrainingPending.length === 0 ? (
          !weightMaxTodo &&
          injuries.filter(injuryNeedsProgressUpdate).length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              未報告の練習メニューはありません。
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-2">
            {todoMenus.map((m) => {
              const isOverdue = m.date < todayStr;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => goToMenu(m)}
                    className={`flex w-full flex-col rounded-lg border p-3 text-left text-sm ${
                      isOverdue
                        ? "border-red-600 bg-red-600 text-white shadow-lg ring-2 ring-red-400"
                        : "border-amber-900/60 bg-amber-950/40 active:bg-amber-100"
                    }`}
                  >
                    <span
                      className={`text-[11px] ${isOverdue ? "text-white" : "text-amber-400"}`}
                    >
                      実施報告 未提出{isOverdue && "（期限切れ）"}
                    </span>
                    <span
                      className={`font-medium ${isOverdue ? "text-white" : "text-neutral-100"}`}
                    >
                      {m.title || formatShortDateTime(m.date, m.start_time)}
                    </span>
                  </button>
                </li>
              );
            })}
            {selfTrainingPending.map((date) => {
              const isOverdue = date < todayStr;
              return (
                <li key={`self-${date}`}>
                  <button
                    onClick={() => {
                      loadLogForDate(date);
                      logSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }}
                    className={`flex w-full flex-col rounded-lg border p-3 text-left text-sm ${
                      isOverdue
                        ? "border-red-600 bg-red-600 text-white shadow-lg ring-2 ring-red-400"
                        : "border-amber-900/60 bg-amber-950/40 active:bg-amber-100"
                    }`}
                  >
                    <span
                      className={`text-[11px] ${isOverdue ? "text-white" : "text-amber-400"}`}
                    >
                      自主トレ（ラン・ウェイトなど） 未提出{isOverdue && "（期限切れ）"}
                    </span>
                    <span
                      className={`font-medium ${isOverdue ? "text-white" : "text-neutral-100"}`}
                    >
                      {formatMonthDay(date)}・タップして記録する
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
        </>
      )}

      {/* カレンダー */}
      <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          カレンダー
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
        />
      </section>
      {/* 練習メニュー・意見コメント・実施報告(マット掲示板本体) */}
      <p className="text-sm font-semibold text-neutral-300">
        {formatMonthDay(selectedCalendarDate ?? todayStr)}のメニュー
      </p>
      {practiceMenuSlot}


      {!isManager && (
        <>
      {/* トレーニングメニュー記入欄 */}
      <section
        ref={logSectionRef}
        className="flex flex-col gap-2 border-t border-neutral-800 pt-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            {logDate === todayStr
              ? "本日のトレーニングメニュー"
              : `${formatMonthDay(logDate)}のトレーニングメニュー`}
          </h2>
          {logDate !== todayStr && (
            <button
              onClick={() => loadLogForDate(todayStr)}
              className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
            >
              今日に戻る
            </button>
          )}
        </div>

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
            {todayLogType === "weight" && (
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                タイトル（種目名など。任意）
                <input
                  type="text"
                  list="weight-title-options"
                  value={todayLogTitle}
                  onChange={(e) => setTodayLogTitle(e.target.value)}
                  placeholder="例：BIG3、上半身の日 など"
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
                <datalist id="weight-title-options">
                  {titleOptions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
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
                  : todayLogType === "weight" && todayLogTitle.trim()
                    ? `${getTitleColor(todayLogTitle.trim()).border} ${getTitleColor(todayLogTitle.trim()).fill}`
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

            {todayLogType === "running" && (
              <RecentTypeLogs
                supabase={supabase}
                authorId={profile.id}
                excludeDate={logDate}
                type="running"
                label="直近のランメニュー"
              />
            )}
            {todayLogType === "weight" && todayLogTitle.trim() && (
              <RecentTypeLogs
                supabase={supabase}
                authorId={profile.id}
                excludeDate={logDate}
                type="weight"
                title={todayLogTitle.trim()}
                label={`直近の${todayLogTitle.trim()}のトレーニングメニュー`}
              />
            )}
          </div>
        )}
      </section>

      {/* 試合の振り返り */}
      <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          試合の振り返り
        </h2>
        {loadingMatchReflections ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : matchReflections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
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
                          <span className="text-neutral-500">試合名：</span>
                          {r.matchTitle}
                        </p>
                      )}
                      {r.matchResult && (
                        <p>
                          <span className="text-neutral-500">試合結果：</span>
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

      {/* 怪我の記録・復帰計画 */}
      <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
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
        </>
      )}

      {/* 通知設定 */}
      {pushSupported && (
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            通知設定
          </h2>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs">
            <span className="text-neutral-300">
              {pushSubscribed
                ? "未完了のタスクがある日、夜に通知が届きます。"
                : "通知はオフになっています。"}
            </span>
            {pushSubscribed ? (
              <button
                onClick={handleDisablePush}
                disabled={pushLoading}
                className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 active:bg-neutral-800 disabled:opacity-50"
              >
                {pushLoading ? "処理中…" : "通知をオフにする"}
              </button>
            ) : (
              <button
                onClick={handleEnablePush}
                disabled={pushLoading}
                className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
              >
                {pushLoading ? "設定中…" : "通知を有効にする"}
              </button>
            )}
          </div>
        </section>
      )}

      {/* ログアウト */}
      <div className="border-t border-neutral-800 pt-4">
        <button
          onClick={signOut}
          className="w-full rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-800"
        >
          ログアウト
        </button>
      </div>
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
        time: string;
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
}) {
  const dotsByDate = new Map<string, TrainingType[]>();
  const titleByDate = new Map<string, string>();
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
          className="rounded px-2 py-1 text-xs text-neutral-400 active:bg-neutral-800"
        >
          ＜
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-400 active:bg-neutral-800"
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
          const isToday = key === todayDate;
          const isMatchDay = !!nextMatchDate && key === nextMatchDate;
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

          let bgClass = "bg-neutral-800 text-neutral-300";
          if (isHighlighted) {
            bgClass = "bg-amber-950/40 font-bold text-amber-400";
          } else if (schedule?.isOff) {
            bgClass = "bg-neutral-900 text-neutral-500";
          } else if (isAway) {
            bgClass = "bg-purple-950/40 text-purple-300";
          } else if (isCamp) {
            bgClass = "bg-pink-950/40 text-pink-300";
          } else if (titleColor) {
            bgClass = `${titleColor.fill} text-neutral-200`;
          }

          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex min-h-[56px] flex-col items-center justify-start gap-0.5 rounded-lg border pt-1 text-xs active:bg-neutral-700 ${bgClass} ${
                isHighlighted ? "ring-2 ring-amber-400" : "border-neutral-700"
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
              {schedule &&
                !schedule.isOff &&
                (schedule.dayType === "camp" || schedule.dayType === "away") && (
                  <span className="max-w-full truncate rounded px-1 text-[7px] font-semibold text-neutral-300">
                    {schedule.eventName || dayTypeLabel[schedule.dayType]}
                  </span>
                )}
              {schedule?.isOff && (
                <span className="max-w-full truncate rounded px-1 text-[7px] font-semibold text-neutral-400">
                  {otherLocationOffDates.has(key)
                    ? "全体オフ"
                    : `${locationLabel[homeLocation]}のみオフ`}
                </span>
              )}
              {(schedule?.sessions ?? []).length > 0 && (
                <span className="flex flex-col items-center gap-0.5">
                  {(schedule?.sessions ?? []).map((s, idx) => (
                    <span
                      key={idx}
                      className="flex items-center gap-0.5 text-[8px] leading-none text-neutral-400"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full border ${sessionTypeDotColor[s.type].replace("bg-", "border-")} bg-transparent`}
                      />
                      {s.time.slice(0, 5)}
                      {schedule?.dayType === "camp" ||
                      schedule?.dayType === "away"
                        ? s.locationNote
                          ? `(${s.locationNote})`
                          : ""
                        : s.type === "mat"
                          ? `(${
                              locationLabel[
                                s.isJoint
                                  ? (s.jointLocation ?? homeLocation)
                                  : homeLocation
                              ]
                            })`
                          : s.locationNote
                            ? `(${s.locationNote})`
                            : ""}
                    </span>
                  ))}
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
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded ring-1 ring-neutral-400" />
          今日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded ring-2 ring-red-400" />
          次の試合日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-purple-950/40" />
          出稽古
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded bg-pink-950/40" />
          合宿
        </span>
        {!disablePendingIndicator && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-400" />
            未提出あり
          </span>
        )}
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
