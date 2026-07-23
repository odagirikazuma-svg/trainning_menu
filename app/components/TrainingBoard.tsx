"use client";

import { useState } from "react";
import { initialMenus } from "../lib/mock-data";
import { canCreateMenu, Role, roleLabel, TrainingMenu } from "../lib/types";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TrainingBoard() {
  const [menus, setMenus] = useState<TrainingMenu[]>(initialMenus);
  const [selectedId, setSelectedId] = useState<string>(initialMenus[0]?.id ?? "");
  const [role, setRole] = useState<Role>("captain");
  const [myName, setMyName] = useState<string>("山田（キャプテン）");

  const [showNewForm, setShowNewForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  const [commentText, setCommentText] = useState("");

  const sortedMenus = [...menus].sort((a, b) => (a.date < b.date ? 1 : -1));
  const selected = menus.find((m) => m.id === selectedId) ?? null;

  function handleCreateMenu(e: React.FormEvent) {
    e.preventDefault();
    if (!newDate || !newTitle || !newContent) return;
    const menu: TrainingMenu = {
      id: `menu-${Date.now()}`,
      date: newDate,
      title: newTitle,
      content: newContent,
      createdBy: myName,
      createdAt: new Date().toISOString(),
      comments: [],
    };
    setMenus((prev) => [menu, ...prev]);
    setSelectedId(menu.id);
    setNewDate("");
    setNewTitle("");
    setNewContent("");
    setShowNewForm(false);
  }

  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !commentText.trim()) return;
    setMenus((prev) =>
      prev.map((m) =>
        m.id === selected.id
          ? {
              ...m,
              comments: [
                ...m.comments,
                {
                  id: `c-${Date.now()}`,
                  authorName: myName,
                  role,
                  text: commentText.trim(),
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : m
      )
    );
    setCommentText("");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-4 p-4 text-sm text-neutral-900 sm:p-6">
      <header className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-bold sm:text-xl">練習メニュー掲示板</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-neutral-500">
            表示名
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
          </label>
          <label className="text-xs text-neutral-500">
            権限
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-xs"
            >
              {(Object.keys(roleLabel) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[240px_1fr]">
        {/* メニュー一覧 */}
        <aside className="flex flex-col gap-2">
          {canCreateMenu(role) && (
            <button
              onClick={() => setShowNewForm((v) => !v)}
              className="rounded bg-neutral-900 px-3 py-2 text-xs font-medium text-white hover:bg-neutral-700"
            >
              {showNewForm ? "キャンセル" : "＋ 新しいメニューを作成"}
            </button>
          )}

          {showNewForm && canCreateMenu(role) && (
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

          <ul className="flex flex-col gap-1">
            {sortedMenus.map((m) => (
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
                  <div className="text-[11px] text-neutral-400">
                    コメント {m.comments.length}件
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* 詳細 + コメント */}
        <main className="flex flex-col gap-4">
          {selected ? (
            <>
              <section className="rounded border border-neutral-200 p-4">
                <div className="mb-1 text-xs text-neutral-400">
                  {selected.date}・作成者: {selected.createdBy}
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
                  {selected.comments.length === 0 && (
                    <li className="text-xs text-neutral-400">
                      まだコメントはありません。
                    </li>
                  )}
                  {selected.comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded border border-neutral-200 bg-white p-3"
                    >
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-400">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
                          {roleLabel[c.role]}
                        </span>
                        <span>{c.authorName}</span>
                        <span>{formatDateTime(c.createdAt)}</span>
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
                    placeholder="コメントを入力（例：アップをもう少し長くした方がいいと思います）"
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
