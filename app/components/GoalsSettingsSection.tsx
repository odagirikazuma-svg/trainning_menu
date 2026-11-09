"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  GOAL_MAX_LENGTH,
  goalTerms,
  notifyGoalsChanged,
  type GoalTerm,
} from "../lib/goals";
import { useProfile } from "./shell/AppShell";

/**
 * 設定タブ「目標」。年間目標・月間目標を登録すると、ヘッダーに交互に表示される。
 */
export default function GoalsSettingsSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<GoalTerm, string>>({ long: "", short: "" });
  const [saved, setSaved] = useState<Record<GoalTerm, string>>({ long: "", short: "" });
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("member_goals")
        .select("term, content")
        .eq("author_id", profile.id)
        .in("term", ["long", "short"]);
      if (error) {
        setAvailable(false);
        setLoading(false);
        return;
      }
      const next: Record<GoalTerm, string> = { long: "", short: "" };
      for (const g of (data ?? []) as { term: GoalTerm; content: string }[]) {
        next[g.term] = g.content;
      }
      setDrafts(next);
      setSaved(next);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const changed = goalTerms.some(({ term }) => drafts[term].trim() !== saved[term]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const rows = goalTerms.map(({ term }) => ({
      team_id: profile.team_id,
      author_id: profile.id,
      term,
      content: drafts[term].trim().slice(0, GOAL_MAX_LENGTH),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("member_goals")
      .upsert(rows, { onConflict: "author_id,term" });
    setSaving(false);
    if (error) {
      setMessage({ ok: false, text: error.message });
      return;
    }
    const next = { long: rows[0].content, short: rows[1].content };
    setSaved(next);
    setDrafts(next);
    setMessage({ ok: true, text: "保存しました。ヘッダーに表示されます。" });
    notifyGoalsChanged();
  }

  if (loading) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  if (!available) {
    return <p className="text-xs text-neutral-500">目標の設定は準備中です。</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        登録した目標は、画面上のヘッダーに5秒ごとに切り替わって表示されます。
      </p>
      {goalTerms.map(({ term, label, hint }) => (
        <label key={term} className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs font-semibold text-neutral-300">
            {label}
            <span className="text-[length:calc(10px+var(--fs-add))] font-normal text-neutral-500">
              {drafts[term].length}/{GOAL_MAX_LENGTH}
            </span>
          </span>
          <input
            type="text"
            value={drafts[term]}
            maxLength={GOAL_MAX_LENGTH}
            onChange={(e) => {
              setDrafts((p) => ({ ...p, [term]: e.target.value }));
              setMessage(null);
            }}
            placeholder={hint}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-neutral-100"
          />
        </label>
      ))}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !changed}
        className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
      >
        {saving ? "保存中…" : "保存する"}
      </button>
      {message && (
        <p className={`text-xs ${message.ok ? "text-emerald-400" : "text-red-400"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
