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
  created_at: string;
  created_by: string;
  creator: { display_name: string } | null;
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
  const [newDate, setNewDate] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [commentText, setCommentText] = useState("");
  const [reportText, setReportText] = useState("");
  const [absentReason, setAbsentReason] = useState("");
  const [absentAlternative, setAbsentAlternative] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const [submissionMap, setSubmissionMap] = useState<
    Record<string, { reportAuthors: Set<string>; respondedAuthors: Set<string> }>
  >({});

  useEffect(() => {
    // 練習に参加しうる部員総数（コーチは提出対象に含めない）
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("team_id", profile.team_id)
      .neq("role", "coach")
      .then(({ count }) => setTotalMembers(count ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMenus();
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation]);

  useEffect(() => {
    if (selectedId) loadComments(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadMenus() {
    setLoadingMenus(true);
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, location, start_time, created_at, created_by, creator:profiles!menus_created_by_fkey(display_name)"
      )
      .eq("location", activeLocation)
      .order("date", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      const rows = (data ?? []) as unknown as MenuRow[];
      setMenus(rows);
      if (rows.length > 0) setSelectedId(rows[0].id);
      await loadSubmissionSummary(rows.map((r) => r.id));
    }
    setLoadingMenus(false);
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
    if (!newDate || !newTitle || !newContent) return;
    const { data, error } = await supabase
      .from("menus")
      .insert({
        team_id: profile.team_id,
        date: newDate,
        title: newTitle,
        content: newContent,
        location: activeLocation,
        start_time: newStartTime || null,
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewDate("");
    setNewStartTime("");
    setNewTitle("");
    setNewContent("");
    setShowNewForm(false);
    await loadMenus();
    if (data) setSelectedId(data.id);
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

  // 前日・当日・翌日のメニューのみを上部のカードに表示する
  const toDateStr = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const nearbyRange = [
    toDateStr(yesterday),
    toDateStr(today),
    toDateStr(tomorrow),
  ];
  const nearbyMenus = menus.filter((m) => nearbyRange.includes(m.date));

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-3 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">練習メニュー掲示板</h1>
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
              onClick={() => setShowNewForm((v) => !v)}
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
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                required
              />
              <label className="flex flex-col text-[11px] text-neutral-500">
                開始時刻
                <input
                  type="time"
                  value={newStartTime}
                  onChange={(e) => setNewStartTime(e.target.value)}
                  className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
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
              <button
                type="submit"
                className="rounded-lg bg-blue-600 py-3 text-sm font-medium text-white active:bg-blue-700"
              >
                {locationLabel[activeLocation]}に投稿する
              </button>
            </form>
          )}

          {loadingMenus ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {nearbyMenus.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className={`flex shrink-0 flex-col rounded-lg border px-3 py-2 text-left text-xs ${
                    m.id === selectedId
                      ? "border-blue-600 bg-blue-50 font-semibold text-blue-700"
                      : "border-neutral-200 bg-white text-neutral-600"
                  }`}
                >
                  <span className="text-[11px] text-neutral-400">
                    {m.date}
                    {m.start_time ? ` ${m.start_time.slice(0, 5)}〜` : ""}
                  </span>
                  <span>{m.title}</span>
                </button>
              ))}
              {nearbyMenus.length === 0 && (
                <p className="text-xs text-neutral-400">
                  前日〜翌日の{locationLabel[activeLocation]}のメニューはありません。下のカレンダーから他の日を選べます。
                </p>
              )}
            </div>
          )}
        </div>

        {selected ? (
          <>
            <section className="rounded-lg border border-neutral-200 p-4">
              <div className="mb-1 text-xs text-neutral-400">
                {locationLabel[selected.location]}・{selected.date}
                {selected.start_time && `・${selected.start_time.slice(0, 5)}〜`}
                ・作成者: {selected.creator?.display_name ?? "不明"}
              </div>
              <h2 className="mb-2 text-base font-bold">{selected.title}</h2>
              <p className="whitespace-pre-wrap text-sm text-neutral-800">
                {selected.content}
              </p>
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
                  {totalMembers !== null
                    ? `${reportSubmittedCount}人 / ${totalMembers}人 提出済み`
                    : `${reportSubmittedCount}人提出済み`}
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
                  <li
                    key={c.id}
                    className="rounded-lg border border-neutral-300 bg-neutral-100 p-3"
                  >
                    <CommentMeta c={c} />
                    <p className="whitespace-pre-wrap text-sm text-neutral-800">
                      {c.text}
                    </p>
                  </li>
                ))}
              </ul>
              <form onSubmit={handleAddAbsent} className="flex flex-col gap-2">
                <label className="flex flex-col text-[11px] text-neutral-500">
                  未実施の理由
                  <input
                    type="text"
                    value={absentReason}
                    onChange={(e) => setAbsentReason(e.target.value)}
                    placeholder="例：授業のため参加できず"
                    className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-500">
                  代替メニュー
                  <textarea
                    value={absentAlternative}
                    onChange={(e) => setAbsentAlternative(e.target.value)}
                    placeholder="例：自宅で腹筋・腕立てを各3セット実施"
                    rows={2}
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
          <p className="text-xs text-neutral-400">
            上のメニューを選択してください。
          </p>
        )}

        {/* すべてのメニューを見るカレンダー */}
        <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <h3 className="text-xs font-semibold text-neutral-500">
            カレンダーからメニューを探す
          </h3>
          <MenuCalendar
            menus={menus}
            selectedId={selectedId}
            onSelect={setSelectedId}
            submissionMap={submissionMap}
            totalMembers={totalMembers}
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
}: {
  report: CommentRow;
  replies: CommentRow[];
  onReply: (text: string) => Promise<void>;
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

  return (
    <li className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 font-medium text-white">
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
        <ul className="mt-3 flex flex-col gap-2 border-l-2 border-emerald-200 pl-3">
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
          className="mt-2 text-xs font-medium text-emerald-700 active:text-emerald-900"
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
  onSelect,
  submissionMap,
  totalMembers,
}: {
  menus: MenuRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  submissionMap: Record<
    string,
    { reportAuthors: Set<string>; respondedAuthors: Set<string> }
  >;
  totalMembers: number | null;
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

  // その日のメニューのうち、全部員が実施報告or未実施報告を提出しきっていないか判定
  // （過去の日付のみ対象。今日・未来はまだ提出期間中なので対象外）
  function isIncomplete(dayMenus: MenuRow[]): boolean {
    if (totalMembers === null) return false;
    return dayMenus.some((m) => {
      const respondedCount = submissionMap[m.id]?.respondedAuthors.size ?? 0;
      return respondedCount < totalMembers;
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
          const isToday = key === todayKey;
          const isPast = key < todayKey;
          const isSelected = dayMenus.some((m) => m.id === selectedId);
          const incomplete = hasMenu && isPast && isIncomplete(dayMenus);
          return (
            <button
              key={i}
              disabled={!hasMenu}
              onClick={() => hasMenu && onSelect(dayMenus[0].id)}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs ${
                isSelected
                  ? "bg-blue-600 font-semibold text-white"
                  : hasMenu
                  ? "bg-blue-50 font-medium text-blue-700 active:bg-blue-100"
                  : "text-neutral-300"
              } ${isToday && !isSelected ? "ring-1 ring-neutral-400" : ""}`}
            >
              {date.getDate()}
              {incomplete && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[10px] text-neutral-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
        未提出の部員がいる日
      </p>
    </div>
  );
}
