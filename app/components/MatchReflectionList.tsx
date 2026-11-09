"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";
import InsightCard from "./InsightCard";

/**
 * 振り返りタブ「試合の振り返り」。
 * イベントの「試合の振り返り」で自分が提出した内容を、新しい順に並べる。
 * 通算の試合数・勝敗もまとめて出す。
 */

type Reflection = {
  event_id: string;
  updated_at: string;
  match_title: string | null;
  match_result: string | null;
  match_count: number | null;
  win_count: number | null;
  loss_count: number | null;
  reflection: string | null;
  good_points: string | null;
  challenges: string | null;
  improvement_plan: string | null;
  team_challenges: string | null;
  event: { type: string; title: string; deadline: string | null } | null;
};

function formatDate(s: string) {
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default function MatchReflectionList({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const [rows, setRows] = useState<Reflection[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("team_event_submissions")
        .select(
          "event_id, updated_at, match_title, match_result, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, event:team_events!team_event_submissions_event_id_fkey(type, title, deadline)"
        )
        .eq("author_id", profile.id)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      const list = ((data ?? []) as unknown as Reflection[]).filter(
        (r) => r.event?.type === "match_reflection"
      );
      setRows(list);
      setOpenId(list[0]?.event_id ?? null);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);


  if (rows === null) {
    return (
      <InsightCard id="ins-match" icon="🤼" title="試合の振り返り" subtitle="イベントで提出した振り返り">
        <p className="text-xs text-neutral-500">読み込み中…</p>
      </InsightCard>
    );
  }

  const totals = rows.reduce(
    (a, r) => ({
      matches: a.matches + (r.match_count ?? 0),
      wins: a.wins + (r.win_count ?? 0),
      losses: a.losses + (r.loss_count ?? 0),
    }),
    { matches: 0, wins: 0, losses: 0 }
  );

  const field = (label: string, value: string | null) =>
    value ? (
      <div className="flex flex-col gap-0.5">
        <span className="text-[length:calc(10px+var(--fs-add))] font-semibold text-neutral-500">
          {label}
        </span>
        <p className="whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">{value}</p>
      </div>
    ) : null;

  return (
    <InsightCard id="ins-match" icon="🤼" title="試合の振り返り" subtitle="イベントで提出した振り返り">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
          まだ提出した試合の振り返りはありません（イベントの「試合の振り返り」で提出すると、ここに並びます）。
        </p>
      ) : (
        <>
          {totals.matches > 0 && (
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              通算 {totals.matches}試合 {totals.wins}勝{totals.losses}敗
              {totals.matches > 0 && `（勝率 ${Math.round((totals.wins / totals.matches) * 100)}%）`}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {rows.map((r) => {
              const isOpen = openId === r.event_id;
              return (
                <div
                  key={r.event_id}
                  className="overflow-hidden rounded-xl bg-neutral-50 dark:bg-neutral-800/50"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : r.event_id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {r.match_title || r.event?.title || "試合"}
                      </span>
                      <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                        {formatDate(r.event?.deadline ?? r.updated_at)}
                        {r.match_count != null &&
                          `・${r.match_count}試合 ${r.win_count ?? 0}勝${r.loss_count ?? 0}敗`}
                      </span>
                    </span>
                    {r.match_result && (
                      <span className="shrink-0 rounded bg-red-600/90 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-white">
                        {r.match_result}
                      </span>
                    )}
                    <span className="shrink-0 text-neutral-500">{isOpen ? "▴" : "▾"}</span>
                  </button>
                  {isOpen && (
                    <div className="flex flex-col gap-2 border-t border-neutral-200 dark:border-neutral-800 px-3 py-2.5">
                      {field("良かった点", r.good_points)}
                      {field("課題", r.challenges)}
                      {field("反省", r.reflection)}
                      {field("今後の改善策", r.improvement_plan)}
                      {field("チームとしての課題", r.team_challenges)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </InsightCard>
  );
}
