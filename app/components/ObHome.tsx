"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";

type MatchReflectionEntry = {
  eventId: string;
  eventTitle: string;
  submittedAt: string;
  matchResult: string;
  matchTitle: string;
  matchCount: number | null;
  winCount: number | null;
  lossCount: number | null;
  reflection: string;
  goodPoints: string;
  challenges: string;
  improvementPlan: string;
  teamChallenges: string;
};

type WeightMaxEntry = {
  deadline: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

type InjuryEntry = {
  symptom_name: string;
  body_part: string;
  is_recovered: boolean;
  expected_recovery_date: string | null;
};

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

export default function ObHome({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const supabase = createClient();
  const [matchReflections, setMatchReflections] = useState<
    MatchReflectionEntry[]
  >([]);
  const [openReflectionId, setOpenReflectionId] = useState<string | null>(
    null
  );
  const [weightMaxes, setWeightMaxes] = useState<WeightMaxEntry[]>([]);
  const [injuries, setInjuries] = useState<InjuryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);

    const { data: reflectionData, error: reflectionError } = await supabase
      .from("team_event_submissions")
      .select(
        "event_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, event:team_events!team_event_submissions_event_id_fkey(title, type)"
      )
      .eq("author_id", profile.id);

    if (reflectionError) {
      setErrorMsg(reflectionError.message);
    } else {
      const rows = (reflectionData ?? []) as unknown as {
        event_id: string;
        updated_at: string;
        match_result: string | null;
        match_title: string | null;
        match_count: number | null;
        win_count: number | null;
        loss_count: number | null;
        reflection: string | null;
        good_points: string | null;
        challenges: string | null;
        improvement_plan: string | null;
        team_challenges: string | null;
        event: { title: string; type: string } | null;
      }[];
      setMatchReflections(
        rows
          .filter((r) => r.event?.type === "match_reflection")
          .map((r) => ({
            eventId: r.event_id,
            eventTitle: r.event?.title || r.match_title || "試合の振り返り",
            submittedAt: r.updated_at,
            matchResult: r.match_result ?? "",
            matchTitle: r.match_title ?? "",
            matchCount: r.match_count,
            winCount: r.win_count,
            lossCount: r.loss_count,
            reflection: r.reflection ?? "",
            goodPoints: r.good_points ?? "",
            challenges: r.challenges ?? "",
            improvementPlan: r.improvement_plan ?? "",
            teamChallenges: r.team_challenges ?? "",
          }))
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      );
    }

    const { data: maxData, error: maxError } = await supabase
      .from("weight_maxes")
      .select(
        "bench, squat, deadlift, event:weight_max_events!weight_maxes_event_id_fkey(deadline)"
      )
      .eq("author_id", profile.id);

    if (maxError) {
      setErrorMsg(maxError.message);
    } else {
      const rows = (maxData ?? []) as unknown as {
        bench: number | null;
        squat: number | null;
        deadlift: number | null;
        event: { deadline: string } | null;
      }[];
      setWeightMaxes(
        rows
          .filter((r) => r.event)
          .map((r) => ({
            deadline: r.event!.deadline,
            bench: r.bench,
            squat: r.squat,
            deadlift: r.deadlift,
          }))
          .sort((a, b) => b.deadline.localeCompare(a.deadline))
      );
    }

    const { data: injuryData, error: injuryError } = await supabase
      .from("injuries")
      .select("symptom_name, body_part, is_recovered, expected_recovery_date")
      .eq("author_id", profile.id)
      .order("created_at", { ascending: false });

    if (injuryError) {
      setErrorMsg(injuryError.message);
    } else {
      setInjuries((injuryData ?? []) as InjuryEntry[]);
    }

    setLoading(false);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          {profile.display_name}(OB)
        </h1>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}
        <p className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-xs text-neutral-400">
          在籍中に提出した記録を、これまで通り振り返ることができます。新しい練習メニューやタスクは表示されません。
        </p>

        {loading ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : (
          <>
            {/* 試合の振り返り */}
            <section className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
                試合の振り返り
              </h2>
              {matchReflections.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                  提出履歴はありません。
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {matchReflections.map((r) => {
                    const isOpen = openReflectionId === r.eventId;
                    return (
                      <div
                        key={r.eventId}
                        className="rounded-lg border border-neutral-800 bg-neutral-900"
                      >
                        <button
                          onClick={() =>
                            setOpenReflectionId(isOpen ? null : r.eventId)
                          }
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm"
                        >
                          <span className="font-medium text-neutral-100">
                            {r.eventTitle}の振り返り
                          </span>
                          <span className="shrink-0 text-[11px] text-neutral-500">
                            提出日{formatMonthDay(r.submittedAt.slice(0, 10))}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="flex flex-col gap-2 border-t border-neutral-800 p-3 text-sm">
                            {r.matchResult && (
                              <p>
                                <span className="text-neutral-500">
                                  試合結果：
                                </span>
                                {r.matchResult}
                              </p>
                            )}
                            {r.matchTitle && (
                              <p>
                                <span className="text-neutral-500">
                                  試合名：
                                </span>
                                {r.matchTitle}
                              </p>
                            )}
                            {r.matchCount != null && (
                              <p>
                                <span className="text-neutral-500">
                                  試合数：
                                </span>
                                {r.matchCount}試合（{r.winCount ?? 0}勝{" "}
                                {r.lossCount ?? 0}敗）
                              </p>
                            )}
                            {r.reflection && (
                              <div>
                                <p className="text-[11px] text-neutral-500">
                                  試合の反省
                                </p>
                                <p className="whitespace-pre-wrap text-neutral-100">
                                  {r.reflection}
                                </p>
                              </div>
                            )}
                            {r.goodPoints && (
                              <div>
                                <p className="text-[11px] text-neutral-500">
                                  良かった点
                                </p>
                                <p className="whitespace-pre-wrap text-neutral-100">
                                  {r.goodPoints}
                                </p>
                              </div>
                            )}
                            {r.challenges && (
                              <div>
                                <p className="text-[11px] text-neutral-500">
                                  課題に感じた点
                                </p>
                                <p className="whitespace-pre-wrap text-neutral-100">
                                  {r.challenges}
                                </p>
                              </div>
                            )}
                            {r.improvementPlan && (
                              <div>
                                <p className="text-[11px] text-neutral-500">
                                  改善方法と必要だと考えるトレーニング
                                </p>
                                <p className="whitespace-pre-wrap text-neutral-100">
                                  {r.improvementPlan}
                                </p>
                              </div>
                            )}
                            {r.teamChallenges && (
                              <div>
                                <p className="text-[11px] text-neutral-500">
                                  当部の課題
                                </p>
                                <p className="whitespace-pre-wrap text-neutral-100">
                                  {r.teamChallenges}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ウェイトMAXの推移 */}
            <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
                ウェイトMAXの記録
              </h2>
              {weightMaxes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                  提出履歴はありません。
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-neutral-800">
                  <table className="w-full text-xs">
                    <thead className="bg-neutral-900">
                      <tr className="border-b border-neutral-800 text-neutral-500">
                        <th className="px-2 py-1.5 text-left font-medium">
                          計測日
                        </th>
                        <th className="px-1 py-1.5 text-right font-medium">
                          BP
                        </th>
                        <th className="px-1 py-1.5 text-right font-medium">
                          SQ
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          DL
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {weightMaxes.map((w, idx) => (
                        <tr key={idx}>
                          <td className="px-2 py-1.5 text-neutral-100">
                            {formatMonthDay(w.deadline)}
                          </td>
                          <td className="px-1 py-1.5 text-right text-neutral-300">
                            {w.bench ?? "-"}
                          </td>
                          <td className="px-1 py-1.5 text-right text-neutral-300">
                            {w.squat ?? "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-neutral-300">
                            {w.deadlift ?? "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 怪我の記録 */}
            <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
                怪我の記録
              </h2>
              {injuries.length === 0 ? (
                <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                  報告されている怪我はありません。
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {injuries.map((inj, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
                    >
                      <span className="text-neutral-100">
                        {inj.symptom_name}（{inj.body_part}）
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          inj.is_recovered
                            ? "bg-emerald-950/40 text-emerald-400"
                            : "bg-amber-950/40 text-amber-400"
                        }`}
                      >
                        {inj.is_recovered ? "完治" : "療養中"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        <div className="border-t border-neutral-800 pt-4">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-800"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
