"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { commentKindLabel, Location, locationLabel, trainingTypeLabel, TrainingType } from "../lib/types";
import type { Profile } from "./AuthGate";
import { loadSetsForLog, SetSummary, blocksSummaryText, type ExerciseBlock } from "./SetLogger";
import { formatMonthDayWeek } from "./DailyReport";

/**
 * 振り返りタブのカレンダーで日付を押したときに、カレンダーの下に出す「その日の記録」。
 * 見るだけの表示。書く・直すときは「この日の日報を開く」から日報タブへ移る。
 */

type MatRow = {
  id: string;
  kind: "report" | "absent";
  text: string;
  menu: { location: Location; start_time: string | null; is_joint: boolean; content: string } | null;
};

type LogRow = {
  id: string;
  type: TrainingType;
  title: string | null;
  content: string;
  start_time: string | null;
};

export default function DayRecordPanel({
  profile,
  date,
  onOpenDaily,
  onClose,
}: {
  profile: Profile;
  date: string;
  onOpenDaily: (date: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [mats, setMats] = useState<MatRow[]>([]);
  // トレーニングの記録（セクションごとに複数あることがある）
  const [logs, setLogs] = useState<{ log: LogRow; blocks: ExerciseBlock[] }[]>([]);
  const [memo, setMemo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [matRes, logRes, memoRes] = await Promise.all([
        supabase
          .from("comments")
          .select("id, kind, text, menu:menus!inner(location, start_time, is_joint, content, date)")
          .eq("author_id", profile.id)
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
          .eq("menu.date", date),
        supabase
          .from("weight_logs")
          .select("id, type, title, content, start_time")
          .eq("author_id", profile.id)
          .eq("date", date)
          .order("start_time", { ascending: true }),
        supabase
          .from("personal_memos")
          .select("content")
          .eq("author_id", profile.id)
          .eq("date", date)
          .maybeSingle(),
      ]);
      const logRows = (logRes.data ?? []) as LogRow[];
      const list = await Promise.all(logRows.map(async (l) => ({ log: l, blocks: await loadSetsForLog(supabase, l.id) })));
      if (cancelled) return;
      setMats((matRes.data ?? []) as unknown as MatRow[]);
      setLogs(list);
      setMemo((memoRes.data as { content: string } | null)?.content ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, profile.id]);

  const empty = !loading && mats.length === 0 && logs.length === 0 && !memo;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-foreground">{formatMonthDayWeek(date)}の記録</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="text-neutral-500 active:text-neutral-800 dark:active:text-neutral-200"
        >
          ✕
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : empty ? (
        <p className="text-xs text-neutral-500">この日の記録はありません。</p>
      ) : (
        <>
          {mats.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg border p-2.5 ${
                m.kind === "report"
                  ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30"
                  : "border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800"
              }`}
            >
              <p className="mb-1 text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-700 dark:text-neutral-300">
                マット練習
                {m.menu
                  ? `（${m.menu.start_time ? `${m.menu.start_time.slice(0, 5)}〜・` : ""}${
                      m.menu.is_joint ? "全体練習・" : ""
                    }${locationLabel[m.menu.location]}）`
                  : ""}
                ・{commentKindLabel[m.kind]}
              </p>
              <p className="whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">{m.text}</p>
            </div>
          ))}
          {logs.map(({ log, blocks }) => (
            <div key={log.id} className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 p-2.5">
              <p className="mb-1 text-[length:calc(11px+var(--fs-add))] font-semibold text-sky-700 dark:text-sky-300">
                {trainingTypeLabel[log.type]}
                {log.title ? `・${log.title}` : ""}
                {log.start_time ? `（${log.start_time.slice(0, 5)}〜）` : ""}
              </p>
              <SetSummary blocks={blocks} />
              {log.content && log.content !== blocksSummaryText(blocks) && (
                <p
                  className={`whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100 ${
                    blocks.length > 0 ? "mt-2 border-t border-sky-200 dark:border-sky-900/50 pt-2" : ""
                  }`}
                >
                  {log.content}
                </p>
              )}
            </div>
          ))}
          {memo && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              <span className="font-semibold">一言メモ：</span>
              {memo}
            </p>
          )}
        </>
      )}

      <button
        type="button"
        onClick={() => onOpenDaily(date)}
        className="self-start rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-xs text-neutral-800 dark:text-neutral-200 active:bg-neutral-100 dark:active:bg-neutral-800"
      >
        この日の日報を開く（書く・直す）
      </button>
    </div>
  );
}
