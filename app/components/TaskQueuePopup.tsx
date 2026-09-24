"use client";

import { useEffect, useState } from "react";
import { useHeaderExtra } from "./shell/AppShell";

export type TaskKind = "mat" | "self" | "injury" | "event";

export type QueueTask = {
  key: string;
  // タスクの種類。一覧で色分けとラベル表示に使う（未指定なら badgeLabel をそのまま表示）
  kind?: TaskKind;
  // 期限切れかどうか（一覧に「期限切れ」の赤いラベルを出す）
  overdue?: boolean;
  badgeLabel: string;
  title: string;
  urgent: boolean;
  // 通常はReactNodeをそのまま渡す。ポップアップを閉じる操作（closeを呼ぶ）を
  // ボタン等に組み込みたい場合は関数形式で渡す（例：イベントページの「入力へ進む」）。
  content: React.ReactNode | ((close: () => void) => React.ReactNode);
};

// 種類ごとの見た目（左の色帯・ラベルの色）。ひと目でマット日報かトレ報か分かるようにする
const kindStyle: Record<TaskKind, { label: string; bar: string; chip: string }> = {
  mat: {
    label: "マット日報",
    bar: "bg-violet-500",
    chip: "bg-violet-600 text-white",
  },
  self: {
    label: "トレ報",
    bar: "bg-sky-500",
    chip: "bg-sky-600 text-white",
  },
  injury: {
    label: "怪我の経過",
    bar: "bg-amber-500",
    chip: "bg-amber-500 text-black",
  },
  event: {
    label: "イベント",
    bar: "bg-emerald-500",
    chip: "bg-emerald-600 text-white",
  },
};

function TaskLabel({ task }: { task: QueueTask }) {
  if (!task.kind) {
    return (
      <span
        className={`text-[length:calc(11px+var(--fs-add))] font-medium ${
          task.urgent ? "text-red-400" : "text-amber-400"
        }`}
      >
        {task.badgeLabel}
      </span>
    );
  }
  const k = kindStyle[task.kind];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded px-1.5 py-0.5 text-[length:calc(11px+var(--fs-add))] font-bold ${k.chip}`}
      >
        {k.label}
      </span>
      {task.overdue && (
        <span className="rounded border border-red-500/70 px-1.5 py-px text-[length:calc(10px+var(--fs-add))] font-semibold text-red-400">
          期限切れ
        </span>
      )}
    </span>
  );
}

/**
 * マイページ・イベントページの「未提出タスク」をポップアップで提出させる仕組み。
 *
 * 表示モードは3つ：
 * - queue  : 自動で開いたとき。未提出タスクを1件ずつ順番に表示し、提出すると次へ進む
 * - list   : ヘッダー右上の「未提出」バッジを押したとき。残っているタスクを一覧表示する
 * - detail : 一覧から選んだタスク1件を表示。提出すると一覧に戻る（残りが無ければ閉じる）
 *
 * 「キャンセル」「閉じる」を押すとポップアップを閉じ、ヘッダー右上のバッジからいつでも再開できる。
 */
export default function TaskQueuePopup({
  tasks,
  startWithList = false,
}: {
  tasks: QueueTask[];
  // true のとき、自動でポップアップが開いたときも1件ずつではなく「未提出のタスク」一覧から始める
  startWithList?: boolean;
}) {
  const initialView = startWithList ? "list" : "queue";
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"queue" | "list" | "detail">(initialView);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
    // 新しいタスクが増えたら、閉じていても自動で再度ポップアップを開く（順番表示モード）
    if (pending.length > 0 && !open) {
      setView(initialView);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  // 一覧から選んだタスクを提出して消えたら、一覧へ戻る（残りが無ければ tasks.length===0 で閉じる）。
  // state を書き換えるのではなく、描画時に「表示するモード」を決めることで実現する。
  const selectedTask =
    view === "detail" ? (tasks.find((t) => t.key === selectedKey) ?? null) : null;
  const effectiveView = view === "detail" && !selectedTask ? "list" : view;

  // ポップアップを閉じている間、ヘッダー右上に件数バッジを表示する。
  // タップすると、残っているタスクの一覧が開く。
  useHeaderExtra(
    !open && tasks.length > 0 ? (
      <button
        onClick={handleOpenList}
        className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-bold text-white shadow active:bg-red-700"
      >
        未提出
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[length:calc(10px+var(--fs-add))] font-bold text-red-600">
          {tasks.length > 9 ? "9+" : tasks.length}
        </span>
      </button>
    ) : null
  );

  if (tasks.length === 0) return null;

  const queueCurrent = pending[0] ?? null;
  const current = effectiveView === "queue" ? queueCurrent : selectedTask;

  function handleClose() {
    if (effectiveView === "queue" && queueCurrent) {
      setSkipped((prev) => new Set(prev).add(queueCurrent.key));
    }
    // キャンセルしたら残りタスクの有無に関わらず必ず閉じる。
    // 1回閉じたらヘッダー右上のバッジからいつでも一覧を開いて再開できる。
    setOpen(false);
    setSelectedKey(null);
  }

  function handleOpenList() {
    setSkipped(new Set());
    setSelectedKey(null);
    setView("list");
    setOpen(true);
  }

  function handleSelect(key: string) {
    setSelectedKey(key);
    setView("detail");
  }

  function handleBackToList() {
    setSelectedKey(null);
    setView("list");
  }

  if (!open) return null;
  if (effectiveView !== "list" && !current) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end bg-black/60"
      onClick={handleClose}
    >
      <div
        className="relative flex max-h-[85vh] w-full flex-col gap-3 overflow-y-auto rounded-t-2xl bg-neutral-900 p-4 pb-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1 w-10 shrink-0 rounded-full bg-neutral-700" />

        {effectiveView === "list" ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">
                未提出のタスク
              </span>
              <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
                {tasks.length}件
              </span>
            </div>
            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
              提出したいタスクを選んでください。
            </p>
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => handleSelect(t.key)}
                    className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg border bg-neutral-800 py-2.5 pr-3 text-left active:bg-neutral-700 ${
                      t.kind ? "pl-4" : "pl-3"
                    } ${t.urgent ? "border-red-900" : "border-neutral-700"}`}
                  >
                    {t.kind ? (
                      <span
                        className={`absolute inset-y-0 left-0 w-1.5 ${kindStyle[t.kind].bar}`}
                      />
                    ) : (
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          t.urgent ? "bg-red-500" : "bg-amber-400"
                        }`}
                      />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <TaskLabel task={t} />
                      <span className="break-words text-sm font-semibold text-white">
                        {t.title}
                      </span>
                    </span>
                    <span className="shrink-0 text-neutral-500">›</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={handleClose}
              className="mt-1 w-full rounded-lg border border-neutral-700 py-2.5 text-sm font-medium text-neutral-300 active:bg-neutral-800"
            >
              閉じる
            </button>
          </>
        ) : (
          current && (
            <>
              {effectiveView === "detail" && (
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="self-start text-xs font-medium text-neutral-400 active:text-neutral-200"
                >
                  ‹ 一覧に戻る
                </button>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col gap-1">
                  <TaskLabel task={current} />
                  <span className="text-sm font-semibold text-white">
                    {current.title}
                  </span>
                </div>
                {effectiveView === "queue" && pending.length > 1 && (
                  <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
                    残り{pending.length}件
                  </span>
                )}
              </div>

              {/* key にタスクのkeyを指定し、タスクが切り替わるたびに中のフォームを
                  作り直す（＝入力内容を必ずリセットする）。これが無いと、同じ種類の
                  フォームが続いたときに前のタスクの入力内容が残ってしまい、
                  別の日のトレーニングを同じ内容で提出してしまう不具合が起きる。 */}
              <div key={current.key} className="flex flex-col gap-2">
                {typeof current.content === "function"
                  ? current.content(handleClose)
                  : current.content}
              </div>

              <button
                onClick={effectiveView === "detail" ? handleBackToList : handleClose}
                className="mt-1 w-full rounded-lg border border-neutral-700 py-2.5 text-sm font-medium text-neutral-300 active:bg-neutral-800"
              >
                {effectiveView === "detail" ? "一覧に戻る" : "キャンセル"}
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}
