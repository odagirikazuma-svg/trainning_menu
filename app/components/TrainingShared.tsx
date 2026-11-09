"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { TrainingType } from "../lib/types";
import type { Profile } from "./AuthGate";

// マイページ（日報・トレーニング）で共通に使う、トレーニング記録まわりの小さな部品。

type WeightLogRow = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
};

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

export function RecentTypeLogs({
  supabase,
  authorId,
  excludeDate,
  type,
  title,
  label,
}: {
  supabase: ReturnType<typeof createClient>;
  authorId: string;
  excludeDate: string;
  type: TrainingType;
  title?: string;
  label: string;
}) {
  const [logs, setLogs] = useState<WeightLogRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLogs(null);
    const timeout = setTimeout(async () => {
      let query = supabase
        .from("weight_logs")
        .select("id, date, content, type, title")
        .eq("author_id", authorId)
        .eq("type", type)
        .neq("date", excludeDate)
        .order("date", { ascending: false })
        .limit(3);
      if (type === "weight" && title) {
        query = query.eq("title", title);
      }
      const { data } = await query;
      if (!cancelled) setLogs((data ?? []) as WeightLogRow[]);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorId, excludeDate, type, title]);

  return (
    <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
      <h3 className="text-xs font-semibold text-neutral-400">{label}</h3>
      {logs === null ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-neutral-500">まだ記録がありません。</p>
      ) : (
        logs.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-3"
          >
            <p className="mb-1 text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-500">
              {formatMonthDay(r.date)}
            </p>
            <p className="whitespace-pre-wrap text-sm text-neutral-100">
              {r.content}
            </p>
          </div>
        ))
      )}
    </div>
  );
}


type TrainingCommentRow = {
  id: string;
  author_id: string;
  text: string;
  created_at: string;
  author: { display_name: string } | null;
};

// トレーニング（マット以外）記録に対するコメントスレッド。
// コーチ・本人どちらからもコメントでき、お互いのフィードバックに使える。
export function TrainingCommentThread({
  weightLogId,
  profile,
}: {
  weightLogId: string;
  profile: Profile;
}) {
  const supabase = createClient();
  const [comments, setComments] = useState<TrainingCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("weight_log_comments")
      .select(
        "id, author_id, text, created_at, author:profiles!weight_log_comments_author_id_fkey(display_name)"
      )
      .eq("weight_log_id", weightLogId)
      .order("created_at", { ascending: true });
    if (error) setErrorMsg(error.message);
    setComments((data ?? []) as unknown as TrainingCommentRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightLogId]);

  async function handlePost() {
    if (!text.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("weight_log_comments").insert({
      weight_log_id: weightLogId,
      team_id: profile.team_id,
      author_id: profile.id,
      text: text.trim(),
    });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setText("");
      await load();
    }
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <p className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-400">コメント</p>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-neutral-500">まだコメントはありません。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {comments.map((c) => {
            const name =
              c.author_id === profile.id
                ? "自分"
                : (c.author?.display_name ?? "コーチ");
            return (
              <div
                key={c.id}
                className="rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-neutral-100">{name}</span>
                  <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                    {c.created_at.slice(5, 10).replace("-", "/")}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-neutral-200">
                  {c.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-[length:calc(11px+var(--fs-add))] text-red-400">
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="コメントを入力"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100"
        />
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
}
