"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  DayType,
  dayTypeFillColor,
  dayTypeLabel,
  Location,
  locationLabel,
  locations,
  Role,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

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
};

type ScheduleDayRow = {
  id: string;
  date: string;
  location: Location;
  is_off: boolean;
  day_type: DayType;
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
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

type PastMenuRow = {
  id: string;
  date: string;
  location: Location;
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

function groupMembersByGrade(
  members: MemberRow[]
): { label: string; members: MemberRow[] }[] {
  const groups = new Map<number | null, MemberRow[]>();
  for (const m of members) {
    const grade = m.entry_year != null ? currentGrade(m.entry_year) : null;
    const list = groups.get(grade) ?? [];
    list.push(m);
    groups.set(grade, list);
  }

  const knownGrades = Array.from(groups.keys())
    .filter((g): g is number => g !== null)
    .sort((a, b) => b - a);

  const result = knownGrades.map((grade) => ({
    label: `${grade}年`,
    members: groups.get(grade)!,
  }));

  if (groups.has(null)) {
    result.push({ label: "学年未設定", members: groups.get(null)! });
  }

  return result;
}

export default function TeamPage({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
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
    profile.home_location ?? "tama"
  );
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<
    string | null
  >(null);
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
  const [editSessions, setEditSessions] = useState<
    {
      type: SessionType;
      time: string;
      isJoint: boolean;
      jointLocation: Location;
    }[]
  >([]);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const canEditMatMenu =
    profile.role === "captain" ||
    profile.role === "leader" ||
    profile.role === "vice_leader" ||
    profile.role === "coach";
  const isCoach = profile.role === "coach";
  const todayStr = toDateKey(new Date());

  const [weightMaxes, setWeightMaxes] = useState<WeightMaxRow[]>([]);
  const [loadingMaxes, setLoadingMaxes] = useState(true);

  const [pastMenus, setPastMenus] = useState<PastMenuRow[]>([]);
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());
  const [loadingCompliance, setLoadingCompliance] = useState(true);

  useEffect(() => {
    loadMembers();
    loadWeightMaxes();
    loadCompliance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor, scheduleLocation]);

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
        "id, date, location, is_off, day_type, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location)"
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
        "id, date, location, is_off, day_type, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location)"
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
    setEditingSchedule(false);
    loadDayDetail(dateStr);
  }

  function handleCloseScheduleDetail() {
    setSelectedScheduleDate(null);
    setDayDetail(undefined);
    setMatMenuDetail(undefined);
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

  function handleStartEditSchedule() {
    const category: "off" | DayType = dayDetail?.is_off
      ? "off"
      : (dayDetail?.day_type ?? "practice");
    setEditCategory(category);
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
        }))
      );
    } else {
      setEditSessions([
        { type: "mat", time: "10:00", isJoint: false, jointLocation: scheduleLocation },
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
            },
          ]
    );
  }

  function removeEditSession(idx: number) {
    setEditSessions((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)
    );
  }

  async function handleSaveSchedule() {
    if (!selectedScheduleDate) return;
    setSavingSchedule(true);

    const isOff = editCategory === "off";
    const dayType: DayType = isOff
      ? "practice"
      : (editCategory as DayType);
    const includeSessions =
      isOff ? false : dayType === "practice" ? true : editIncludeSessions;

    const { data: dayRow, error: dayError } = await supabase
      .from("schedule_days")
      .upsert(
        {
          team_id: profile.team_id,
          location: scheduleLocation,
          date: selectedScheduleDate,
          is_off: isOff,
          day_type: dayType,
          created_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id,location,date" }
      )
      .select("id")
      .single();

    if (dayError || !dayRow) {
      setErrorMsg(dayError?.message ?? "時間割の保存に失敗しました。");
      setSavingSchedule(false);
      return;
    }

    const dayId = (dayRow as { id: string }).id;

    const { error: delError } = await supabase
      .from("schedule_sessions")
      .delete()
      .eq("schedule_day_id", dayId);

    if (delError) {
      setErrorMsg(delError.message);
      setSavingSchedule(false);
      return;
    }

    if (!isOff && includeSessions && editSessions.length > 0) {
      const rows = editSessions.map((s, idx) => ({
        schedule_day_id: dayId,
        session_no: idx + 1,
        session_type: s.type,
        start_time: s.time,
        is_joint: s.isJoint,
        joint_location: s.isJoint ? s.jointLocation : null,
      }));
      const { error: insError } = await supabase
        .from("schedule_sessions")
        .insert(rows);
      if (insError) {
        setErrorMsg(insError.message);
        setSavingSchedule(false);
        return;
      }

      // 全体練習として登録された場合、もう一方の拠点のカレンダーにも
      // 自動で反映する（どちらの拠点を編集していても反映されるようにする）
      for (const s of editSessions) {
        if (s.isJoint) {
          await propagateJointSession(
            selectedScheduleDate,
            scheduleLocation,
            s.jointLocation,
            {
              type: s.type,
              time: s.time,
            }
          );
        }
      }
    }

    // 合宿・試合は基本的にチーム全体の予定なので、もう一方の拠点にも
    // 区分（合宿/試合）だけ自動で反映する（セッションの有無は拠点ごとに個別設定のまま）
    if (!isOff && (dayType === "camp" || dayType === "match")) {
      await propagateDayType(selectedScheduleDate, scheduleLocation, dayType);
    }

    setEditingSchedule(false);
    setSavingSchedule(false);
    await loadMonthSchedule();
    await loadDayDetail(selectedScheduleDate);
  }

  async function propagateDayType(
    dateStr: string,
    editingLocation: Location,
    dayType: DayType
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
    session: { type: SessionType; time: string }
  ) {
    const otherLocation: Location =
      editingLocation === "tama" ? "otsuka" : "tama";

    const { data: existingDay } = await supabase
      .from("schedule_days")
      .select(
        "id, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location)"
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
      if (mirrored.start_time.slice(0, 5) !== session.time) {
        await supabase
          .from("schedule_sessions")
          .update({ start_time: session.time })
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
    });
  }

  async function loadWeightMaxes() {
    setLoadingMaxes(true);
    const { data, error } = await supabase
      .from("weight_maxes")
      .select("author_id, bench, squat, deadlift")
      .eq("team_id", profile.team_id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setWeightMaxes((data ?? []) as WeightMaxRow[]);
    }
    setLoadingMaxes(false);
  }

  // 直近1週間の「オフではない練習」のうち、実施報告・未実施報告が
  // まだ提出されていないものがあるかどうかを部員ごとに調べる
  async function loadCompliance() {
    setLoadingCompliance(true);
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 7);
    const rangeStart = toDateKey(lookbackStart);
    const todayStr = toDateKey(new Date());

    const { data: menuData, error: menuError } = await supabase
      .from("menus")
      .select("id, date, location")
      .eq("team_id", profile.team_id)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (menuError) {
      setErrorMsg(menuError.message);
      setLoadingCompliance(false);
      return;
    }

    const menuRows = (menuData ?? []) as PastMenuRow[];
    setPastMenus(menuRows);

    if (menuRows.length === 0) {
      setSubmittedKeys(new Set());
      setLoadingCompliance(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, author_id, kind")
      .in(
        "menu_id",
        menuRows.map((m) => m.id)
      )
      .in("kind", ["report", "absent"])
      .is("parent_id", null);

    if (commentError) {
      setErrorMsg(commentError.message);
      setLoadingCompliance(false);
      return;
    }

    const keys = new Set<string>();
    for (const row of (commentData ?? []) as {
      menu_id: string;
      author_id: string | null;
    }[]) {
      if (row.author_id) keys.add(`${row.author_id}:${row.menu_id}`);
    }
    setSubmittedKeys(keys);
    setLoadingCompliance(false);
  }

  const maxByAuthor = new Map(weightMaxes.map((w) => [w.author_id, w]));

  function getMissingSubmissions(
    memberId: string,
    homeLocation: Location | null
  ): PastMenuRow[] {
    if (!homeLocation) return [];
    return pastMenus
      .filter(
        (m) =>
          m.location === homeLocation &&
          !submittedKeys.has(`${memberId}:${m.id}`)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">チームページ</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <button
            onClick={() => router.push("/mypage")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            {profile.role === "coach" ? "管理ページ" : "マイページ"}
          </button>
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            掲示板に戻る
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        {/* 月間の練習スケジュール */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">
            月間の練習スケジュール
          </h2>
          <div className="flex gap-2">
            {locations.map((loc) => (
              <button
                key={loc}
                onClick={() => setScheduleLocation(loc)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                  scheduleLocation === loc
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 text-neutral-500 active:bg-neutral-100"
                }`}
              >
                {locationLabel[loc]}
              </button>
            ))}
          </div>
          <div className="relative">
            <MonthlyCalendar
              cursor={calendarCursor}
              onCursorChange={setCalendarCursor}
              scheduleDays={monthScheduleDays}
              loading={loadingMonthSchedule}
              onSelectDate={handleSelectScheduleDate}
              highlightDate={selectedScheduleDate}
              viewLocation={scheduleLocation}
            />
            {selectedScheduleDate && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center p-2"
                onClick={handleCloseScheduleDetail}
              >
                <div
                  className="relative max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-neutral-300 bg-white p-4 shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleCloseScheduleDetail}
                    aria-label="閉じる"
                    className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-white text-neutral-400 shadow active:bg-neutral-100"
                  >
                    ✕
                  </button>
                  {!editingSchedule && (
                    <>
                      <button
                        onClick={() => handleShiftScheduleDate(-1)}
                        aria-label="前の日"
                        className="absolute left-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm text-neutral-500 shadow active:bg-neutral-100"
                      >
                        ◀
                      </button>
                      <button
                        onClick={() => handleShiftScheduleDate(1)}
                        aria-label="次の日"
                        className="absolute right-[-14px] top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-sm text-neutral-500 shadow active:bg-neutral-100"
                      >
                        ▶
                      </button>
                    </>
                  )}

                  {editingSchedule ? (
                    <div className="flex flex-col gap-3 pr-5">
                      <h3 className="text-sm font-bold text-neutral-800">
                        {locationLabel[scheduleLocation]}・
                        {formatMonthDay(selectedScheduleDate)}の時間割
                      </h3>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-neutral-500">
                          区分
                        </span>
                        <div className="grid grid-cols-4 gap-1 rounded-lg bg-neutral-200 p-1 text-[11px]">
                          {(
                            [
                              { v: "off", label: "オフ" },
                              { v: "practice", label: "練習" },
                              { v: "camp", label: "合宿" },
                              { v: "match", label: "試合" },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.v}
                              type="button"
                              onClick={() => setEditCategory(opt.v)}
                              className={`rounded-md py-2 font-medium ${
                                editCategory === opt.v
                                  ? "bg-white text-neutral-900 shadow"
                                  : "text-neutral-500"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {(editCategory === "camp" || editCategory === "match") && (
                        <label className="flex items-center gap-2 text-xs text-neutral-600">
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
                              className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-2.5"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-neutral-500">
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
                                  className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
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
                              <label className="flex items-center gap-2 text-[11px] text-neutral-500">
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
                                      jointLocation: e.target.value as Location,
                                    })
                                  }
                                  className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                                >
                                  {locations.map((loc) => (
                                    <option key={loc} value={loc}>
                                      {locationLabel[loc]}で実施
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          ))}
                          {editSessions.length < 2 && (
                            <button
                              onClick={addEditSession}
                              className="self-start text-xs font-medium text-neutral-600"
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
                          className="flex-1 rounded-lg bg-neutral-900 py-2 text-xs font-medium text-white active:bg-neutral-700 disabled:opacity-50"
                        >
                          保存する
                        </button>
                        <button
                          onClick={() => setEditingSchedule(false)}
                          className="flex-1 rounded-lg border border-neutral-300 py-2 text-xs text-neutral-600"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : loadingDayDetail ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      読み込み中…
                    </p>
                  ) : dayDetail === null ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <p className="text-xs text-neutral-400">
                        {locationLabel[scheduleLocation]}の
                        {formatMonthDay(selectedScheduleDate)}
                        はまだ時間割が決まっていません
                      </p>
                      {isCoach && (
                        <button
                          onClick={handleStartEditSchedule}
                          className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white active:bg-neutral-700"
                        >
                          時間割を設定する
                        </button>
                      )}
                    </div>
                  ) : !dayDetail ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      読み込み中…
                    </p>
                  ) : dayDetail.is_off ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <p className="text-sm font-bold text-neutral-600">
                        {formatMonthDay(dayDetail.date)}はオフです
                      </p>
                      {isCoach && (
                        <button
                          onClick={handleStartEditSchedule}
                          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
                        >
                          時間割を編集する
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 pr-5">
                      <p className="text-xs text-neutral-400">
                        {locationLabel[scheduleLocation]}・
                        {formatMonthDay(dayDetail.date)}
                      </p>
                      {(dayDetail.day_type === "camp" ||
                        dayDetail.day_type === "match") && (
                        <span
                          className={`self-start rounded px-2 py-1 text-xs font-semibold ${dayTypeFillColor[dayDetail.day_type]}`}
                        >
                          {dayTypeLabel[dayDetail.day_type]}
                        </span>
                      )}
                      {dayDetail.sessions.length === 0 && (
                        <div className="flex flex-col items-start gap-2 py-2">
                          <p className="text-xs text-neutral-400">
                            この日は練習セクションの設定はありません。
                          </p>
                          {isCoach && (
                            <button
                              onClick={handleStartEditSchedule}
                              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
                            >
                              時間割を編集する
                            </button>
                          )}
                        </div>
                      )}
                      {dayDetail.sessions.map((s) => (
                        <div
                          key={s.id}
                          className="rounded-lg border border-neutral-200 p-3"
                        >
                          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-neutral-500">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                            />
                            第{s.session_no}セッション・
                            {sessionTypeLabel[s.session_type]}・
                            {s.start_time.slice(0, 5)}〜
                          </div>
                          {s.is_joint && (
                            <p className="mb-2 rounded bg-purple-50 px-2 py-1 text-[11px] text-purple-700">
                              全体練習（
                              {locationLabel[s.joint_location ?? scheduleLocation]}
                              で実施）
                            </p>
                          )}
                          {s.session_type === "mat" ? (
                            matMenuDetail === undefined ? (
                              <p className="text-xs text-neutral-400">
                                読み込み中…
                              </p>
                            ) : matMenuDetail === null ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-xs text-neutral-400">
                                  このセッションの練習メニューはまだ掲示板に投稿されていません
                                </p>
                                {canEditMatMenu &&
                                  !isPastSession(
                                    dayDetail.date,
                                    s.start_time
                                  ) && (
                                    <button
                                      onClick={() =>
                                        handleGoToMatMenu(s.start_time)
                                      }
                                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white active:bg-neutral-700"
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
                                <p className="whitespace-pre-wrap text-sm text-neutral-800">
                                  {matMenuDetail.content}
                                </p>
                                {canEditMatMenu &&
                                  !isPastSession(
                                    matMenuDetail.date,
                                    matMenuDetail.start_time
                                  ) && (
                                    <button
                                      onClick={() => handleGoToMatMenu()}
                                      className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
                                    >
                                      掲示板で編集する
                                    </button>
                                  )}
                              </div>
                            )
                          ) : (
                            <p className="text-xs text-neutral-500">
                              各自申告制です。実施状況はマイページの「今日のトレーニングメニュー」から記録できます。
                            </p>
                          )}
                        </div>
                      ))}
                      {isCoach && (
                        <button
                          onClick={handleStartEditSchedule}
                          className="self-start text-xs font-medium text-neutral-500 underline"
                        >
                          時間割を編集する
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 一覧表示（セッション内容・時間を一目で見れるように） */}
          <ScheduleAgenda
            scheduleDays={monthScheduleDays}
            loading={loadingMonthSchedule}
            onSelectDate={handleSelectScheduleDate}
          />
        </section>

        {/* 部員一覧 */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">部員一覧</h2>
          <p className="text-[11px] text-neutral-400">
            タップするとその部員のマイページを閲覧できます。「未提出あり」は直近1週間で実施報告・未実施報告のどちらも提出されていない練習日があることを示し、その日付も表示されます。
          </p>
          {loadingMembers ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              部員が登録されていません。
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groupMembersByGrade(
                members.filter((m) => m.role !== "coach")
              ).map((group) => {
                const columns: { label: string; loc: Location | null }[] = [
                  { label: locationLabel.tama, loc: "tama" },
                  { label: locationLabel.otsuka, loc: "otsuka" },
                ];
                return (
                  <div key={group.label} className="flex flex-col gap-1.5">
                    <h3 className="text-[11px] font-semibold text-neutral-400">
                      {group.label}（{group.members.length}人）
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {columns.map((col) => {
                        const colMembers = group.members.filter(
                          (m) =>
                            m.home_location === col.loc ||
                            (col.loc === "tama" && m.home_location == null)
                        );
                        return (
                          <div
                            key={col.label}
                            className="flex flex-col gap-1"
                          >
                            <p className="text-[10px] text-neutral-400">
                              {col.label}（{colMembers.length}人）
                            </p>
                            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-neutral-200">
                              {colMembers.length === 0 ? (
                                <p className="p-2 text-[10px] text-neutral-300">
                                  なし
                                </p>
                              ) : (
                                <ul className="divide-y divide-neutral-100">
                                  {colMembers.map((m) => {
                                    const missingList =
                                      m.isPending || loadingCompliance
                                        ? null
                                        : getMissingSubmissions(
                                            m.id,
                                            m.home_location
                                          );
                                    const missing =
                                      missingList !== null &&
                                      missingList.length > 0;
                                    const content = (
                                      <>
                                        <span className="truncate font-medium text-neutral-800">
                                          {m.display_name}
                                        </span>
                                        <span className="flex flex-col gap-0.5">
                                          {m.isPending ? (
                                            <span className="self-start rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                                              招待中（未登録）
                                            </span>
                                          ) : missingList === null ? (
                                            <span className="text-[10px] text-neutral-300">
                                              確認中…
                                            </span>
                                          ) : missing ? (
                                            <>
                                              <span className="self-start rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                                                未提出あり
                                              </span>
                                              <span className="text-[10px] leading-tight text-red-500">
                                                {missingList
                                                  .map((mm) =>
                                                    formatMonthDay(mm.date)
                                                  )
                                                  .join("、")}
                                              </span>
                                            </>
                                          ) : (
                                            <span className="self-start rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                                              提出OK
                                            </span>
                                          )}
                                        </span>
                                      </>
                                    );
                                    return (
                                      <li key={m.id}>
                                        {m.isPending ? (
                                          <div className="flex w-full flex-col gap-1 px-2 py-2 text-left text-[11px]">
                                            {content}
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() =>
                                              router.push(`/team/${m.id}`)
                                            }
                                            className="flex w-full flex-col gap-1 px-2 py-2 text-left text-[11px] active:bg-neutral-50"
                                          >
                                            {content}
                                          </button>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 全員のウェイトMAX */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            ウェイトMAX一覧
          </h2>
          <p className="text-[11px] text-neutral-400">
            コーチが計測イベントを作成すると、部員が提出した記録がここに反映される予定です（準備中）。
          </p>
          {loadingMembers || loadingMaxes ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              部員が登録されていません。
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-neutral-200">
              <ul className="divide-y divide-neutral-100">
                {members.map((m) => {
                  const max = maxByAuthor.get(m.id);
                  const fmt = (v: number | null | undefined) =>
                    v != null ? `${v}kg` : "未登録";
                  return (
                    <li
                      key={m.id}
                      className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                    >
                      <span className="font-medium text-neutral-800">
                        {m.display_name}
                      </span>
                      <span className="grid grid-cols-3 gap-2 text-center">
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            ベンチ
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.bench)}
                          </span>
                        </span>
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            スクワット
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.squat)}
                          </span>
                        </span>
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            デッドリフト
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.deadlift)}
                          </span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
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
        className="flex-1 rounded border border-neutral-300 px-1.5 py-1.5 text-xs"
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
        className="flex-1 rounded border border-neutral-300 px-1.5 py-1.5 text-xs"
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

function ScheduleAgenda({
  scheduleDays,
  loading,
  onSelectDate,
}: {
  scheduleDays: Map<string, ScheduleDayRow>;
  loading: boolean;
  onSelectDate: (dateStr: string) => void;
}) {
  if (loading) {
    return <p className="text-xs text-neutral-400">読み込み中…</p>;
  }

  const days = Array.from(scheduleDays.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
        この月の時間割はまだ設定されていません。
      </p>
    );
  }

  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-neutral-200">
      <ul className="divide-y divide-neutral-100">
        {days.map((day) => (
          <li key={day.id}>
            <button
              onClick={() => onSelectDate(day.date)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs active:bg-neutral-50"
            >
              <span className="flex shrink-0 items-center gap-1.5 font-semibold text-neutral-600">
                {formatMonthDay(day.date)}
                {(day.day_type === "camp" || day.day_type === "match") && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${dayTypeFillColor[day.day_type]}`}
                  >
                    {dayTypeLabel[day.day_type]}
                  </span>
                )}
              </span>
              {day.is_off ? (
                <span className="flex-1 text-right text-neutral-400">オフ</span>
              ) : day.sessions.length === 0 ? (
                <span className="flex-1 text-right text-neutral-300">
                  セクション設定なし
                </span>
              ) : (
                <span className="flex flex-1 flex-wrap justify-end gap-x-3 gap-y-1">
                  {day.sessions.map((s) => (
                    <span
                      key={s.id}
                      className="flex items-center gap-1 text-neutral-600"
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                      />
                      {sessionTypeLabel[s.session_type]}
                      {" "}
                      {s.start_time.slice(0, 5)}〜
                      {s.is_joint && (
                        <span className="text-purple-500">(全体)</span>
                      )}
                    </span>
                  ))}
                </span>
              )}
              <span className="shrink-0 text-neutral-300">›</span>
            </button>
          </li>
        ))}
      </ul>
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
  viewLocation,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  scheduleDays: Map<string, ScheduleDayRow>;
  loading: boolean;
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
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
      {loading ? (
        <p className="text-xs text-neutral-400">読み込み中…</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />;
              const key = toDateKey(date);
              const day = scheduleDays.get(key);
              const isHighlighted = key === highlightDate;
              return (
                <button
                  key={i}
                  onClick={() => onSelectDate(key)}
                  className={`flex min-h-[64px] flex-col items-start gap-0.5 rounded-lg border p-1 text-left ${
                    day?.is_off
                      ? "border-neutral-200 bg-neutral-200"
                      : day?.day_type === "camp"
                        ? "border-pink-200 bg-pink-50"
                        : day?.day_type === "match"
                          ? "border-red-200 bg-red-50"
                          : isHighlighted
                            ? "border-amber-400 bg-amber-50 ring-1 ring-amber-400"
                            : "border-neutral-200 active:bg-neutral-50"
                  }`}
                >
                  <span
                    className={`text-[11px] font-semibold ${
                      day?.is_off ? "text-neutral-400" : "text-neutral-700"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {day?.is_off && (
                    <span className="text-[9px] text-neutral-400">オフ</span>
                  )}
                  {day &&
                    !day.is_off &&
                    (day.day_type === "camp" || day.day_type === "match") && (
                      <span
                        className={`rounded px-1 text-[9px] font-semibold ${dayTypeFillColor[day.day_type]}`}
                      >
                        {dayTypeLabel[day.day_type]}
                      </span>
                    )}
                  {day &&
                    !day.is_off &&
                    day.sessions.map((s) => (
                      <span
                        key={s.id}
                        className="flex w-full items-start gap-0.5 leading-tight"
                      >
                        <span
                          className={`mt-[3px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                        />
                        <span className="break-words text-[9px] text-neutral-600">
                          {sessionTypeLabel[s.session_type]}
                          {s.start_time.slice(0, 5)}〜
                          {s.is_joint &&
                            (s.joint_location &&
                            s.joint_location !== viewLocation
                              ? `（${locationLabel[s.joint_location]}）`
                              : "（全体）")}
                        </span>
                      </span>
                    ))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
            {(Object.keys(sessionTypeLabel) as SessionType[]).map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${sessionTypeDotColor[t]}`}
                />
                {sessionTypeLabel[t]}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded bg-neutral-200" />
              オフ
            </span>
          </p>
        </>
      )}
    </div>
  );
}
