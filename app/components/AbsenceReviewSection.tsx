"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  absencePlanText,
  absenceReasonText,
  absenceStateText,
  absenceStatusCls,
  type AbsenceRequest,
  sickStreakHeads,
  hasHospitalReport,
  absenceSessionsText,
} from "../lib/absence";

type Loc = "tama" | "otsuka";
type Row = AbsenceRequest & {
  author: { display_name: string; home_location: Loc | null } | null;
  permitter?: { display_name: string } | null;
};
const LOC_LABEL: Record<Loc, string> = { tama: "多摩", otsuka: "大塚" };

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

// 管理ページ「報告」タブの、休みの報告の一覧。
// 授業・学業は届け出、それ以外は部員が監督・管理者から直接許可をもらって報告する。
// 身に覚えのない報告は、管理者（コーチ）が取り消せる。マネージャーは見るだけ。
export default function AbsenceReviewSection({
  teamId,
  reviewerId,
  canReview,
  onChanged,
}: {
  teamId: string;
  reviewerId: string;
  canReview: boolean;
  // 承認待ちの件数が変わったとき（タブのバッジ用）
  onChanged?: (pending: number) => void;
}) {
  const [loc, setLoc] = useState<Loc>("tama");
  const [locPicked, setLocPicked] = useState(false);
  const router = useRouter();
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  // 直近2週間の体調不良（病院の報告を確認する）
  const [sickPast, setSickPast] = useState<Row[]>([]);
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
      .select(
        "*, author:profiles!absence_requests_author_id_fkey(display_name, home_location), permitter:profiles!absence_requests_permitted_by_fkey(display_name)"
      )
      .eq("team_id", teamId)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      setUnavailable(true);
    } else {
      const list = (data ?? []) as unknown as Row[];
      setRows(list);
      onChanged?.(list.filter((r) => r.status === "pending").length);
      const since = toDateKey(new Date(Date.now() - 14 * 86400_000));
      const { data: past } = await supabase
        .from("absence_requests")
        .select("*, author:profiles!absence_requests_author_id_fkey(display_name, home_location), permitter:profiles!absence_requests_permitted_by_fkey(display_name)")
        .eq("team_id", teamId)
        .eq("reason_type", "sick")
        .neq("status", "rejected")
        .gte("date", since)
        .lt("date", todayStr)
        .order("date", { ascending: false });
      setSickPast((past ?? []) as unknown as Row[]);
      // 最初は、承認待ちがある拠点を開く
      if (!locPicked) {
        const p = list.filter((r) => r.status === "pending");
        if (p.length > 0 && p.every((r) => r.author?.home_location === "otsuka")) setLoc("otsuka");
      }
    }
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  // LINEの「承認待ち」ボタンから来たとき（#absence）は、この欄までスクロールする
  useEffect(() => {
    if (loaded && typeof window !== "undefined" && window.location.hash === "#absence") {
      document.getElementById("absence")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [loaded]);

  // 続けて休んだ体調不良は、最初の日の病院の報告でまとめて済む
  const sickHeads = useMemo(() => sickStreakHeads([...sickPast, ...rows]), [sickPast, rows]);
  const rowsOf = (l: Loc) => rows.filter((r) => (r.author?.home_location ?? "tama") === l);
  const byDate = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows.filter((x) => (x.author?.home_location ?? "tama") === loc)) {
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date)!.push(r);
    }
    return Array.from(m.entries());
  }, [rows, loc]);

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
    <section id="absence" className="flex scroll-mt-24 flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-block h-3.5 w-1 rounded-full bg-amber-500" />
        休みの報告
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-white">
            承認待ち {pendingCount}
          </span>
        )}
      </h2>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
        {(["tama", "otsuka"] as Loc[]).map((l) => {
          const pend = rowsOf(l).filter((r) => r.status === "pending").length;
          return (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLoc(l);
                setLocPicked(true);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ${
                loc === l
                  ? "bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100"
                  : "text-neutral-500"
              }`}
            >
              {LOC_LABEL[l]}
              <span className="text-xs font-normal text-neutral-500">{rowsOf(l).length}件</span>
              {pend > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[length:calc(10px+var(--fs-add))] font-bold text-white">
                  {pend}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
      {byDate.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
          {LOC_LABEL[loc]}の今日以降の休みの報告はありません。
        </p>
      ) : (
        byDate.map(([date, list]) => {
          const pendingIds = list.filter((r) => r.status === "pending").map((r) => r.id);
          return (
            <div
              key={date}
              className={`flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-900/70 ${
                date === todayStr
                  ? "border-red-300 dark:border-red-900"
                  : date === tomorrowStr
                    ? "border-amber-300 dark:border-amber-900"
                    : "border-neutral-200 dark:border-neutral-800"
              }`}
            >
              {/* 日付の見出し帯：今日＝赤、明日＝オレンジ、それ以降＝グレー */}
              <div
                className={`flex items-center justify-between gap-2 px-3 py-2 ${
                  date === todayStr
                    ? "bg-red-600 text-white"
                    : date === tomorrowStr
                      ? "bg-amber-500 text-white"
                      : "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                }`}
              >
                <span className="flex items-baseline gap-2">
                  {(date === todayStr || date === tomorrowStr) && (
                    <span className="rounded bg-white/25 px-1.5 py-0.5 text-[length:calc(11px+var(--fs-add))] font-bold">
                      {date === todayStr ? "今日" : "明日"}
                    </span>
                  )}
                  <span className="text-base font-extrabold tracking-wide">{dateLabel(date, "", "")}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-bold">
                    休み {list.filter((r) => r.status !== "rejected").length}人
                  </span>
                  {list.some((r) => r.status === "rejected") && (
                    <span className="text-[length:calc(11px+var(--fs-add))] opacity-80">
                      （取り消し{list.filter((r) => r.status === "rejected").length}）
                    </span>
                  )}
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
              <ul className="flex flex-col divide-y divide-neutral-100 px-3 dark:divide-neutral-800">
                {list.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/team/${r.author_id}?date=${r.date}`)}
                        className="text-sm font-semibold text-neutral-900 underline decoration-dotted dark:text-neutral-100"
                      >
                        {r.author?.display_name ?? "（不明）"}
                      </button>
                      <span className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${absenceStatusCls[r.status]}`}>
                        {absenceStateText(r, r.permitter?.display_name)}
                      </span>
                    </div>
                    {r.session_keys && r.session_keys.length > 0 && (
                      <p className="text-xs text-neutral-700 dark:text-neutral-300">
                        <span className="text-neutral-500">休むセクション：</span>
                        <b>{absenceSessionsText(r.session_keys)}</b>（ほかは参加）
                      </p>
                    )}
                    <p className="text-xs text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500">理由：</span>
                      {absenceReasonText(r)}
                    </p>
                    <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                      <span className="text-neutral-500">代替：</span>
                      {absencePlanText(r)}
                    </p>
                    {r.reason_type === "sick" && r.status !== "rejected" && <HospitalLine r={r} head={sickHeads.get(r.id)} />}
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
                          placeholder="取り消す理由（例：許可していない、直接連絡がない）"
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRejecting(null);
                              setComment("");
                            }}
                            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                          >
                            やめる
                          </button>
                          <button
                            type="button"
                            disabled={!!busy || !comment.trim()}
                            onClick={() => review([r.id], "rejected", comment.trim())}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                          >
                            取り消す
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
                              className="rounded-lg border border-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-400"
                            >
                              {r.status === "rejected" ? "取り消しを戻す" : "承認"}
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
                              身に覚えがないので取り消す
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
      {sickPast.filter((r) => (r.author?.home_location ?? "tama") === loc).length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/70">
          <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">🏥 体調不良の病院の報告（直近2週間）</span>
          <ul className="flex flex-col divide-y divide-neutral-100 dark:divide-neutral-800">
            {sickPast
              .filter((r) => (r.author?.home_location ?? "tama") === loc)
              .map((r) => (
                <li key={r.id} className="flex flex-col gap-0.5 py-1.5">
                  <span className="text-xs text-neutral-800 dark:text-neutral-200">
                    <b>{r.author?.display_name ?? "（不明）"}</b>
                    <span className="ml-1.5 text-neutral-500">{dateLabel(r.date, todayStr, tomorrowStr)}休み・{absenceReasonText(r)}</span>
                  </span>
                  <HospitalLine r={r} head={sickHeads.get(r.id)} />
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HospitalLine({ r, head }: { r: AbsenceRequest; head?: AbsenceRequest }) {
  const target = head ?? r;
  const cont = head && head.id !== r.id ? `${Number(head.date.slice(5, 7))}/${Number(head.date.slice(8, 10))}からの続き` : "";
  if (!hasHospitalReport(target))
    return (
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
        🏥 病院の報告：まだ{cont && <span className="ml-1 font-normal text-neutral-500">（{cont}）</span>}
      </p>
    );
  return (
    <p className="whitespace-pre-wrap text-xs text-sky-900 dark:text-sky-200">
      🏥 {cont && <span className="text-neutral-500">{cont}・</span>}
      {target.hospital_name}
      {target.hospital_result && <span className="text-neutral-700 dark:text-neutral-300">：{target.hospital_result}</span>}
    </p>
  );
}
