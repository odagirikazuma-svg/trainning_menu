"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";
import SetLogger, { blocksHaveData, SetSummary, type ExerciseBlock } from "./SetLogger";
import {
  absencePlanLabel,
  blocksToPlan,
  planToBlocks,
  type AbsencePlanTemplate,
} from "../lib/absence";

// 設定：休みの代替メニューのテンプレート（自分だけのもの。ほかの人には見えない）
type PlanType = AbsencePlanTemplate["plan_type"];
type Draft = { id: string | null; name: string; plan_type: PlanType; plan: string; blocks: ExerciseBlock[] };

function todayKey() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

export default function AbsencePlanTemplatesSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [list, setList] = useState<AbsencePlanTemplate[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = true; // 自分のテンプレートなので、誰でも作れる

  async function load() {
    const { data, error } = await supabase
      .from("absence_plan_templates")
      .select("id, name, plan_type, plan, plan_sets")
      .eq("created_by", profile.id)
      .order("name");
    if (error) {
      setMsg({ ok: false, text: error.message });
      setList([]);
      return;
    }
    setList((data ?? []) as AbsencePlanTemplate[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return setMsg({ ok: false, text: "名前を入れてください。" });
    const hasSets = draft.plan_type === "weight" && blocksHaveData(draft.blocks);
    if (!draft.plan.trim() && !hasSets) return setMsg({ ok: false, text: "内容を入れてください。" });
    setBusy(true);
    const payload = {
      team_id: profile.team_id,
      name: name.slice(0, 30),
      plan_type: draft.plan_type,
      plan: draft.plan.trim(),
      plan_sets: hasSets ? blocksToPlan(draft.blocks) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = draft.id
      ? await supabase.from("absence_plan_templates").update(payload).eq("id", draft.id)
      : await supabase.from("absence_plan_templates").insert({ ...payload, created_by: profile.id });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
    setDraft(null);
    setMsg({ ok: true, text: `「${name}」を保存しました。` });
    await load();
  }

  async function remove(t: AbsencePlanTemplate) {
    if (!window.confirm(`テンプレート「${t.name}」を削除しますか？`)) return;
    const { error } = await supabase.from("absence_plan_templates").delete().eq("id", t.id);
    if (error) return setMsg({ ok: false, text: `削除できませんでした：${error.message}` });
    await load();
  }

  const input =
    "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium ${
      on ? "bg-red-600 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
    }`;

  if (!list) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  if (draft) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          {draft.id ? "テンプレートを編集" : "新しいテンプレート"}
        </span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="名前（例：上半身ウェイト、ジョグ30分）"
          maxLength={30}
          className={input}
        />
        <div className="flex flex-wrap gap-1.5">
          {(["weight", "running", "other"] as PlanType[]).map((t) => (
            <button key={t} type="button" onClick={() => setDraft({ ...draft, plan_type: t })} className={chip(draft.plan_type === t)}>
              {absencePlanLabel[t]}
            </button>
          ))}
        </div>
        {draft.plan_type === "weight" && (
          <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:ring-neutral-800">
            <SetLogger
              supabase={supabase}
              profile={profile}
              date={todayKey()}
              blocks={draft.blocks}
              onChange={(blocks) => setDraft((d) => (d ? { ...d, blocks } : d))}
            />
          </div>
        )}
        <textarea
          value={draft.plan}
          onChange={(e) => setDraft({ ...draft, plan: e.target.value })}
          maxLength={300}
          rows={3}
          placeholder={draft.plan_type === "weight" ? "補足（任意）" : draft.plan_type === "running" ? "例：ジョグ30分、インターバル400m×8" : "例：体幹・ストレッチ30分"}
          className={input}
        />
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setMsg(null);
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            やめる
          </button>
          <button type="button" disabled={busy} onClick={save} className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {busy ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        休みの申請で、代替メニューを選ぶときに使える自分用のテンプレートです。ほかの人には見えません。
      </p>
      {list.length === 0 && <p className="text-xs text-neutral-500">まだテンプレートはありません。</p>}
      {list.map((t) => (
        <div key={t.id} className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {t.name}
              <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-normal text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {absencePlanLabel[t.plan_type]}
              </span>
            </span>
            {editable && (
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMsg(null);
                    setDraft({ id: t.id, name: t.name, plan_type: t.plan_type, plan: t.plan, blocks: planToBlocks(t.plan_sets) });
                  }}
                  className="rounded-md border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
                >
                  編集
                </button>
                <button
                  type="button"
                  onClick={() => remove(t)}
                  className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-700 dark:border-red-900 dark:text-red-400"
                >
                  削除
                </button>
              </span>
            )}
          </div>
          {t.plan_sets && t.plan_sets.length > 0 && <SetSummary blocks={planToBlocks(t.plan_sets)} />}
          {t.plan && <span className="whitespace-pre-wrap text-xs text-neutral-600 dark:text-neutral-400">{t.plan}</span>}
        </div>
      ))}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      {editable && (
        <button
          type="button"
          onClick={() => {
            setMsg(null);
            setDraft({ id: null, name: "", plan_type: "weight", plan: "", blocks: [] });
          }}
          className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          ＋ テンプレートを作る
        </button>
      )}
    </div>
  );
}
