"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  canCreateMenu,
  isAdminEditor,
  isStaffRole,
  CommentKind,
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  locations,
  SessionType,
  sessionTypeLabel,
  TrainingType,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";
import { isExemptOn, loadExemptions, type ExemptionRow } from "../lib/exemptions";
import { useSubNav } from "./shell/AppShell";
import SubTabBar from "./shell/SubTabBar";
import ScheduleEditForm, { type ScheduleDayPrefill } from "./ScheduleEditForm";
import ReactionBar, { loadReactions, type ReactionRow } from "./ReactionBar";
import ParticipantsPanel from "./board/ParticipantsPanel";
import StructuredMenuCard from "./board/StructuredMenuCard";
import TemplatePicker from "./board/TemplatePicker";
import { notifyBoardTasksChanged, useBoardTasks, type BoardTask } from "./shell/useBoardTasks";
import { itemsToText, toRow, type MenuItemDraft } from "../lib/menuItems";
import MenuItemsEditor from "./board/MenuItemsEditor";
import { CommentItem, ReportThread, toDateKey, MenuCalendar, TimeSelect, type MenuRow, type CommentRow } from "./board/BoardParts";

const locationSubTabItems = locations.map((loc) => ({
  value: loc,
  label: locationLabel[loc],
}));


// "YYYY-MM-DD" -> "●月●日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

// "YYYY-MM-DD" + "HH:MM" -> "2026年7月24日 10時10分〜"
function formatFullDateTime(dateStr: string, startTime: string | null) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = `${y}年${m}月${d}日`;
  if (!startTime) return base;
  const [h, min] = startTime.split(":").map(Number);
  return `${base} ${h}時${String(min).padStart(2, "0")}分〜`;
}

// メニューの開始時刻を過ぎているか判定（開始時刻未設定の場合は常に報告可能）
function isReportOpen(menu: MenuRow): boolean {
  if (!menu.start_time) return true;
  const threshold = new Date(`${menu.date}T${menu.start_time}`);
  return new Date() >= threshold;
}

// 「11/10（火）17:00〜」
function formatMenuHeading(date: string, start: string | null) {
  const [, m, d] = date.split("-").map(Number);
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00`).getDay()];
  return `${m}/${d}（${w}）${start ? ` ${start.slice(0, 5)}〜` : ""}`;
}

export default function TrainingBoardSupabase({
  profile,
}: {
  profile: Profile;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [{ initialLocation, initialDate, initialStartTime }] = useState<{
    initialLocation: Location;
    initialDate: string | null;
    initialStartTime: string | null;
  }>(() => {
    if (typeof window === "undefined") {
      return { initialLocation: "tama", initialDate: null, initialStartTime: null };
    }
    try {
      const raw = sessionStorage.getItem("jumpTo");
      if (raw) {
        sessionStorage.removeItem("jumpTo");
        const parsed = JSON.parse(raw);
        return {
          initialLocation: parsed.location === "otsuka" ? "otsuka" : "tama",
          initialDate: parsed.date ?? null,
          initialStartTime: parsed.startTime ?? null,
        };
      }
    } catch {
      // 無視して通常起動にフォールバック
    }
    return { initialLocation: "tama", initialDate: null, initialStartTime: null };
  });
  const usedInitialJump = useRef(false);
  const pendingJumpDateRef = useRef<string | null>(null);
  // タスクから開いたときに選ぶメニュー
  const pendingMenuIdRef = useRef<string | null>(null);
  const practiceSectionRef = useRef<HTMLDivElement>(null);
  // 管理者・マネージャーは管理者用の表示（時間割・未提出者・トレ報の一覧など）。
  // 時間割（セクション）の登録・編集ができるのは管理者だけ。
  const isCoachView = isStaffRole(profile.role);
  const canEditSchedule = isAdminEditor(profile.role);
  // 部員（コーチ以外）が閲覧できる拠点。マネージャーは多摩所属として扱う。
  const memberHomeLocation: Location =
    profile.role === "manager" ? "tama" : (profile.home_location ?? "tama");
  const [activeLocation, setActiveLocation] = useState<Location>(
    isCoachView ? initialLocation : memberHomeLocation
  );
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [crossLocationMenu, setCrossLocationMenu] = useState<MenuRow | null>(
    null
  );
  const [comments, setComments] = useState<CommentRow[]>([]);
  // 日報（実施報告・未実施報告）に付いたリアクション
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [viewDateSchedule, setViewDateSchedule] = useState<{
    is_off: boolean;
    day_type: DayType;
    event_name: string | null;
    sessions: {
      session_type: SessionType;
      start_time: string | null;
      is_joint: boolean;
      joint_location: Location | null;
      location_note: string | null;
    }[];
  } | null>(null);
  // コーチがマット掲示板から直接、時間割（練習セクション）を編集できるようにする
  const [editingViewDateSchedule, setEditingViewDateSchedule] = useState(false);
  const [showBulkScheduleForm, setShowBulkScheduleForm] = useState(false);

  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  // テンプレートから入力したとき：保存時にメニュー項目（予定）にも入れる
  // 新しいメニューの項目（本文はここから作る）
  const [newItems, setNewItems] = useState<MenuItemDraft[]>([]);
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [showCommentForm, setShowCommentForm] = useState(false);
  // 実施報告・未実施報告を送信中かどうか（二重送信防止）
  const reportSubmitLock = useRef(false);
  // 「◯人/◯人 提出済み」を押すと出る未提出者ポップアップ
  const [showMissingPopup, setShowMissingPopup] = useState(false);
  // 実施報告・未実施報告は名前だけ並べ、押した人の詳細だけ開く
  const [expandedReportIds, setExpandedReportIds] = useState<Set<string>>(
    new Set()
  );
  const [expandedAbsentIds, setExpandedAbsentIds] = useState<Set<string>>(
    new Set()
  );
  const [newMenuType, setNewMenuType] = useState<"normal" | "joint" | "off">(
    "normal"
  );
  const [newOffBothLocations, setNewOffBothLocations] = useState(false);
  const [newJointLocation, setNewJointLocation] = useState<Location>(
    activeLocation
  );
  const [editingMenu, setEditingMenu] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [memberCounts, setMemberCounts] = useState<{
    tama: number;
    otsuka: number;
    all: number;
  }>({ tama: 0, otsuka: 0, all: 0 });
  // 免除期間の人数調整用：練習に参加しうる部員(id・拠点)と、免除期間の一覧
  const [memberRows, setMemberRows] = useState<
    { id: string; home_location: Location | null }[]
  >([]);
  const [boardExemptions, setBoardExemptions] = useState<ExemptionRow[]>([]);
  const [locationRoster, setLocationRoster] = useState<
    { id: string; display_name: string }[]
  >([]);
  const [dayWeightLogs, setDayWeightLogs] = useState<
    {
      author_id: string;
      display_name: string;
      content: string;
      type: TrainingType;
      title: string | null;
    }[]
  >([]);
  const [loadingDayWeightLogs, setLoadingDayWeightLogs] = useState(false);
  const [submissionMap, setSubmissionMap] = useState<
    Record<string, { reportAuthors: Set<string>; respondedAuthors: Set<string> }>
  >({});
  // 「もう一方の拠点」で全体練習として作成されたメニュー（日付→メニュー情報）
  const [jointElsewhere, setJointElsewhere] = useState<
    Map<string, { menuId: string; location: Location }>
  >(new Map());
  const [jointNoticeDate, setJointNoticeDate] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<string>(() => toDateKey(new Date()));
  // 時間割を保存・コピーしたあとに、下の練習スケジュールのカレンダーを再読み込みさせるためのカウンタ
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  useEffect(() => {
    // 練習に参加しうる部員を、コーチ・マネージャー・OBを除いて拠点ごとに集計する
    // （マネージャーは実施報告の提出義務がないため、分母から除外する）
    supabase
      .from("profiles")
      .select("id, home_location")
      .eq("team_id", profile.team_id)
      .not("role", "in", "(coach,manager,ob)")
      .then(({ data }) => {
        const rows = (data ?? []) as {
          id: string;
          home_location: Location | null;
        }[];
        setMemberRows(rows);
        const tama = rows.filter((r) => r.home_location === "tama").length;
        const otsuka = rows.filter((r) => r.home_location === "otsuka").length;
        setMemberCounts({ tama, otsuka, all: rows.length });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 免除期間（直近約3か月前〜1年先）を読み込む。免除中の部員は人数・未提出者から外す
    const from = new Date();
    from.setMonth(from.getMonth() - 3);
    const to = new Date();
    to.setFullYear(to.getFullYear() + 1);
    loadExemptions(
      supabase,
      profile.team_id,
      toDateKey(from),
      toDateKey(to)
    ).then(setBoardExemptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 未提出者ポップアップ用に、拠点の部員一覧は全員分読み込む
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role, home_location")
        .eq("team_id", profile.team_id)
        .eq("home_location", activeLocation)
        .not("role", "in", "(coach,manager,ob)");
      if (!error) {
        setLocationRoster(
          (data ?? []) as { id: string; display_name: string }[]
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoachView, activeLocation]);

  useEffect(() => {
    if (!isCoachView) return;
    (async () => {
      setLoadingDayWeightLogs(true);
      const { data, error } = await supabase
        .from("weight_logs")
        .select(
          "author_id, content, type, title, author:profiles!weight_logs_author_id_fkey(display_name, home_location)"
        )
        .eq("team_id", profile.team_id)
        .eq("date", viewDate);
      if (!error) {
        const rows = (data ?? []) as unknown as {
          author_id: string;
          content: string;
          type: TrainingType;
          title: string | null;
          author: { display_name: string; home_location: Location | null } | null;
        }[];
        setDayWeightLogs(
          rows
            .filter((r) => r.author?.home_location === activeLocation)
            .map((r) => ({
              author_id: r.author_id,
              display_name: r.author?.display_name ?? "不明",
              content: r.content,
              type: r.type,
              title: r.title,
            }))
        );
      }
      setLoadingDayWeightLogs(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoachView, activeLocation, viewDate]);

  useEffect(() => {
    setJointNoticeDate(null);
    (async () => {
      const [rows, jointMap] = await Promise.all([
        loadMenus(),
        loadJointElsewhere(),
      ]);
      const isInitialJump = !usedInitialJump.current && !!initialDate;
      const pendingDate = pendingJumpDateRef.current;
      pendingJumpDateRef.current = null;
      const targetDate = isInitialJump
        ? (initialDate as string)
        : (pendingDate ?? toDateKey(new Date()));
      usedInitialJump.current = true;
      await applySelectionForDate(targetDate, rows, jointMap);
      if (pendingMenuIdRef.current && rows.some((m) => m.id === pendingMenuIdRef.current)) {
        setSelectedId(pendingMenuIdRef.current);
      }
      pendingMenuIdRef.current = null;

      if (isInitialJump) {
        const hasMenu = rows.some((m) => m.date === targetDate);
        if (!hasMenu && canCreateMenu(profile.role)) {
          setNewDate(targetDate);
          setNewStartTime(initialStartTime ?? "");

          // この日が出稽古・合宿で両拠点に反映されている場合は自動で両拠点登録、
          // 通常の全体練習セッションの場合は自動で「全体練習」を選択する
          const { data: dayData } = await supabase
            .from("schedule_days")
            .select(
              "day_type, sessions:schedule_sessions(session_type, is_joint, joint_location)"
            )
            .eq("team_id", profile.team_id)
            .eq("location", activeLocation)
            .eq("date", targetDate)
            .maybeSingle();
          const dayRow = dayData as {
            day_type: DayType;
            sessions: {
              session_type: SessionType;
              is_joint: boolean;
              joint_location: Location | null;
            }[];
          } | null;
          const isAwayLikeDay =
            dayRow?.day_type === "camp" || dayRow?.day_type === "away";
          const matSession = dayRow?.sessions.find(
            (s) => s.session_type === "mat"
          );
          const isRegularJoint = !isAwayLikeDay && !!matSession?.is_joint;
          setNewMenuType(isRegularJoint ? "joint" : "normal");
          setNewJointLocation(matSession?.joint_location ?? activeLocation);
          setNewOffBothLocations(
            isAwayLikeDay ? !!matSession?.is_joint : false
          );

          setShowNewForm(true);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation]);

  useEffect(() => {
    if (selectedId) loadComments(selectedId);
    setShowCommentForm(false);
    setShowMissingPopup(false);
    setExpandedReportIds(new Set());
    setExpandedAbsentIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadViewDateSchedule() {
    const { data } = await supabase
      .from("schedule_days")
      .select(
        "is_off, day_type, event_name, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location, location_note)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", activeLocation)
      .eq("date", viewDate)
      .maybeSingle();
    setViewDateSchedule(
      (data as unknown as typeof viewDateSchedule) ?? null
    );
  }

  useEffect(() => {
    loadViewDateSchedule();
    setEditingViewDateSchedule(false);
    setShowBulkScheduleForm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, activeLocation]);

  // 「＋ メニューを作成」ボタン：閉じている場合は開き、
  // 管理者が設定した時間割にマットのセッションがあれば日付・開始時刻を自動入力する
  async function handleOpenNewForm() {
    setNewItems([]);
    setNewTemplateId(null);
    if (showNewForm) {
      setShowNewForm(false);
      return;
    }
    setConfirmingNew(false);

    // 表示中のstateではなく、クリック時点の最新情報をDBから直接取得して判定する
    const { data: dayData } = await supabase
      .from("schedule_days")
      .select(
        "day_type, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", activeLocation)
      .eq("date", viewDate)
      .maybeSingle();
    const dayRow = dayData as {
      day_type: DayType;
      sessions: {
        session_type: SessionType;
        start_time: string | null;
        is_joint: boolean;
        joint_location: Location | null;
      }[];
    } | null;
    const isAwayLikeDay =
      dayRow?.day_type === "camp" || dayRow?.day_type === "away";
    const matSession = dayRow?.sessions.find((s) => s.session_type === "mat");
    const isRegularJoint = !isAwayLikeDay && !!matSession?.is_joint;

    setNewMenuType(isRegularJoint ? "joint" : "normal");
    setNewOffBothLocations(isAwayLikeDay ? !!matSession?.is_joint : false);
    setNewJointLocation(matSession?.joint_location ?? activeLocation);
    setNewDate(viewDate);
    setNewStartTime(matSession?.start_time ? matSession.start_time.slice(0, 5) : "");

    setShowNewForm(true);
  }

  // 指定した日付の表示状態（メニュー／全体練習案内／未作成）を決めて反映する
  async function loadCrossLocationMenu(
    menuId: string
  ): Promise<MenuRow | null> {
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, location, start_time, is_joint, is_off, created_at, created_by, last_edited_by, last_edited_at, creator:profiles!menus_created_by_fkey(display_name), editor:profiles!menus_last_edited_by_fkey(display_name)"
      )
      .eq("id", menuId)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
      return null;
    }
    return (data as unknown as MenuRow) ?? null;
  }

  async function applySelectionForDate(
    date: string,
    rows: MenuRow[],
    jointMap: Map<string, { menuId: string; location: Location }>
  ) {
    setViewDate(date);
    setEditingMenu(false);
    const dayMenus = rows
      .filter((m) => m.date === date)
      .sort((a, b) => (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99"));
    if (dayMenus.length > 0) {
      setSelectedId(dayMenus[0].id);
      setJointNoticeDate(null);
      setCrossLocationMenu(null);
    } else if (jointMap.has(date)) {
      if (isCoachView) {
        setSelectedId(null);
        setJointNoticeDate(date);
        setCrossLocationMenu(null);
      } else {
        // 部員は別拠点で行われる全体練習のメニューも、自分の拠点の掲示板からそのまま閲覧・報告できるようにする
        setJointNoticeDate(null);
        const info = jointMap.get(date)!;
        const menu = await loadCrossLocationMenu(info.menuId);
        setCrossLocationMenu(menu);
        setSelectedId(menu ? menu.id : null);
      }
    } else {
      setSelectedId(null);
      setJointNoticeDate(null);
      setCrossLocationMenu(null);
    }
  }

  async function loadMenus(): Promise<MenuRow[]> {
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, location, start_time, is_joint, is_off, created_at, created_by, last_edited_by, last_edited_at, creator:profiles!menus_created_by_fkey(display_name), editor:profiles!menus_last_edited_by_fkey(display_name)"
      )
      .eq("location", activeLocation)
      .order("date", { ascending: false });

    let rows: MenuRow[] = [];
    if (error) {
      setErrorMsg(error.message);
    } else {
      rows = (data ?? []) as unknown as MenuRow[];
      setMenus(rows);
      await loadSubmissionSummary(rows.map((r) => r.id));
    }
    return rows;
  }

  // もう一方の拠点で「全体練習」として作成されたメニューを取得する
  async function loadJointElsewhere(): Promise<
    Map<string, { menuId: string; location: Location }>
  > {
    const otherLocation = locations.find((l) => l !== activeLocation)!;
    const { data, error } = await supabase
      .from("menus")
      .select("id, date")
      .eq("team_id", profile.team_id)
      .eq("location", otherLocation)
      .eq("is_joint", true);

    if (error) {
      setErrorMsg(error.message);
      return jointElsewhere;
    }
    const map = new Map<string, { menuId: string; location: Location }>();
    for (const row of (data ?? []) as { id: string; date: string }[]) {
      map.set(row.date, { menuId: row.id, location: otherLocation });
    }
    setJointElsewhere(map);
    return map;
  }

  // メニューごとに「実施報告」「未実施報告」を提出した部員（重複なし）を集計する
  async function loadSubmissionSummary(menuIds: string[]) {
    if (menuIds.length === 0) {
      setSubmissionMap({});
      return;
    }
    const { data, error } = await supabase
      .from("comments")
      .select("menu_id, author_id, kind")
      .in("menu_id", menuIds)
      .in("kind", ["report", "absent"]);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    const map: Record<
      string,
      { reportAuthors: Set<string>; respondedAuthors: Set<string> }
    > = {};
    for (const row of (data ?? []) as {
      menu_id: string;
      author_id: string;
      kind: CommentKind;
    }[]) {
      if (!map[row.menu_id]) {
        map[row.menu_id] = { reportAuthors: new Set(), respondedAuthors: new Set() };
      }
      map[row.menu_id].respondedAuthors.add(row.author_id);
      if (row.kind === "report") {
        map[row.menu_id].reportAuthors.add(row.author_id);
      }
    }
    setSubmissionMap(map);
  }

  async function loadComments(menuId: string) {
    const { data, error } = await supabase
      .from("comments")
      .select(
        "id, text, kind, parent_id, created_at, author_id, alt_type, author:profiles!comments_author_id_fkey(display_name, role)"
      )
      .eq("menu_id", menuId)
      .order("created_at", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
    } else {
      const rows = (data ?? []) as unknown as CommentRow[];
      setComments(rows);
      await reloadReactions(rows);
    }
  }

  async function reloadReactions(rows: CommentRow[] = comments) {
    const ids = rows
      .filter((c) => !c.parent_id && (c.kind === "report" || c.kind === "absent"))
      .map((c) => c.id);
    setReactions(await loadReactions(supabase, ids));
  }

  // 日報はマイページの「日報」から提出する。その日の日報を開いた状態でマイページへ移動する
  function goToDailyReport(date: string) {
    try {
      sessionStorage.setItem("dailyReportDate", date);
    } catch {
      // 保存できなくても、マイページを開くだけにする
    }
    router.push("/mypage");
  }

  // テンプレートの項目を、そのメニューのメニュー項目（予定）として保存する
  async function writePlanItems(menuIds: string[], items: MenuItemDraft[]) {
    for (const id of menuIds) {
      await supabase.from("menu_items").delete().eq("menu_id", id).eq("phase", "plan");
      const rows = items
        .filter((it) => it.name.trim())
        .map((it, i) => ({
          ...toRow(it),
          team_id: profile.team_id,
          menu_id: id,
          phase: "plan",
          sort_order: i,
          created_by: profile.id,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("menu_items").insert(rows);
        if (error) setErrorMsg(`メニュー項目を保存できませんでした：${error.message}`);
      }
    }
  }

  async function handleCreateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate) return;
    const newBody = itemsToText(newItems);
    if (newMenuType !== "off" && !newBody) return;

    const otherLocation = locations.find((l) => l !== activeLocation)!;
    const createdIds: string[] = [];
    const basePayload = {
      team_id: profile.team_id,
      date: newDate,
      created_by: profile.id,
    };

    let error;
    if (newMenuType === "off") {
      const offPayload = {
        ...basePayload,
        title: "オフ",
        content: "",
        start_time: null,
        is_joint: false,
        is_off: true,
      };
      const res = await supabase
        .from("menus")
        .insert({ ...offPayload, location: activeLocation });
      error = res.error;

      if (!error && newOffBothLocations) {
        const res2 = await supabase
          .from("menus")
          .insert({ ...offPayload, location: otherLocation });
        error = res2.error;
      }
    } else {
      // 時間割から自動で用意された「空のメニュー枠」が同じ日・同じ開始時刻にあれば、
      // 新しく作らずにその枠へ書き込む（二重登録を防ぐ）
      const targetLocation =
        newMenuType === "joint" ? newJointLocation : activeLocation;
      let placeholderQuery = supabase
        .from("menus")
        .select("id")
        .eq("team_id", profile.team_id)
        .eq("location", targetLocation)
        .eq("date", newDate)
        .eq("is_off", false)
        .eq("content", "");
      placeholderQuery = newStartTime
        ? placeholderQuery.eq("start_time", newStartTime)
        : placeholderQuery.is("start_time", null);
      const { data: placeholder } = await placeholderQuery
        .limit(1)
        .maybeSingle();
      const res = placeholder
        ? await supabase
            .from("menus")
            .update({
              content: newBody,
              created_by: profile.id,
              last_edited_by: null,
              last_edited_at: null,
            })
            .eq("id", (placeholder as { id: string }).id)
            .select("id")
        : await supabase.from("menus").insert({
        ...basePayload,
        title: "",
        content: newBody,
        location: targetLocation,
        start_time: newStartTime || null,
        is_joint: newMenuType === "joint",
        is_off: false,
      }).select("id");
      error = res.error;
      for (const r of (res.data ?? []) as { id: string }[]) createdIds.push(r.id);

      if (!error && newMenuType === "normal" && newOffBothLocations) {
        const res2 = await supabase.from("menus").insert({
          ...basePayload,
          title: "",
          content: newBody,
          location: otherLocation,
          start_time: newStartTime || null,
          is_joint: false,
          is_off: false,
        }).select("id");
        error = res2.error;
        for (const r of (res2.data ?? []) as { id: string }[]) createdIds.push(r.id);
      }
    }

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (newMenuType !== "off" && createdIds.length > 0) {
      await writePlanItems(createdIds, newItems);
    }
    setNewItems([]);
    setNewTemplateId(null);
    notifyBoardTasksChanged();
    setNewDate("");
    setNewStartTime("");
    setNewMenuType("normal");
    setNewOffBothLocations(false);
    setShowNewForm(false);
    setConfirmingNew(false);
    const [rows, jointMap] = await Promise.all([
      loadMenus(),
      loadJointElsewhere(),
    ]);
    await applySelectionForDate(newDate, rows, jointMap);
  }

  async function handleDeleteMenu(menuId: string) {
    const { error } = await supabase.from("menus").delete().eq("id", menuId);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const dateBefore = viewDate;
    const [rows, jointMap] = await Promise.all([
      loadMenus(),
      loadJointElsewhere(),
    ]);
    await applySelectionForDate(dateBefore, rows, jointMap);
  }

  function startEditingMenu(m: MenuRow) {
    setEditDate(m.date);
    setEditStartTime(m.start_time ?? "");
    setEditingMenu(true);
  }

  // メニュー項目を保存したら、メニュー本文（LINEや昔の画面で使う文章）も項目から作り直す
  async function savePlanBody(m: MenuRow, items: MenuItemDraft[]) {
    const body = itemsToText(items);
    const isFillingPlaceholder = !m.content;
    const { error } = await supabase
      .from("menus")
      .update(
        isFillingPlaceholder
          ? { content: body, created_by: profile.id }
          : { content: body, last_edited_by: profile.id, last_edited_at: new Date().toISOString() }
      )
      .eq("id", m.id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    notifyBoardTasksChanged();
    const rows = await loadMenus();
    await applySelectionForDate(m.date, rows, jointElsewhere);
    setSelectedId(m.id);
  }

  async function handleUpdateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !editDate) return;
    // 自動で用意された空の枠に初めて書き込む場合は「作成」として記録する
    const editingTarget =
      menus.find((m) => m.id === selectedId) ??
      (crossLocationMenu?.id === selectedId ? crossLocationMenu : null);
    const isFillingPlaceholder = !!editingTarget && !editingTarget.content;
    const { error } = await supabase
      .from("menus")
      .update(
        isFillingPlaceholder
          ? {
              date: editDate,
              start_time: editStartTime || null,
              created_by: profile.id,
            }
          : {
              date: editDate,
              start_time: editStartTime || null,
              last_edited_by: profile.id,
              last_edited_at: new Date().toISOString(),
            }
      )
      .eq("id", selectedId);

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    notifyBoardTasksChanged();
    const rows = await loadMenus();
    applySelectionForDate(editDate, rows, jointElsewhere);
  }

  async function submitComment(
    kind: CommentKind,
    text: string,
    parentId: string | null = null,
    altType: string | null = null
  ): Promise<boolean> {
    if (!selectedId || !text.trim()) return false;
    const isReport = (kind === "report" || kind === "absent") && !parentId;
    // 実施報告・未実施報告の二重送信を防ぐ（ボタンの連打・通信の遅れで同じ報告が何件も入らないように）
    if (isReport) {
      if (reportSubmitLock.current) return false;
      reportSubmitLock.current = true;
    }
    try {
      if (isReport) {
        // すでに自分の報告があれば、新しく作らずに表示を更新するだけにする
        const { data: existing } = await supabase
          .from("comments")
          .select("id")
          .eq("menu_id", selectedId)
          .eq("author_id", profile.id)
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
          .limit(1);
        if (existing && existing.length > 0) {
          await loadComments(selectedId);
          return true;
        }
      }
      const { error } = await supabase.from("comments").insert({
        menu_id: selectedId,
        author_id: profile.id,
        kind,
        parent_id: parentId,
        text: text.trim(),
        alt_type: altType,
      });
      if (error) {
        // 23505 = 同じ報告がすでにある（データベース側の重複防止に引っかかった）
        if (error.code !== "23505") {
          setErrorMsg(error.message);
          return false;
        }
      }
      await loadComments(selectedId);
      if (kind === "report" || kind === "absent") {
        await loadSubmissionSummary(menus.map((m) => m.id));
      }
      return true;
    } finally {
      if (isReport) {
        reportSubmitLock.current = false;
      }
    }
  }

  async function handleUpdateComment(
    commentId: string,
    text: string,
    altType: string | null = null
  ) {
    if (!text.trim()) return;
    const { error } = await supabase
      .from("comments")
      .update({ text: text.trim(), alt_type: altType })
      .eq("id", commentId);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (selectedId) await loadComments(selectedId);
  }

  async function handleDeleteComment(commentId: string) {
    const { error } = await supabase
      .from("comments")
      .delete()
      .eq("id", commentId);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (selectedId) await loadComments(selectedId);
    await loadSubmissionSummary(menus.map((m) => m.id));
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    await submitComment("opinion", commentText);
    setCommentText("");
  }

  const selected =
    menus.find((m) => m.id === selectedId) ??
    (crossLocationMenu && crossLocationMenu.id === selectedId
      ? crossLocationMenu
      : null);

  const opinions = comments.filter((c) => c.kind === "opinion" && !c.parent_id);
  const reports = comments.filter((c) => c.kind === "report" && !c.parent_id);
  const absentReports = comments.filter(
    (c) => c.kind === "absent" && !c.parent_id
  );
  // 自分の日報をいちばん上に出す
  const ownFirst = (a: CommentRow, b: CommentRow) =>
    Number(b.author_id === profile.id) - Number(a.author_id === profile.id);
  const visibleReports = reports.slice().sort(ownFirst);
  const visibleAbsentReports = absentReports.slice().sort(ownFirst);
  const reactionCountOf = (id: string) =>
    reactions.filter((r) => r.comment_id === id).length;
  const repliesOf = (id: string) =>
    comments.filter((c) => c.parent_id === id);
  const myReport = reports.find((r) => r.author_id === profile.id) ?? null;
  const myAbsent =
    absentReports.find((c) => c.author_id === profile.id) ?? null;
  const isViewOnly = profile.role === "coach" || profile.role === "manager";
  const reportOpen = selected ? isReportOpen(selected) : false;
  const selectedSubmission = selectedId ? submissionMap[selectedId] : undefined;
  const reportSubmittedCount = selectedSubmission
    ? selectedSubmission.reportAuthors.size
    : 0;
  // そのメニューの対象人数（その日に免除期間中の部員は除く）
  function totalFor(m: { date: string; is_joint: boolean; location: Location }) {
    const base = m.is_joint ? memberCounts.all : memberCounts[m.location];
    const exempt = memberRows.filter(
      (r) =>
        (m.is_joint || r.home_location === m.location) &&
        isExemptOn(boardExemptions, r.id, m.date)
    ).length;
    return Math.max(0, base - exempt);
  }
  const selectedMemberTotal = selected ? totalFor(selected) : 0;

  const boardTasks = useBoardTasks(profile);
  function openTask(t: BoardTask) {
    if (!t.isJoint && t.location !== activeLocation) {
      // 拠点を切り替えて、読み込み終わったらそのメニューを選ぶ
      pendingJumpDateRef.current = t.date;
      pendingMenuIdRef.current = t.menuId;
      setActiveLocation(t.location);
      return;
    }
    if (menus.some((m) => m.id === t.menuId)) {
      selectMenu(t.menuId);
    } else {
      pendingJumpDateRef.current = t.date;
      pendingMenuIdRef.current = t.menuId;
      setActiveLocation(t.location);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectMenu(id: string) {
    const m = menus.find((mm) => mm.id === id);
    if (m) setViewDate(m.date);
    setJointNoticeDate(null);
    setEditingMenu(false);
    setSelectedId(id);
  }

  // 表示中の日付に管理者が設定した「マット」セッションがあれば、その時刻を取得
  const matSessionForViewDate =
    viewDateSchedule && !viewDateSchedule.is_off
      ? viewDateSchedule.sessions.find((s) => s.session_type === "mat")
      : undefined;

  // 表示中の日付が「合宿」または「出稽古」として設定されているか
  const isAwayLikeForViewDate =
    !!viewDateSchedule &&
    !viewDateSchedule.is_off &&
    (viewDateSchedule.day_type === "camp" ||
      viewDateSchedule.day_type === "away");

  const practiceSection = (
    <div ref={practiceSectionRef}>
        {isCoachView && (
          <section className="mb-3 flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                {locationLabel[activeLocation]}・{formatMonthDay(viewDate)}の時間割
                {viewDateSchedule && !viewDateSchedule.is_off && (
                  <span className="ml-1 font-normal text-neutral-500">
                    （{dayTypeLabel[viewDateSchedule.day_type]}
                    {viewDateSchedule.event_name
                      ? `：${viewDateSchedule.event_name}`
                      : ""}
                    ）
                  </span>
                )}
                {viewDateSchedule?.is_off && (
                  <span className="ml-1 font-normal text-neutral-500">
                    （オフ）
                  </span>
                )}
              </p>
              {canEditSchedule && (
              <button
                type="button"
                onClick={() => {
                  setShowBulkScheduleForm(false);
                  setEditingViewDateSchedule((v) => !v);
                }}
                className="shrink-0 text-[length:calc(11px+var(--fs-add))] font-medium text-neutral-700 dark:text-neutral-300 underline"
              >
                {editingViewDateSchedule
                  ? "閉じる"
                  : viewDateSchedule
                    ? "編集する"
                    : "時間割を設定する"}
              </button>
              )}
            </div>
            {canEditSchedule && editingViewDateSchedule && (
              <ScheduleEditForm
                teamId={profile.team_id}
                authorId={profile.id}
                location={activeLocation}
                mode="single"
                date={viewDate}
                existingDay={viewDateSchedule as ScheduleDayPrefill | null}
                onCancel={() => setEditingViewDateSchedule(false)}
                onSaved={async () => {
                  setEditingViewDateSchedule(false);
                  await loadViewDateSchedule();
                  setScheduleRefreshKey((k) => k + 1);
                }}
                onCopied={async () => {
                  await loadViewDateSchedule();
                  setScheduleRefreshKey((k) => k + 1);
                }}
              />
            )}
            {canEditSchedule && (
            <button
              type="button"
              onClick={() => {
                setEditingViewDateSchedule(false);
                setShowBulkScheduleForm((v) => !v);
              }}
              className="self-start text-[length:calc(11px+var(--fs-add))] font-medium text-neutral-600 dark:text-neutral-400 underline"
            >
              {showBulkScheduleForm
                ? "期間まとめて設定を閉じる"
                : "期間でまとめて設定する（オフ・合宿・試合・出稽古）"}
            </button>
            )}
            {canEditSchedule && showBulkScheduleForm && (
              <ScheduleEditForm
                teamId={profile.team_id}
                authorId={profile.id}
                location={activeLocation}
                mode="range"
                date={viewDate}
                onCancel={() => setShowBulkScheduleForm(false)}
                onSaved={async () => {
                  await loadViewDateSchedule();
                  setScheduleRefreshKey((k) => k + 1);
                }}
              />
            )}
          </section>
        )}
        {/* メニュー一覧（横スクロール、スマホ向け） */}
        <div className="flex flex-col gap-2">
          {showNewForm && canCreateMenu(profile.role) && (
            <form
              onSubmit={handleCreateMenu}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3"
            >
              {confirmingNew ? (
                <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-950/40 p-3 text-sm">
                  <p className="text-xs font-semibold text-blue-400">
                    以下の内容で投稿します。よろしいですか？
                  </p>
                  {newMenuType === "off" ? (
                    <p>
                      {newDate}・オフ
                      {newOffBothLocations && "（多摩・大塚とも）"}
                    </p>
                  ) : (
                    <>
                      <p>
                        {locationLabel[activeLocation]}・{newDate}
                        {newStartTime && ` ${newStartTime}〜`}
                        {isAwayLikeForViewDate
                          ? `・${dayTypeLabel[viewDateSchedule!.day_type]}${
                              matSessionForViewDate?.location_note
                                ? `（${matSessionForViewDate.location_note}）`
                                : ""
                            }`
                          : newMenuType === "joint" && "・全体練習"}
                      </p>
                      <p className="whitespace-pre-wrap text-neutral-900 dark:text-neutral-100">
                        {itemsToText(newItems)}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"
                    required
                  />

                  {isAwayLikeForViewDate ? (
                    <p className="rounded-lg bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs font-semibold text-red-700 dark:text-red-400">
                      {dayTypeLabel[viewDateSchedule!.day_type]}
                      {matSessionForViewDate?.location_note
                        ? `（${matSessionForViewDate.location_note}）`
                        : viewDateSchedule!.event_name
                          ? `（${viewDateSchedule!.event_name}）`
                          : ""}
                      ・
                      {matSessionForViewDate?.is_joint
                        ? `このメニューは、全体での${dayTypeLabel[viewDateSchedule!.day_type]}なので両拠点に同じ内容が登録されます`
                        : `このメニューは${locationLabel[activeLocation]}メンバーのみに登録されます`}
                    </p>
                  ) : (
                    <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
                      {(
                        [
                          { v: "normal", label: "通常" },
                          { v: "joint", label: "全体練習" },
                          { v: "off", label: "オフ" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setNewMenuType(opt.v)}
                          className={`flex-1 rounded-md py-2 font-medium ${
                            newMenuType === opt.v
                              ? "bg-red-600 shadow text-white"
                              : "text-neutral-600 dark:text-neutral-400"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {newMenuType === "off" ? (
                    <label className="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                      <input
                        type="checkbox"
                        checked={newOffBothLocations}
                        onChange={(e) =>
                          setNewOffBothLocations(e.target.checked)
                        }
                        className="h-4 w-4"
                      />
                      両拠点同時にオフにする（多摩・大塚とも）
                    </label>
                  ) : (
                    <>
                      <label className="flex flex-col text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                        開始時刻
                        <TimeSelect
                          value={newStartTime}
                          onChange={setNewStartTime}
                        />
                      </label>
                      {newMenuType === "joint" && !isAwayLikeForViewDate && (
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                          開催拠点
                          <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
                            {locations.map((loc) => (
                              <button
                                key={loc}
                                type="button"
                                onClick={() => setNewJointLocation(loc)}
                                className={`flex-1 rounded-md py-2 font-medium ${
                                  newJointLocation === loc
                                    ? "bg-red-600 text-white shadow"
                                    : "text-neutral-600 dark:text-neutral-400"
                                }`}
                              >
                                {locationLabel[loc]}
                              </button>
                            ))}
                          </div>
                        </label>
                      )}
                      <TemplatePicker
                        teamId={profile.team_id}
                        selected={newTemplateId}
                        onPick={(t) => {
                          if (!t) return setNewTemplateId(null);
                          if (newItems.some((i) => i.name.trim()) && !window.confirm("今の項目を、テンプレートの内容に置き換えますか？")) return;
                          setNewTemplateId(t.id);
                          setNewItems(t.items);
                        }}
                      />
                      <MenuItemsEditor
                        items={newItems}
                        onChange={setNewItems}
                        canConfirm={profile.role === "coach"}
                      />
                      {newMenuType === "joint" && !isAwayLikeForViewDate && (
                        <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                          {newJointLocation === activeLocation
                            ? "もう一方の拠点はこの練習に合流します"
                            : `${locationLabel[newJointLocation]}で開催され、${locationLabel[activeLocation]}の部員もこの練習に合流します`}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}

              {confirmingNew ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingNew(false)}
                    className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 py-2.5 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    戻って修正
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white active:bg-blue-700"
                  >
                    この内容で投稿する
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNewForm(false)}
                    className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 py-3 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        newDate &&
                        (newMenuType === "off" || itemsToText(newItems))
                      )
                        setConfirmingNew(true);
                    }}
                    className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-medium text-white active:bg-blue-700"
                  >
                    確認する
                  </button>
                </div>
              )}
            </form>
          )}
        </div>

      {jointNoticeDate && jointElsewhere.get(jointNoticeDate) ? (
          <div className="rounded-lg border border-purple-200 bg-purple-950/40 p-4 text-sm text-purple-800">
            <p className="mb-2">
              {jointNoticeDate}は
              {locationLabel[jointElsewhere.get(jointNoticeDate)!.location]}
              で全体練習です。参加・不参加の報告は
              {locationLabel[jointElsewhere.get(jointNoticeDate)!.location]}
              のページで行ってください。
            </p>
            <button
              onClick={() => {
                const loc = jointElsewhere.get(jointNoticeDate)?.location;
                pendingJumpDateRef.current = jointNoticeDate;
                setJointNoticeDate(null);
                setSelectedId(null);
                if (loc) setActiveLocation(loc);
              }}
              className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-medium text-white active:bg-purple-700"
            >
              {locationLabel[jointElsewhere.get(jointNoticeDate)!.location]}
              のページを開く
            </button>
          </div>
        ) : selected?.is_off ? (
          <section className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 p-4">
            <div className="mb-2 text-xs text-neutral-600 dark:text-neutral-400">
              {locationLabel[selected.location]}・{selected.date}
              ・作成者: {selected.creator?.display_name ?? "不明"}
            </div>
            <p className="mb-3 text-base font-bold text-neutral-800 dark:text-neutral-200">
              {formatMonthDay(selected.date)}はオフです
            </p>
            {canCreateMenu(profile.role) && (
              <button
                onClick={() => handleDeleteMenu(selected.id)}
                className="rounded-lg border border-neutral-400 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                オフを取り消す
              </button>
            )}
          </section>
        ) : selected ? (
          <>
            <section className="rounded-lg border border-border-color bg-surface p-4 text-foreground">
              {editingMenu ? (
                <form onSubmit={handleUpdateMenu} className="flex flex-col gap-2">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100"
                    required
                  />
                  <label className="flex flex-col text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                    開始時刻
                    <TimeSelect
                      value={editStartTime}
                      onChange={setEditStartTime}
                    />
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingMenu(false)}
                      className="flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 py-2.5 text-sm text-neutral-700 dark:text-neutral-300"
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white active:bg-blue-700"
                    >
                      保存する
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {/* 見出しは1行：日付・時刻・拠点。作成者は小さく右に */}
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2">
                    <h2 className="text-base font-bold text-foreground">
                      {selected.title || formatMenuHeading(selected.date, selected.start_time)}
                      <span className="ml-1.5 text-xs font-normal text-neutral-500">
                        {selected.is_joint ? "全体練習" : locationLabel[selected.location]}
                      </span>
                    </h2>
                    {selected.content && (
                      <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">
                        {(selected.editor ?? selected.creator)?.display_name ?? ""}
                        {selected.editor ? "が編集" : selected.creator ? "が作成" : ""}
                      </span>
                    )}
                  </div>
                  {/* メニュー本文（項目）と練習後の実施報告。実施報告のあとは実績だけを出す */}
                  <StructuredMenuCard
                    // メニューを保存し直したら読み込み直す
                    key={`${selected.id}:${selected.last_edited_at ?? ""}:${selected.content.length}`}
                    profile={profile}
                    menuId={selected.id}
                    date={selected.date}
                    startTime={selected.start_time}
                    location={selected.location}
                    isJoint={selected.is_joint}
                    started={isReportOpen(selected)}
                    canEdit={canCreateMenu(profile.role)}
                    canEditPlan={canCreateMenu(profile.role) && selected.location === activeLocation}
                    canConfirm={profile.role === "coach"}
                    legacyContent={selected.content}
                    onPlanSaved={(items) => savePlanBody(selected, items)}
                  />
                  {canCreateMenu(profile.role) &&
                    !isReportOpen(selected) &&
                    selected.location === activeLocation && (
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => startEditingMenu(selected)}
                          className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline"
                        >
                          日付・開始時刻を変える
                        </button>
                      </div>
                    )}
                </>
              )}
            </section>

            {/* 参加予定者・参加者・欠席者 */}
            {selected && !selected.is_off && (
              <ParticipantsPanel
                menuId={selected.id}
                teamId={profile.team_id}
                date={selected.date}
                location={selected.location}
                isJoint={selected.is_joint}
                started={isReportOpen(selected)}
                isStaff={isStaffRole(profile.role)}
                startTime={selected.start_time}
              />
            )}

            {/* 実施報告・未実施報告（日報）。提出はマイページの「日報」から行い、ここは見る・コメント・リアクションの場 */}
            {(
              <>
            {!isViewOnly && selected && (
              <section className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 pt-4">
                {myReport || myAbsent ? (
                  <p className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                    ✓ この練習の日報は提出済みです。修正はマイページの「日報」からできます。
                  </p>
                ) : !reportOpen ? (
                  <p className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-700">
                    まだ時間前です。練習開始予定時刻を過ぎると、マイページの「日報」から提出できます。
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 rounded-lg border border-violet-300 dark:border-violet-800/70 bg-violet-50 dark:bg-violet-950/20 p-3">
                    <p className="text-xs text-neutral-700 dark:text-neutral-300">
                      この練習の日報がまだです。日報はマイページから、トレーニングとまとめて提出します。
                    </p>
                    <button
                      type="button"
                      onClick={() => goToDailyReport(selected.date)}
                      className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
                    >
                      日報を書く（マイページへ）
                    </button>
                  </div>
                )}
              </section>
            )}
              </>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
            <div className="mt-2 mb-1 text-xs text-neutral-500">
              {locationLabel[activeLocation]}・{viewDate}
              {matSessionForViewDate?.start_time &&
                `・${matSessionForViewDate.start_time.slice(0, 5)}〜`}
            </div>
            {matSessionForViewDate ? (
              <div>
                <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
                  このセッションのメニューはまだ作成されていません
                </p>
                {canCreateMenu(profile.role) && (
                  <button
                    onClick={handleOpenNewForm}
                    className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700"
                  >
                    このセッションのメニューを作成する
                  </button>
                )}
              </div>
            ) : viewDateSchedule &&
              !viewDateSchedule.is_off &&
              viewDateSchedule.sessions.length > 0 ? (
              <p className="py-2 text-center text-sm text-neutral-500">
                この日は
                {viewDateSchedule.sessions
                  .map((s) => sessionTypeLabel[s.session_type])
                  .join("・")}
                の予定です。メニュー作成はマット練習がある日のみ対応しています。
              </p>
            ) : (
              <p className="py-2 text-center text-sm text-neutral-500">
                まだスケジュールは作成されていません。
              </p>
            )}
          </div>
        )}
    </div>
  );

  // 拠点タブ（多摩／大塚）はフッター上のサブナビに表示する
  const locationSubNav = useMemo(
    () => (
      <SubTabBar
        items={locationSubTabItems}
        active={activeLocation}
        onChange={setActiveLocation}
      />
    ),
    [activeLocation]
  );
  useSubNav(locationSubNav);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col text-neutral-800 dark:text-neutral-200">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
            {errorMsg}
          </p>
        )}

        {/* 自分のタスク（メニュー未登録・練習後の実施報告がまだ） */}
        {boardTasks.length > 0 && (
          <section className="flex flex-col gap-1.5 rounded-xl border border-red-200 bg-red-50/60 p-3 dark:border-red-900/60 dark:bg-red-950/20">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-red-800 dark:text-red-300">
              やること
              <span className="rounded-full bg-red-600 px-1.5 text-[length:calc(10px+var(--fs-add))] font-bold text-white">
                {boardTasks.length}
              </span>
            </h3>
            {(showAllTasks ? boardTasks : boardTasks.slice(0, 3)).map((t) => {
              const [, mm, dd] = t.date.split("-").map(Number);
              return (
                <button
                  key={`${t.kind}-${t.menuId}`}
                  type="button"
                  onClick={() => openTask(t)}
                  className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-xs active:bg-neutral-100 dark:bg-neutral-900 dark:active:bg-neutral-800"
                >
                  <span className="shrink-0 font-semibold text-neutral-800 dark:text-neutral-200">
                    {mm}/{dd}
                    {t.startTime ? ` ${t.startTime.slice(0, 5)}` : ""}
                  </span>
                  <span className="shrink-0 text-neutral-500">{t.isJoint ? "合同" : locationLabel[t.location]}</span>
                  <span className="flex-1 text-neutral-900 dark:text-neutral-100">
                    {t.kind === "menu" ? "練習メニューがまだ登録されていません" : "練習後の実施報告がまだです"}
                  </span>
                  <span className="text-neutral-400">›</span>
                </button>
              );
            })}
            {boardTasks.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllTasks((v) => !v)}
                className="self-start text-[length:calc(11px+var(--fs-add))] text-red-700 underline dark:text-red-400"
              >
                {showAllTasks ? "閉じる" : `ほか${boardTasks.length - 3}件を表示`}
              </button>
            )}
          </section>
        )}

        {/* 練習スケジュール */}
        <section className="flex flex-col gap-3">
          <MenuCalendar
            menus={menus}
            viewDate={viewDate}
            onSelect={selectMenu}
            jointElsewhere={jointElsewhere}
            onSelectJoint={(date) =>
              applySelectionForDate(date, menus, jointElsewhere)
            }
            onSelectEmpty={(date) =>
              applySelectionForDate(date, menus, jointElsewhere)
            }
            teamId={profile.team_id}
            location={activeLocation}
            refreshKey={scheduleRefreshKey}
          />
        </section>

        {practiceSection}
      </div>

      {showMissingPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setShowMissingPopup(false)}
        >
          <div
            className="relative flex w-full max-w-sm flex-col gap-2 rounded-lg border border-border-color bg-surface p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                未提出者（{locationLabel[activeLocation]}）
              </p>
              <button
                type="button"
                onClick={() => setShowMissingPopup(false)}
                aria-label="閉じる"
                className="flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800/50"
              >
                ✕
              </button>
            </div>
            {(() => {
              const reportedIds = new Set(reports.map((r) => r.author_id));
              const absentIds = new Set(absentReports.map((c) => c.author_id));
              const missing = locationRoster.filter(
                (m) =>
                  !reportedIds.has(m.id) &&
                  !absentIds.has(m.id) &&
                  !(selected && isExemptOn(boardExemptions, m.id, selected.date))
              );
              return missing.length === 0 ? (
                <p className="text-xs text-neutral-500">全員提出済みです。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((m) => (
                    <span
                      key={m.id}
                      className="rounded border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-xs text-red-700 dark:text-red-400"
                    >
                      {m.display_name}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
