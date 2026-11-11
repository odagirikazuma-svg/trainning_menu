"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

// 日報の「今日の疲労度」（1〜10の自己評価）。
// 参考値として扱うため提出の必須項目にはせず、タップした時点ですぐ保存する。
// 見られるのは本人と管理者・マネージャーのみ（daily_conditions の RLS）。

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function fatigueColor(v: number) {
  if (v >= 8) return "bg-red-600 text-white";
  if (v >= 6) return "bg-amber-500 text-white";
  if (v >= 4) return "bg-emerald-600 text-white";
  return "bg-sky-600 text-white";
}

export default function FatigueSelector({
  memberId,
  teamId,
  date,
  readOnly = false,
}: {
  memberId: string;
  teamId: string;
  date: string;
  readOnly?: boolean;
}) {
  const supabase = createClient();
  const [value, setValue] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    supabase
      .from("daily_conditions")
      .select("fatigue")
      .eq("author_id", memberId)
      .eq("date", date)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        // テーブルがまだ無い環境では欄ごと出さない
        if (error) {
          setValue(null);
          setError(error.message);
        } else {
          setValue((data as { fatigue: number } | null)?.fatigue ?? null);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, date]);

  async function choose(v: number) {
    if (readOnly || saving) return;
    const next = value === v ? null : v;
    const prev = value;
    setValue(next);
    setSaving(true);
    setError(null);
    const res =
      next === null
        ? await supabase
            .from("daily_conditions")
            .delete()
            .eq("author_id", memberId)
            .eq("date", date)
        : await supabase.from("daily_conditions").upsert(
            {
              team_id: teamId,
              author_id: memberId,
              date,
              fatigue: next,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "author_id,date" }
          );
    if (res.error) {
      setValue(prev);
      setError(res.error.message);
    }
    setSaving(false);
  }

  if (!loaded) return null;
  if (error && value === null && !saving && readOnly) return null;

  if (readOnly) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 px-3 py-2">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          😮‍💨 疲労度（自己評価）
        </span>
        {value === null ? (
          <span className="text-xs text-neutral-500">未入力</span>
        ) : (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-bold ${fatigueColor(value)}`}
          >
            {value} / 10
          </span>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
          😮‍💨 今日の疲労度（1＝元気 〜 10＝限界）
        </span>
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          {saving ? "保存中…" : value !== null ? "保存済み" : "任意"}
        </span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {LEVELS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => choose(v)}
            className={`rounded-md py-2 text-xs font-bold ${
              value === v
                ? fatigueColor(v)
                : "bg-white text-neutral-600 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
        タップするとすぐ保存されます。監督・コーチと自分だけが見られます。
      </span>
      {error && (
        <span className="text-[length:calc(10px+var(--fs-add))] text-red-600 dark:text-red-400">
          保存できませんでした：{error}
        </span>
      )}
    </section>
  );
}
