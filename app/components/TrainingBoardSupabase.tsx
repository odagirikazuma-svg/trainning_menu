"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  canCreateMenu,
  CommentKind,
  commentKindLabel,
  Location,
  locationLabel,
  locations,
  roleLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";

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
  const [activeLocation, setActiveLocation] = useState<Location>("tama");
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);

  const [showNewForm, setShowNewForm] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [commentText, setCommentText] = useState("");
  const [reportText, setReportText] = useState("");
  const [absentReason, setAbsentReason] = useState("");
  const [absentAlternative, setAbsentAlternative] = useState("");
  const [newMenuType, setNewMenuType] = useState<"normal" | "joint" | "off">(
    "normal"
  );
  const [newOffBothLocations, setNewOffBothLocations] = useState(false);
  const [editingMenu, setEditingMenu] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editTitle, setEditTitle] = useState("");
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
    // 練習に参加しうる部員を、コーチを除いて拠点ごとに集計する
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
    (async () => {
      const [rows, jointMap] = await Promise.all([
        loadMenus(),
        loadJointElsewhere(),
      ]);
      const todayStr = toDateKey(new Date());
      applySelectionForDate(todayStr, rows, jointMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation]);

  useEffect(() => {
    if (selectedId) loadComments(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
        "id, text, kind, parent_id, created_at, author_id, author:profiles!comments_author_id_fkey(display_name, role)"
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
    if (newMenuType !== "off" && (!newTitle || !newContent)) return;

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
        title: newTitle,
        content: newContent,
        location: activeLocation,
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
    setNewTitle("");
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
    setEditTitle(m.title);
    setEditContent(m.content);
    setEditingMenu(true);
  }

  async function handleUpdateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !editDate || !editTitle || !editContent) return;
    const { error } = await supabase
      .from("menus")
      .update({
        date: editDate,
        start_time: editStartTime || null,
        title: editTitle,
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
    parentId: string | null = null
  ) {
    if (!selectedId || !text.trim()) return;
    const { error } = await supabase.from("comments").insert({
      menu_id: selectedId,
      author_id: profile.id,
      kind,
      parent_id: parentId,
      text: text.trim(),
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
    const combined = `理由: ${absentReason.trim()}\n代替メニュー: ${absentAlternative.trim()}`;
    await submitComment("absent", combined);
    setAbsentReason("");
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
  const referenceKey = selected
    ? `${selected.date}T${selected.start_time ?? "00:00"}`
    : `${viewDate}T12:00`;
  const prevCard =
    [...chronoMenus]
      .reverse()
      .find(
        (m) => `${m.date}T${m.start_time ?? "00:00"}` < referenceKey
      ) ?? null;
  const nextCard =
    chronoMenus.find(
      (m) => `${m.date}T${m.start_time ?? "00:00"}` > referenceKey
    ) ?? null;
  const neighborCards: { menu: MenuRow; role: "prev" | "current" | "next" }[] =
    [
      ...(prevCard ? [{ menu: prevCard, role: "prev" as const }] : []),
      ...(selected ? [{ menu: selected, role: "current" as const }] : []),
      ...(nextCard ? [{ menu: nextCard, role: "next" as const }] : []),
    ];

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-3 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">マット練習掲示板</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span className="hidden sm:inline">
            {profile.display_name}（{roleLabel[profile.role]}）
          </span>
          <button
            onClick={signOut}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* 拠点タブ */}
      <div className="sticky top-[49px] z-10 flex border-b border-neutral-200 bg-white">
        {locations.map((loc) => (
          <button
            key={loc}
            onClick={() => setActiveLocation(loc)}
            className={`flex-1 py-3 text-sm font-medium transition ${
              activeLocation === loc
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-neutral-400"
            }`}
          >
            {locationLabel[loc]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 p-3 sm:p-4">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        {/* メニュー一覧（横スクロール、スマホ向け） */}
        <div className="flex flex-col gap-2">
          {canCreateMenu(profile.role) && (
            <button
              onClick={() => {
                setShowNewForm((v) => !v);
                setConfirmingNew(false);
                setNewMenuType("normal");
                setNewOffBothLocations(false);
              }}
              className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-medium text-white active:bg-neutral-700"
            >
              {showNewForm
                ? "キャンセル"
                : `＋ ${locationLabel[activeLocation]}のメニューを作成`}
            </button>
          )}

          {showNewForm && canCreateMenu(profile.role) && (
            <form
              onSubmit={handleCreateMenu}
              className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              {confirmingNew ? (
                <div className="flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">
                  <p className="text-xs font-semibold text-blue-700">
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
                      <p className="font-bold">{newTitle}</p>
                      <p className="whitespace-pre-wrap text-neutral-800">
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
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    required
                  />

                  <div className="flex gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
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
                            ? "bg-white shadow text-neutral-900"
                            : "text-neutral-500"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {newMenuType === "off" ? (
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
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
                      <label className="flex flex-col text-[11px] text-neutral-500">
                        開始時刻
                        <TimeSelect
                          value={newStartTime}
                          onChange={setNewStartTime}
                        />
                      </label>
                      <input
                        type="text"
                        placeholder="タイトル（例：通常練習）"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                        required
                      />
                      <textarea
                        placeholder="メニュー詳細（自由記述）"
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        rows={4}
                        className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                        required
                      />
                      {newMenuType === "joint" && (
                        <p className="text-[11px] text-neutral-500">
                          もう一方の拠点はこの練習に合流します
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
                    className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm text-neutral-600"
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
                <button
                  type="button"
                  onClick={() => {
                    if (
                      newDate &&
                      (newMenuType === "off" || (newTitle && newContent))
                    )
                      setConfirmingNew(true);
                  }}
                  className="rounded-lg bg-blue-600 py-3 text-sm font-medium text-white active:bg-blue-700"
                >
                  確認する
                </button>
              )}
            </form>
          )}

          {loadingMenus ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : neighborCards.length === 0 ? (
            <p className="text-xs text-neutral-400">
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
              {neighborCards.map(({ menu: m, role }) => {
                const executed = !m.is_off && isReportOpen(m);
                const total = m.is_joint
                  ? memberCounts.all
                  : memberCounts[m.location];
                const responded =
                  submissionMap[m.id]?.respondedAuthors.size ?? 0;
                const unsubmitted = executed && !m.is_off && responded < total;
                const isCurrent = role === "current";
                return (
                  <div
                    key={m.id}
                    className={`relative flex min-w-0 flex-col rounded-lg border px-2 py-2 text-left text-xs ${
                      isCurrent
                        ? "border-blue-600 bg-blue-50 font-semibold text-blue-700 shadow-sm"
                        : "border-neutral-100 bg-neutral-50 text-neutral-400"
                    }`}
                  >
                    <span
                      className={`truncate text-[10px] ${
                        isCurrent ? "text-neutral-400" : "text-neutral-300"
                      }`}
                    >
                      {m.date.slice(5)}
                      {m.start_time ? ` ${m.start_time.slice(0, 5)}〜` : ""}
                    </span>
                    <span className="truncate">{m.title}</span>
                    {executed && (
                      <span
                        className={`mt-1 inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          !isCurrent
                            ? "bg-neutral-100 text-neutral-400"
                            : unsubmitted
                            ? "bg-red-100 text-red-600"
                            : "bg-neutral-100 text-neutral-500"
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
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-800">
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
          <section className="rounded-lg border border-neutral-300 bg-neutral-100 p-4">
            <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
            <div className="mb-2 text-xs text-neutral-500">
              {locationLabel[selected.location]}・{selected.date}
              ・作成者: {selected.creator?.display_name ?? "不明"}
            </div>
            <p className="mb-3 text-base font-bold text-neutral-700">
              {formatMonthDay(selected.date)}はオフです
            </p>
            {canCreateMenu(profile.role) && (
              <button
                onClick={() => handleDeleteMenu(selected.id)}
                className="rounded-lg border border-neutral-400 px-3 py-2 text-xs text-neutral-600 active:bg-neutral-200"
              >
                オフを取り消す
              </button>
            )}
          </section>
        ) : selected ? (
          <>
            <section className="rounded-lg border border-neutral-200 p-4">
              <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
              {editingMenu ? (
                <form onSubmit={handleUpdateMenu} className="flex flex-col gap-2">
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    required
                  />
                  <label className="flex flex-col text-[11px] text-neutral-500">
                    開始時刻
                    <TimeSelect
                      value={editStartTime}
                      onChange={setEditStartTime}
                    />
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    required
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    rows={4}
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingMenu(false)}
                      className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm text-neutral-600"
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
                  <div className="mb-1 text-xs text-neutral-400">
                    {locationLabel[selected.location]}・{selected.date}
                    {selected.start_time &&
                      `・${selected.start_time.slice(0, 5)}〜`}
                    ・作成者: {selected.creator?.display_name ?? "不明"}
                    {selected.editor && (
                      <>（編集: {selected.editor.display_name}）</>
                    )}
                  </div>
                  <h2 className="mb-2 text-base font-bold">
                    {selected.title}
                  </h2>
                  <p className="whitespace-pre-wrap text-sm text-neutral-800">
                    {selected.content}
                  </p>
                  {canCreateMenu(profile.role) &&
                    !isReportOpen(selected) && (
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => startEditingMenu(selected)}
                          className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-[11px] text-neutral-600 active:bg-neutral-100"
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
              <h3 className="text-xs font-semibold text-neutral-500">
                意見・コメント
              </h3>
              <ul className="flex flex-col gap-2">
                {opinions.length === 0 && (
                  <li className="text-xs text-neutral-400">
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
                  className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                />
                <button
                  type="submit"
                  className="self-start rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white active:bg-neutral-700"
                >
                  コメントする
                </button>
              </form>
            </section>

            {/* 実施報告 */}
            <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-neutral-500">
                  実施報告
                </h3>
                <span className="text-[11px] text-neutral-400">
                  {`${reportSubmittedCount}人 / ${selectedMemberTotal}人 提出済み`}
                </span>
              </div>
              <ul className="flex flex-col gap-3">
                {reports.length === 0 && (
                  <li className="text-xs text-neutral-400">
                    まだ実施報告はありません。
                  </li>
                )}
                {reports.map((r) => (
                  <ReportThread
                    key={r.id}
                    report={r}
                    replies={repliesOf(r.id)}
                    onReply={(text) => submitComment("opinion", text, r.id)}
                  />
                ))}
              </ul>

              {reportOpen ? (
                <form onSubmit={handleAddReport} className="flex flex-col gap-2">
                  <textarea
                    value={reportText}
                    onChange={(e) => setReportText(e.target.value)}
                    placeholder="今日の練習を振り返って、感想や気づきを書いてください"
                    rows={3}
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
                  >
                    実施報告を提出する
                  </button>
                </form>
              ) : (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
                  まだ時間前です。練習開始予定時刻を過ぎると報告できるようになります。
                </p>
              )}
            </section>

            {/* 未実施報告 */}
            <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
              <h3 className="text-xs font-semibold text-neutral-500">
                未実施報告（授業・通院などで参加できなかった場合）
              </h3>
              <ul className="flex flex-col gap-2">
                {absentReports.length === 0 && (
                  <li className="text-xs text-neutral-400">
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
                  />
                ))}
              </ul>
              <form onSubmit={handleAddAbsent} className="flex flex-col gap-2">
                <label className="flex flex-col text-[11px] text-neutral-500">
                  未実施の理由
                  <input
                    type="text"
                    value={absentReason}
                    onChange={(e) => setAbsentReason(e.target.value)}
                    placeholder="例：授業・病院・出稽古など"
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-500">
                  代替メニュー
                  <textarea
                    value={absentAlternative}
                    onChange={(e) => setAbsentAlternative(e.target.value)}
                    placeholder={
                      "例：\n〇スナッチ\n　50㎏×7、6、5\n　60kg×4、3\n　70kg×1、1\n〇BP\n　100kg ×10、8、6\n　80kg×7、5\n〇荷重懸垂\n　20kg×10、7、5\n　10kg×8、5\n　0㎏×13\n〇DL\n　120kg×13、10、9\n　140kg×6、5、3"
                    }
                    rows={8}
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                  />
                </label>
                <button
                  type="submit"
                  className="self-start rounded-lg bg-neutral-600 px-4 py-2.5 text-sm font-medium text-white active:bg-neutral-700"
                >
                  未実施報告を提出する
                </button>
              </form>
            </section>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-neutral-300 p-4">
            <MenuNavBar onPrev={goPrevDay} onNext={goNextDay} />
            <p className="text-center text-sm text-neutral-400">
              {formatMonthDay(viewDate)}のメニューはまだ作成されていません
            </p>
          </div>
        )}

        {/* すべてのメニューを見るカレンダー */}
        <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <h3 className="text-xs font-semibold text-neutral-500">
            カレンダーからメニューを探す
          </h3>
          <MenuCalendar
            menus={menus}
            selectedId={selectedId}
            viewDate={viewDate}
            onSelect={selectMenu}
            submissionMap={submissionMap}
            memberCounts={memberCounts}
            jointElsewhere={jointElsewhere}
            onSelectJoint={selectJointDate}
            onSelectEmpty={(date) =>
              applySelectionForDate(date, menus, jointElsewhere)
            }
          />
        </section>
      </div>
    </div>
  );
}

function CommentItem({ c }: { c: CommentRow }) {
  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-3">
      <CommentMeta c={c} />
      <p className="whitespace-pre-wrap text-sm text-neutral-800">{c.text}</p>
    </li>
  );
}

function CommentMeta({ c }: { c: CommentRow }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
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
}: {
  report: CommentRow;
  replies: CommentRow[];
  onReply: (text: string) => Promise<void>;
  tone?: "emerald" | "neutral";
}) {
  const [replyText, setReplyText] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    await onReply(replyText);
    setReplyText("");
    setShowReplyForm(false);
  }

  const colors =
    tone === "emerald"
      ? {
          border: "border-emerald-200",
          bg: "bg-emerald-50",
          tag: "bg-emerald-600 text-white",
          replyBorder: "border-emerald-200",
          link: "text-emerald-700 active:text-emerald-900",
        }
      : {
          border: "border-neutral-300",
          bg: "bg-neutral-100",
          tag: "bg-neutral-600 text-white",
          replyBorder: "border-neutral-300",
          link: "text-neutral-700 active:text-neutral-900",
        };

  return (
    <li className={`rounded-lg border ${colors.border} ${colors.bg} p-3`}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
        <span className={`rounded px-1.5 py-0.5 font-medium ${colors.tag}`}>
          {commentKindLabel[report.kind]}
        </span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
          {report.author ? roleLabel[report.author.role] : "?"}
        </span>
        <span>{report.author?.display_name ?? "不明"}</span>
        <span>{formatDateTime(report.created_at)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-neutral-800">
        {report.text}
      </p>

      {replies.length > 0 && (
        <ul className={`mt-3 flex flex-col gap-2 border-l-2 ${colors.replyBorder} pl-3`}>
          {replies.map((r) => (
            <li key={r.id} className="rounded-lg bg-white p-2.5">
              <CommentMeta c={r} />
              <p className="whitespace-pre-wrap text-sm text-neutral-800">
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
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white active:bg-neutral-700"
            >
              送信
            </button>
            <button
              type="button"
              onClick={() => setShowReplyForm(false)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-600"
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
  selectedId,
  viewDate,
  onSelect,
  submissionMap,
  memberCounts,
  jointElsewhere,
  onSelectJoint,
  onSelectEmpty,
}: {
  menus: MenuRow[];
  selectedId: string | null;
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
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

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
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100"
        >
          ＜
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => setCursor(new Date(year, month + 1, 1))}
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
          const dayMenus = menusByDate.get(key) ?? [];
          const hasMenu = dayMenus.length > 0;
          const isOff = dayMenus.some((m) => m.is_off);
          const jointInfo = !hasMenu ? jointElsewhere.get(key) : undefined;
          const isToday = key === todayKey;
          const isViewDate = key === viewDate;
          const isPast = key < todayKey;
          const incomplete = hasMenu && isPast && isIncomplete(dayMenus);
          return (
            <button
              key={i}
              onClick={() => {
                if (hasMenu) onSelect(dayMenus[0].id);
                else if (jointInfo) onSelectJoint(key);
                else onSelectEmpty(key);
              }}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${
                isViewDate && hasMenu
                  ? "bg-blue-600 font-semibold text-white"
                  : isOff
                  ? "bg-neutral-200 font-medium text-neutral-500 active:bg-neutral-300"
                  : hasMenu
                  ? "bg-blue-50 font-medium text-blue-700 active:bg-blue-100"
                  : jointInfo
                  ? "bg-purple-50 font-medium text-purple-600 active:bg-purple-100"
                  : "text-neutral-300"
              } ${isViewDate ? "ring-2 ring-blue-500" : ""}`}
            >
              {date.getDate()}
              {isToday && (
                <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-neutral-900" />
              )}
              {incomplete && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-900" />
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
          <span className="inline-block h-2 w-2 rounded bg-purple-50" />
          全体練習（別拠点）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-neutral-200" />
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
        className="flex-1 rounded-lg border border-neutral-300 px-2 py-2.5 text-sm"
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
        className="flex-1 rounded-lg border border-neutral-300 px-2 py-2.5 text-sm"
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
        className="rounded px-2 py-1 text-sm text-neutral-500 active:bg-neutral-100"
      >
        ◀
      </button>
      <button
        onClick={onNext}
        className="rounded px-2 py-1 text-sm text-neutral-500 active:bg-neutral-100"
      >
        ▶
      </button>
    </div>
  );
}
