"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  absencePlanText,
  absenceReasonText,
  absenceStatusCls,
  absenceStatusLabel,
  type AbsenceRequest,
} from "../lib/absence";

type Row = AbsenceRequest & { author: { display_name: string } | null };

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateLabel(dateStr: string, todayStr: string, tomorrowStr: string) {
  const [, m, d] = dateStr.split("-");
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${dateStr}T00:00:00`).getDay()];
  const base = `${Number(m)}/${Number(d)}（${w}）`;
  if (dateStr === todayStr) return `今日 ${base}`;
  if (dateStr === tomorrowStr) return `明日 ${base}`;
  return base;
}

// 管理ページ「日報」タブの先頭に出す、休み申請の一覧と承認。
// 承認・差し戻しができるのは管理者（コーチ）だけ。マネージャーは見るだけ。
export default function AbsenceReviewSection({
  teamId,
  reviewerId,
  canReview,
}: {
  teamId: string;
  reviewerId: string;
  canReview: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const todayStr = toDateKey(new Date());
  const tomorrowStr = toDateKey(new Date(Date.now() + 86400000));

  async function load() {
    const { data, error } = await supabase
      .from("absence_requests")
      .select("*, author:profiles!absence_requests_author_id_fkey(display_name)")
      .eq("team_id", teamId)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setUnavailable(true);
    } else {
      setRows((data ?? []) as unknown as Row[]);
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const byDate = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows]);

  async function review(ids: string[], status: "approved" | "rejected", reviewComment: string | null) {
    setBusy(ids.join(","));
    setError(null);
    const { error } = await supabase
      .from("absence_requests")
      .update({
        status,
        review_comment: reviewComment,
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .in("id", ids);
    if (error) setError(`更新できませんでした：${error.message}`);
    setRejecting(null);
    setComment("");
    await load();
    setBusy(null);
  }

  if (!loaded || unavailable) return null;

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-block h-3.5 w-1 rounded-full bg-amber-500" />
        休み申請
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-white">
            承認待ち {pendingCount}
          </span>
        )}
      </h2>
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
      {byDate.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
          今日以降の休み申請はありません。
        </p>
      ) : (
        byDate.map(([date, list]) => {
          const pendingIds = list.filter((r) => r.status === "pending").map((r) => r.id);
          const approved = list.filter((r) => r.status === "approved").length;
          return (
            <div
              key={date}
              className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/70"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                  {dateLabel(date, todayStr, tomorrowStr)}　休み {list.length}人
                  <span className="ml-1 font-normal text-neutral-500">
                    （承認済み{approved}・承認待ち{pendingIds.length}）
                  </span>
                </span>
                {canReview && pendingIds.length > 1 && (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => {
                      if (window.confirm(`承認待ちの${pendingIds.length}人をまとめて承認しますか？`)) {
                        review(pendingIds, "approved", null);
                      }
                    }}
                    className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-bold text-white disabled:opacity-50"
                  >
                    まとめて承認
                  </button>
                )}
              </div>
              <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/team/${r.author_id}?date=${r.date}`)}
                        className="text-sm font-semibold text-neutral-900 underline decoration-dotted dark:text-neutral-100"
                      >
                        {r.author?.display_name ?? "（不明）"}
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${absenceStatusCls[r.status]}`}>
                        {absenceStatusLabel[r.status]}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500">理由：</span>
                      {absenceReasonText(r)}
                    </p>
                    <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500">代替：</span>
                      {absencePlanText(r)}
                    </p>
                    {r.review_comment && (
                      <p className="text-xs text-neutral-500">💬 {r.review_comment}</p>
                    )}
                    {canReview && rejecting === r.id ? (
                      <div className="flex flex-col gap-1.5 pt-1">
                        <input
                          type="text"
                          autoFocus
                          value={comment}
                          maxLength={200}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="差し戻す理由・直してほしいこと"
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRejecting(null);
                              setComment("");
                            }}
                            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs dark:border-neutral-700"
                          >
                            やめる
                          </button>
                          <button
                            type="button"
                            disabled={!!busy || !comment.trim()}
                            onClick={() => review([r.id], "rejected", comment.trim())}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                          >
                            差し戻す
                          </button>
                        </div>
                      </div>
                    ) : (
                      canReview && (
                        <div className="flex gap-2 pt-1">
                          {r.status !== "approved" && (
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => review([r.id], "approved", null)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                            >
                              承認
                            </button>
                          )}
                          {r.status !== "rejected" && (
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => {
                                setRejecting(r.id);
                                setComment("");
                              }}
                              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                            >
                              {r.status === "approved" ? "承認を取り消して差し戻す" : "差し戻す"}
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
