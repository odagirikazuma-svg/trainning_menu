"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { canCreateMenu, roleLabel } from "../lib/types";
import type { Profile } from "./AuthGate";

type MenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  created_at: string;
  created_by: string;
  creator: { display_name: string } | null;
};

type CommentRow = {
  id: string;
  text: string;
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

export default function TrainingBoardSupabase({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const supabase = createClient();
  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [loadingMenus, setLoadingMenus] = useState(true);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [commentText, setCommentText] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadMenus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) loadComments(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadMenus() {
    setLoadingMenus(true);
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, created_at, created_by, creator:profiles!menus_created_by_fkey(display_name)"
      )
      .order("date", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      const rows = (data ?? []) as unknown as MenuRow[];
      setMenus(rows);
      if (rows.length > 0 && !selectedId) setSelectedId(rows[0].id);
    }
    setLoadingMenus(false);
  }

  async function loadComments(menuId: string) {
    const { data, error } = await supabase
      .from("comments")
      .select(
        "id, text, created_at, author_id, author:profiles!comments_author_id_fkey(display_name, role)"
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
        created_by: profile.id,
      })
      .select("id")
      .single();

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewDate("");
    setNewTitle("");
    setNewContent("");
    setShowNewForm(false);
    await loadMenus();
    if (data) setSelectedId(data.id);
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !commentText.trim()) return;
    const { error } = await supabase.from("comments").insert({
      menu_id: selectedId,
      author_id: profile.id,
      text: commentText.trim(),
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setCommentText("");
    await loadComments(selectedId);
  }

  const selected = menus.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4 text-sm text-neutral-900 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold sm:text-xl">練習メニュー掲示板</h1>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>
            {profile.display_name}（{roleLabel[profile.role]}）
          </span>
          <button
            onClick={signOut}
            className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
          >
            ログアウト
          </button>
        </div>
      </header>

      {errorMsg && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-600">
          {errorMsg}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[240px_1fr]">
        <aside className="flex flex-col gap-2">
          {canCreateMenu(profile.role) && (
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="rounded bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
            >
              {showNewForm ? "キャンセル" : "＋ 新しいメニューを作成"}
            </button>
          )}

          {showNewForm && canCreateMenu(profile.role) && (
            <form
              onSubmit={handleCreateMenu}
              className="flex flex-col gap-2 rounded border border-neutral-200 bg-neutral-50 p-3"
            >
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                required
              />
              <input
                type="text"
                placeholder="タイトル（例：通常練習）"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                required
              />
              <textarea
                placeholder="メニュー詳細（自由記述）"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={4}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
                required
              />
              <button
                type="submit"
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
              >
                投稿する
              </button>
            </form>
          )}

          {loadingMenus ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {menus.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={`w-full rounded px-3 py-2 text-left text-xs transition ${
                      m.id === selectedId
                        ? "bg-blue-50 font-semibold text-blue-700"
                        : "hover:bg-neutral-100"
                    }`}
                  >
                    <div className="text-[11px] text-neutral-400">{m.date}</div>
                    <div>{m.title}</div>
                  </button>
                </li>
              ))}
              {menus.length === 0 && (
                <li className="text-xs text-neutral-400">
                  まだメニューがありません。
                </li>
              )}
            </ul>
          )}
        </aside>

        <main className="flex flex-col gap-4">
          {selected ? (
            <>
              <section className="rounded border border-neutral-200 p-4">
                <div className="mb-1 text-xs text-neutral-400">
                  {selected.date}・作成者:{" "}
                  {selected.creator?.display_name ?? "不明"}
                </div>
                <h2 className="mb-2 text-base font-bold">{selected.title}</h2>
                <p className="whitespace-pre-wrap text-neutral-800">
                  {selected.content}
                </p>
              </section>

              <section className="flex flex-col gap-3">
                <h3 className="text-xs font-semibold text-neutral-500">
                  コメント
                </h3>
                <ul className="flex flex-col gap-2">
                  {comments.length === 0 && (
                    <li className="text-xs text-neutral-400">
                      まだコメントはありません。
                    </li>
                  )}
                  {comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded border border-neutral-200 bg-white p-3"
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-400">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
                          {c.author ? roleLabel[c.author.role] : "?"}
                        </span>
                        <span>{c.author?.display_name ?? "不明"}</span>
                        <span>{formatDateTime(c.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-neutral-800">
                        {c.text}
                      </p>
                    </li>
                  ))}
                </ul>

                <form onSubmit={handleAddComment} className="flex flex-col gap-2">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="コメントを入力"
                    rows={3}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    className="self-start rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                  >
                    コメントする
                  </button>
                </form>
              </section>
            </>
          ) : (
            <p className="text-xs text-neutral-400">
              左のメニューを選択してください。
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
