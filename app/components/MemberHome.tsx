"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  formatExemptionDate,
  isExemptOn,
  loadExemptions,
  type ExemptionRow,
} from "../lib/exemptions";
import {
  DayType,
  getTitleColorBySlot,
  Location,
  MAX_SAVED_TITLES,
  SessionType,
  TitleColor,
  TrainingType,
  } from "../lib/types";
import type { Profile } from "./AuthGate";
import TaskQueuePopup, { type QueueTask } from "./TaskQueuePopup";
import DailyReport from "./DailyReport";
import TrainingInsights from "./TrainingInsights";
import GoalsSettingsSection from "./GoalsSettingsSection";
import DayRecordPanel from "./DayRecordPanel";
import InsightCard from "./InsightCard";
import { useGoalTasks } from "./shell/useGoalTasks";
import { useSubNav } from "./shell/AppShell";
import SubTabBar from "./shell/SubTabBar";
import { notifyTasksChanged } from "./shell/taskRefreshBus";
import { UnifiedCalendar } from "./mypage/UnifiedCalendar";
import AbsenceRequestTab from "./mypage/AbsenceRequestTab";
import { loadObligations } from "../lib/obligations";
import {
  absencePlanLabel,
  absenceReasonLabel,
  type AbsencePlanType,
  type AbsenceReasonType,
} from "../lib/absence";

// 未提出の判定に使う分だけ（メニューの本文などは読み込まない）
type TodoMenuRow = {
  id: string;
  date: string;
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

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

// "YYYY-MM-DD" -> "9月24日(木)"
function formatMonthDayWeek(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${w})`;
}

// 日報／振り返り／申請（休みの申請・怪我の記録）
type HomeSubTab = "daily" | "training" | "request";

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
  // 今日が管理者による免除期間中なら、その期間（バナー表示用）
  const [activeExemption, setActiveExemption] = useState<ExemptionRow | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  // 種目（ラン/ウェイト/その他）ごとに、保存されているタイトルの候補一覧（最大10個ずつ）
  const [titleOptionsByType, setTitleOptionsByType] = useState<
    Record<TrainingType, string[]>
  >({ running: [], weight: [], other: [] });
  // 種目ごとの「タイトル→色」マップ（保存枠(10個)から外れたタイトルは含まれない＝無色になる）
  const [titleColorByType, setTitleColorByType] = useState<
    Record<TrainingType, Map<string, TitleColor>>
  >({ running: new Map(), weight: new Map(), other: new Map() });

  // マイページカレンダーの「一言メモ」（本人のみ閲覧、日付ごと1件・20文字まで）
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
  // カレンダー（実績）：マット練習に出た日（日報で実施報告）と、休みの申請
  const [calendarMatDone, setCalendarMatDone] = useState<Set<string>>(new Set());
  const [calendarAbsences, setCalendarAbsences] = useState<
    Map<string, { reason: string; plan: string; sessionKeys: string[] | null }>
  >(new Map());
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

  // 日報タブで表示している日付と、提出後に日報・集計を読み直すためのカウンタ
  // 練習予定表の「日報を書く」から来た場合は、その日の日報を開く
  const [reportDate, setReportDate] = useState<string>(() => {
    if (typeof window === "undefined") return todayStr;
    // LINEのリッチメニューから：?absence=1 は明日の日報（休み申請）、?date=YYYY-MM-DD はその日
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("absence") === "1") return todayStr;
      const d = q.get("date");
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    } catch {
      // 読めなくても今日の日報を開く
    }
    try {
      const jump = sessionStorage.getItem("dailyReportDate");
      if (jump) {
        sessionStorage.removeItem("dailyReportDate");
        if (/^\d{4}-\d{2}-\d{2}$/.test(jump) && jump <= todayStr) return jump;
      }
    } catch {
      // 読めなくても今日の日報を開く
    }
    return todayStr;
  });
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [homeSubTab, setHomeSubTab] = useState<HomeSubTab>(() => {
    if (typeof window === "undefined") return "daily";
    const tab = new URLSearchParams(window.location.search).get("tab");
    const q = new URLSearchParams(window.location.search);
    if (q.get("absence") === "1") return "request";
    return tab === "review" ? "training" : tab === "injury" || tab === "request" ? "request" : "daily";
  });
  // 「申請」タブで休みを申請・確認する日（LINEの「休み申請」からは明日）
  const [requestDate, setRequestDate] = useState<string>(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("absence") === "1") {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return toDateKey(t);
    }
    return todayStr;
  });
  function openRequest(date: string) {
    setRequestDate(date);
    setHomeSubTab("request");
  }

  useEffect(() => {
    if (isManager) {
      return;
    }
    loadTodo();
    loadActiveExemption();
    loadNextMatch();
    loadTitleOptions();
    loadInjuries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // カレンダーは「振り返り」タブ（とマネージャー表示）でしか使わないので、開いたときだけ読み込む
  const calendarVisible = isManager || homeSubTab === "training";
  useEffect(() => {
    if (!calendarVisible) return;
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor, calendarVisible, reportRefreshKey]);

  useEffect(() => {
    if (isFirstRefresh.current) {
      isFirstRefresh.current = false;
      return;
    }
    loadTodo();
    loadActiveExemption();
    if (calendarVisible) loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // 今日が免除期間中かどうかを調べる（マイページ上部のお知らせ表示用）
  async function loadActiveExemption() {
    const rows = await loadExemptions(
      supabase,
      profile.team_id,
      todayStr,
      todayStr,
      profile.id
    );
    setActiveExemption(rows[0] ?? null);
  }

  // 未提出の日報（マット練習・ラン／ウェイトのセクション・代替メニュー）。直近1か月分
  async function loadTodo() {
    if (!effectiveHomeLocation) {
      setTodoMenus([]);
      setSelfTrainingPending([]);
      return;
    }
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const ob = await loadObligations(
      supabase,
      profile.team_id,
      [{ id: profile.id, home_location: effectiveHomeLocation, created_at: profile.created_at }],
      toDateKey(oneMonthAgo),
      todayStr
    );
    const mats: TodoMenuRow[] = [];
    const trainingDates: string[] = [];
    for (const [d, items] of ob.get(profile.id) ?? []) {
      for (const x of items) {
        if (x.done) continue;
        if (x.kind === "mat")
          mats.push({ id: x.menu.id, date: d, location: x.menu.location as Location, start_time: x.menu.start_time, is_off: false });
        else if (!trainingDates.includes(d)) trainingDates.push(d);
      }
    }
    setTodoMenus(mats.sort((a, b) => b.date.localeCompare(a.date)));
    setSelfTrainingPending(trainingDates.sort());
  }

  async function loadNextMatch() {
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

    // マット練習の実績（日報で「参加」と報告した練習）と、休みの申請
    const [{ data: matData }, { data: absReqData }] = await Promise.all([
      supabase
        .from("comments")
        .select("menu:menus!comments_menu_id_fkey(date)")
        .eq("author_id", profile.id)
        .eq("kind", "report"),
      supabase
        .from("absence_requests")
        .select("date, reason_type, plan_type, status, session_keys")
        .eq("author_id", profile.id)
        .neq("status", "rejected")
        .gte("date", rangeStart)
        .lte("date", rangeEnd),
    ]);
    setCalendarMatDone(
      new Set(
        ((matData ?? []) as unknown as { menu: { date: string } | null }[])
          .map((r) => r.menu?.date)
          .filter((d): d is string => !!d && d >= rangeStart && d <= rangeEnd)
      )
    );
    setCalendarAbsences(
      new Map(
        ((absReqData ?? []) as {
          date: string;
          reason_type: AbsenceReasonType;
          plan_type: AbsencePlanType;
          session_keys: string[] | null;
        }[]).map((r) => [
          r.date,
          {
            reason: absenceReasonLabel[r.reason_type],
            plan: r.plan_type === "none" ? "休養" : absencePlanLabel[r.plan_type],
            sessionKeys: r.session_keys,
          },
        ])
      )
    );

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
      const calendarExemptions = await loadExemptions(
        supabase,
        profile.team_id,
        rangeStart,
        rangeEnd,
        profile.id
      );
      const pastMenus = menuRows
        .filter((m) => !isExemptOn(calendarExemptions, profile.id, m.date))
        .filter((m) => {
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



  // 振り返りのカレンダーで日付を押したら、カレンダーの下にその日の記録を出す（もう一度押すと閉じる）
  function handleSelectCalendarDate(dateStr: string) {
    setSelectedCalendarDate((prev) => (prev === dateStr ? null : dateStr));
  }

  // 日報タブの指定した日へ移動する（タスクのポップアップから）
  function openDailyReport(date: string) {
    setReportDate(date);
    setHomeSubTab("daily");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // 日報（マット報告・トレ報）を出したあとの読み直し
  async function handleDailySubmitted() {
    await Promise.all([
      loadTodo(),
      loadTitleOptions(),
    ]);
    setReportRefreshKey((n) => n + 1);
  }

  // 未提出の日（マット報告・トレ報のどちらかが残っている日）。古い日が先
  const pendingDailyDates = Array.from(
    new Set([...todoMenus.map((m) => m.date), ...selfTrainingPending])
  ).sort();

  // 年間目標・月間目標が未設定なら、タスクとして出す
  const missingGoals = useGoalTasks(profile);

  // フッター上のサブナビ（トレーニング／怪我の記録の切り替え）を登録
  // ※ node は必ず useMemo で安定させること。毎レンダー新しいJSXを渡すと
  //   useSubNav内のuseEffectが依存配列[node]の変化を検知して毎回発火し、
  //   AppShell側の再レンダーとの間で無限ループになりうる。
  const pendingDailyCount = pendingDailyDates.length;
  const homeSubNav = useMemo(
    () =>
      !isManager ? (
        <SubTabBar<HomeSubTab>
          items={[
            { value: "daily", label: "日報", badge: pendingDailyCount },
            { value: "training", label: "振り返り" },
            { value: "request", label: "申請" },
          ]}
          active={homeSubTab}
          onChange={setHomeSubTab}
        />
      ) : null,
    [isManager, homeSubTab, pendingDailyCount]
  );
  useSubNav(homeSubNav);


  return (
    <>
      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </p>
      )}

      {!isManager && (
        <>
      {/* 免除期間中のお知らせ（管理者が登録した期間。理由は部員には表示しない） */}
      {activeExemption && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-[length:calc(12px+var(--fs-add))] text-amber-700 dark:text-amber-300">
          <p className="font-semibold">
            管理者により免除されています（
            {formatExemptionDate(activeExemption.start_date)}〜
            {formatExemptionDate(activeExemption.end_date)}）
          </p>
          <p className="mt-1 text-amber-700 dark:text-amber-300/80">
            この期間の練習の実施報告・自主トレの記録は不要です。怪我の経過報告やイベントの提出は、これまで通りお願いします。
          </p>
        </div>
      )}
      {/* タスク一覧（練習タスク・怪我タスク） */}
      {isOb && (
        <div className="flex items-center justify-end border-t border-neutral-200 dark:border-neutral-800 pt-4">
          <button
            onClick={handleToggleTaskListPref}
            disabled={savingTaskListPref}
            className="shrink-0 rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800 disabled:opacity-50"
          >
            {showTaskListPref
              ? "タスクのポップアップを非表示にする"
              : "タスクのポップアップを表示する"}
          </button>
        </div>
      )}
      {(() => {
        if (isOb && !showTaskListPref) return null;
        // タスクのポップアップは「日報」タブを開いているときだけ出す
        if (homeSubTab !== "daily") return null;
        const queueTasks: QueueTask[] = [];
        // 並び順用のキー（古い日付が上。怪我の経過報告は日付がないので一番上）
        const sortKeyOf = new Map<string, string>();

        for (const inj of injuries.filter(injuryNeedsProgressUpdate)) {
          const isOpen = progressInjuryId === inj.id;
          queueTasks.push({
            key: `injury-${inj.id}`,
            kind: "injury",
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
                  <div className="flex flex-col gap-2 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-3">
                    <div className="flex gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-900 p-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setProgressIsRecovered(true)}
                        className={`flex-1 rounded-md py-2 font-medium ${
                          progressIsRecovered
                            ? "bg-red-600 text-white shadow"
                            : "text-neutral-600 dark:text-neutral-400"
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
                            : "text-neutral-600 dark:text-neutral-400"
                        }`}
                      >
                        まだ完治していない
                      </button>
                    </div>
                    {!progressIsRecovered && (
                      <>
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                          新しい完治見込み日
                          <input
                            type="date"
                            value={progressRecoveryDate}
                            onChange={(e) =>
                              setProgressRecoveryDate(e.target.value)
                            }
                            className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                          マット参加の可否
                          <select
                            value={progressMatParticipation}
                            onChange={(e) =>
                              setProgressMatParticipation(
                                e.target.value as "yes" | "no" | "conditional"
                              )
                            }
                            className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                          >
                            <option value="no">非</option>
                            <option value="yes">可</option>
                            <option value="conditional">条件付きで可</option>
                          </select>
                        </label>
                        {progressMatParticipation === "conditional" && (
                          <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                            条件の詳細
                            <textarea
                              value={progressMatDetail}
                              onChange={(e) =>
                                setProgressMatDetail(e.target.value)
                              }
                              rows={2}
                              className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                            />
                          </label>
                        )}
                      </>
                    )}
                    <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
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
                        className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
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

        if (missingGoals.length > 0) {
          sortKeyOf.set("goal", "0000");
          queueTasks.push({
            key: "goal",
            kind: "goal",
            overdue: false,
            badgeLabel: "目標 未設定",
            title:
              missingGoals.length === 2
                ? "年間目標・月間目標を設定しよう"
                : missingGoals[0] === "long"
                  ? "年間目標を設定しよう"
                  : `${new Date().getMonth() + 1}月の月間目標を設定しよう`,
            urgent: false,
            content: <GoalsSettingsSection />,
          });
        }

        // マット報告・トレ報は「その日の日報」1件にまとめて出す
        for (const date of pendingDailyDates) {
          const isOverdue = date < todayStr;
          const matLeft = todoMenus.filter((m) => m.date === date).length;
          const selfLeft = selfTrainingPending.includes(date);
          const parts = [
            matLeft > 0 ? `マット${matLeft > 1 ? `${matLeft}件` : ""}` : null,
            selfLeft ? "トレーニング" : null,
          ].filter(Boolean);
          sortKeyOf.set(`daily-${date}`, `${date} 0`);
          queueTasks.push({
            key: `daily-${date}`,
            kind: "daily",
            overdue: isOverdue,
            badgeLabel: `日報 未提出${isOverdue ? "（期限切れ）" : ""}`,
            title: `${formatMonthDayWeek(date)}の日報（${parts.join("・")}）`,
            urgent: isOverdue,
            // 押したら、その日の日報（このページの日報欄）へ移動する
            onOpen: () => openDailyReport(date),
            content: (close: () => void) => (
              <button
                type="button"
                onClick={() => {
                  openDailyReport(date);
                  close();
                }}
                className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white active:bg-emerald-700"
              >
                {formatMonthDayWeek(date)}の日報を書く
              </button>
            ),
          });
        }

        // 日付の時系列順（古い日のタスクが上）
        queueTasks.sort((a, b) =>
          (sortKeyOf.get(a.key) ?? "").localeCompare(sortKeyOf.get(b.key) ?? "")
        );

        return <TaskQueuePopup tasks={queueTasks} startWithList rememberKey={profile.id} />;
      })()}
        </>
      )}

      {/* カレンダー（トレーニングの記録）。日付を押すと、その下にその日の記録が出る */}
      {(isManager || homeSubTab === "training") && (
      <InsightCard icon="📅" title="トレーニングの記録" subtitle="日付を押すと、その日の記録が下に出ます">
        <UnifiedCalendar
          cursor={calendarCursor}
          onCursorChange={setCalendarCursor}
          weightLogs={calendarWeightLogs}
          absentLogs={calendarAbsentLogs}
          matDoneDates={calendarMatDone}
          absenceByDate={calendarAbsences}
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
        {!isManager && selectedCalendarDate && (
          <DayRecordPanel
            key={`${selectedCalendarDate}-${reportRefreshKey}`}
            profile={profile}
            date={selectedCalendarDate}
            onOpenDaily={(d) => openDailyReport(d > todayStr ? todayStr : d)}
            onClose={() => setSelectedCalendarDate(null)}
          />
        )}
      </InsightCard>
      )}

      {/* 振り返り：まとめ・種目ごとの記録・自己ベスト・試合・イベントの推移 */}
      {!isManager && homeSubTab === "training" && (
        <TrainingInsights profile={profile} refreshKey={reportRefreshKey} />
      )}

      {!isManager && (
        <>
      {homeSubTab === "daily" && (
        <section className="flex flex-col gap-3">
          <DailyReport
            profile={profile}
            date={reportDate}
            onDateChange={setReportDate}
            refreshKey={reportRefreshKey}
            pendingDates={pendingDailyDates}
            titleOptions={titleOptionsByType}
            titleColors={titleColorByType}
            onSubmitted={handleDailySubmitted}
            onTitlesChanged={loadTitleOptions}
            onOpenRequest={openRequest}
          />
        </section>
      )}

      {homeSubTab === "request" && (
        <AbsenceRequestTab
          profile={profile}
          date={requestDate}
          onDateChange={setRequestDate}
          todayStr={todayStr}
          onChanged={() => setReportRefreshKey((k) => k + 1)}
        />
      )}

      {homeSubTab === "request" && (
      <section className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
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
            className="flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3"
          >
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              怪我の症状名
              <input
                type="text"
                value={injurySymptom}
                onChange={(e) => setInjurySymptom(e.target.value)}
                disabled={!!editingInjuryId}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 disabled:opacity-60"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              部位
              <input
                type="text"
                value={injuryBodyPart}
                onChange={(e) => setInjuryBodyPart(e.target.value)}
                disabled={!!editingInjuryId}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 disabled:opacity-60"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              詳細（任意）
              <textarea
                value={injuryDetail}
                onChange={(e) => setInjuryDetail(e.target.value)}
                disabled={!!editingInjuryId}
                rows={3}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              完治見込み日（任意）
              <input
                type="date"
                value={injuryRecoveryDate}
                onChange={(e) => setInjuryRecoveryDate(e.target.value)}
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              手術の可能性
              <select
                value={injurySurgery}
                onChange={(e) =>
                  setInjurySurgery(e.target.value as "yes" | "no" | "unknown")
                }
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
              >
                <option value="unknown">未定</option>
                <option value="no">なし</option>
                <option value="yes">あり</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
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
              <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                次回通院日
                <input
                  type="date"
                  value={injuryNextHospital}
                  onChange={(e) => setInjuryNextHospital(e.target.value)}
                  className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
              マット参加の可否
              <select
                value={injuryMatParticipation}
                onChange={(e) =>
                  setInjuryMatParticipation(
                    e.target.value as "yes" | "no" | "conditional"
                  )
                }
                className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
              >
                <option value="no">非</option>
                <option value="yes">可</option>
                <option value="conditional">条件付きで可</option>
              </select>
            </label>
            {injuryMatParticipation === "conditional" && (
              <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                条件の詳細
                <textarea
                  value={injuryMatDetail}
                  onChange={(e) => setInjuryMatDetail(e.target.value)}
                  rows={2}
                  className="rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
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
                className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 py-2.5 text-sm text-neutral-700 dark:text-neutral-300"
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
          <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-xs text-neutral-500">
            報告されている怪我はありません。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {injuries
              .filter((inj) => !inj.is_recovered)
              .map((inj) => (
                <div
                  key={inj.id}
                  className="flex flex-col gap-1 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">
                      {inj.symptom_name}（{inj.body_part}）
                    </span>
                    <button
                      onClick={() => handleStartEditInjury(inj)}
                      className="shrink-0 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
                    >
                      編集
                    </button>
                  </div>
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
                  {inj.next_hospital_date && (
                    <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                      次回通院：{formatMonthDay(inj.next_hospital_date)}
                    </p>
                  )}
                  {inj.progress_note && (
                    <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                      {inj.progress_note}
                    </p>
                  )}
                  <button
                    onClick={() => handleMarkRecovered(inj.id)}
                    className="self-start rounded border border-emerald-300 dark:border-emerald-800 px-2 py-1 text-[length:calc(11px+var(--fs-add))] text-emerald-700 dark:text-emerald-400 active:bg-emerald-100 dark:active:bg-emerald-900/40"
                  >
                    完治として報告する
                  </button>
                </div>
              ))}
            {injuries.filter((inj) => inj.is_recovered).length > 0 && (
              <details className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs text-neutral-600 dark:text-neutral-400">
                <summary className="cursor-pointer">過去の怪我情報を見る</summary>
                <div className="mt-2 flex flex-col gap-2">
                  {injuries
                    .filter((inj) => inj.is_recovered)
                    .map((inj) => (
                      <div key={inj.id} className="rounded border border-neutral-200 dark:border-neutral-800 p-2">
                        <p className="font-medium text-neutral-800 dark:text-neutral-200">
                          {inj.symptom_name}（{inj.body_part}）
                        </p>
                        {inj.progress_note && (
                          <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">
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
