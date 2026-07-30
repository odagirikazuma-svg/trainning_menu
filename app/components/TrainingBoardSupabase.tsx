"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  canCreateMenu,
  CommentKind,
  commentKindLabel,
  DayType,
  dayTypeLabel,
  Location,
  locationLabel,
  locations,
  roleLabel,
  SessionType,
  sessionTypeDotColor,
  sessionTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

// ダークテーマ用の合宿/試合/出稽古バッジ配色（types.tsの共有カラーはライト前提のため、ここではローカルに上書きする）
const dayTypeFillColorDark: Record<DayType, string> = {
  practice: "",
  camp: "bg-pink-950/40 text-pink-400",
  match: "bg-red-950/40 text-red-400",
  away: "bg-purple-950/40 text-purple-400",
};

type MenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_joint: boolean;
  is_off: boolean;
  created_at: string;
  created_by: string;
  creator: { display_name: string } | null;
  last_edited_by: string | null;
  last_edited_at: string | null;
  editor: { display_name: string } | null;
};

type CommentRow = {
  id: string;
  text: string;
  kind: CommentKind;
  parent_id: string | null;
  created_at: string;
  author_id: string;
  alt_type: "running" | "weight" | "other" | null;
  author: { display_name: string; role: Profile["role"] } | null;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

export default function TrainingBoardSupabase({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
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
  const [activeLocation, setActiveLocation] =
    useState<Location>(initialLocation);
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);
  const [viewDateSchedule, setViewDateSchedule] = useState<{
    is_off: boolean;
    sessions: {
      session_type: SessionType;
      start_time: string;
      is_joint: boolean;
      joint_location: Location | null;
    }[];
  } | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newContent, setNewContent] = useState("");
  const [commentText, setCommentText] = useState("");
  const [reportText, setReportText] = useState("");
  const [absentReason, setAbsentReason] = useState("");
  const [absentAltType, setAbsentAltType] = useState<
    "running" | "weight" | "other"
  >("running");
  const [absentAlternative, setAbsentAlternative] = useState("");
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
  const [editContent, setEditContent] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [memberCounts, setMemberCounts] = useState<{
    tama: number;
    otsuka: number;
    all: number;
  }>({ tama: 0, otsuka: 0, all: 0 });
  const [submissionMap, setSubmissionMap] = useState<
    Record<string, { reportAuthors: Set<string>; respondedAuthors: Set<string> }>
  >({});
  // 「もう一方の拠点」で全体練習として作成されたメニュー（日付→メニュー情報）
  const [jointElsewhere, setJointElsewhere] = useState<
    Map<string, { menuId: string; location: Location }>
  >(new Map());
  const [jointNoticeDate, setJointNoticeDate] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState<string>(() => toDateKey(new Date()));

  useEffect(() => {
    // 練習に参加しうる部員を、管理者を除いて拠点ごとに集計する
    supabase
      .from("profiles")
      .select("home_location")
      .eq("team_id", profile.team_id)
      .neq("role", "coach")
      .then(({ data }) => {
        const rows = (data ?? []) as { home_location: Location | null }[];
        const tama = rows.filter((r) => r.home_location === "tama").length;
        const otsuka = rows.filter((r) => r.home_location === "otsuka").length;
        setMemberCounts({ tama, otsuka, all: rows.length });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setJointNoticeDate(null);
    (async () => {
      const [rows, jointMap] = await Promise.all([
        loadMenus(),
        loadJointElsewhere(),
      ]);
      const isInitialJump = !usedInitialJump.current && !!initialDate;
      const targetDate = isInitialJump
        ? (initialDate as string)
        : toDateKey(new Date());
      usedInitialJump.current = true;
      applySelectionForDate(targetDate, rows, jointMap);

      if (isInitialJump) {
        const hasMenu = rows.some((m) => m.date === targetDate);
        if (!hasMenu && canCreateMenu(profile.role)) {
          setNewMenuType("normal");
          setNewDate(targetDate);
          setNewStartTime(initialStartTime ?? "");
          setShowNewForm(true);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation]);

  useEffect(() => {
    if (selectedId) loadComments(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("schedule_days")
        .select(
          "is_off, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location)"
        )
        .eq("team_id", profile.team_id)
        .eq("location", activeLocation)
        .eq("date", viewDate)
        .maybeSingle();
      setViewDateSchedule(
        (data as unknown as typeof viewDateSchedule) ?? null
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, activeLocation]);

  // 「＋ メニューを作成」ボタン：閉じている場合は開き、
  // 管理者が設定した時間割にマットのセッションがあれば日付・開始時刻を自動入力する
  function handleOpenNewForm() {
    if (showNewForm) {
      setShowNewForm(false);
      return;
    }
    setConfirmingNew(false);
    setNewMenuType("normal");
    setNewOffBothLocations(false);
    setNewJointLocation(activeLocation);
    setNewDate(viewDate);
    setNewStartTime(
      matSessionForViewDate ? matSessionForViewDate.start_time.slice(0, 5) : ""
    );

    setShowNewForm(true);
  }

  // 指定した日付の表示状態（メニュー／全体練習案内／未作成）を決めて反映する
  function applySelectionForDate(
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
    } else if (jointMap.has(date)) {
      setSelectedId(null);
      setJointNoticeDate(date);
    } else {
      setSelectedId(null);
      setJointNoticeDate(null);
    }
  }

  function shiftDateStr(dateStr: string, delta: number) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return toDateKey(d);
  }

  function goPrevDay() {
    applySelectionForDate(shiftDateStr(viewDate, -1), menus, jointElsewhere);
  }
  function goNextDay() {
    applySelectionForDate(shiftDateStr(viewDate, 1), menus, jointElsewhere);
  }

  async function loadMenus(): Promise<MenuRow[]> {
    setLoadingMenus(true);
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
    setLoadingMenus(false);
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
      setComments((data ?? []) as unknown as CommentRow[]);
    }
  }

  async function handleCreateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate) return;
    if (newMenuType !== "off" && !newContent) return;

    const otherLocation = locations.find((l) => l !== activeLocation)!;
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
      const res = await supabase.from("menus").insert({
        ...basePayload,
        title: "",
        content: newContent,
        location: newMenuType === "joint" ? newJointLocation : activeLocation,
        start_time: newStartTime || null,
        is_joint: newMenuType === "joint",
        is_off: false,
      });
      error = res.error;
    }

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewDate("");
    setNewStartTime("");
    setNewContent("");
    setNewMenuType("normal");
    setNewOffBothLocations(false);
    setShowNewForm(false);
    setConfirmingNew(false);
    const [rows, jointMap] = await Promise.all([
      loadMenus(),
      loadJointElsewhere(),
    ]);
    applySelectionForDate(newDate, rows, jointMap);
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
    applySelectionForDate(dateBefore, rows, jointMap);
  }

  function startEditingMenu(m: MenuRow) {
    setEditDate(m.date);
    setEditStartTime(m.start_time ?? "");
    setEditContent(m.content);
    setEditingMenu(true);
  }

  async function handleUpdateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !editDate || !editContent) return;
    const { error } = await supabase
      .from("menus")
      .update({
        date: editDate,
        start_time: editStartTime || null,
        content: editContent,
        last_edited_by: profile.id,
        last_edited_at: new Date().toISOString(),
      })
      .eq("id", selectedId);

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const rows = await loadMenus();
    applySelectionForDate(editDate, rows, jointElsewhere);
  }

  async function submitComment(
    kind: CommentKind,
    text: string,
    parentId: string | null = null,
    altType: string | null = null
  ) {
    if (!selectedId || !text.trim()) return;
    const { error } = await supabase.from("comments").insert({
      menu_id: selectedId,
      author_id: profile.id,
      kind,
      parent_id: parentId,
      text: text.trim(),
      alt_type: altType,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await loadComments(selectedId);
    if (kind === "report" || kind === "absent") {
      await loadSubmissionSummary(menus.map((m) => m.id));
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

  async function handleAddReport(e: React.FormEvent) {
    e.preventDefault();
    await submitComment("report", reportText);
    setReportText("");
  }

  async function handleAddAbsent(e: React.FormEvent) {
    e.preventDefault();
    if (!absentReason.trim() || !absentAlternative.trim()) return;
    const altTypeLabel =
      absentAltType === "running"
        ? "ランニング"
        : absentAltType === "weight"
        ? "ウェイト"
        : "その他";
    const combined = `理由: ${absentReason.trim()}\n代替メニュー: ${altTypeLabel}\n詳細: ${absentAlternative.trim()}`;
    await submitComment("absent", combined, null, absentAltType);
    setAbsentReason("");
    setAbsentAltType("running");
    setAbsentAlternative("");
  }

  const selected = menus.find((m) => m.id === selectedId) ?? null;
  const chronoMenus = [...menus].sort((a, b) => {
    const aKey = `${a.date}T${a.start_time ?? "00:00"}`;
    const bKey = `${b.date}T${b.start_time ?? "00:00"}`;
    return aKey.localeCompare(bKey);
  });

  const opinions = comments.filter((c) => c.kind === "opinion" && !c.parent_id);
  const reports = comments.filter((c) => c.kind === "report" && !c.parent_id);
  const absentReports = comments.filter(
    (c) => c.kind === "absent" && !c.parent_id
  );
  const repliesOf = (id: string) =>
    comments.filter((c) => c.parent_id === id);
  const myReport = reports.find((r) => r.author_id === profile.id) ?? null;
  const myAbsent =
    absentReports.find((c) => c.author_id === profile.id) ?? null;
  const isCoach = profile.role === "coach";
  const isViewOnly = profile.role === "coach" || profile.role === "manager";
  const reportOpen = selected ? isReportOpen(selected) : false;
  const selectedSubmission = selectedId ? submissionMap[selectedId] : undefined;
  const reportSubmittedCount = selectedSubmission
    ? selectedSubmission.reportAuthors.size
    : 0;
  const selectedMemberTotal = selected
    ? selected.is_joint
      ? memberCounts.all
      : memberCounts[selected.location]
    : 0;

  function selectMenu(id: string) {
    const m = menus.find((mm) => mm.id === id);
    if (m) setViewDate(m.date);
    setJointNoticeDate(null);
    setEditingMenu(false);
    setSelectedId(id);
  }

  function selectJointDate(date: string) {
    setViewDate(date);
    setSelectedId(null);
    setJointNoticeDate(date);
  }

  // 上部カードは「今表示中のメニュー」を中央に、前後(古い/新しい)を左右に表示する
  // もう一方の拠点の全体練習日も、仮想アイテムとして同じ時系列に混ぜる
  type NeighborItem =
    | { kind: "menu"; menu: MenuRow; sortKey: string }
    | { kind: "joint"; date: string; location: Location; sortKey: string };

  const menuItems: NeighborItem[] = chronoMenus.map((m) => ({
    kind: "menu",
    menu: m,
    sortKey: `${m.date}T${m.start_time ?? "00:00"}`,
  }));
  const jointItems: NeighborItem[] = Array.from(jointElsewhere.entries()).map(
    ([date, info]) => ({
      kind: "joint",
      date,
      location: info.location,
      sortKey: `${date}T00:00`,
    })
  );
  const allItems = [...menuItems, ...jointItems].sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey)
  );

  const referenceKey = selected
    ? `${selected.date}T${selected.start_time ?? "00:00"}`
    : jointNoticeDate
    ? `${jointNoticeDate}T00:00`
    : `${viewDate}T12:00`;

  const centerItem: NeighborItem | null = selected
    ? { kind: "menu", menu: selected, sortKey: referenceKey }
    : jointNoticeDate && jointElsewhere.get(jointNoticeDate)
    ? {
        kind: "joint",
        date: jointNoticeDate,
        location: jointElsewhere.get(jointNoticeDate)!.location,
        sortKey: referenceKey,
      }
    : null;

  const prevItem =
    [...allItems].reverse().find((it) => it.sortKey < referenceKey) ?? null;
  const nextItem = allItems.find((it) => it.sortKey > referenceKey) ?? null;

  const neighborCards: { item: NeighborItem; role: "prev" | "current" | "next" }[] =
    [
      ...(prevItem ? [{ item: prevItem, role: "prev" as const }] : []),
      ...(centerItem ? [{ item: centerItem, role: "current" as const }] : []),
      ...(nextItem ? [{ item: nextItem, role: "next" as const }] : []),
    ];

  // 表示中の日付に管理者が設定した「マット」セッションがあれば、その時刻を取得
  const matSessionForViewDate =
    viewDateSchedule && !viewDateSchedule.is_off
      ? viewDateSchedule.sessions.find((s) => s.session_type === "mat")
      : undefined;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          マット練習掲示板
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <span className="hidden sm:inline">
            {profile.display_name}（{roleLabel[profile.role]}）
          </span>
          {profile.role !== "manager" && (
            <button
              onClick={() => router.push("/mypage")}
              className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
            >
              {profile.role === "coach" ? "管理ページ" : "マイページ"}
            </button>
          )}
          <button
            onClick={() => router.push("/team")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            チームページ
          </button>
        </div>
      </header>

      {/* 拠点タブ */}
      <div className="sticky top-[49px] z-10 flex border-b border-neutral-800 bg-neutral-900">
        {locations.map((loc) => (
          <button
            key={loc}
            onClick={() => setActiveLocation(loc)}
            className={`flex-1 py-3 text-sm font-medium transition ${
              activeLocation === loc
                ? "border-b-2 border-red-600 text-red-400"
                : "text-neutral-500"
            }`}
          >
            {locationLabel[loc]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {/* メニュー一覧（横スクロール、スマホ向け） */}
        <div className="flex flex-col gap-2">
          {showNewForm && canCreateMenu(profile.role) && (
            <form
              onSubmit={handleCreateMenu}
              className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
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
                        {newMenuType === "joint" && "・全体練習"}
                      </p>
                      <p className="whitespace-pre-wrap text-neutral-100">
                        {newContent}
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
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                    required
                  />

                  <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
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
                            : "text-neutral-400"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {newMenuType === "off" ? (
                    <label className="flex items-center gap-2 text-sm text-neutral-200">
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
                      <label className="flex flex-col text-[11px] text-neutral-400">
                        開始時刻
                        <TimeSelect
                          value={newStartTime}
                          onChange={setNewStartTime}
                        />
                      </label>
                      {newMenuType === "joint" && (
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                          開催拠点
                          <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
                            {locations.map((loc) => (
                              <button
                                key={loc}
                                type="button"
                                onClick={() => setNewJointLocation(loc)}
                                className={`flex-1 rounded-md py-2 font-medium ${
                                  newJointLocation === loc
                                    ? "bg-red-600 text-white shadow"
                                    : "text-neutral-400"
                                }`}
                              >
                                {locationLabel[loc]}
                              </button>
                            ))}
                          </div>
                        </label>
                      )}
                      <textarea
                        placeholder="メニュー詳細（自由記述）"
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        rows={4}
                        className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                        required
                      />
                      {newMenuType === "joint" && (
                        <p className="text-[11px] text-neutral-400">
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
                    className="flex-1 rounded-lg border border-neutral-700 py-2.5 text-sm text-neutral-300"
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
                    className="flex-1 rounded-lg border border-neutral-700 py-3 text-sm text-neutral-300"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        newDate &&
                        (newMenuType === "off" || newContent)
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

          {loadingMenus ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : neighborCards.length === 0 ? (
            <p className="text-xs text-neutral-500">
              {locationLabel[activeLocation]}のメニューはまだありません。下のカレンダーから作成・確認できます。
            </p>
          ) : (
            <div
              className={`grid gap-2 ${
                neighborCards.length === 1
                  ? "grid-cols-1"
                  : neighborCards.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-3"
              }`}
            >
              {neighborCards.map(({ item, role }) => {
                const isCurrent = role === "current";
                const key =
                  item.kind === "menu" ? item.menu.id : `joint-${item.date}`;

                if (item.kind === "joint") {
                  return (
                    <div
                      key={key}
                      className={`relative flex min-w-0 flex-col rounded-lg border px-2 py-2 text-left text-xs ${
                        isCurrent
                          ? "border-purple-600 bg-purple-950/40 font-semibold text-purple-700 shadow-sm"
                          : "border-neutral-800 bg-neutral-900 text-neutral-500"
                      }`}
                    >
                      <span
                        className={`truncate text-[10px] ${
                          isCurrent ? "text-purple-400" : "text-neutral-600"
                        }`}
                      >
                        {item.date.slice(5)}
                      </span>
                      <span className="truncate">
                        全体練習（{locationLabel[item.location]}）
                      </span>
                    </div>
                  );
                }

                const m = item.menu;
                const executed = !m.is_off && isReportOpen(m);
                const total = m.is_joint
                  ? memberCounts.all
                  : memberCounts[m.location];
                const responded =
                  submissionMap[m.id]?.respondedAuthors.size ?? 0;
                const unsubmitted = executed && !m.is_off && responded < total;
                return (
                  <div
                    key={key}
                    className={`relative flex min-w-0 flex-col rounded-lg border px-2 py-2 text-left text-xs ${
                      isCurrent
                        ? "border-blue-600 bg-blue-950/40 font-semibold text-blue-400 shadow-sm"
                        : "border-neutral-800 bg-neutral-900 text-neutral-500"
                    }`}
                  >
                    <span
                      className={`truncate text-[10px] ${
                        isCurrent ? "text-neutral-500" : "text-neutral-600"
                      }`}
                    >
                      {m.date.slice(5)}
                      {m.start_time ? ` ${m.start_time.slice(0, 5)}〜` : ""}
                    </span>
                    <span className="truncate">
                      {m.title || formatFullDateTime(m.date, m.start_time)}
                    </span>
                    {executed && (
                      <span
                        className={`mt-1 inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          !isCurrent
                            ? "bg-neutral-800 text-neutral-500"
                            : unsubmitted
                            ? "bg-red-100 text-red-400"
                            : "bg-neutral-800 text-neutral-400"
                        }`}
                      >
                        {unsubmitted ? "実施済み・未提出あり" : "実施済み"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {jointNoticeDate && jointElsewhere.get(jointNoticeDate) ? (
          <div className="rounded-lg border border-purple-200 bg-purple-950/40 p-4 text-sm text-purple-800">
            <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
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
          <section className="rounded-lg border border-neutral-700 bg-neutral-800 p-4">
            <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
            <div className="mb-2 text-xs text-neutral-400">
              {locationLabel[selected.location]}・{selected.date}
              ・作成者: {selected.creator?.display_name ?? "不明"}
            </div>
            <p className="mb-3 text-base font-bold text-neutral-200">
              {formatMonthDay(selected.date)}はオフです
            </p>
            {canCreateMenu(profile.role) && (
              <button
                onClick={() => handleDeleteMenu(selected.id)}
                className="rounded-lg border border-neutral-400 px-3 py-2 text-xs text-neutral-300 active:bg-neutral-800"
              >
                オフを取り消す
              </button>
            )}
          </section>
        ) : selected ? (
          <>
            <section className="rounded-lg border border-neutral-800 p-4">
              <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
              {editingMenu ? (
                <form onSubmit={handleUpdateMenu} className="flex flex-col gap-2">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                    required
                  />
                  <label className="flex flex-col text-[11px] text-neutral-400">
                    開始時刻
                    <TimeSelect
                      value={editStartTime}
                      onChange={setEditStartTime}
                    />
                  </label>
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingMenu(false)}
                      className="flex-1 rounded-lg border border-neutral-700 py-2.5 text-sm text-neutral-300"
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
                  <div className="mb-1 text-xs text-neutral-500">
                    {locationLabel[selected.location]}・{selected.date}
                    {selected.start_time &&
                      `・${selected.start_time.slice(0, 5)}〜`}
                    ・作成者: {selected.creator?.display_name ?? "不明"}
                    {selected.editor && (
                      <>（編集: {selected.editor.display_name}）</>
                    )}
                  </div>
                  <h2 className="mb-2 text-lg font-bold">
                    {selected.title ||
                      formatFullDateTime(selected.date, selected.start_time)}
                  </h2>
                  <p className="whitespace-pre-wrap text-sm text-neutral-100">
                    {selected.content}
                  </p>
                  {canCreateMenu(profile.role) &&
                    !isReportOpen(selected) && (
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => startEditingMenu(selected)}
                          className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
                        >
                          編集する
                        </button>
                      </div>
                    )}
                </>
              )}
            </section>

            {/* 意見・コメント */}
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-neutral-400">
                意見・コメント
              </h3>
              <ul className="flex flex-col gap-2">
                {opinions.length === 0 && (
                  <li className="text-xs text-neutral-500">
                    まだコメントはありません。
                  </li>
                )}
                {opinions.map((c) => (
                  <CommentItem key={c.id} c={c} />
                ))}
              </ul>
              <form onSubmit={handleAddComment} className="flex flex-col gap-2">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="意見・コメントを入力"
                  rows={3}
                  className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                />
                <button
                  type="submit"
                  className="self-start rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white active:bg-red-700"
                >
                  コメントする
                </button>
              </form>
            </section>

            {/* 実施報告 */}
            <section className="flex flex-col gap-3 border-t border-neutral-800 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-neutral-400">
                  実施報告
                </h3>
                <span className="text-[11px] text-neutral-500">
                  {`${reportSubmittedCount}人 / ${selectedMemberTotal}人 提出済み`}
                </span>
              </div>
              <ul className="flex flex-col gap-3">
                {reports.length === 0 && (
                  <li className="text-xs text-neutral-500">
                    まだ実施報告はありません。
                  </li>
                )}
                {reports.map((r) => (
                  <ReportThread
                    key={r.id}
                    report={r}
                    replies={repliesOf(r.id)}
                    onReply={(text) => submitComment("opinion", text, r.id)}
                    currentUserId={profile.id}
                    onUpdate={(text) => handleUpdateComment(r.id, text)}
                    onDelete={() => handleDeleteComment(r.id)}
                  />
                ))}
              </ul>

              {isViewOnly ? (
                <div className="rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">
                  <p className="mb-1.5 font-semibold text-neutral-400">
                    実施報告を提出したメンバー
                  </p>
                  {reports.length === 0 ? (
                    <p className="text-neutral-500">まだいません</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {reports.map((r) => (
                        <span
                          key={r.id}
                          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1"
                        >
                          {r.author?.display_name ?? "不明"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : myReport ? (
                <p className="rounded-lg bg-emerald-950/40 p-3 text-xs text-emerald-400">
                  実施報告は提出済みです。内容の修正・削除は上の報告欄から行えます。
                </p>
              ) : myAbsent ? (
                <p className="rounded-lg bg-neutral-800 p-3 text-xs text-neutral-300">
                  未実施報告をすでに提出済みです。実施報告と未実施報告はどちらか一方のみ提出できます。
                </p>
              ) : reportOpen ? (
                <form onSubmit={handleAddReport} className="flex flex-col gap-2">
                  <textarea
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                    placeholder="今日の練習を振り返って、感想や気づきを書いてください"
                    rows={3}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                  />
                  <button
                    type="submit"
                    className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
                  >
                    実施報告を提出する
                  </button>
                </form>
              ) : (
                <p className="rounded-lg bg-amber-950/40 p-3 text-xs text-amber-700">
                  まだ時間前です。練習開始予定時刻を過ぎると報告できるようになります。
                </p>
              )}
            </section>

            {/* 未実施報告 */}
            <section className="flex flex-col gap-3 border-t border-neutral-800 pt-4">
              <h3 className="text-xs font-semibold text-neutral-400">
                未実施報告（授業・通院などで参加できなかった場合）
              </h3>
              <ul className="flex flex-col gap-2">
                {absentReports.length === 0 && (
                  <li className="text-xs text-neutral-500">
                    まだ未実施報告はありません。
                  </li>
                )}
                {absentReports.map((c) => (
                  <ReportThread
                    key={c.id}
                    report={c}
                    replies={repliesOf(c.id)}
                    onReply={(text) => submitComment("opinion", text, c.id)}
                    tone="neutral"
                    currentUserId={profile.id}
                    editableAltType
                    onUpdate={(text, altType) =>
                      handleUpdateComment(c.id, text, altType ?? null)
                    }
                    onDelete={() => handleDeleteComment(c.id)}
                  />
                ))}
              </ul>
              {isViewOnly ? (
                <div className="rounded-lg bg-neutral-900 p-3 text-xs text-neutral-300">
                  <p className="mb-1.5 font-semibold text-neutral-400">
                    未実施報告を提出したメンバー
                  </p>
                  {absentReports.length === 0 ? (
                    <p className="text-neutral-500">まだいません</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {absentReports.map((c) => (
                        <span
                          key={c.id}
                          className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1"
                        >
                          {c.author?.display_name ?? "不明"}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : myAbsent ? (
                <p className="rounded-lg bg-neutral-800 p-3 text-xs text-neutral-300">
                  未実施報告は提出済みです。内容の修正・削除は上の報告欄から行えます。
                </p>
              ) : myReport ? (
                <p className="rounded-lg bg-emerald-950/40 p-3 text-xs text-emerald-400">
                  実施報告をすでに提出済みです。実施報告と未実施報告はどちらか一方のみ提出できます。
                </p>
              ) : (
              <form onSubmit={handleAddAbsent} className="flex flex-col gap-2">
                <label className="flex flex-col text-[11px] text-neutral-400">
                  未実施の理由
                  <input
                    type="text"
                    value={absentReason}
                    onChange={(e) => setAbsentReason(e.target.value)}
                    placeholder="例：授業・病院・出稽古など"
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-400">
                  代替メニュー
                  <select
                    value={absentAltType}
                    onChange={(e) =>
                      setAbsentAltType(
                        e.target.value as "running" | "weight" | "other"
                      )
                    }
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                  >
                    <option value="running">ランニング</option>
                    <option value="weight">ウェイト</option>
                    <option value="other">その他</option>
                  </select>
                </label>
                <label className="flex flex-col text-[11px] text-neutral-400">
                  詳細
                  <textarea
                    value={absentAlternative}
                    onChange={(e) => setAbsentAlternative(e.target.value)}
                    placeholder={
                      "例：\n〇スナッチ\n　50㎏×7、6、5\n　60kg×4、3\n　70kg×1、1\n〇BP\n　100kg ×10、8、6\n　80kg×7、5\n〇荷重懸垂\n　20kg×10、7、5\n　10kg×8、5\n　0㎏×13\n〇DL\n　120kg×13、10、9\n　140kg×6、5、3"
                    }
                    rows={8}
                    className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
                  />
                </label>
                <button
                  type="submit"
                  className="self-start rounded-lg bg-neutral-600 px-4 py-2.5 text-sm font-medium text-white active:bg-neutral-700"
                >
                  未実施報告を提出する
                </button>
              </form>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-neutral-800 p-4">
            <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
            <div className="mt-2 mb-1 text-xs text-neutral-500">
              {locationLabel[activeLocation]}・{viewDate}
              {matSessionForViewDate &&
                `・${matSessionForViewDate.start_time.slice(0, 5)}〜`}
            </div>
            {matSessionForViewDate ? (
              <div>
                <p className="mb-3 text-sm text-neutral-400">
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
            ) : (
              <p className="py-2 text-center text-sm text-neutral-500">
                まだスケジュールは作成されていません。
              </p>
            )}
          </div>
        )}

        {/* すべてのメニューを見るカレンダー */}
        <section className="flex flex-col gap-3 border-t border-neutral-800 pt-4">
          <h3 className="text-xs font-semibold text-neutral-400">
            カレンダーからメニューを探す
          </h3>
          <MenuCalendar
            menus={menus}
            viewDate={viewDate}
            onSelect={selectMenu}
            submissionMap={submissionMap}
            memberCounts={memberCounts}
            jointElsewhere={jointElsewhere}
            onSelectJoint={selectJointDate}
            onSelectEmpty={(date) =>
              applySelectionForDate(date, menus, jointElsewhere)
            }
            teamId={profile.team_id}
            location={activeLocation}
          />
        </section>

        {profile.role === "manager" && (
          <div className="border-t border-neutral-800 pt-4">
            <button
              onClick={signOut}
              className="w-full rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-800"
            >
              ログアウト
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CommentItem({ c }: { c: CommentRow }) {
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <CommentMeta c={c} />
      <p className="whitespace-pre-wrap text-sm text-neutral-100">{c.text}</p>
    </li>
  );
}

function CommentMeta({ c }: { c: CommentRow }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
      <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-medium text-neutral-300">
        {c.author ? roleLabel[c.author.role] : "?"}
      </span>
      <span>{c.author?.display_name ?? "不明"}</span>
      <span>{formatDateTime(c.created_at)}</span>
    </div>
  );
}

function ReportThread({
  report,
  replies,
  onReply,
  tone = "emerald",
  currentUserId,
  editableAltType = false,
  onUpdate,
  onDelete,
}: {
  report: CommentRow;
  replies: CommentRow[];
  onReply: (text: string) => Promise<void>;
  tone?: "emerald" | "neutral";
  currentUserId?: string;
  editableAltType?: boolean;
  onUpdate?: (text: string, altType?: string | null) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [replyText, setReplyText] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(report.text);
  const [editAltType, setEditAltType] = useState(report.alt_type ?? "running");
  const [saving, setSaving] = useState(false);

  const isOwn = currentUserId != null && report.author_id === currentUserId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    await onReply(replyText);
    setReplyText("");
    setShowReplyForm(false);
  }

  async function handleSaveEdit() {
    if (!editText.trim() || !onUpdate) return;
    setSaving(true);
    await onUpdate(editText, editableAltType ? editAltType : undefined);
    setSaving(false);
    setIsEditing(false);
  }

  async function handleDeleteClick() {
    if (!onDelete) return;
    if (!window.confirm("この報告を削除しますか？削除すると元に戻せません。")) {
      return;
    }
    await onDelete();
  }

  const colors =
    tone === "emerald"
      ? {
          border: "border-emerald-900/60",
          bg: "bg-emerald-950/40",
          tag: "bg-emerald-600 text-white",
          replyBorder: "border-emerald-900/60",
          link: "text-emerald-400 active:text-emerald-300",
        }
      : {
          border: "border-neutral-700",
          bg: "bg-neutral-800",
          tag: "bg-neutral-600 text-white",
          replyBorder: "border-neutral-700",
          link: "text-neutral-200 active:text-white",
        };

  return (
    <li className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
          <span className={`rounded px-1.5 py-0.5 font-medium ${colors.tag}`}>
            {commentKindLabel[report.kind]}
          </span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-medium text-neutral-300">
            {report.author ? roleLabel[report.author.role] : "?"}
          </span>
          <span>{report.author?.display_name ?? "不明"}</span>
          <span>{formatDateTime(report.created_at)}</span>
        </div>
        {isOwn && !isEditing && (
          <div className="flex items-center gap-2 text-[11px]">
            <button
              onClick={() => {
                setEditText(report.text);
                setEditAltType(report.alt_type ?? "running");
                setIsEditing(true);
              }}
              className={`font-medium ${colors.link}`}
            >
              編集
            </button>
            <button
              onClick={handleDeleteClick}
              className="font-medium text-red-400 active:text-red-800"
            >
              削除
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          {editableAltType && (
            <label className="flex flex-col text-[11px] text-neutral-400">
              代替メニュー
              <select
                value={editAltType}
                onChange={(e) =>
                  setEditAltType(
                    e.target.value as "running" | "weight" | "other"
                  )
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
              >
                <option value="running">ランニング</option>
                <option value="weight">ウェイト</option>
                <option value="other">その他</option>
              </select>
            </label>
          )}
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={5}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={saving}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              保存する
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-neutral-100">
          {report.text}
        </p>
      )}

      {replies.length > 0 && (
        <ul className={`mt-3 flex flex-col gap-2 border-l-2 ${colors.replyBorder} pl-3`}>
          {replies.map((r) => (
            <li key={r.id} className="rounded-lg bg-neutral-900 p-2.5">
              <CommentMeta c={r} />
              <p className="whitespace-pre-wrap text-sm text-neutral-100">
                {r.text}
              </p>
            </li>
          ))}
        </ul>
      )}

      {showReplyForm ? (
        <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="この報告にコメントする"
            rows={2}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700"
            >
              送信
            </button>
            <button
              type="button"
              onClick={() => setShowReplyForm(false)}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-300"
            >
              閉じる
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowReplyForm(true)}
          className={`mt-2 text-xs font-medium ${colors.link}`}
        >
          ＋ コメントする
        </button>
      )}
    </li>
  );
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function MenuCalendar({
  menus,
  viewDate,
  onSelect,
  submissionMap,
  memberCounts,
  jointElsewhere,
  onSelectJoint,
  onSelectEmpty,
  teamId,
  location,
}: {
  menus: MenuRow[];
  viewDate: string;
  onSelect: (id: string) => void;
  submissionMap: Record<
    string,
    { reportAuthors: Set<string>; respondedAuthors: Set<string> }
  >;
  memberCounts: { tama: number; otsuka: number; all: number };
  jointElsewhere: Map<string, { menuId: string; location: Location }>;
  onSelectJoint: (date: string) => void;
  onSelectEmpty: (date: string) => void;
  teamId: string;
  location: Location;
}) {
  const supabase = createClient();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  // 上部の◀▶で日付を移動して月をまたいだ場合、下のカレンダーの表示月も追従させる
  useEffect(() => {
    const [y, m] = viewDate.split("-").map(Number);
    if (y !== cursor.getFullYear() || m - 1 !== cursor.getMonth()) {
      setCursor(new Date(y, m - 1, 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate]);

  const [scheduleByDate, setScheduleByDate] = useState<
    Map<
      string,
      {
        is_off: boolean;
        day_type: DayType;
        event_name: string | null;
        sessions: {
          session_type: SessionType;
          start_time: string;
          is_joint: boolean;
          joint_location: Location | null;
          location_note: string | null;
        }[];
      }
    >
  >(new Map());

  useEffect(() => {
    (async () => {
      const year = cursor.getFullYear();
      const month = cursor.getMonth();
      const rangeStart = toDateKey(new Date(year, month, 1));
      const rangeEnd = toDateKey(new Date(year, month + 1, 0));

      const { data } = await supabase
        .from("schedule_days")
        .select(
          "date, is_off, day_type, event_name, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location, location_note)"
        )
        .eq("team_id", teamId)
        .eq("location", location)
        .gte("date", rangeStart)
        .lte("date", rangeEnd);

      const map = new Map<
        string,
        {
          is_off: boolean;
          day_type: DayType;
        event_name: string | null;
          sessions: {
            session_type: SessionType;
            start_time: string;
            is_joint: boolean;
            joint_location: Location | null;
            location_note: string | null;
          }[];
        }
      >();
      for (const row of (data ?? []) as unknown as {
        date: string;
        is_off: boolean;
        day_type: DayType;
        event_name: string | null;
        sessions: {
          session_type: SessionType;
          start_time: string;
          is_joint: boolean;
          joint_location: Location | null;
          location_note: string | null;
        }[];
      }[]) {
        map.set(row.date, {
          is_off: row.is_off,
          day_type: row.day_type,
          event_name: row.event_name,
          sessions: row.sessions,
        });
      }
      setScheduleByDate(map);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, location]);

  const menusByDate = new Map<string, MenuRow[]>();
  for (const m of menus) {
    const list = menusByDate.get(m.date) ?? [];
    list.push(m);
    menusByDate.set(m.date, list);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay(); // 0=日
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const todayKey = toDateKey(new Date());

  // その日のメニューのうち、対象部員が実施報告or未実施報告を提出しきっていないか判定
  // （過去の日付のみ対象。今日・未来はまだ提出期間中なので対象外）
  function isIncomplete(dayMenus: MenuRow[]): boolean {
    return dayMenus.some((m) => {
      if (m.is_off) return false;
      const total = m.is_joint ? memberCounts.all : memberCounts[m.location];
      const respondedCount = submissionMap[m.id]?.respondedAuthors.size ?? 0;
      return respondedCount < total;
    });
  }

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-400 active:bg-neutral-800"
        >
          ＜
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
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
          const dayMenus = menusByDate.get(key) ?? [];
          const hasMenu = dayMenus.length > 0;
          const isOff = dayMenus.some((m) => m.is_off);
          const jointInfo = !hasMenu ? jointElsewhere.get(key) : undefined;
          const schedule = scheduleByDate.get(key);
          const isToday = key === todayKey;
          const isViewDate = key === viewDate;
          const isPast = key < todayKey;
          const incomplete = hasMenu && isPast && isIncomplete(dayMenus);
          const weekday = date.getDay();
          return (
            <button
              key={i}
              onClick={() => {
                if (hasMenu) onSelect(dayMenus[0].id);
                else if (jointInfo) onSelectJoint(key);
                else onSelectEmpty(key);
              }}
              className={`relative flex min-h-[56px] flex-col items-center justify-start gap-0.5 rounded-lg border border-neutral-700 pt-1 text-xs ${
                isViewDate && hasMenu
                  ? "bg-blue-600 font-semibold text-white"
                  : isOff || schedule?.is_off
                    ? "bg-neutral-800 font-medium text-neutral-400 active:bg-neutral-700"
                    : schedule?.day_type === "camp"
                      ? "bg-pink-950/40 font-medium text-pink-400 active:bg-pink-900/40"
                      : schedule?.day_type === "match"
                        ? "bg-red-950/40 font-medium text-red-400 active:bg-red-900/40"
                        : hasMenu
                          ? "bg-blue-950/40 font-medium text-blue-400 active:bg-blue-900/40"
                          : jointInfo
                            ? "bg-purple-950/40 font-medium text-purple-400 active:bg-purple-900/40"
                            : "bg-neutral-800 text-neutral-300 active:bg-neutral-700"
              } ${isViewDate ? "ring-2 ring-blue-500" : ""}`}
            >
              <span
                className={
                  !isViewDate && !hasMenu && !isOff && !schedule?.is_off
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
              {isToday && (
                <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
              )}
              {incomplete && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
              {schedule &&
                !schedule.is_off &&
                (schedule.day_type === "camp" ||
                  schedule.day_type === "match" ||
                  schedule.day_type === "away") && (
                  <span
                    className={`max-w-full truncate rounded px-1 text-[8px] font-semibold ${dayTypeFillColorDark[schedule.day_type]}`}
                  >
                    {schedule.event_name || dayTypeLabel[schedule.day_type]}
                  </span>
                )}
              {schedule &&
                !schedule.is_off &&
                schedule.sessions.length > 0 && (
                  <span className="flex flex-col items-center gap-0.5 px-0.5">
                    {[...schedule.sessions]
                      .sort((a, b) => a.start_time.localeCompare(b.start_time))
                      .map((s, idx) => (
                        <span
                          key={idx}
                          className="flex items-center gap-0.5 text-[8px] leading-none text-neutral-400"
                        >
                          <span
                            className={`inline-block h-1 w-1 shrink-0 rounded-full ${sessionTypeDotColor[s.session_type]}`}
                          />
                          {sessionTypeLabel[s.session_type]}
                          {s.start_time.slice(0, 5)}
                          {s.location_note
                            ? `(${s.location_note})`
                            : s.is_joint &&
                              (s.joint_location &&
                              s.joint_location !== location
                                ? `(${locationLabel[s.joint_location]})`
                                : "(全体)")}
                        </span>
                      ))}
                  </span>
                )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
          今日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded ring-2 ring-blue-500" />
          表示中の日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
          未提出の部員がいる日
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-purple-950/40" />
          全体練習（別拠点）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-neutral-800" />
          オフ
        </span>
      </p>
    </div>
  );
}

// 10分刻みのプルダウンで時刻を選ぶ（ブラウザ標準のtime inputはstep指定が
// 効かない場合があるため、hour/minuteそれぞれをselectで選ばせる方式にしている）
function TimeSelect({
  value,
  onChange,
}: {
  value: string; // "HH:MM" or ""
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value ? value.split(":") : ["", ""];
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "10", "20", "30", "40", "50"];

  function update(nextHour: string, nextMinute: string) {
    if (!nextHour || !nextMinute) {
      onChange("");
      return;
    }
    onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <div className="flex gap-2">
      <select
        value={hour}
        onChange={(e) => update(e.target.value, minute || "00")}
        className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2.5 text-sm text-neutral-100"
      >
        <option value="">--</option>
        {hours.map((h) => (
          <option key={h} value={h}>
            {h}時
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => update(hour || "00", e.target.value)}
        className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2.5 text-sm text-neutral-100"
      >
        <option value="">--</option>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </div>
  );
}

function MenuNavBar({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <button
        onClick={onPrev}
        className="rounded px-2 py-1 text-sm text-neutral-400 active:bg-neutral-800"
      >
        ◀
      </button>
      <button
        onClick={onNext}
        className="rounded px-2 py-1 text-sm text-neutral-400 active:bg-neutral-800"
      >
        ▶
      </button>
    </div>
  );
}
