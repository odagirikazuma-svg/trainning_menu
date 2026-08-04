"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  locations,
  Role,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
  teamEventTypeLabel,
  TeamEventType,
} from "../lib/types";
import type { Profile } from "./AuthGate";

// ダークテーマ用の合宿/試合/出稽古バッジ配色（types.tsの共有カラーはライト前提のため、ここではローカルに上書きする）
const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-950/40 text-pink-400",
  match: "bg-red-950/40 text-red-400",
  away: "bg-purple-950/40 text-purple-400",
};

type MemberRow = {
  id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  entry_year: number | null;
  isPending?: boolean;
};

// member_rosterテーブルのroleカラムに入り得る値
type RosterRoleForMember = "captain" | "vice_captain" | "coach" | "member";

type ScheduleSessionRow = {
  id: string;
  session_no: number;
  session_type: SessionType;
  start_time: string;
  is_joint: boolean;
  joint_location: Location | null;
  location_note: string | null;
};

type ScheduleDayRow = {
  id: string;
  date: string;
  location: Location;
  is_off: boolean;
  day_type: DayType;
  event_name: string | null;
  sessions: ScheduleSessionRow[];
};

type ScheduleDetailRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_off: boolean;
  creator: { display_name: string } | null;
};

type WeightMaxRow = {
  author_id: string;
  event_id: string | null;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

type WeightMaxEventInfo = {
  id: string;
  measurementDate: string;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "掲示板"側の仕様と合わせ、練習開始時刻を過ぎた（＝過去の）メニューは編集不可とする
function isPastSession(dateStr: string, startTime: string | null): boolean {
  if (!startTime) return true;
  const threshold = new Date(`${dateStr}T${startTime}`);
  return new Date() >= threshold;
}

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

export default function TeamPage({
  profile,
}: {
  profile: Profile;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthScheduleDays, setMonthScheduleDays] = useState<
    Map<string, ScheduleDayRow>
  >(new Map());
  const [loadingMonthSchedule, setLoadingMonthSchedule] = useState(true);
  const [scheduleLocation, setScheduleLocation] = useState<Location>(
    profile.role === "coach"
      ? (profile.home_location ?? "tama")
      : profile.role === "manager"
        ? "tama"
        : (profile.home_location ?? "tama")
  );
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<
    string | null
  >(() => toDateKey(new Date()));
  const [showDayPopup, setShowDayPopup] = useState(false);
  const [dayDetail, setDayDetail] = useState<
    ScheduleDayRow | null | undefined
  >(undefined);
  const [matMenuDetail, setMatMenuDetail] = useState<
    ScheduleDetailRow | null | undefined
  >(undefined);
  const [loadingDayDetail, setLoadingDayDetail] = useState(false);

  const [editingSchedule, setEditingSchedule] = useState(false);
  const [editCategory, setEditCategory] = useState<"off" | DayType>(
    "practice"
  );
  const [editIncludeSessions, setEditIncludeSessions] = useState(true);
  const [editEventName, setEditEventName] = useState("");
  const [editOffBothLocations, setEditOffBothLocations] = useState(false);
  const [editShareBothLocations, setEditShareBothLocations] = useState(true);
  const [editSessions, setEditSessions] = useState<
    {
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
      locationNote: string;
    }[]
  >([]);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState("");
  const [bulkEndDate, setBulkEndDate] = useState("");
  const [bulkCategory, setBulkCategory] = useState<
    "off" | "camp" | "match" | "away"
  >("off");
  const [bulkEventName, setBulkEventName] = useState("");
  const [bulkOffBothLocations, setBulkOffBothLocations] = useState(false);
  const [bulkShareBothLocations, setBulkShareBothLocations] = useState(true);
  const [bulkIncludeSessions, setBulkIncludeSessions] = useState(false);
  const [bulkSessions, setBulkSessions] = useState<
    {
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
      locationNote: string;
    }[]
  >([
    {
      type: "mat",
      time: "10:00",
      isJoint: false,
      jointLocation: "tama",
      locationNote: "",
    },
  ]);
  const [savingBulk, setSavingBulk] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const canEditMatMenu =
    profile.role === "captain" ||
    profile.role === "leader" ||
    profile.role === "vice_leader" ||
    profile.role === "coach";
  const isCoach = profile.role === "coach";
  // 部員（コーチ以外）が閲覧・操作できる拠点。マネージャーは多摩所属として扱う。
  const restrictedHomeLocation: Location =
    profile.role === "manager" ? "tama" : (profile.home_location ?? "tama");
  const todayStr = toDateKey(new Date());

  const [weightMaxes, setWeightMaxes] = useState<WeightMaxRow[]>([]);

  const [activeEvents, setActiveEvents] = useState<
    { id: string; type: "weight_max" | TeamEventType; label: string; deadline: string }[]
  >([]);
  const [loadingActiveEvents, setLoadingActiveEvents] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [eventSubmissionDetail, setEventSubmissionDetail] = useState<
    { memberId: string; displayName: string; location: Location; submitted: boolean }[]
  >([]);
  const [loadingEventDetail, setLoadingEventDetail] = useState(false);
  const [loadingMaxes, setLoadingMaxes] = useState(true);
  const [weightMaxEvents, setWeightMaxEvents] = useState<WeightMaxEventInfo[]>(
    []
  );

  const [teamEvents, setTeamEvents] = useState<
    {
      id: string;
      type: TeamEventType;
      title: string;
      deadline: string;
      created_at: string;
    }[]
  >([]);
  const [teamEventSubmissions, setTeamEventSubmissions] = useState<
    {
      event_id: string;
      author_id: string;
      content: string;
      weight_kg: number | null;
      body_fat_pct: number | null;
      measurement_date: string | null;
      muscle_mass_kg: number | null;
      lean_body_mass_kg: number | null;
    }[]
  >([]);
  const [loadingTeamEvents, setLoadingTeamEvents] = useState(true);

  const [submissionCounts, setSubmissionCounts] = useState<
    Map<string, { submitted: number; total: number }>
  >(new Map());
  const [submissionCountsByLoc, setSubmissionCountsByLoc] = useState<
    Map<string, Record<Location, { submitted: number; total: number } | null>>
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

  useEffect(() => {
    loadMembers();
    loadWeightMaxes();
    loadTeamEvents();
    loadActiveEvents();
    if (selectedScheduleDate) loadDayDetail(selectedScheduleDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor, scheduleLocation]);

  useEffect(() => {
    loadMonthSubmissionCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthScheduleDays, members, scheduleLocation, calendarCursor]);

  useEffect(() => {
    if (selectedScheduleDate) loadDaySubmissionDetail(selectedScheduleDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthScheduleDays, members, scheduleLocation]);

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, role, home_location, entry_year")
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
      role: (r.role === "vice_captain" ? "vice_leader" : r.role) as Role,
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

  async function loadMonthSchedule() {
    setLoadingMonthSchedule(true);
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const { data, error } = await supabase
      .from("schedule_days")
      .select(
        "id, date, location, is_off, day_type, event_name, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location, location_note)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (error) {
      setErrorMsg(error.message);
      setLoadingMonthSchedule(false);
      return;
    }

    const map = new Map<string, ScheduleDayRow>();
    for (const row of (data ?? []) as unknown as ScheduleDayRow[]) {
      map.set(row.date, {
        ...row,
        sessions: [...row.sessions].sort((a, b) => a.session_no - b.session_no),
      });
    }
    setMonthScheduleDays(map);
    setLoadingMonthSchedule(false);
  }

  async function loadMatMenu(dateStr: string) {
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, location, start_time, is_off, creator:profiles!menus_created_by_fkey(display_name)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .eq("date", dateStr)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
      setMatMenuDetail(null);
    } else {
      setMatMenuDetail((data as unknown as ScheduleDetailRow | null) ?? null);
    }
  }

  async function loadDayDetail(dateStr: string) {
    setLoadingDayDetail(true);
    setMatMenuDetail(undefined);

    const { data, error } = await supabase
      .from("schedule_days")
      .select(
        "id, date, location, is_off, day_type, event_name, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location, location_note)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .eq("date", dateStr)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
      setDayDetail(null);
      setLoadingDayDetail(false);
      return;
    }

    if (!data) {
      setDayDetail(null);
      setLoadingDayDetail(false);
      return;
    }

    const row = data as unknown as ScheduleDayRow;
    row.sessions = [...row.sessions].sort((a, b) => a.session_no - b.session_no);
    setDayDetail(row);
    setLoadingDayDetail(false);

    const hasMat = row.sessions.some((s) => s.session_type === "mat");
    if (!row.is_off && hasMat) {
      await loadMatMenu(dateStr);
    }
  }

  function handleSelectScheduleDate(dateStr: string) {
    setSelectedScheduleDate(dateStr);
    setShowDayPopup(true);
    setEditingSchedule(false);
    loadDayDetail(dateStr);
    loadDaySubmissionDetail(dateStr);
  }

  function handleCloseScheduleDetail() {
    setShowDayPopup(false);
    setEditingSchedule(false);
  }

  function handleShiftScheduleDate(diffDays: number) {
    if (!selectedScheduleDate) return;
    const [y, m, d] = selectedScheduleDate.split("-").map(Number);
    const next = new Date(y, m - 1, d + diffDays);
    const nextKey = toDateKey(next);
    setSelectedScheduleDate(nextKey);
    setEditingSchedule(false);
    loadDayDetail(nextKey);
    if (
      next.getFullYear() !== calendarCursor.getFullYear() ||
      next.getMonth() !== calendarCursor.getMonth()
    ) {
      setCalendarCursor(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }

  function handleGoToMatMenu(startTime?: string) {
    if (!selectedScheduleDate) return;
    try {
      sessionStorage.setItem(
        "jumpTo",
        JSON.stringify({
          location: scheduleLocation,
          date: selectedScheduleDate,
          startTime: startTime ?? null,
        })
      );
    } catch {
      // sessionStorageが使えない環境では何もしない
    }
    router.push("/");
  }

  // 出稽古・合宿の予定を削除する（コーチのみ・この拠点の予定のみ削除）
  async function handleDeleteAwayLikeSchedule() {
    if (!isCoach || !selectedScheduleDate || !dayDetail) return;
    if (dayDetail.day_type !== "camp" && dayDetail.day_type !== "away") return;

    const label = `${dayTypeLabel[dayDetail.day_type]}${
      dayDetail.event_name ? `：${dayDetail.event_name}` : ""
    }`;
    const ok = window.confirm(
      `${locationLabel[scheduleLocation]}・${formatMonthDay(
        selectedScheduleDate
      )}の「${label}」予定を削除します。よろしいですか？\n（この拠点の予定のみ削除されます。もう一方の拠点にも登録している場合は、そちらは別途削除してください）`
    );
    if (!ok) return;

    setErrorMsg(null);
    const { data: dayRow, error: findError } = await supabase
      .from("schedule_days")
      .select("id")
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .eq("date", selectedScheduleDate)
      .maybeSingle();

    if (findError) {
      setErrorMsg(findError.message);
      return;
    }
    if (dayRow) {
      const { error: deleteError } = await supabase
        .from("schedule_days")
        .delete()
        .eq("id", (dayRow as { id: string }).id);
      if (deleteError) {
        setErrorMsg(deleteError.message);
        return;
      }
    }

    await loadMonthSchedule();
    await loadDayDetail(selectedScheduleDate);
  }

  function handleStartEditSchedule() {
    const category: "off" | DayType = dayDetail?.is_off
      ? "off"
      : (dayDetail?.day_type ?? "practice");
    setEditCategory(category);
    setEditEventName(dayDetail?.event_name ?? "");
    setEditOffBothLocations(false);
    setEditShareBothLocations(true);
    setEditIncludeSessions(
      category === "practice" || (dayDetail?.sessions.length ?? 0) > 0
    );
    if (dayDetail && dayDetail.sessions.length > 0) {
      setEditSessions(
        dayDetail.sessions.map((s) => ({
          type: s.session_type,
          time: s.start_time.slice(0, 5),
          isJoint: s.is_joint,
          jointLocation: s.joint_location ?? scheduleLocation,
          locationNote: s.location_note ?? "",
        }))
      );
    } else {
      setEditSessions([
        {
          type: "mat",
          time: "10:00",
          isJoint: false,
          jointLocation: scheduleLocation,
          locationNote: "",
        },
      ]);
    }
    setEditingSchedule(true);
  }

  function updateEditSession(
    idx: number,
    patch: Partial<{
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
      locationNote: string;
    }>
  ) {
    setEditSessions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  }

  function addEditSession() {
    setEditSessions((prev) =>
      prev.length >= 2
        ? prev
        : [
            ...prev,
            {
              type: "weight",
              time: "17:00",
              isJoint: false,
              jointLocation: scheduleLocation,
              locationNote: "",
            },
          ]
    );
  }

  function removeEditSession(idx: number) {
    setEditSessions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  function updateBulkSession(
    idx: number,
    patch: Partial<{
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
      locationNote: string;
    }>
  ) {
    setBulkSessions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  }

  function addBulkSession() {
    setBulkSessions((prev) =>
      prev.length >= 2
        ? prev
        : [
            ...prev,
            {
              type: "weight",
              time: "17:00",
              isJoint: false,
              jointLocation: scheduleLocation,
              locationNote: "",
            },
          ]
    );
  }

  function removeBulkSession(idx: number) {
    setBulkSessions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  function handleOpenBulk() {
    setBulkStartDate(selectedScheduleDate ?? todayStr);
    setBulkEndDate(selectedScheduleDate ?? todayStr);
    setBulkCategory("off");
    setBulkEventName("");
    setBulkOffBothLocations(false);
    setBulkShareBothLocations(true);
    setBulkIncludeSessions(false);
    setBulkSessions([
      {
        type: "mat",
        time: "10:00",
        isJoint: false,
        jointLocation: scheduleLocation,
        locationNote: "",
      },
    ]);
    setBulkResult(null);
    setBulkOpen(true);
  }

  async function handleSaveBulk() {
    if (!bulkStartDate || !bulkEndDate) return;
    if (bulkEndDate < bulkStartDate) {
      setErrorMsg("終了日は開始日より後の日付にしてください。");
      return;
    }

    setSavingBulk(true);
    setBulkResult(null);

    const dates: string[] = [];
    const cursorDate = new Date(
      Number(bulkStartDate.slice(0, 4)),
      Number(bulkStartDate.slice(5, 7)) - 1,
      Number(bulkStartDate.slice(8, 10))
    );
    const endDateObj = new Date(
      Number(bulkEndDate.slice(0, 4)),
      Number(bulkEndDate.slice(5, 7)) - 1,
      Number(bulkEndDate.slice(8, 10))
    );
    while (cursorDate <= endDateObj) {
      dates.push(toDateKey(cursorDate));
      cursorDate.setDate(cursorDate.getDate() + 1);
    }

    let failCount = 0;
    for (const d of dates) {
      const errorMessage = await saveScheduleForDate(
        d,
        bulkCategory,
        bulkSessions,
        bulkIncludeSessions,
        bulkEventName,
        bulkOffBothLocations,
        bulkShareBothLocations
      );
      if (errorMessage) failCount++;
    }

    setSavingBulk(false);
    if (failCount > 0) {
      setBulkResult(
        `${dates.length}日中${dates.length - failCount}日を設定しました（${failCount}日は失敗しました）。`
      );
    } else {
      setBulkResult(`${dates.length}日分をまとめて設定しました。`);
    }
    await loadMonthSchedule();
    if (selectedScheduleDate) await loadDayDetail(selectedScheduleDate);
  }

  // 1日分の時間割を保存する共通処理（単日編集・期間一括設定の両方から使う）
  async function saveScheduleForDate(
    dateStr: string,
    category: "off" | DayType,
    sessions: {
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
      locationNote: string;
    }[],
    includeSessionsFlag: boolean,
    eventName: string = "",
    offBothLocations: boolean = false,
    shareBothLocations: boolean = true
  ): Promise<string | null> {
    const isOff = category === "off";
    const dayType: DayType = isOff ? "practice" : (category as DayType);
    const includeSessions = isOff
      ? false
      : dayType === "practice"
        ? true
        : includeSessionsFlag;
    const isAwayLike = dayType === "camp" || dayType === "away";
    const trimmedEventName =
      dayType === "camp" || dayType === "match" || dayType === "away"
        ? eventName.trim() || null
        : null;

    const { data: dayRow, error: dayError } = await supabase
      .from("schedule_days")
      .upsert(
        {
          team_id: profile.team_id,
          location: scheduleLocation,
          date: dateStr,
          is_off: isOff,
          day_type: dayType,
          event_name: trimmedEventName,
          created_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id,location,date" }
      )
      .select("id")
      .single();

    if (dayError || !dayRow) {
      return dayError?.message ?? "時間割の保存に失敗しました。";
    }

    const dayId = (dayRow as { id: string }).id;

    const { error: delError } = await supabase
      .from("schedule_sessions")
      .delete()
      .eq("schedule_day_id", dayId);

    if (delError) return delError.message;

    if (!isOff && includeSessions && sessions.length > 0) {
      const rows = sessions.map((s, idx) => {
        // 合宿・出稽古は「両拠点に反映する」がオンの時だけ全体練習として扱う
        const isJoint = isAwayLike ? shareBothLocations : s.isJoint;
        return {
          schedule_day_id: dayId,
          session_no: idx + 1,
          session_type: s.type,
          start_time: s.time,
          is_joint: isJoint,
          joint_location: isJoint ? s.jointLocation : null,
          location_note: isAwayLike ? s.locationNote.trim() || null : null,
        };
      });
      const { error: insError } = await supabase
        .from("schedule_sessions")
        .insert(rows);
      if (insError) return insError.message;

      if (
        !(
          (dayType === "camp" || dayType === "match" || dayType === "away") &&
          !shareBothLocations
        )
      ) {
        for (const s of sessions) {
          const isJoint = isAwayLike ? shareBothLocations : s.isJoint;
          if (isJoint) {
            await propagateJointSession(dateStr, scheduleLocation, s.jointLocation, {
              type: s.type,
              time: s.time,
              locationNote: isAwayLike ? s.locationNote.trim() || null : null,
            });
          }
        }
      }
    }

    if (
      !isOff &&
      (dayType === "camp" || dayType === "match" || dayType === "away") &&
      shareBothLocations
    ) {
      await propagateDayType(
        dateStr,
        scheduleLocation,
        dayType,
        trimmedEventName
      );
    }

    if (isOff && offBothLocations) {
      const otherLocation: Location =
        scheduleLocation === "tama" ? "otsuka" : "tama";
      const { data: otherDay } = await supabase
        .from("schedule_days")
        .upsert(
          {
            team_id: profile.team_id,
            location: otherLocation,
            date: dateStr,
            is_off: true,
            day_type: "practice",
            event_name: null,
            created_by: profile.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "team_id,location,date" }
        )
        .select("id")
        .single();
      if (otherDay) {
        await supabase
          .from("schedule_sessions")
          .delete()
          .eq("schedule_day_id", (otherDay as { id: string }).id);
      }
    }

    return null;
  }

  async function handleSaveSchedule() {
    if (!selectedScheduleDate) return;
    setSavingSchedule(true);

    const errorMessage = await saveScheduleForDate(
      selectedScheduleDate,
      editCategory,
      editSessions,
      editIncludeSessions,
      editEventName,
      editOffBothLocations,
      editShareBothLocations
    );

    if (errorMessage) {
      setErrorMsg(errorMessage);
      setSavingSchedule(false);
      return;
    }

    setEditingSchedule(false);
    setSavingSchedule(false);
    await loadMonthSchedule();
    await loadDayDetail(selectedScheduleDate);
  }

  async function propagateDayType(
    dateStr: string,
    editingLocation: Location,
    dayType: DayType,
    eventName: string | null = null
  ) {
    const otherLocation: Location =
      editingLocation === "tama" ? "otsuka" : "tama";

    await supabase.from("schedule_days").upsert(
      {
        team_id: profile.team_id,
        location: otherLocation,
        date: dateStr,
        is_off: false,
        day_type: dayType,
        event_name: eventName,
        created_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id,location,date", ignoreDuplicates: false }
    );
  }

  // 全体練習のセッションを、もう一方の拠点のカレンダーにも自動で反映する
  // （既に同じ内容の通知セッションがあれば時刻だけ更新し、無ければ空いている
  //   セッション枠に追加する。すでに2セッション埋まっている場合は反映できない）
  async function propagateJointSession(
    dateStr: string,
    editingLocation: Location,
    hostLocation: Location,
    session: { type: SessionType; time: string; locationNote?: string | null }
  ) {
    const otherLocation: Location =
      editingLocation === "tama" ? "otsuka" : "tama";

    const { data: existingDay } = await supabase
      .from("schedule_days")
      .select(
        "id, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location, location_note)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", otherLocation)
      .eq("date", dateStr)
      .maybeSingle();

    const { data: dayRow, error: dayError } = await supabase
      .from("schedule_days")
      .upsert(
        {
          team_id: profile.team_id,
          location: otherLocation,
          date: dateStr,
          is_off: false,
          created_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id,location,date" }
      )
      .select("id")
      .single();

    if (dayError || !dayRow) return;

    const dayId = (dayRow as { id: string }).id;
    const existingSessions =
      ((existingDay as unknown as { sessions: ScheduleSessionRow[] } | null)
        ?.sessions ?? []);

    const mirrored = existingSessions.find(
      (s) =>
        s.is_joint &&
        s.joint_location === hostLocation &&
        s.session_type === session.type
    );

    if (mirrored) {
      if (
        mirrored.start_time.slice(0, 5) !== session.time ||
        mirrored.location_note !== (session.locationNote ?? null)
      ) {
        await supabase
          .from("schedule_sessions")
          .update({
            start_time: session.time,
            location_note: session.locationNote ?? null,
          })
          .eq("id", mirrored.id);
      }
      return;
    }

    const usedNos = new Set(existingSessions.map((s) => s.session_no));
    const sessionNo = !usedNos.has(1) ? 1 : !usedNos.has(2) ? 2 : null;
    if (sessionNo === null) return; // 既に2セッション分埋まっている場合は反映できない

    await supabase.from("schedule_sessions").insert({
      schedule_day_id: dayId,
      session_no: sessionNo,
      session_type: session.type,
      start_time: session.time,
      is_joint: true,
      joint_location: hostLocation,
      location_note: session.locationNote ?? null,
    });
  }

  async function loadWeightMaxes() {
    setLoadingMaxes(true);
    const { data, error } = await supabase
      .from("weight_maxes")
      .select("author_id, event_id, bench, squat, deadlift")
      .eq("team_id", profile.team_id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setWeightMaxes((data ?? []) as WeightMaxRow[]);
    }

    const { data: eventData, error: eventError } = await supabase
      .from("weight_max_events")
      .select("id, deadline, closed_at")
      .eq("team_id", profile.team_id);

    if (eventError) {
      setErrorMsg(eventError.message);
    } else {
      const events = (
        (eventData ?? []) as {
          id: string;
          deadline: string;
          closed_at: string | null;
        }[]
      ).map((e) => {
        // 測定日は「締切日」と「集計終了日」のうち早い方
        const closedDateStr = e.closed_at
          ? toDateKey(new Date(e.closed_at))
          : null;
        const measurementDate =
          closedDateStr && closedDateStr < e.deadline
            ? closedDateStr
            : e.deadline;
        return { id: e.id, measurementDate };
      });
      events.sort((a, b) => b.measurementDate.localeCompare(a.measurementDate));
      setWeightMaxEvents(events);
    }
    setLoadingMaxes(false);
  }

  async function loadTeamEvents() {
    setLoadingTeamEvents(true);
    const { data: eventData, error: eventError } = await supabase
      .from("team_events")
      .select("id, type, title, deadline, created_at")
      .eq("team_id", profile.team_id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (eventError) {
      setErrorMsg(eventError.message);
      setLoadingTeamEvents(false);
      return;
    }
    const events = (eventData ?? []) as {
      id: string;
      type: TeamEventType;
      title: string;
      deadline: string;
      created_at: string;
    }[];
    setTeamEvents(events);

    if (events.length === 0) {
      setTeamEventSubmissions([]);
      setLoadingTeamEvents(false);
      return;
    }

    const { data: subData, error: subError } = await supabase
      .from("team_event_submissions")
      .select(
        "event_id, author_id, content, weight_kg, body_fat_pct, measurement_date, muscle_mass_kg, lean_body_mass_kg"
      )
      .in(
        "event_id",
        events.map((e) => e.id)
      );

    if (subError) {
      setErrorMsg(subError.message);
    } else {
      setTeamEventSubmissions(
        (subData ?? []) as {
          event_id: string;
          author_id: string;
          content: string;
          weight_kg: number | null;
          body_fat_pct: number | null;
          measurement_date: string | null;
          muscle_mass_kg: number | null;
          lean_body_mass_kg: number | null;
        }[]
      );
    }
    setLoadingTeamEvents(false);
  }

  // 現在開催中の全イベント（ウェイトMAX集計＋試合の振り返り＋体組成の提出）を一覧化する
  async function loadActiveEvents() {
    setLoadingActiveEvents(true);
    const list: {
      id: string;
      type: "weight_max" | TeamEventType;
      label: string;
      deadline: string;
    }[] = [];

    const { data: wmEvent, error: wmError } = await supabase
      .from("weight_max_events")
      .select("id, deadline")
      .eq("team_id", profile.team_id)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (wmError) {
      setErrorMsg(wmError.message);
    } else if (wmEvent) {
      const event = wmEvent as { id: string; deadline: string };
      list.push({
        id: event.id,
        type: "weight_max",
        label: "ウェイトMAX集計",
        deadline: event.deadline,
      });
    }

    const { data: teEvents, error: teError } = await supabase
      .from("team_events")
      .select("id, type, title, deadline")
      .eq("team_id", profile.team_id)
      .is("closed_at", null);
    if (teError) {
      setErrorMsg(teError.message);
    } else {
      for (const e of (teEvents ?? []) as {
        id: string;
        type: TeamEventType;
        title: string;
        deadline: string;
      }[]) {
        list.push({
          id: e.id,
          type: e.type,
          label: e.title
            ? `${teamEventTypeLabel[e.type]}：${e.title}`
            : teamEventTypeLabel[e.type],
          deadline: e.deadline,
        });
      }
    }

    list.sort((a, b) => a.deadline.localeCompare(b.deadline));
    setActiveEvents(list);
    setLoadingActiveEvents(false);
  }

  async function loadEventSubmissionDetail(event: {
    id: string;
    type: "weight_max" | TeamEventType;
  }) {
    setLoadingEventDetail(true);

    let targetIds: Set<string> | null = null;
    if (event.type === "weight_max") {
      const { data: targets, error: targetError } = await supabase
        .from("weight_max_event_targets")
        .select("member_id")
        .eq("event_id", event.id);
      if (targetError) {
        setErrorMsg(targetError.message);
      } else if (targets && targets.length > 0) {
        targetIds = new Set(
          (targets as { member_id: string }[]).map((t) => t.member_id)
        );
      }
    } else {
      const { data: targets, error: targetError } = await supabase
        .from("team_event_targets")
        .select("member_id")
        .eq("event_id", event.id);
      if (targetError) {
        setErrorMsg(targetError.message);
      } else if (targets && targets.length > 0) {
        targetIds = new Set(
          (targets as { member_id: string }[]).map((t) => t.member_id)
        );
      }
    }

    const requiredMembers = members.filter(
      (m) =>
        m.role !== "coach" &&
        m.role !== "manager" &&
        m.role !== "ob" &&
        !m.isPending &&
        (!targetIds || targetIds.has(m.id))
    );

    let submittedIds = new Set<string>();
    if (event.type === "weight_max") {
      const { data, error } = await supabase
        .from("weight_maxes")
        .select("author_id")
        .eq("event_id", event.id);
      if (error) setErrorMsg(error.message);
      else
        submittedIds = new Set(
          ((data ?? []) as { author_id: string }[]).map((r) => r.author_id)
        );
    } else {
      const { data, error } = await supabase
        .from("team_event_submissions")
        .select("author_id")
        .eq("event_id", event.id);
      if (error) setErrorMsg(error.message);
      else
        submittedIds = new Set(
          ((data ?? []) as { author_id: string }[]).map((r) => r.author_id)
        );
    }

    setEventSubmissionDetail(
      requiredMembers
        .map((m) => ({
          memberId: m.id,
          displayName: m.display_name,
          location: m.home_location ?? "tama",
          submitted: submittedIds.has(m.id),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"))
    );
    setLoadingEventDetail(false);
  }

  function handleToggleEventDetail(event: {
    id: string;
    type: "weight_max" | TeamEventType;
  }) {
    if (expandedEventId === event.id) {
      setExpandedEventId(null);
      return;
    }
    setExpandedEventId(event.id);
    loadEventSubmissionDetail(event);
  }

  // 直近1週間の「オフではない練習」のうち、実施報告・未実施報告が
  // まだ提出されていないものがあるかどうかを部員ごとに調べる
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
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
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
      setLoadingSubmissionCounts(false);
      return;
    }

    // 両拠点のスケジュール（オフ・区分・セッション種別）を取得
    const { data: scheduleData, error: scheduleErrorAll } = await supabase
      .from("schedule_days")
      .select(
        "date, location, is_off, sessions:schedule_sessions(session_type)"
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
    for (const row of (scheduleData ?? []) as unknown as {
      date: string;
      location: Location;
      is_off: boolean;
      sessions: { session_type: SessionType }[];
    }[]) {
      scheduleByLocDate.set(`${row.location}:${row.date}`, {
        isOff: row.is_off,
        hasMat: row.sessions.some((s) => s.session_type === "mat"),
        hasNonMat: row.sessions.some((s) => s.session_type !== "mat"),
      });
    }

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


  // イベントごとに「著者ID -> 記録」のMapを作る
  const weightMaxesByEvent = new Map<string, Map<string, WeightMaxRow>>();
  for (const w of weightMaxes) {
    if (!w.event_id) continue;
    const inner = weightMaxesByEvent.get(w.event_id) ?? new Map();
    inner.set(w.author_id, w);
    weightMaxesByEvent.set(w.event_id, inner);
  }

  function formatWithDiff(
    current: number | null,
    previous: number | null | undefined
  ): { text: string; className: string } {
    if (current == null) {
      return { text: "-", className: "text-neutral-600" };
    }
    if (previous == null) {
      return { text: `${current}`, className: "text-neutral-200" };
    }
    const diff = current - previous;
    if (diff === 0) {
      return { text: `${current}（±0）`, className: "text-neutral-400" };
    }
    if (diff > 0) {
      return {
        text: `${current}（+${diff}）`,
        className: "font-semibold text-blue-400",
      };
    }
    return {
      text: `${current}（${diff}）`,
      className: "font-semibold text-red-400",
    };
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          チームページ
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          {profile.role === "coach" && (
            <button
              onClick={() => router.push("/mypage")}
              className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
            >
              管理ページ
            </button>
          )}
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            掲示板に戻る
          </button>
        </div>
      </header>

      {!isCoach && (
        <div className="sticky top-[49px] z-10 flex border-b border-neutral-800 bg-neutral-900">
          <button
            onClick={() => router.push("/")}
            className="flex-1 py-3 text-sm font-medium text-neutral-500 transition"
          >
            マイページ
          </button>
          <span className="flex-1 py-3 text-center text-sm font-medium border-b-2 border-red-600 text-red-400">
            チームページ
          </span>
        </div>
      )}

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {/* 月間の練習スケジュール */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            月間の練習スケジュール
          </h2>
          {isCoach && (
            <div className="flex gap-2">
              {locations.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setScheduleLocation(loc)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                    scheduleLocation === loc
                      ? "border-red-600 bg-red-600 text-white"
                      : "border-neutral-700 text-neutral-400 active:bg-neutral-800"
                  }`}
                >
                  {locationLabel[loc]}
                </button>
              ))}
            </div>
          )}
          {isCoach && (
            <button
              onClick={handleOpenBulk}
              className="self-start text-xs font-medium text-neutral-400 underline"
            >
              期間でまとめて設定する（オフ・合宿・試合）
            </button>
          )}
          {bulkOpen && (
            <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-neutral-300">
                  {locationLabel[scheduleLocation]}の期間をまとめて設定
                </p>
                <button
                  onClick={() => setBulkOpen(false)}
                  aria-label="閉じる"
                  className="text-neutral-500"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col text-[11px] text-neutral-400">
                  開始日
                  <input
                    type="date"
                    value={bulkStartDate}
                    onChange={(e) => setBulkStartDate(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-400">
                  終了日
                  <input
                    type="date"
                    value={bulkEndDate}
                    onChange={(e) => setBulkEndDate(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-neutral-400">区分</span>
                <div className="grid grid-cols-4 gap-1 rounded-lg bg-neutral-800 p-1 text-[11px]">
                  {(
                    [
                      { v: "off", label: "オフ" },
                      { v: "camp", label: "合宿" },
                      { v: "match", label: "試合" },
                      { v: "away", label: "出稽古" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setBulkCategory(opt.v)}
                      className={`rounded-md py-2 font-medium ${
                        bulkCategory === opt.v
                          ? "bg-red-600 text-white shadow"
                          : "text-neutral-400"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {bulkCategory === "off" && (
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={bulkOffBothLocations}
                    onChange={(e) =>
                      setBulkOffBothLocations(e.target.checked)
                    }
                  />
                  両拠点ともオフにする
                </label>
              )}

              {(bulkCategory === "camp" ||
                bulkCategory === "match" ||
                bulkCategory === "away") && (
                <input
                  type="text"
                  value={bulkEventName}
                  onChange={(e) => setBulkEventName(e.target.value)}
                  placeholder={
                    bulkCategory === "camp"
                      ? "合宿名（例：夏合宿・山梨合宿）"
                      : bulkCategory === "away"
                        ? "出稽古先（例：◯◯大学、◯◯高校）"
                        : "試合名（例：インカレ・県大会）"
                  }
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                />
              )}

              {(bulkCategory === "camp" ||
                bulkCategory === "match" ||
                bulkCategory === "away") && (
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={bulkShareBothLocations}
                    onChange={(e) =>
                      setBulkShareBothLocations(e.target.checked)
                    }
                  />
                  両拠点に反映する（チームで一緒に行く場合）
                </label>
              )}

              {(bulkCategory === "camp" ||
                bulkCategory === "match" ||
                bulkCategory === "away") && (
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                  <input
                    type="checkbox"
                    checked={bulkIncludeSessions}
                    onChange={(e) => setBulkIncludeSessions(e.target.checked)}
                  />
                  期間中すべての日に同じ練習セクションも設定する
                </label>
              )}

              {bulkCategory !== "off" && bulkIncludeSessions && (
                <div className="flex flex-col gap-3">
                  {bulkSessions.map((s, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-neutral-400">
                          第{idx + 1}セッション
                        </span>
                        {bulkSessions.length > 1 && (
                          <button
                            onClick={() => removeBulkSession(idx)}
                            className="text-[11px] text-red-500"
                          >
                            削除
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={s.type}
                          onChange={(e) =>
                            updateBulkSession(idx, {
                              type: e.target.value as SessionType,
                            })
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                        >
                          <option value="mat">マット</option>
                          <option value="running">ラン</option>
                          <option value="weight">ウェイト</option>
                        </select>
                        <ScheduleTimeSelect
                          value={s.time}
                          onChange={(v) => updateBulkSession(idx, { time: v })}
                        />
                      </div>
                      {(bulkCategory === "camp" || bulkCategory === "away") && (
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          練習場所（任意）
                          <input
                            type="text"
                            value={s.locationNote}
                            onChange={(e) =>
                              updateBulkSession(idx, {
                                locationNote: e.target.value,
                              })
                            }
                            placeholder="例：山梨県立武道館、◯◯大学 など"
                            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                          />
                        </label>
                      )}
                    </div>
                  ))}
                  {bulkSessions.length < 2 && (
                    <button
                      onClick={addBulkSession}
                      className="self-start text-xs font-medium text-neutral-300"
                    >
                      ＋ セッションを追加
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleSaveBulk}
                  disabled={savingBulk}
                  className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                >
                  {savingBulk ? "設定中…" : "この内容でまとめて設定する"}
                </button>
              </div>
              {bulkResult && (
                <p className="rounded bg-emerald-950/40 p-2 text-[11px] text-emerald-400">
                  {bulkResult}
                </p>
              )}
            </div>
          )}
          <div className="relative">
            <MonthlyCalendar
              cursor={calendarCursor}
              onCursorChange={setCalendarCursor}
              scheduleDays={monthScheduleDays}
              loading={loadingMonthSchedule}
              onSelectDate={handleSelectScheduleDate}
              highlightDate={selectedScheduleDate}
              submissionCounts={submissionCounts}
              isCoach={isCoach}
              viewLocation={scheduleLocation}
            />
            {selectedScheduleDate && showDayPopup && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center p-2"
                onClick={handleCloseScheduleDetail}
              >
                <div
                  className="relative max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-4 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleCloseScheduleDetail}
                    aria-label="閉じる"
                    className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-neutral-500 shadow active:bg-neutral-800"
                  >
                    ✕
                  </button>
                  {!editingSchedule && (
                    <>
                      <button
                        onClick={() => handleShiftScheduleDate(-1)}
                        aria-label="前の日"
                        className="absolute left-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-sm text-neutral-400 shadow active:bg-neutral-800"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => handleShiftScheduleDate(1)}
                        aria-label="次の日"
                        className="absolute right-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-sm text-neutral-400 shadow active:bg-neutral-800"
                      >
                        ▶
                      </button>
                    </>
                  )}

                  {editingSchedule ? (
                    <div className="flex flex-col gap-3 pr-5">
                      <h3 className="text-sm font-bold text-neutral-100">
                        {locationLabel[scheduleLocation]}・
                        {formatMonthDay(selectedScheduleDate)}の時間割
                      </h3>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-neutral-400">
                          区分
                        </span>
                        <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-800 p-1 text-[11px]">
                          {(
                            [
                              { v: "off", label: "オフ" },
                              { v: "practice", label: "練習" },
                              { v: "camp", label: "合宿" },
                              { v: "match", label: "試合" },
                              { v: "away", label: "出稽古" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.v}
                              type="button"
                              onClick={() => setEditCategory(opt.v)}
                              className={`rounded-md py-2 font-medium ${
                                editCategory === opt.v
                                  ? "bg-red-600 text-white shadow"
                                  : "text-neutral-400"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {editCategory === "off" && (
                        <label className="flex items-center gap-2 text-xs text-neutral-300">
                          <input
                            type="checkbox"
                            checked={editOffBothLocations}
                            onChange={(e) =>
                              setEditOffBothLocations(e.target.checked)
                            }
                          />
                          両拠点ともオフにする
                        </label>
                      )}

                      {(editCategory === "camp" ||
                        editCategory === "match" ||
                        editCategory === "away") && (
                        <input
                          type="text"
                          value={editEventName}
                          onChange={(e) => setEditEventName(e.target.value)}
                          placeholder={
                            editCategory === "camp"
                              ? "合宿名（例：夏合宿・山梨合宿）"
                              : editCategory === "away"
                                ? "出稽古先（例：◯◯大学、◯◯高校）"
                                : "試合名（例：インカレ・県大会）"
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                        />
                      )}

                      {(editCategory === "camp" ||
                        editCategory === "match" ||
                        editCategory === "away") && (
                        <label className="flex items-center gap-2 text-xs text-neutral-300">
                          <input
                            type="checkbox"
                            checked={editShareBothLocations}
                            onChange={(e) =>
                              setEditShareBothLocations(e.target.checked)
                            }
                          />
                          両拠点に反映する（チームで一緒に行く場合）
                        </label>
                      )}

                      {(editCategory === "camp" ||
                        editCategory === "match" ||
                        editCategory === "away") && (
                        <label className="flex items-center gap-2 text-xs text-neutral-300">
                          <input
                            type="checkbox"
                            checked={editIncludeSessions}
                            onChange={(e) =>
                              setEditIncludeSessions(e.target.checked)
                            }
                          />
                          この日も練習セクションを設定する
                        </label>
                      )}

                      {editCategory !== "off" &&
                        (editCategory === "practice" ||
                          editIncludeSessions) && (
                        <div className="flex flex-col gap-3">
                          {editSessions.map((s, idx) => (
                            <div
                              key={idx}
                              className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-2.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-neutral-400">
                                  第{idx + 1}セッション
                                </span>
                                {editSessions.length > 1 && (
                                  <button
                                    onClick={() => removeEditSession(idx)}
                                    className="text-[11px] text-red-500"
                                  >
                                    削除
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <select
                                  value={s.type}
                                  onChange={(e) =>
                                    updateEditSession(idx, {
                                      type: e.target.value as SessionType,
                                    })
                                  }
                                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                                >
                                  <option value="mat">マット</option>
                                  <option value="running">ラン</option>
                                  <option value="weight">ウェイト</option>
                                </select>
                                <ScheduleTimeSelect
                                  value={s.time}
                                  onChange={(v) =>
                                    updateEditSession(idx, { time: v })
                                  }
                                />
                              </div>
                              {editCategory === "camp" ||
                              editCategory === "away" ? (
                                <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                                  練習場所（任意）
                                  <input
                                    type="text"
                                    value={s.locationNote}
                                    onChange={(e) =>
                                      updateEditSession(idx, {
                                        locationNote: e.target.value,
                                      })
                                    }
                                    placeholder="例：山梨県立武道館、◯◯大学 など"
                                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                                  />
                                </label>
                              ) : (
                                <>
                                  <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                                    <input
                                      type="checkbox"
                                      checked={s.isJoint}
                                      onChange={(e) =>
                                        updateEditSession(idx, {
                                          isJoint: e.target.checked,
                                        })
                                      }
                                    />
                                    全体練習（合同）にする
                                  </label>
                                  {s.isJoint && (
                                    <select
                                      value={s.jointLocation}
                                      onChange={(e) =>
                                        updateEditSession(idx, {
                                          jointLocation: e.target
                                            .value as Location,
                                        })
                                      }
                                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                                    >
                                      {locations.map((loc) => (
                                        <option key={loc} value={loc}>
                                          {locationLabel[loc]}で実施
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                          {editSessions.length < 2 && (
                            <button
                              onClick={addEditSession}
                              className="self-start text-xs font-medium text-neutral-300"
                            >
                              ＋ セッションを追加
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveSchedule}
                          disabled={savingSchedule}
                          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                        >
                          保存する
                        </button>
                        <button
                          onClick={() => setEditingSchedule(false)}
                          className="flex-1 rounded-lg border border-neutral-700 py-2 text-xs text-neutral-300"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : loadingDayDetail ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
                      読み込み中…
                    </p>
                  ) : dayDetail === null ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <p className="text-xs text-neutral-500">
                        {locationLabel[scheduleLocation]}の
                        {formatMonthDay(selectedScheduleDate)}
                        はまだ時間割が決まっていません
                      </p>
                      {isCoach && (
                        <button
                          onClick={handleStartEditSchedule}
                          className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700"
                        >
                          時間割を設定する
                        </button>
                      )}
                    </div>
                  ) : !dayDetail ? (
                    <p className="py-6 text-center text-xs text-neutral-500">
                      読み込み中…
                    </p>
                  ) : isCoach ? (
                    <div className="flex flex-col gap-3 pr-5">
                      <p className="text-xs text-neutral-500">
                        {locationLabel[scheduleLocation]}・
                        {formatMonthDay(dayDetail.date)}
                      </p>
                      {(dayDetail.day_type === "camp" ||
                        dayDetail.day_type === "match" ||
                        dayDetail.day_type === "away") && (
                        <div className="flex items-center gap-2">
                          <span
                            className={`self-start rounded px-2 py-1 text-xs font-semibold ${dayTypeFillColorDark[dayDetail.day_type]}`}
                          >
                            {dayTypeLabel[dayDetail.day_type]}
                            {dayDetail.event_name &&
                              `：${dayDetail.event_name}`}
                          </span>
                          {(dayDetail.day_type === "camp" ||
                            dayDetail.day_type === "away") && (
                            <button
                              onClick={handleDeleteAwayLikeSchedule}
                              className="rounded px-2 py-1 text-[11px] font-medium text-red-400 underline"
                            >
                              この予定を削除する
                            </button>
                          )}
                        </div>
                      )}
                      {dayDetail.sessions.length === 0 && (
                        <div className="flex flex-col items-start gap-2 py-2">
                          <p className="text-xs text-neutral-500">
                            この日は練習セクションの設定はありません。
                          </p>
                          <button
                            onClick={handleStartEditSchedule}
                            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                          >
                            時間割を編集する
                          </button>
                        </div>
                      )}
                      {dayDetail.sessions.map((s) => (
                        <div
                          key={s.id}
                          className="rounded-lg border border-neutral-800 p-3"
                        >
                          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-400">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                            />
                            第{s.session_no}セッション・
                            {sessionTypeLabel[s.session_type]}・
                            {s.start_time.slice(0, 5)}〜
                          </div>
                          {s.location_note ? (
                            <p className="mb-2 rounded bg-purple-950/40 px-2 py-1 text-[11px] text-purple-400">
                              練習場所：{s.location_note}
                            </p>
                          ) : (
                            s.is_joint && (
                              <p className="mb-2 rounded bg-purple-950/40 px-2 py-1 text-[11px] text-purple-400">
                                全体練習（
                                {locationLabel[s.joint_location ?? scheduleLocation]}
                                で実施）
                              </p>
                            )
                          )}
                          {s.session_type === "mat" ? (
                            matMenuDetail === undefined ? (
                              <p className="text-xs text-neutral-500">
                                読み込み中…
                              </p>
                            ) : matMenuDetail === null ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-xs text-neutral-500">
                                  このセッションの練習メニューはまだ掲示板に投稿されていません
                                </p>
                                {canEditMatMenu && (
                                  <button
                                    onClick={() =>
                                      handleGoToMatMenu(s.start_time)
                                    }
                                    className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                                  >
                                    このセッションの練習メニューを作成する
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div>
                                <h4 className="mb-1 text-sm font-bold">
                                  {matMenuDetail.title || "練習メニュー"}
                                </h4>
                                <p className="whitespace-pre-wrap text-sm text-neutral-100">
                                  {matMenuDetail.content}
                                </p>
                                {canEditMatMenu &&
                                  !isPastSession(
                                    matMenuDetail.date,
                                    matMenuDetail.start_time
                                  ) && (
                                    <button
                                      onClick={() => handleGoToMatMenu()}
                                      className="mt-2 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                                    >
                                      掲示板で編集する
                                    </button>
                                  )}
                              </div>
                            )
                          ) : (
                            <p className="text-xs text-neutral-400">
                              各自申告制です。実施状況はマイページの「今日のトレーニングメニュー」から記録できます。
                            </p>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={handleStartEditSchedule}
                        className="self-start text-xs font-medium text-neutral-400 underline"
                      >
                        時間割を編集する
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 pr-5">
                      <p className="text-xs text-neutral-500">
                        {formatMonthDay(dayDetail.date)}の提出状況
                      </p>
                      {(["tama", "otsuka"] as Location[]).map((loc) => {
                        const c = submissionCountsByLoc.get(selectedScheduleDate!)?.[loc];
                        return (
                          <div
                            key={loc}
                            className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-neutral-200">
                              {locationLabel[loc]}
                            </span>
                            {c ? (
                              <span
                                className={`font-semibold ${
                                  c.total > 0 && c.submitted === c.total
                                    ? "text-emerald-400"
                                    : "text-neutral-300"
                                }`}
                              >
                                {c.submitted}/{c.total}人提出
                              </span>
                            ) : (
                              <span className="text-neutral-500">該当なし</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        {!isCoach && (
          <>
        {/* 日別の提出状況 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            {selectedScheduleDate
              ? `${formatMonthDay(selectedScheduleDate)}の提出状況`
              : "部員一覧"}
          </h2>
          <p className="text-[11px] text-neutral-500">
            上のカレンダーで日付をタップすると、その日に必要な報告（マットの実施報告・未実施報告、マット以外のセッションの自主トレ記録）を、部員ごとに確認できます。
          </p>
          {loadingMembers || loadingDaySubmissionDetail ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : !selectedScheduleDate ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              カレンダーから日付を選んでください。
            </p>
          ) : daySubmissionDetail.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              この日は報告が必要なセッションがありません（オフ、または部員が登録されていません）。
            </p>
          ) : (
            <div
              className={
                isCoach ? "flex flex-col gap-3" : "grid grid-cols-2 gap-3"
              }
            >
              {(isCoach ? [scheduleLocation] : (["tama", "otsuka"] as Location[])).map((loc) => (
                <div key={loc} className="flex flex-col gap-3">
                  {!isCoach && (
                    <p className="text-xs font-semibold text-neutral-400">
                      {locationLabel[loc]}
                    </p>
                  )}
                  {daySubmissionDetail.filter((d) => d.location === loc)
                    .length === 0 ? (
                    <p className="text-[11px] text-neutral-600">該当なし</p>
                  ) : (
                    groupDetailByGrade(
                      daySubmissionDetail.filter((d) => d.location === loc)
                    ).map((group) => (
                      <div key={group.label} className="flex flex-col gap-1">
                        <p className="text-[10px] text-neutral-500">
                          {group.label}
                        </p>
                        {group.rows.map((d) => {
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
                                  `/team/${d.memberId}?date=${selectedScheduleDate}`
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
                              <span className="truncate">{d.displayName}</span>
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
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
          </>
        )}

        {/* 開催中のイベント */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            開催中のイベント
          </h2>
          {loadingActiveEvents ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : activeEvents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              現在開催中のイベントはありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {activeEvents.map((event) => {
                const isExpanded = expandedEventId === event.id;
                return (
                  <div
                    key={event.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-900"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-neutral-100">
                          {event.label}
                        </span>
                        <span className="text-[11px] text-neutral-500">
                          締切：{formatMonthDay(event.deadline)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleToggleEventDetail(event)}
                        className="shrink-0 rounded border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-300 active:bg-neutral-800"
                      >
                        {isExpanded ? "閉じる" : "提出者を確認する"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="border-t border-neutral-800 p-3">
                        {loadingEventDetail ? (
                          <p className="text-xs text-neutral-500">
                            読み込み中…
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 gap-3">
                            {(["tama", "otsuka"] as Location[]).map((loc) => {
                              const rows = eventSubmissionDetail.filter(
                                (r) => r.location === loc
                              );
                              return (
                                <div key={loc} className="flex flex-col gap-1.5">
                                  <p className="text-xs font-semibold text-neutral-400">
                                    {locationLabel[loc]}
                                  </p>
                                  {rows.length === 0 ? (
                                    <p className="text-[11px] text-neutral-600">
                                      該当なし
                                    </p>
                                  ) : (
                                    rows.map((r) => (
                                      <div
                                        key={r.memberId}
                                        className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                                          r.submitted
                                            ? "bg-emerald-950/20 text-neutral-100"
                                            : "bg-neutral-950 text-neutral-300"
                                        }`}
                                      >
                                        <span className="truncate">
                                          {r.displayName}
                                        </span>
                                        <span
                                          className={`shrink-0 text-[10px] font-semibold ${
                                            r.submitted
                                              ? "text-emerald-400"
                                              : "text-red-400"
                                          }`}
                                        >
                                          {r.submitted ? "済" : "未"}
                                        </span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              );
                            })}
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

        {/* イベント一覧 */}
        <section className="flex flex-col gap-4 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            イベント一覧
          </h2>
          <p className="text-[11px] text-neutral-500">
            管理者が作成したイベント（ウェイトMAX集計・体組成の提出・試合の振り返り）の提出内容が、種類ごとに新着順で反映されます。
          </p>

          {/* ウェイトMAX一覧 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-neutral-300">
              ウェイトMAX一覧
            </h3>
            {loadingMembers || loadingMaxes ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : weightMaxEvents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                まだウェイトMAXの計測は行われていません。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {weightMaxEvents.map((event, eventIdx) => {
                  const currentMap = weightMaxesByEvent.get(event.id);
                  const previousEvent = weightMaxEvents[eventIdx + 1];
                  const previousMap = previousEvent
                    ? weightMaxesByEvent.get(previousEvent.id)
                    : undefined;

                  return (
                    <details
                      key={event.id}
                      open={eventIdx === 0}
                      className="rounded-lg border border-neutral-800"
                    >
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-neutral-200">
                        {formatMonthDay(event.measurementDate)}計測一覧
                      </summary>
                      <div className="overflow-x-auto border-t border-neutral-800">
                        <table className="w-full text-xs">
                          <thead className="bg-neutral-900">
                            <tr className="border-b border-neutral-800 text-neutral-500">
                              <th className="px-2 py-1.5 text-left font-medium">
                                氏名
                              </th>
                              <th className="px-1 py-1.5 text-right font-medium">
                                BP
                              </th>
                              <th className="px-1 py-1.5 text-right font-medium">
                                SQ
                              </th>
                              <th className="px-2 py-1.5 text-right font-medium">
                                DL
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-800">
                            {members
                              .filter((m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob" && !m.isPending)
                              .map((m) => {
                                const max = currentMap?.get(m.id);
                                const prev = previousMap?.get(m.id);
                                const bench = formatWithDiff(
                                  max?.bench ?? null,
                                  prev?.bench
                                );
                                const squat = formatWithDiff(
                                  max?.squat ?? null,
                                  prev?.squat
                                );
                                const deadlift = formatWithDiff(
                                  max?.deadlift ?? null,
                                  prev?.deadlift
                                );
                                return (
                                  <tr key={m.id}>
                                    <td className="max-w-[6rem] truncate px-2 py-1.5 font-medium text-neutral-100">
                                      {m.display_name}
                                    </td>
                                    <td
                                      className={`px-1 py-1.5 text-right ${bench.className}`}
                                    >
                                      {bench.text}
                                    </td>
                                    <td
                                      className={`px-1 py-1.5 text-right ${squat.className}`}
                                    >
                                      {squat.text}
                                    </td>
                                    <td
                                      className={`px-2 py-1.5 text-right ${deadlift.className}`}
                                    >
                                      {deadlift.text}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>

          {/* 体組成一覧 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-neutral-300">
              体組成一覧
            </h3>
            {loadingMembers || loadingTeamEvents ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : teamEvents.filter((e) => e.type === "body_composition").length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                まだイベントは作成されていません。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {teamEvents
                  .filter((e) => e.type === "body_composition")
                  .map((event, idx) => {
                    const subs = teamEventSubmissions.filter(
                      (s) => s.event_id === event.id
                    );
                    const subByAuthor = new Map(
                      subs.map((s) => [s.author_id, s])
                    );
                    return (
                      <details
                        key={event.id}
                        open={idx === 0}
                        className="rounded-lg border border-neutral-800"
                      >
                        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-neutral-200">
                          {event.title || "体組成の提出"}（締切{" "}
                          {formatMonthDay(event.deadline)}）
                        </summary>
                        <div className="flex flex-col gap-2 border-t border-neutral-800 p-3">
                          {members
                            .filter(
                              (m) =>
                                m.role !== "coach" &&
                                m.role !== "manager" &&
                                m.role !== "ob" &&
                                !m.isPending
                            )
                            .map((m) => {
                              const sub = subByAuthor.get(m.id);
                              return (
                                <div
                                  key={m.id}
                                  className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-xs"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-neutral-100">
                                      {m.display_name}
                                    </span>
                                    {!sub && (
                                      <span className="text-[10px] text-red-400">
                                        未提出
                                      </span>
                                    )}
                                  </div>
                                  {sub && (
                                    <p className="text-neutral-300">
                                      {sub.measurement_date &&
                                        `測定日: ${formatMonthDay(sub.measurement_date)}・`}
                                      体重: {sub.weight_kg ?? "-"}kg・体脂肪率:{" "}
                                      {sub.body_fat_pct ?? "-"}%・骨格筋量:{" "}
                                      {sub.muscle_mass_kg ?? "-"}kg・除脂肪体重:{" "}
                                      {sub.lean_body_mass_kg ?? "-"}kg
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </details>
                    );
                  })}
              </div>
            )}
          </div>

          {/* 試合の振り返り */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-neutral-300">
              試合の振り返り
            </h3>
            {loadingMembers || loadingTeamEvents ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : teamEvents.filter((e) => e.type === "match_reflection").length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                まだイベントは作成されていません。
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {teamEvents
                  .filter((e) => e.type === "match_reflection")
                  .map((event, idx) => {
                    const subs = teamEventSubmissions.filter(
                      (s) => s.event_id === event.id
                    );
                    const subByAuthor = new Map(
                      subs.map((s) => [s.author_id, s])
                    );
                    return (
                      <details
                        key={event.id}
                        open={idx === 0}
                        className="rounded-lg border border-neutral-800"
                      >
                        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-neutral-200">
                          {event.title || "試合の振り返り"}（締切{" "}
                          {formatMonthDay(event.deadline)}）
                        </summary>
                        <div className="flex flex-col gap-2 border-t border-neutral-800 p-3">
                          {members
                            .filter(
                              (m) =>
                                m.role !== "coach" &&
                                m.role !== "manager" &&
                                m.role !== "ob" &&
                                !m.isPending
                            )
                            .map((m) => {
                              const sub = subByAuthor.get(m.id);
                              return (
                                <div
                                  key={m.id}
                                  className="flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-950 px-2.5 py-2 text-xs"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-medium text-neutral-100">
                                      {m.display_name}
                                    </span>
                                    {!sub && (
                                      <span className="text-[10px] text-red-400">
                                        未提出
                                      </span>
                                    )}
                                  </div>
                                  {sub && (
                                    <button
                                      onClick={() =>
                                        router.push(`/team/${m.id}`)
                                      }
                                      className="self-start text-[11px] text-emerald-400 underline"
                                    >
                                      提出済み（マイページで内容を見る）
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </details>
                    );
                  })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScheduleTimeSelect({
  value,
  onChange,
}: {
  value: string; // "HH:MM"
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value ? value.split(":") : ["10", "00"];
  const hours = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0")
  );
  const minutes = ["00", "10", "20", "30", "40", "50"];

  return (
    <div className="flex gap-1">
      <select
        value={hour}
        onChange={(e) => onChange(`${e.target.value}:${minute || "00"}`)}
        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1.5 text-xs text-neutral-100"
      >
        {hours.map((h) => (
          <option key={h} value={h}>
            {h}時
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => onChange(`${hour || "10"}:${e.target.value}`)}
        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1.5 text-xs text-neutral-100"
      >
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </div>
  );
}

function MonthlyCalendar({
  cursor,
  onCursorChange,
  scheduleDays,
  loading,
  onSelectDate,
  highlightDate,
  submissionCounts,
  isCoach,
  viewLocation,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  scheduleDays: Map<string, ScheduleDayRow>;
  loading: boolean;
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
  submissionCounts: Map<string, { submitted: number; total: number }>;
  isCoach: boolean;
  viewLocation: Location;
}) {
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
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : (
        <>
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
              const day = scheduleDays.get(key);
              const isHighlighted = key === highlightDate;
              const weekday = date.getDay();
              const count = submissionCounts.get(key);
              const isFullySubmitted =
                !!count && count.total > 0 && count.submitted === count.total;
              return (
                <button
                  key={i}
                  onClick={() => onSelectDate(key)}
                  className={`flex min-h-[64px] flex-col items-start gap-0.5 rounded-lg border p-1 text-left ${
                    day?.is_off
                      ? "border-neutral-700 bg-neutral-900"
                      : !isCoach && isFullySubmitted
                        ? "border-emerald-700 bg-emerald-900/60"
                        : day?.day_type === "camp"
                          ? "border-pink-900/60 bg-pink-950/40"
                          : day?.day_type === "match"
                            ? "border-red-900/60 bg-red-950/40"
                            : isHighlighted
                              ? "border-amber-400 bg-amber-950/40 ring-1 ring-amber-400"
                              : "border-neutral-700 bg-neutral-800 active:bg-neutral-700"
                  } ${isHighlighted && !day?.is_off ? "ring-1 ring-amber-400" : ""}`}
                >
                  <span
                    className={`text-[11px] font-semibold ${
                      day?.is_off
                        ? "text-neutral-600"
                        : !isHighlighted && weekday === 0
                          ? "border-b-2 border-red-500 text-red-400"
                          : !isHighlighted && weekday === 6
                            ? "border-b-2 border-blue-500 text-blue-400"
                            : "text-neutral-200"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {day?.is_off && (
                    <span className="text-[9px] text-neutral-500">
                      全体オフ
                    </span>
                  )}
                  {day &&
                    !day.is_off &&
                    (day.day_type === "camp" ||
                      day.day_type === "match" ||
                      day.day_type === "away") && (
                      <span
                        className={`max-w-full truncate rounded px-1 text-[9px] font-semibold ${dayTypeFillColorDark[day.day_type]}`}
                      >
                        {day.event_name || dayTypeLabel[day.day_type]}
                      </span>
                    )}
                  {isCoach ? (
                    day &&
                    !day.is_off &&
                    day.sessions.map((s) => (
                      <span
                        key={s.id}
                        className="flex w-full items-start gap-0.5 leading-tight"
                      >
                        <span
                          className={`mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                        />
                        <span className="break-words text-[9px] text-neutral-300">
                          {sessionTypeLabel[s.session_type]}
                          {s.start_time.slice(0, 5)}〜
                          {s.location_note
                            ? `（${s.location_note}）`
                            : s.is_joint &&
                              (s.joint_location &&
                              s.joint_location !== viewLocation
                                ? `（${locationLabel[s.joint_location]}）`
                                : "（全体）")}
                        </span>
                      </span>
                    ))
                  ) : (
                    day && !day.is_off && count && (
                      <span
                        className={`text-[10px] font-semibold ${
                          isFullySubmitted ? "text-emerald-300" : "text-neutral-300"
                        }`}
                      >
                        {count.submitted}/{count.total}人
                      </span>
                    )
                  )}
                </button>
              );
            })}
          </div>
          {isCoach ? (
            <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
              {(Object.keys(sessionTypeLabel) as SessionType[]).map((t) => (
                <span key={t} className="flex items-center gap-1">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${sessionTypeDotColor[t]}`}
                  />
                  {sessionTypeLabel[t]}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-pink-950/40" />
                合宿
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-red-950/40" />
                試合
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-neutral-900" />
                オフ
              </span>
            </p>
          ) : (
            <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-emerald-900/60 ring-1 ring-emerald-700" />
                全員提出済み
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-pink-950/40" />
                合宿
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-red-950/40" />
                試合
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded bg-neutral-900" />
                オフ
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
