"use client";

import { useEffect, useState } from "react";

export type QueueTask = {
  key: string;
  badgeLabel: string;
  title: string;
  urgent: boolean;
  content: React.ReactNode;
};

/**
 * マイページの「練習タスク・怪我タスク」を1件ずつポップアップで提出させる仕組み。
 * - タスクがあれば自動でポップアップが開く
 * - 「キャンセル」を押すと、残りタスクの有無に関わらずポップアップを閉じる
 * - 閉じている間は下に赤いバナー（未提出タスク件数つき）が常に表示され、
 *   タップすると最初のタスクから再度ポップアップする
 * - タスクを提出する（tasks配列からそのkeyが消える）と、自動で次のタスクに進む
 */
export default function TaskQueuePopup({ tasks }: { tasks: QueueTask[] }) {
  const [open, setOpen] = useState(true);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  // タスクの中身が変わったら（提出済みで消えたら）、スキップ済みキーも掃除する
  useEffect(() => {
    setSkipped((prev) => {
      const taskKeys = new Set(tasks.map((t) => t.key));
      const next = new Set(Array.from(prev).filter((k) => taskKeys.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const pending = tasks.filter((t) => !skipped.has(t.key));

  useEffect(() => {
    // 新しいタスクが増えたら、閉じていても自動で再度ポップアップを開く
    if (pending.length > 0) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  const current = pending[0] ?? null;

  function handleCancel() {
    if (!current) return;
    setSkipped((prev) => new Set(prev).add(current.key));
    // キャンセルしたら残りタスクの有無に関わらず必ず閉じる。
    // 次のタスクへ自動で進めてしまうと、複数件残っているときに
    // キャンセルのたびにポップアップへ付き合わされることになるため、
    // 1回キャンセルしたら常時表示のバナー（下記）からいつでも再開できる形にする。
    setOpen(false);
  }

  function handleReopen() {
    setSkipped(new Set());
    setOpen(true);
  }

  return (
    <>
      {open && current && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-black/60"
          onClick={handleCancel}
        >
          <div
            className="relative flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 pb-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 shrink-0 rounded-full bg-neutral-700" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <span
                  className={`text-[11px] font-medium ${
                    current.urgent ? "text-red-400" : "text-amber-400"
                  }`}
                >
                  {current.badgeLabel}
                </span>
                <span className="text-sm font-semibold text-white">
                  {current.title}
                </span>
              </div>
              {pending.length > 1 && (
                <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400">
                  残り{pending.length}件
                </span>
              )}
            </div>

            <div className="flex flex-col gap-2">{current.content}</div>

            <button
              onClick={handleCancel}
              className="mt-1 w-full rounded-lg border border-neutral-700 py-2.5 text-sm font-medium text-neutral-300 active:bg-neutral-800"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {!open && (
        <button
          onClick={handleReopen}
          className="fixed inset-x-0 bottom-16 z-30 mx-auto w-[92%] max-w-md rounded-lg bg-red-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg active:bg-red-700"
        >
          {tasks.length > 1
            ? `未提出のタスクが${tasks.length}件あります`
            : "未提出のタスクがあります"}
        </button>
      )}
    </>
  );
}
