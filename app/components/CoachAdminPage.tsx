"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { currentGrade, DayType, dayTypeLabel, Location, locationLabel, locations, SessionType, teamEventTypeLabel, TeamEventType } from "../lib/types";
import type { Profile } from "./AuthGate";

type RosterRoleChoice = "coach" | "captain" | "vice_captain" | "leader" | "manager" | "member";

const rosterRoleLabel: Record<RosterRoleChoice, string> = {
  coach: "管理者（コーチ）",
  captain: "主将",
  vice_captain: "副主将",
  leader: "リーダー",
  manager: "マネージャー",
  member: "役職なし",
};

type MemberRoleForEdit = "coach" | "captain" | "vice_captain" | "leader" | "vice_leader" | "manager" | "member" | "ob";

const memberRoleEditLabel: Record<MemberRoleForEdit, string> = {
  coach: "管理者（コーチ）",
  captain: "主将",
  vice_captain: "副主将",
  leader: "リーダー",
  vice_leader: "副リーダー",
  manager: "マネージャー",
  member: "役職なし",
  ob: "OB(引退)",
};

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
  role: MemberRoleForEdit;
};

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

type WeightMaxEventRow = {
  id: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
};

type TeamEventRow = {
  id: string;
  type: TeamEventType;
  title: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
};

type RosterRow = {
  id: string;
  display_name: string;
  email: string | null;
  role: RosterRoleChoice;
  home_location: Location | null;
  entry_year: number | null;
  claimed_by: string | null;
  token: string;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-950/40 text-pink-400",
  match: "bg-red-950/40 text-red-400",
  away: "bg-purple-950/40 text-purple-400",
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

export default function CoachAdminPage({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
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

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterName, setRosterName] = useState("");
  const [rosterEmail, setRosterEmail] = useState("");
  const [rosterLocation, setRosterLocation] = useState<Location>("tama");
  const [rosterEntryYear, setRosterEntryYear] = useState("");
  const [rosterRole, setRosterRole] = useState<RosterRoleChoice>("member");
  const [savingRoster, setSavingRoster] = useState(false);

  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  const [weightMaxEvent, setWeightMaxEvent] = useState<
    WeightMaxEventRow | null | undefined
  >(undefined);
  const [weightMaxSubmittedCount, setWeightMaxSubmittedCount] = useState(0);
  const [newDeadline, setNewDeadline] = useState("");
  const [savingWeightMaxEvent, setSavingWeightMaxEvent] = useState(false);

  const [selectedEventType, setSelectedEventType] = useState<
    "weight_max" | TeamEventType
  >("weight_max");
  const [teamEvents, setTeamEvents] = useState<
    Record<TeamEventType, TeamEventRow | null | undefined>
  >({ match_reflection: undefined, body_composition: undefined });
  const [teamEventSubmittedCounts, setTeamEventSubmittedCounts] = useState<
    Record<TeamEventType, number>
  >({ match_reflection: 0, body_composition: 0 });
  const [newEventTitle, setNewEventTitle] = useState("");
  const [savingTeamEvent, setSavingTeamEvent] = useState(false);
  const [selectedEventTargetIds, setSelectedEventTargetIds] = useState<
    Set<string>
  >(new Set());
  const [activeEventTargetCounts, setActiveEventTargetCounts] = useState<
    Record<"weight_max" | TeamEventType, number | null>
  >({ weight_max: null, match_reflection: null, body_composition: null });

  const rosterEntryYearOptions: number[] = (() => {
    const now = new Date();
    const newAcademicYearStarted =
      now.getMonth() > 2 || (now.getMonth() === 2 && now.getDate() >= 15);
    const academicYear = newAcademicYearStarted
      ? now.getFullYear()
      : now.getFullYear() - 1;
    return Array.from({ length: 4 }, (_, i) => academicYear - i);
  })();

  useEffect(() => {
    loadMembers();
    loadRoster();
    loadWeightMaxEvent();
    loadTeamEvents();
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
    } else {
      setMembers((data ?? []) as MemberRow[]);
    }
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
      tama: requiredByLoc.tama.map((m) => m.id),
      otsuka: requiredByLoc.otsuka.map((m) => m.id),
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
      ...requiredByLoc.tama.map((m) => m.id),
      ...requiredByLoc.otsuka.map((m) => m.id),
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
          isPending: false,
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


  const [showRoleLocationEdit, setShowRoleLocationEdit] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<
    Record<string, { role: MemberRoleForEdit; home_location: Location }>
  >({});

  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loadingInjuries, setLoadingInjuries] = useState(true);
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(
    null
  );
  const [showPastInjuries, setShowPastInjuries] = useState(false);

  async function handleSaveMemberEdit(memberId: string) {
    const draft = draftEdits[memberId];
    if (!draft) return;
    setSavingRoleId(memberId);
    const { error } = await supabase
      .from("profiles")
      .update({ role: draft.role, home_location: draft.home_location })
      .eq("id", memberId);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? { ...m, role: draft.role, home_location: draft.home_location }
            : m
        )
      );
      setDraftEdits((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
    }
    setSavingRoleId(null);
  }

  async function handleDeleteMember(memberId: string, displayName: string) {
    if (memberId === profile.id) {
      setErrorMsg("自分自身は削除できません。");
      return;
    }
    if (
      !window.confirm(
        `${displayName}さんを本当に削除しますか？\nこの操作は元に戻せません。提出済みの記録も全て削除されます。`
      )
    )
      return;
    setSavingRoleId(memberId);
    setErrorMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setErrorMsg("認証情報が確認できませんでした。もう一度ログインし直してください。");
      setSavingRoleId(null);
      return;
    }

    try {
      const res = await fetch("/api/admin/delete-member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.error ?? "削除に失敗しました。");
      } else {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
        setDraftEdits((prev) => {
          const next = { ...prev };
          delete next[memberId];
          return next;
        });
      }
    } catch {
      setErrorMsg("削除に失敗しました。通信環境を確認してください。");
    }
    setSavingRoleId(null);
  }

  async function loadWeightMaxEvent() {
    const { data, error } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at, closed_at")
      .eq("team_id", profile.team_id)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const event = (data as WeightMaxEventRow | null) ?? null;
    setWeightMaxEvent(event);

    if (event) {
      const { data: maxData, error: maxError } = await supabase
        .from("weight_maxes")
        .select("author_id")
        .eq("team_id", profile.team_id)
        .eq("event_id", event.id);
      if (maxError) {
        setErrorMsg(maxError.message);
      } else {
        setWeightMaxSubmittedCount((maxData ?? []).length);
      }

      const { data: targetData, error: targetError } = await supabase
        .from("weight_max_event_targets")
        .select("member_id")
        .eq("event_id", event.id);
      if (targetError) {
        setErrorMsg(targetError.message);
      } else {
        setActiveEventTargetCounts((prev) => ({
          ...prev,
          weight_max:
            targetData && targetData.length > 0 ? targetData.length : null,
        }));
      }
    } else {
      setActiveEventTargetCounts((prev) => ({ ...prev, weight_max: null }));
    }
  }

  async function handleCreateWeightMaxEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeadline) return;
    setSavingWeightMaxEvent(true);

    const { data: inserted, error } = await supabase
      .from("weight_max_events")
      .insert({
        team_id: profile.team_id,
        deadline: newDeadline,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) {
      setErrorMsg(error.message);
      setSavingWeightMaxEvent(false);
      return;
    }

    if (selectedEventTargetIds.size > 0 && inserted) {
      const targetRows = Array.from(selectedEventTargetIds).map(
        (memberId) => ({
          event_id: (inserted as { id: string }).id,
          member_id: memberId,
        })
      );
      const { error: targetError } = await supabase
        .from("weight_max_event_targets")
        .insert(targetRows);
      if (targetError) setErrorMsg(targetError.message);
    }

    setNewDeadline("");
    setSelectedEventTargetIds(new Set());
    await loadWeightMaxEvent();
    setSavingWeightMaxEvent(false);
  }

  async function handleEndWeightMaxEvent() {
    if (!weightMaxEvent) return;
    if (
      !window.confirm(
        "このウェイトMAX集計を終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("weight_max_events")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", weightMaxEvent.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadWeightMaxEvent();
    }
  }

  async function loadTeamEvents() {
    for (const type of ["match_reflection", "body_composition"] as TeamEventType[]) {
      const { data, error } = await supabase
        .from("team_events")
        .select("id, type, title, deadline, created_at, closed_at")
        .eq("team_id", profile.team_id)
        .eq("type", type)
        .is("closed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setErrorMsg(error.message);
        continue;
      }
      const event = (data as TeamEventRow | null) ?? null;
      setTeamEvents((prev) => ({ ...prev, [type]: event }));

      if (event) {
        const { data: subData, error: subError } = await supabase
          .from("team_event_submissions")
          .select("author_id")
          .eq("event_id", event.id);
        if (subError) {
          setErrorMsg(subError.message);
        } else {
          setTeamEventSubmittedCounts((prev) => ({
            ...prev,
            [type]: (subData ?? []).length,
          }));
        }

        const { data: targetData, error: targetError } = await supabase
          .from("team_event_targets")
          .select("member_id")
          .eq("event_id", event.id);
        if (targetError) {
          setErrorMsg(targetError.message);
        } else {
          setActiveEventTargetCounts((prev) => ({
            ...prev,
            [type]: targetData && targetData.length > 0 ? targetData.length : null,
          }));
        }
      } else {
        setActiveEventTargetCounts((prev) => ({ ...prev, [type]: null }));
      }
    }
  }

  async function handleCreateTeamEvent(
    type: TeamEventType,
    e: React.FormEvent
  ) {
    e.preventDefault();
    if (!newDeadline) return;
    if (type === "match_reflection" && !newEventTitle.trim()) return;
    setSavingTeamEvent(true);

    const { data: inserted, error } = await supabase
      .from("team_events")
      .insert({
        team_id: profile.team_id,
        type,
        title: newEventTitle.trim(),
        deadline: newDeadline,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) {
      setErrorMsg(error.message);
      setSavingTeamEvent(false);
      return;
    }

    if (
      type === "match_reflection" &&
      selectedEventTargetIds.size > 0 &&
      inserted
    ) {
      const targetRows = Array.from(selectedEventTargetIds).map(
        (memberId) => ({
          event_id: (inserted as { id: string }).id,
          member_id: memberId,
        })
      );
      const { error: targetError } = await supabase
        .from("team_event_targets")
        .insert(targetRows);
      if (targetError) setErrorMsg(targetError.message);
    }

    setNewDeadline("");
    setNewEventTitle("");
    setSelectedEventTargetIds(new Set());
    await loadTeamEvents();
    setSavingTeamEvent(false);
  }

  async function handleEndTeamEvent(type: TeamEventType) {
    const event = teamEvents[type];
    if (!event) return;
    if (
      !window.confirm(
        "このイベントを終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("team_events")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadTeamEvents();
    }
  }

  async function loadRoster() {
    setLoadingRoster(true);
    const { data, error } = await supabase
      .from("member_roster")
      .select(
        "id, display_name, email, role, home_location, entry_year, claimed_by, token"
      )
      .eq("team_id", profile.team_id)
      .is("claimed_by", null)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setRoster((data ?? []) as RosterRow[]);
    }
    setLoadingRoster(false);
  }

  async function handleAddRoster(e: React.FormEvent) {
    e.preventDefault();
    if (!rosterName.trim()) return;
    setSavingRoster(true);

    const { error } = await supabase.from("member_roster").insert({
      team_id: profile.team_id,
      display_name: rosterName.trim(),
      email: rosterEmail.trim() || null,
      role: rosterRole,
      home_location:
        rosterRole === "coach" || rosterRole === "manager"
          ? null
          : rosterLocation,
      entry_year:
        rosterRole === "coach" || rosterRole === "manager" || !rosterEntryYear
          ? null
          : Number(rosterEntryYear),
      created_by: profile.id,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setRosterName("");
      setRosterEmail("");
      setRosterEntryYear("");
      setRosterRole("member");
      setRosterLocation("tama");
      await loadRoster();
    }
    setSavingRoster(false);
  }

  function handleStartEditEmail(row: RosterRow) {
    setEditingEmailId(row.id);
    setEditingEmailValue(row.email ?? "");
  }

  async function handleSaveEmail(id: string) {
    setSavingEmail(true);
    const { error } = await supabase
      .from("member_roster")
      .update({ email: editingEmailValue.trim() || null })
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setEditingEmailId(null);
      setEditingEmailValue("");
      await loadRoster();
    }
    setSavingEmail(false);
  }

  async function handleCopyInviteLink(row: RosterRow) {
    const url = `${window.location.origin}/?invite=${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTokenId(row.id);
      setTimeout(() => setCopiedTokenId(null), 2000);
    } catch {
      window.prompt("このリンクをコピーしてください", url);
    }
  }

  async function handleDeleteRoster(id: string) {
    if (!window.confirm("この事前登録を削除しますか？")) return;
    const { error } = await supabase
      .from("member_roster")
      .delete()
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadRoster();
    }
  }

  // 新規メンバー登録欄の並び順：コーチを先頭に、その後は学年（上級生から）→拠点の順
  const sortedRoster = [...roster]
    .filter((r) => !r.claimed_by)
    .sort((a, b) => {
    if (a.role === "coach" && b.role !== "coach") return -1;
    if (b.role === "coach" && a.role !== "coach") return 1;
    const gradeA = a.entry_year != null ? currentGrade(a.entry_year) : -1;
    const gradeB = b.entry_year != null ? currentGrade(b.entry_year) : -1;
    if (gradeA !== gradeB) return gradeB - gradeA;
    const locA = a.home_location ?? "";
    const locB = b.home_location ?? "";
    if (locA !== locB) return locA.localeCompare(locB);
    return a.display_name.localeCompare(b.display_name, "ja");
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          管理ページ
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            掲示板に戻る
          </button>
          <button
            onClick={() => router.push("/team")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            チームページ
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {/* 報告状況一覧 */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            報告状況一覧
          </h2>
          <p className="text-[11px] text-neutral-500">
            日報(実施報告・未実施報告)・トレ報(マット以外のセッションの自主トレ記録)の提出状況です。日付をタップすると、その日の部員ごとの提出状況が下に表示されます。
          </p>

          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() =>
                  setReportCalendarCursor(
                    new Date(
                      reportCalendarCursor.getFullYear(),
                      reportCalendarCursor.getMonth() - 1,
                      1
                    )
                  )
                }
                className="rounded px-2 py-1 text-xs text-neutral-400 active:bg-neutral-800"
              >
                ＜
              </button>
              <span className="text-sm font-semibold">
                {reportCalendarCursor.getFullYear()}年
                {reportCalendarCursor.getMonth() + 1}月
              </span>
              <button
                onClick={() =>
                  setReportCalendarCursor(
                    new Date(
                      reportCalendarCursor.getFullYear(),
                      reportCalendarCursor.getMonth() + 1,
                      1
                    )
                  )
                }
                className="rounded px-2 py-1 text-xs text-neutral-400 active:bg-neutral-800"
              >
                ＞
              </button>
            </div>
            {loadingSubmissionCounts ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : (
              <>
                <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
                  {["日", "月", "火", "水", "木", "金", "土"].map(
                    (w, idx) => (
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
                    )
                  )}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {(() => {
                    const year = reportCalendarCursor.getFullYear();
                    const month = reportCalendarCursor.getMonth();
                    const firstDay = new Date(year, month, 1);
                    const startWeekday = firstDay.getDay();
                    const daysInMonth = new Date(
                      year,
                      month + 1,
                      0
                    ).getDate();
                    const cells: (Date | null)[] = [];
                    for (let i = 0; i < startWeekday; i++) cells.push(null);
                    for (let d = 1; d <= daysInMonth; d++)
                      cells.push(new Date(year, month, d));

                    return cells.map((date, i) => {
                      if (!date) return <div key={i} />;
                      const key = toDateKey(date);
                      const isHighlighted = key === selectedReportDate;
                      const weekday = date.getDay();
                      const count = submissionCounts.get(key);
                      const dayInfo = reportDayInfo.get(key);
                      const isFullySubmitted =
                        !!count &&
                        count.total > 0 &&
                        count.submitted === count.total;
                      return (
                        <button
                          key={i}
                          onClick={() => handleSelectReportDate(key)}
                          className={`flex min-h-[52px] flex-col items-start gap-0.5 rounded-lg border p-1 text-left ${
                            dayInfo?.isFullyOff
                              ? "border-neutral-700 bg-neutral-900"
                              : isFullySubmitted
                                ? "border-emerald-700 bg-emerald-900/60"
                                : isHighlighted
                                  ? "border-amber-400 bg-amber-950/40 ring-1 ring-amber-400"
                                  : "border-neutral-700 bg-neutral-800 active:bg-neutral-700"
                          }`}
                        >
                          <span
                            className={`text-[11px] font-semibold ${
                              !isHighlighted && weekday === 0
                                ? "border-b-2 border-red-500 text-red-400"
                                : !isHighlighted && weekday === 6
                                  ? "border-b-2 border-blue-500 text-blue-400"
                                  : "text-neutral-200"
                            }`}
                          >
                            {date.getDate()}
                          </span>
                          {dayInfo?.isFullyOff ? (
                            <span className="text-[9px] text-neutral-500">
                              全体オフ
                            </span>
                          ) : (
                            <>
                              {dayInfo && dayInfo.dayType !== "practice" && (
                                <span
                                  className={`max-w-full truncate rounded px-1 text-[9px] font-semibold ${dayTypeFillColorDark[dayInfo.dayType]}`}
                                >
                                  {dayInfo.eventName ||
                                    dayTypeLabel[dayInfo.dayType]}
                                </span>
                              )}
                              {count && (
                                <span
                                  className={`text-[9px] font-semibold ${
                                    isFullySubmitted
                                      ? "text-emerald-300"
                                      : "text-neutral-300"
                                  }`}
                                >
                                  {count.submitted}/{count.total}人
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    });
                  })()}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {(["tama", "otsuka"] as Location[]).map((loc) => {
                    const c = submissionCountsByLoc.get(selectedReportDate)?.[loc];
                    return (
                      <div
                        key={loc}
                        className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2"
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
              </>
            )}
          </div>

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
              {(["tama", "otsuka"] as Location[]).map((loc) => (
                <div key={loc} className="flex flex-col gap-3">
                  <p className="text-xs font-semibold text-neutral-400">
                    {locationLabel[loc]}
                  </p>
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
                            !resolved &&
                            (d.matStatus === "not_started" ||
                              d.selfStatus === "not_started");
                          const allDone =
                            !notStarted &&
                            (d.matStatus === "not_required" ||
                              d.matStatus !== "missing") &&
                            (d.selfStatus === "not_required" ||
                              d.selfStatus === "done");
                          return (
                            <button
                              key={d.memberId}
                              onClick={() =>
                                router.push(
                                  `/team/${d.memberId}?date=${selectedReportDate}`
                                )
                              }
                              className={`flex items-center justify-between gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                                notStarted
                                  ? "border-neutral-800 bg-neutral-900 text-neutral-400"
                                  : allDone
                                    ? "border-emerald-900/60 bg-emerald-950/20 text-neutral-100 active:bg-emerald-950/40"
                                    : "border-neutral-800 bg-neutral-900 text-neutral-100 active:bg-neutral-800"
                              }`}
                            >
                              <span className="truncate">
                                {d.displayName}
                              </span>
                              {notStarted ? (
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

        {/* イベントを作成する */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            イベントを作成する
          </h2>
          <p className="text-[11px] text-neutral-500">
            締切日を設定すると、部員のマイページの「タスク一覧」に提出タスクが表示されます(期日を過ぎると赤く強調され、提出すると一覧から消えます)。提出内容はチームページで確認できます。
          </p>

          <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
            {(
              [
                ["weight_max", "ウェイトMAX集計"],
                ["match_reflection", "試合の振り返り"],
                ["body_composition", "体組成の提出"],
              ] as [typeof selectedEventType, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedEventType(key)}
                className={`flex-1 rounded-md py-2 font-medium ${
                  selectedEventType === key
                    ? "bg-red-600 text-white shadow"
                    : "text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {selectedEventType === "weight_max" ? (
            weightMaxEvent === undefined ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : weightMaxEvent ? (
              <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
                <p className="text-sm text-neutral-200">
                  締切:{" "}
                  <span className="font-semibold">
                    {weightMaxEvent.deadline}
                  </span>
                </p>
                <p className="text-xs text-neutral-400">
                  提出済み {weightMaxSubmittedCount}人 /{" "}
                  {activeEventTargetCounts.weight_max ??
                    members.filter((m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob").length}
                  人
                  {activeEventTargetCounts.weight_max != null &&
                    "（対象者を限定しています）"}
                </p>
                <button
                  onClick={handleEndWeightMaxEvent}
                  className="self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                >
                  この集計を終了する
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleCreateWeightMaxEvent}
                className="flex flex-col gap-2"
              >
                <EventTargetPicker
                  members={members}
                  selectedIds={selectedEventTargetIds}
                  onChange={setSelectedEventTargetIds}
                />
                <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                  締切日
                  <input
                    type="date"
                    required
                    value={newDeadline}
                    onChange={(e) => setNewDeadline(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingWeightMaxEvent}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                >
                  集計を開始する
                </button>
                </div>
              </form>
            )
          ) : teamEvents[selectedEventType] === undefined ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : teamEvents[selectedEventType] ? (
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
              {teamEvents[selectedEventType]!.title && (
                <p className="text-sm font-semibold text-neutral-100">
                  {teamEvents[selectedEventType]!.title}
                </p>
              )}
              <p className="text-sm text-neutral-200">
                締切:{" "}
                <span className="font-semibold">
                  {teamEvents[selectedEventType]!.deadline}
                </span>
              </p>
              <p className="text-xs text-neutral-400">
                提出済み {teamEventSubmittedCounts[selectedEventType]}人 /{" "}
                {activeEventTargetCounts[selectedEventType] ??
                  members.filter((m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob").length}
                人
                {activeEventTargetCounts[selectedEventType] != null &&
                  "（対象者を限定しています）"}
              </p>
              <button
                onClick={() => handleEndTeamEvent(selectedEventType)}
                className="self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
              >
                このイベントを終了する
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => handleCreateTeamEvent(selectedEventType, e)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                {selectedEventType === "match_reflection"
                  ? "タイトル(例：全日本学生選手権、東日本学生リーグ戦)"
                  : "タイトル(任意)"}
                <input
                  type="text"
                  required={selectedEventType === "match_reflection"}
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
              <EventTargetPicker
                members={members}
                selectedIds={selectedEventTargetIds}
                onChange={setSelectedEventTargetIds}
              />
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                  締切日
                  <input
                    type="date"
                    required
                    value={newDeadline}
                    onChange={(e) => setNewDeadline(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingTeamEvent}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                >
                  イベントを作成する
                </button>
              </div>
            </form>
          )}
        </section>


        {/* 怪我人一覧 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
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

        {/* 部員の役職を編集 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
              メンバー情報の編集
            </h2>
            <button
              onClick={() => {
                setShowRoleLocationEdit((v) => !v);
                setDraftEdits({});
              }}
              className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
            >
              {showRoleLocationEdit ? "閉じる" : "編集する"}
            </button>
          </div>
          {showRoleLocationEdit && (
            <p className="text-[11px] text-neutral-500">
              役職は主将・副主将・リーダー・副リーダー・役職なし、拠点は多摩・大塚から選べます。変更したら部員ごとに「保存する」を押してください。
            </p>
          )}
          {loadingMembers ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              部員が登録されていません。
            </p>
          ) : !showRoleLocationEdit ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
              <ul className="divide-y divide-neutral-800">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <span className="font-medium text-neutral-100">
                      {m.display_name}
                    </span>
                    <div className="flex items-center gap-1.5 text-neutral-400">
                      <span className="rounded bg-neutral-800 px-2 py-1">
                        {m.home_location
                          ? locationLabel[m.home_location]
                          : "拠点未設定"}
                      </span>
                      <span className="rounded bg-neutral-800 px-2 py-1">
                        {memberRoleEditLabel[m.role]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
              <ul className="divide-y divide-neutral-800">
                {members.map((m) => {
                  const draft = draftEdits[m.id];
                  const currentRole = draft?.role ?? m.role;
                  const currentLocation =
                    draft?.home_location ?? m.home_location ?? "tama";
                  const isDirty = !!draft;
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                    >
                      <span className="font-medium text-neutral-100">
                        {m.display_name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={currentLocation}
                          disabled={savingRoleId === m.id}
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
                              ...prev,
                              [m.id]: {
                                role: prev[m.id]?.role ?? m.role,
                                home_location: e.target.value as Location,
                              },
                            }))
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        >
                          {locations.map((loc) => (
                            <option
                              key={loc}
                              value={loc}
                              className="bg-neutral-900 text-neutral-100"
                            >
                              {locationLabel[loc]}
                            </option>
                          ))}
                        </select>
                        <select
                          value={currentRole}
                          disabled={savingRoleId === m.id}
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
                              ...prev,
                              [m.id]: {
                                role: e.target.value as MemberRoleForEdit,
                                home_location:
                                  prev[m.id]?.home_location ??
                                  m.home_location ??
                                  "tama",
                              },
                            }))
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        >
                          {(
                            Object.keys(
                              memberRoleEditLabel
                            ) as MemberRoleForEdit[]
                          ).map((r) => (
                            <option
                              key={r}
                              value={r}
                              className="bg-neutral-900 text-neutral-100"
                            >
                              {memberRoleEditLabel[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSaveMemberEdit(m.id)}
                          disabled={!isDirty || savingRoleId === m.id}
                          className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white active:bg-red-700 disabled:opacity-40"
                        >
                          保存する
                        </button>
                        <button
                          onClick={() =>
                            handleDeleteMember(m.id, m.display_name)
                          }
                          disabled={savingRoleId === m.id}
                          className="rounded border border-red-900 px-2.5 py-1 text-[11px] font-medium text-red-400 active:bg-red-950/40 disabled:opacity-40"
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* 新規メンバー登録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            新規メンバー登録
          </h2>
          <p className="text-[11px] text-neutral-500">
            部員だけでなく、管理者・マネージャーもここから事前登録できます。氏名とメールアドレスをあらかじめ登録しておくと、本人がそのメールアドレスで新規登録した際に、氏名・拠点・学年・役職が自動で反映されます。
          </p>

          {loadingRoster ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : roster.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              まだ事前登録がありません。
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
              {sortedRoster.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-neutral-100">
                          {r.display_name}
                        </span>
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                          {rosterRoleLabel[r.role]}
                        </span>
                        {r.home_location && (
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                            {locationLabel[r.home_location]}
                          </span>
                        )}
                      </span>
                      {editingEmailId !== r.id &&
                        (r.email ? (
                          <span className="truncate text-neutral-500">
                            {r.email}
                          </span>
                        ) : (
                          <span className="text-amber-400">
                            メール未設定
                          </span>
                        ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                        未登録
                      </span>
                      <button
                        onClick={() => handleDeleteRoster(r.id)}
                        className="text-red-500"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {editingEmailId === r.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        autoFocus
                        placeholder="メールアドレス"
                        value={editingEmailValue}
                        onChange={(e) => setEditingEmailValue(e.target.value)}
                        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      />
                      <button
                        onClick={() => handleSaveEmail(r.id)}
                        disabled={savingEmail}
                        className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingEmailId(null)}
                        className="rounded border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleStartEditEmail(r)}
                        className="text-[11px] font-medium text-neutral-400 underline"
                      >
                        {r.email ? "メールを編集" : "メールを追加"}
                      </button>
                      {!r.claimed_by && (
                        <button
                          onClick={() => handleCopyInviteLink(r)}
                          className="text-[11px] font-medium text-blue-600 underline"
                        >
                          {copiedTokenId === r.id
                            ? "コピーしました！"
                            : "招待リンクをコピー"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form
            onSubmit={handleAddRoster}
            className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3"
          >
            <p className="text-xs font-semibold text-neutral-300">
              1件ずつ登録
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="氏名"
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
              <input
                type="email"
                placeholder="メールアドレス（あとで追加可）"
                value={rosterEmail}
                onChange={(e) => setRosterEmail(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={rosterRole}
                onChange={(e) =>
                  setRosterRole(e.target.value as RosterRoleChoice)
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              >
                {(
                  Object.keys(rosterRoleLabel) as RosterRoleChoice[]
                ).map((r) => (
                  <option key={r} value={r}>
                    {rosterRoleLabel[r]}
                  </option>
                ))}
              </select>
              {rosterRole !== "coach" && rosterRole !== "manager" && (
                <select
                  value={rosterLocation}
                  onChange={(e) =>
                    setRosterLocation(e.target.value as Location)
                  }
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                >
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>
                      {locationLabel[loc]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rosterRole !== "coach" && rosterRole !== "manager" && (
              <select
                value={rosterEntryYear}
                onChange={(e) => setRosterEntryYear(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              >
                <option value="">入学年を選択</option>
                {rosterEntryYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}年入学（現在{currentGrade(y)}年）
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={savingRoster}
              className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              追加する
            </button>
          </form>
        </section>

        <div className="border-t border-neutral-800 pt-4">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-800"
          >
            ログアウト
          </button>
        </div>
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
          <span className="font-medium text-neutral-100">
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
        <div className="flex flex-col gap-1 border-t border-neutral-800 px-3 py-2.5 text-xs text-neutral-300">
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

function EventTargetPicker({
  members,
  selectedIds,
  onChange,
}: {
  members: MemberRow[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-neutral-400">
          対象者(選ばなければ全員が対象になります)
        </span>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-[11px] text-neutral-500 underline"
          >
            選択をクリア
          </button>
        )}
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-neutral-700 bg-neutral-900 p-2">
        <div className="flex flex-col gap-1">
          {members
            .filter((m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob")
            .map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 text-xs text-neutral-200"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(m.id)}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    onChange(next);
                  }}
                  className="h-3.5 w-3.5"
                />
                {m.display_name}
                <span className="text-neutral-500">
                  （{locationLabel[m.home_location ?? "tama"]}）
                </span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}
