"use client";

import { useEffect, useState } from "react";
import { useHeaderExtra } from "./shell/AppShell";

export type QueueTask = {
  key: string;
  badgeLabel: string;
  title: string;
  urgent: boolean;
  // 通常はReactNodeをそのまま渡す。ポップアップを閉じる操作（closeを呼ぶ）を
  // ボタン等に組み込みたい場合は関数形式で渡す（例：イベントページの「入力へ進む」）。
  content: React.ReactNode | ((close: () => void) => React.ReactNode);
};

/**
 * マイページ・イベントページの「未提出タスク」を1件ずつポップアップで提出させる仕組み。
 * - タスクがあれば自動でポップアップが開く
 * - 「キャンセル」を押すと、残りタスクの有無に関わらずポップアップを閉じる
 * - 閉じている間はヘッダー右上に件数バッジが表示され、
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

  const current = pending[0] ?? null;

  // ポップアップを閉じている間、ヘッダー右上に件数バッジを表示する
  // （下部固定バナーは、フッターと重なって隠れる・邪魔に感じるという声があったため廃止）
  useHeaderExtra(
    !open && tasks.length > 0 ? (
      <button
        onClick={handleReopen}
        className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white shadow active:bg-red-700"
      >
        未提出
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-red-600">
          {tasks.length > 9 ? "9+" : tasks.length}
        </span>
      </button>
    ) : null
  );

  if (tasks.length === 0) return null;

  function handleCancel() {
    if (!current) return;
    setSkipped((prev) => new Set(prev).add(current.key));
    // キャンセルしたら残りタスクの有無に関わらず必ず閉じる。
    // 次のタスクへ自動で進めてしまうと、複数件残っているときに
    // キャンセルのたびにポップアップへ付き合わされることになるため、
    // 1回キャンセルしたらヘッダー右上のバッジ（上記）からいつでも再開できる形にする。
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

            <div className="flex flex-col gap-2">
              {typeof current.content === "function"
                ? current.content(handleCancel)
                : current.content}
            </div>

            <button
              onClick={handleCancel}
              className="mt-1 w-full rounded-lg border border-neutral-700 py-2.5 text-sm font-medium text-neutral-300 active:bg-neutral-800"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </>
  );
}
