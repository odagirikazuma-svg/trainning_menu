"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  getTitleColor,
  Location,
  locationLabel,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
  TrainingType,
  trainingTypeDotColor,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

type MenuRow = {
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
  created_at: string;
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
  isAlternative: boolean; // 未実施報告の代替メニューかどうか
};

type PopupRecordRow = {
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

// メニューの開始時刻を過ぎているか（開始時刻未設定なら常に対象）
function isReportOpen(menu: MenuRow): boolean {
  if (!menu.start_time) return true;
  const threshold = new Date(`${menu.date}T${menu.start_time}`);
  return new Date() >= threshold;
}

// "YYYY-MM-DD" + "HH:MM" -> "7月24日 10時10分〜"
function formatShortDateTime(dateStr: string, startTime: string | null) {
  const [, m, d] = dateStr.split("-").map(Number);
  const base = `${m}月${d}日`;
  if (!startTime) return base;
  const [h, min] = startTime.split(":").map(Number);
  return `${base} ${h}時${String(min).padStart(2, "0")}分〜`;
}

// "YYYY-MM-DD" -> "2026年7月24日"
function formatFullDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function MyPage({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const todayStr = toDateKey(new Date());

  const [todoMenus, setTodoMenus] = useState<MenuRow[]>([]);
  const [loadingTodo, setLoadingTodo] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
  const [savingInjury, setSavingInjury] = useState(false);

  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [newMatchName, setNewMatchName] = useState("");
  const [newMatchDate, setNewMatchDate] = useState("");
  const [editingMatch, setEditingMatch] = useState(false);
  const [editMatchDate, setEditMatchDate] = useState("");

  const [todayLog, setTodayLog] = useState<WeightLogRow | null>(null);
  const [todayLogText, setTodayLogText] = useState("");
  const [todayLogType, setTodayLogType] = useState<TrainingType>("weight");
  const [todayLogTitle, setTodayLogTitle] = useState("");
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [savingLog, setSavingLog] = useState(false);
  const [todayAbsentRecords, setTodayAbsentRecords] = useState<RecentRecord[]>(
    []
  );

  const [recentLogs, setRecentLogs] = useState<RecentRecord[]>([]);
  const [loadingRecentLogs, setLoadingRecentLogs] = useState(true);

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
    Map<string, { type: SessionType; time: string }[]>
  >(new Map());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<
    string | null
  >(null);
  const [popupRecord, setPopupRecord] = useState<
    PopupRecordRow[] | null | undefined
  >(undefined);
  const [loadingPopupRecord, setLoadingPopupRecord] = useState(false);
  // トレーニング記録（実施報告・未実施報告の代替メニュー）が存在する日付一覧（昇順）
  const [recordDates, setRecordDates] = useState<string[]>([]);

  // 日付が変わった瞬間（深夜0時）に「あと○○日」等の表示を自動で更新するための時計
  // ※試合日を編集した際は、その場でloadNextMatch()経由でstateが更新されて
  //   即座に再計算されるので、ここでは日付が変わる瞬間だけに絞ってスケジュールする
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
        5 // 日付切り替え直後を確実に捉えるため5秒の余裕を持たせる
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
    if (profile.home_location) loadTodo();
    else setLoadingTodo(false);
    loadNextMatch();
    loadTodayLog();
    loadTodayAbsent();
    loadRecentLogs();
    loadRecordDates();
    loadTitleOptions();
    loadWeightMaxTodo();
    loadInjuries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor]);

  async function loadTodo() {
    setLoadingTodo(true);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const rangeStart = toDateKey(twoWeeksAgo);

    // 自分の所属拠点のメニュー
    const { data: ownMenuData, error: ownMenuError } = await supabase
      .from("menus")
      .select("id, date, title, content, location, start_time, is_off")
      .eq("team_id", profile.team_id)
      .eq("location", profile.home_location)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (ownMenuError) {
      setErrorMsg(ownMenuError.message);
      setLoadingTodo(false);
      return;
    }

    // もう一方の拠点で全体練習になっている日も対象にする（全員が報告対象のため）
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
      // RLSの権限不足などで実際には0件しか更新されなかった場合はここに来る
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
    const event = eventData as { id: string; deadline: string; created_at: string };

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
        : { eventId: event.id, deadline: event.deadline, createdAt: event.created_at }
    );
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

  async function loadInjuries() {
    setLoadingInjuries(true);
    const { data, error } = await supabase
      .from("injuries")
      .select(
        "id, symptom_name, body_part, detail, expected_recovery_date, surgery_possibility, next_hospital_date, created_at"
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
    setShowInjuryForm(true);
  }

  async function handleSubmitInjury(e: React.FormEvent) {
    e.preventDefault();
    if (!injurySymptom.trim() || !injuryBodyPart.trim()) return;
    setSavingInjury(true);

    const payload = {
      team_id: profile.team_id,
      author_id: profile.id,
      symptom_name: injurySymptom.trim(),
      body_part: injuryBodyPart.trim(),
      detail: injuryDetail.trim() || null,
      expected_recovery_date: injuryRecoveryDate || null,
      surgery_possibility: injurySurgery,
      next_hospital_date: injuryNextHospital || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = editingInjuryId
      ? await supabase
          .from("injuries")
          .update(payload)
          .eq("id", editingInjuryId)
      : await supabase.from("injuries").insert(payload);

    if (error) {
      setErrorMsg(error.message);
    } else {
      resetInjuryForm();
      setShowInjuryForm(false);
      await loadInjuries();
    }
    setSavingInjury(false);
  }

  async function handleDeleteInjury(id: string) {
    if (!window.confirm("この怪我の報告を削除しますか？")) return;
    const { error } = await supabase.from("injuries").delete().eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadInjuries();
    }
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

  async function loadTodayLog() {
    setLoadingLog(true);
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id, date, content, type, title")
      .eq("author_id", profile.id)
      .eq("date", todayStr)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
    } else if (data) {
      const row = data as WeightLogRow;
      setTodayLog(row);
      setTodayLogText(row.content);
      setTodayLogType(row.type);
      setTodayLogTitle(row.title ?? "");
    }
    setLoadingLog(false);
  }

  // 今日提出済みの未実施報告(代替メニュー)を取得する
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

  async function loadRecentLogs() {
    setLoadingRecentLogs(true);

    // 直近60日をさかのぼって、実際にトレーニングを行った（実施報告 or 未実施報告の代替メニュー）
    // 日を新しい順に検索し、そのうち3日間分を表示する
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 60);
    const rangeStart = toDateKey(lookbackStart);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const rangeEnd = toDateKey(yesterday);

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("id, date, content, type, title")
      .eq("author_id", profile.id)
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
      .eq("author_id", profile.id)
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

    // 新しい順に見ていき、日付が重複しないよう3日間分だけ抽出する
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

  async function handleSaveLog() {
    setSavingLog(true);
    const trimmedTitle = todayLogTitle.trim();
    const { data, error } = await supabase
      .from("weight_logs")
      .upsert(
        {
          id: todayLog?.id,
          team_id: profile.team_id,
          author_id: profile.id,
          date: todayStr,
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
      await loadRecordDates();
      await loadTitleOptions();
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
          (r) =>
            r.menu &&
            r.menu.date >= rangeStart &&
            r.menu.date <= rangeEnd
        )
        .map((r) => ({ date: r.menu!.date, type: r.alt_type, title: null }));
      setCalendarAbsentLogs(filtered);
    }

    if (profile.home_location) {
      const { data: scheduleData, error: scheduleError } = await supabase
        .from("schedule_days")
        .select(
          "date, is_off, sessions:schedule_sessions(session_type, start_time)"
        )
        .eq("team_id", profile.team_id)
        .eq("location", profile.home_location)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      if (scheduleError) {
        setErrorMsg(scheduleError.message);
      } else {
        const map = new Map<string, { type: SessionType; time: string }[]>();
        for (const row of (scheduleData ?? []) as unknown as {
          date: string;
          is_off: boolean;
          sessions: { session_type: SessionType; start_time: string }[];
        }[]) {
          if (row.is_off) continue;
          const nonMat = row.sessions
            .filter((s) => s.session_type !== "mat")
            .map((s) => ({ type: s.session_type, time: s.start_time }));
          if (nonMat.length > 0) map.set(row.date, nonMat);
        }
        setCalendarSchedule(map);
      }
    }
  }

  async function loadDateRecord(dateStr: string) {
    setLoadingPopupRecord(true);

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("id, date, content, type, title")
      .eq("author_id", profile.id)
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
      .eq("author_id", profile.id)
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

    // 通常のトレーニング記録を先に、未実施報告の代替メニューはその後に並べる
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

  // トレーニング記録（実施報告 or 未実施報告の代替メニュー）がある日付を
  // 全期間分集めておく。カレンダーの矢印移動で「記録がある次/前の日」に
  // ジャンプするために使う。
  async function loadRecordDates() {
    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("date")
      .eq("author_id", profile.id);

    if (logError) {
      setErrorMsg(logError.message);
      return;
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", profile.id)
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

  function handleSelectCalendarDate(dateStr: string) {
    setSelectedCalendarDate(dateStr);
    loadDateRecord(dateStr);
  }

  function handleCloseCalendarPopup() {
    setSelectedCalendarDate(null);
    setPopupRecord(undefined);
  }

  // 記録がある日付の中で、現在の選択日より前/後にある最も近い日付へジャンプする
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

  function goToMenu(m: MenuRow) {
    try {
      sessionStorage.setItem(
        "jumpTo",
        JSON.stringify({ location: m.location, date: m.date })
      );
    } catch {
      // sessionStorageが使えない環境では何もしない
    }
    router.push("/");
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;
  const gradeLabel =
    profile.entry_year != null ? `${currentGrade(profile.entry_year)}年` : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">マイページ</h1>
        <div className="flex flex-col items-end text-[11px] leading-tight text-neutral-500">
          <span>{formatFullDate(todayStr)}</span>
          <span className="font-semibold text-neutral-700">
            {profile.display_name}
            {gradeLabel && ` ${gradeLabel}`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            掲示板に戻る
          </button>
          <button
            onClick={() => router.push("/team")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            チームページ
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        {/* 次の試合まで */}
        <section className="flex flex-col gap-2">
          {loadingMatch ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : nextMatch ? (
            <div className="relative rounded-lg border border-red-200 bg-red-50 p-4 text-center">
              <p className="text-xs text-red-600">次の試合【{nextMatch.name}】まで</p>
              <p className="text-3xl font-bold text-red-700">
                あと{matchDays}日
              </p>
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
                    className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm"
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
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 active:bg-red-100"
                    >
                      削除する
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMatch(false)}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
                    >
                      閉じる
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={startEditingMatch}
                  className="absolute bottom-2 right-2 rounded border border-red-200 bg-white px-2 py-1 text-[10px] text-red-500 active:bg-red-100"
                >
                  編集
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-400">
              次の試合はまだ登録されていません。
            </p>
          )}

          <button
            onClick={() => setShowMatchForm((v) => !v)}
            className="self-start text-[11px] font-medium text-red-700 active:text-red-900"
          >
            {showMatchForm ? "キャンセル" : "＋ 試合を登録する"}
          </button>
          {showMatchForm && (
            <form
              onSubmit={handleAddMatch}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <input
                type="text"
                placeholder="試合名（例：全日本学生選手権）"
                value={newMatchName}
                onChange={(e) => setNewMatchName(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                required
              />
              <input
                type="date"
                value={newMatchDate}
                onChange={(e) => setNewMatchDate(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
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

        {/* やることリスト */}
        <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            やることリスト
          </h2>

          {weightMaxTodo &&
            (() => {
              const isOverdue = todayStr > weightMaxTodo.deadline;
              return (
                <div
                  className={`flex flex-col rounded-lg border p-3 text-sm ${
                    isOverdue
                      ? "border-red-600 bg-red-600 text-white shadow-lg ring-2 ring-red-400"
                      : "border-amber-200 bg-amber-50 text-left"
                  }`}
                >
                  <button
                    onClick={() => setWeightMaxTodoOpen((v) => !v)}
                    className="flex w-full flex-col text-left"
                  >
                    <span
                      className={`text-[11px] ${isOverdue ? "text-white" : "text-amber-600"}`}
                    >
                      {isOverdue
                        ? `期限切れ！(${weightMaxTodo.deadline}まで)`
                        : `${weightMaxTodo.deadline}までに提出`}
                    </span>
                    <span
                      className={`font-medium ${isOverdue ? "text-white" : "text-neutral-800"}`}
                    >
                      ウェイトMAX(BIG3)を提出する
                    </span>
                  </button>
                  {weightMaxTodoOpen && (
                    <div className="mt-3 flex flex-col gap-2 rounded-lg bg-white p-3 text-neutral-800">
                      <div className="grid grid-cols-3 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                          ベンチプレス(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={weightMaxBench}
                            onChange={(e) => setWeightMaxBench(e.target.value)}
                            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                          スクワット(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={weightMaxSquat}
                            onChange={(e) => setWeightMaxSquat(e.target.value)}
                            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                          デッドリフト(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={weightMaxDeadlift}
                            onChange={(e) =>
                              setWeightMaxDeadlift(e.target.value)
                            }
                            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
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

          {!profile.home_location ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              所属拠点(多摩/大塚)がまだ設定されていません。設定されると、未報告の練習メニューがここに表示されます。
            </p>
          ) : loadingTodo ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : todoMenus.length === 0 ? (
            !weightMaxTodo && (
              <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
                未報告の練習メニューはありません。
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-2">
              {todoMenus.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => goToMenu(m)}
                    className="flex w-full flex-col rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm active:bg-amber-100"
                  >
                    <span className="text-[11px] text-amber-600">
                      {locationLabel[m.location]}・実施報告 未提出
                    </span>
                    <span className="font-medium text-neutral-800">
                      {m.title || formatShortDateTime(m.date, m.start_time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 本日のトレーニングメニュー */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            本日のトレーニングメニュー
          </h2>

          {todayAbsentRecords.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-500">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[r.type]}`}
                />
                {trainingTypeLabel[r.type]}
                <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                  未実施報告の代替メニュー
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">
                {r.content}
              </p>
            </div>
          ))}

          {loadingLog ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
                {(
                  Object.keys(trainingTypeLabel) as TrainingType[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTodayLogType(t)}
                    className={`flex-1 rounded-md py-2 font-medium ${
                      todayLogType === t
                        ? "bg-white text-neutral-900 shadow"
                        : "text-neutral-500"
                    }`}
                  >
                    {trainingTypeLabel[t]}
                  </button>
                ))}
              </div>
              {todayLogType === "weight" && (
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                  タイトル（種目名など。任意）
                  <input
                    type="text"
                    list="weight-title-options"
                    value={todayLogTitle}
                    onChange={(e) => setTodayLogTitle(e.target.value)}
                    placeholder="例：BIG3、上半身の日 など"
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm text-neutral-800"
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
                className={`rounded-lg border px-3 py-2.5 text-sm ${
                  !todayLog
                    ? "border-neutral-300"
                    : todayLogType === "weight" && todayLogTitle.trim()
                      ? `${getTitleColor(todayLogTitle.trim()).border} ${getTitleColor(todayLogTitle.trim()).fill}`
                      : "border-emerald-300 bg-emerald-50"
                }`}
              />
              <button
                onClick={handleSaveLog}
                disabled={savingLog}
                className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
              >
                {todayLog ? "更新する" : "保存する"}
              </button>
              {todayLog && (
                <p className="text-[11px] text-emerald-600">
                  保存済みです。内容を変えてから「更新する」を押すと上書きされます。
                </p>
              )}
            </div>
          )}
        </section>

        {/* 直近のトレーニング記録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            直近のトレーニング記録
          </h2>
          <p className="text-[11px] text-neutral-400">
            過去にトレーニングを行った直近3日間のメニューが表示されます。それ以外のメニューは下の「記録カレンダー」から閲覧できます。
          </p>
          {loadingRecentLogs ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : recentLogs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              まだ記録がありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentLogs.map((log) => {
                const titleColor = log.title ? getTitleColor(log.title) : null;
                return (
                  <details
                    key={log.id}
                    className={`rounded-lg border p-3 ${
                      titleColor ? titleColor.border : "border-neutral-200"
                    }`}
                  >
                    <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-500">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[log.type]}`}
                      />
                      {formatMonthDay(log.date)}・{trainingTypeLabel[log.type]}
                      {log.title && (
                        <span
                          className={`rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium ${titleColor?.text}`}
                        >
                          {log.title}
                        </span>
                      )}
                      {log.isAlternative && (
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">
                          代替メニュー
                        </span>
                      )}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                      {log.content || "(記録なし)"}
                    </p>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        {/* 記録カレンダー */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            記録カレンダー
          </h2>
          <div className="relative">
            <TrainingCalendar
              cursor={calendarCursor}
              onCursorChange={setCalendarCursor}
              weightLogs={calendarWeightLogs}
              absentLogs={calendarAbsentLogs}
              scheduleByDate={calendarSchedule}
              onSelectDate={handleSelectCalendarDate}
              highlightDate={selectedCalendarDate}
              todayDate={todayStr}
              nextMatchDate={nextMatch?.date ?? null}
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

                  {selectedCalendarDate &&
                    (calendarSchedule.get(selectedCalendarDate) ?? []).length >
                      0 && (
                      <div className="mb-3 flex flex-col gap-1 rounded-lg bg-neutral-50 p-2">
                        <p className="text-[10px] font-semibold text-neutral-400">
                          この日の予定
                        </p>
                        {(calendarSchedule.get(selectedCalendarDate) ?? []).map(
                          (s, idx) => (
                            <span
                              key={idx}
                              className="flex items-center gap-1 text-xs text-neutral-600"
                            >
                              <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${sessionTypeDotColor[s.type]}`}
                              />
                              {sessionTypeLabel[s.type]}
                              {s.time.slice(0, 5)}〜
                            </span>
                          )
                        )}
                      </div>
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
                            {r.title && (
                              <span
                                className={`rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium ${getTitleColor(r.title).text}`}
                              >
                                {r.title}
                              </span>
                            )}
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

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            怪我の記録・復帰計画
          </h2>

          {!showInjuryForm && (
            <button
              onClick={handleStartNewInjury}
              className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white active:bg-neutral-700"
            >
              ＋ 怪我を報告する
            </button>
          )}

          {showInjuryForm && (
            <form
              onSubmit={handleSubmitInjury}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3"
            >
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                怪我の症状名
                <input
                  type="text"
                  required
                  value={injurySymptom}
                  onChange={(e) => setInjurySymptom(e.target.value)}
                  placeholder="例：前十字靭帯損傷、肉離れ など"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                発生場所（部位）
                <input
                  type="text"
                  required
                  value={injuryBodyPart}
                  onChange={(e) => setInjuryBodyPart(e.target.value)}
                  placeholder="例：右膝、左足首 など"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                発生時の詳細
                <textarea
                  value={injuryDetail}
                  onChange={(e) => setInjuryDetail(e.target.value)}
                  rows={4}
                  placeholder="いつ・どんな状況で起きたかなど自由に記入してください"
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                  完治見込み日
                  <input
                    type="date"
                    value={injuryRecoveryDate}
                    onChange={(e) => setInjuryRecoveryDate(e.target.value)}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                  次回通院日
                  <input
                    type="date"
                    value={injuryNextHospital}
                    onChange={(e) => setInjuryNextHospital(e.target.value)}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                手術の可能性
                <select
                  value={injurySurgery}
                  onChange={(e) =>
                    setInjurySurgery(
                      e.target.value as "yes" | "no" | "unknown"
                    )
                  }
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="unknown">未定</option>
                  <option value="yes">あり</option>
                  <option value="no">なし</option>
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={savingInjury}
                  className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                >
                  {editingInjuryId ? "更新する" : "報告する"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetInjuryForm();
                    setShowInjuryForm(false);
                  }}
                  className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm text-neutral-600"
                >
                  キャンセル
                </button>
              </div>
            </form>
          )}

          {loadingInjuries ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : injuries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              報告されている怪我はありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {injuries.map((inj) => (
                <li
                  key={inj.id}
                  className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-800">
                      {inj.symptom_name}（{inj.body_part}）
                    </span>
                    <span className="text-[10px] text-neutral-400">
                      {formatMonthDay(toDateKey(new Date(inj.created_at)))}報告
                    </span>
                  </div>
                  {inj.detail && (
                    <p className="whitespace-pre-wrap text-neutral-600">
                      {inj.detail}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3 text-[11px] text-neutral-500">
                    <span>
                      完治見込み:{" "}
                      {inj.expected_recovery_date
                        ? formatMonthDay(inj.expected_recovery_date)
                        : "未定"}
                    </span>
                    <span>
                      次回通院:{" "}
                      {inj.next_hospital_date
                        ? formatMonthDay(inj.next_hospital_date)
                        : "未定"}
                    </span>
                    <span>
                      手術:{" "}
                      {inj.surgery_possibility === "yes"
                        ? "あり"
                        : inj.surgery_possibility === "no"
                          ? "なし"
                          : "未定"}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleStartEditInjury(inj)}
                      className="text-[11px] font-medium text-neutral-500 underline"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDeleteInjury(inj.id)}
                      className="text-[11px] font-medium text-red-500 underline"
                    >
                      削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ログアウト（一番下に配置） */}
        <div className="border-t border-neutral-200 pt-4">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-neutral-300 py-3 text-sm font-medium text-neutral-600 active:bg-neutral-100"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}

function TrainingCalendar({
  cursor,
  onCursorChange,
  weightLogs,
  absentLogs,
  scheduleByDate,
  onSelectDate,
  highlightDate,
  todayDate,
  nextMatchDate,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  weightLogs: { date: string; type: TrainingType; title: string | null }[];
  absentLogs: { date: string; type: TrainingType; title: string | null }[];
  scheduleByDate: Map<string, { type: SessionType; time: string }[]>;
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
  todayDate?: string;
  nextMatchDate?: string | null;
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
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100"
        >
          ＜
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100"
        >
          ＞
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
          const title = titleByDate.get(key);
          const titleColor = title ? getTitleColor(title) : null;
          const isHighlighted = key === highlightDate;
          const isToday = key === todayDate;
          const isMatchDay = !!nextMatchDate && key === nextMatchDate;
          return (
            <button
              key={i}
              onClick={() => onSelectDate(key)}
              className={`relative flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs active:bg-neutral-100 ${
                isHighlighted
                  ? "bg-amber-50 font-bold text-amber-700 ring-2 ring-amber-400"
                  : titleColor
                    ? `${titleColor.fill} text-neutral-700`
                    : "text-neutral-600"
              } ${
                isMatchDay
                  ? "ring-2 ring-red-400"
                  : isToday
                    ? "ring-1 ring-neutral-900"
                    : ""
              }`}
              title={title ?? undefined}
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
              {(scheduleByDate.get(key) ?? []).length > 0 && (
                <span
                  className="flex flex-wrap justify-center gap-0.5"
                  title={(scheduleByDate.get(key) ?? [])
                    .map((s) => `${sessionTypeLabel[s.type]}${s.time.slice(0, 5)}〜`)
                    .join("、")}
                >
                  {(scheduleByDate.get(key) ?? []).map((s, idx) => (
                    <span
                      key={idx}
                      className={`inline-block h-1.5 w-1.5 rounded-full border ${sessionTypeDotColor[s.type].replace("bg-", "border-")} bg-transparent`}
                    />
                  ))}
                </span>
              )}
              {isMatchDay && (
                <span className="absolute -top-1 -right-1 rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">
                  試合
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded ring-1 ring-neutral-900" />
          今日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded ring-2 ring-red-400" />
          次の試合日
        </span>
        {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[t]}`}
            />
            {trainingTypeLabel[t]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full border border-neutral-400 bg-transparent" />
          予定（未実施）
        </span>
      </p>
    </div>
  );
}
