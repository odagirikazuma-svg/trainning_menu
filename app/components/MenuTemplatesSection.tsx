"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";
import { canCreateMenu } from "../lib/types";
import { describeAmount, newKey, toDraft, toRow, type MenuItemDraft } from "../lib/menuItems";
import MenuItemsEditor from "./board/MenuItemsEditor";

// 設定：練習メニューのテンプレートを作る・直す・消す（メニューを作れる人なら誰でも）
type Template = { id: string; name: string; purpose: string | null; items: Record<string, unknown>[] };
type Draft = { id: string | null; name: string; purpose: string; items: MenuItemDraft[] };

export default function MenuTemplatesSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = canCreateMenu(profile.role);

  async function load() {
    const { data, error } = await supabase
      .from("menu_templates")
      .select("id, name, purpose, items")
      .eq("team_id", profile.team_id)
      .order("name");
    if (error) return setMsg({ ok: false, text: error.message });
    setTemplates((data ?? []) as Template[]);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(t: Template | null) {
    setMsg(null);
    setDraft(
      t
        ? { id: t.id, name: t.name, purpose: t.purpose ?? "", items: (t.items ?? []).map((r) => ({ ...toDraft(r), key: newKey() })) }
        : { id: null, name: "", purpose: "", items: [] }
    );
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const items = draft.items.filter((d) => d.name.trim());
    if (!name) return setMsg({ ok: false, text: "テンプレートの名前を入れてください。" });
    if (items.length === 0) return setMsg({ ok: false, text: "項目を1つ以上入れてください。" });
    if (templates?.some((t) => t.name === name && t.id !== draft.id))
      return setMsg({ ok: false, text: "同じ名前のテンプレートがあります。" });
    setBusy(true);
    const payload = {
      team_id: profile.team_id,
      name,
      purpose: draft.purpose.trim() || null,
      items: items.map((d) => toRow(d)),
      updated_at: new Date().toISOString(),
    };
    const { error } = draft.id
      ? await supabase.from("menu_templates").update(payload).eq("id", draft.id)
      : await supabase.from("menu_templates").insert({ ...payload, created_by: profile.id });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
    setDraft(null);
    setMsg({ ok: true, text: `「${name}」を保存しました。` });
    await load();
  }

  async function remove(t: Template) {
    if (!window.confirm(`テンプレート「${t.name}」を削除しますか？（作成済みのメニューには影響しません）`)) return;
    const { error } = await supabase.from("menu_templates").delete().eq("id", t.id);
    if (error) return setMsg({ ok: false, text: `削除できませんでした：${error.message}` });
    if (draft?.id === t.id) setDraft(null);
    await load();
  }

  const input =
    "rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  if (!templates) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  if (draft) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          {draft.id ? "テンプレートを編集" : "新しいテンプレート"}
        </span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="名前（例：通常練習、試合前調整）"
          maxLength={30}
          className={input}
        />
        <input
          value={draft.purpose}
          onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          placeholder="目的・メモ（任意）"
          maxLength={40}
          className={input}
        />
        <MenuItemsEditor
          items={draft.items}
          onChange={(items) => setDraft({ ...draft, items })}
          canConfirm={profile.role === "coach"}
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
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy ? "保存中…" : "保存する"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        練習予定表でメニューを書くときに選べるテンプレートです。直しても、作成済みのメニューは変わりません。
      </p>
      {templates.length === 0 && <p className="text-xs text-neutral-500">まだテンプレートはありません。</p>}
      {templates.map((t) => (
        <div
          key={t.id}
          className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {t.name}
              {t.purpose && <span className="ml-1.5 text-xs font-normal text-neutral-500">{t.purpose}</span>}
            </span>
            {editable && (
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => open(t)}
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
          <span className="text-[length:calc(11px+var(--fs-add))] leading-relaxed text-neutral-600 dark:text-neutral-400">
            {(t.items ?? [])
              .map((r) => {
                const d = toDraft(r);
                const a = describeAmount(d);
                return a ? `${d.name} ${a}` : d.name;
              })
              .join(" ／ ")}
          </span>
        </div>
      ))}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      {editable && (
        <button
          type="button"
          onClick={() => open(null)}
          className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white"
        >
          ＋ テンプレートを作る
        </button>
      )}
    </div>
  );
}
