"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";

// 試合に出る階級（kg）。ウェイトの負荷を階級の体重で割って評価するために使う。
const MEN_CLASSES = [57, 61, 65, 70, 74, 79, 86, 92, 97, 125];
const WOMEN_CLASSES = [50, 53, 55, 57, 59, 62, 65, 68, 72, 76];

export default function WeightClassSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [value, setValue] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("weight_class")
      .eq("id", profile.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setMsg({ ok: false, text: "階級の項目がまだデータベースにありません（SQLの実行待ち）。" });
        } else {
          const v = (data as { weight_class: number | null } | null)?.weight_class ?? null;
          setValue(v);
          if (v !== null && !MEN_CLASSES.includes(v) && !WOMEN_CLASSES.includes(v)) {
            setCustom(String(v));
          }
        }
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  async function save(v: number | null) {
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ weight_class: v })
      .eq("id", profile.id);
    if (error) {
      setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
    } else {
      setValue(v);
      setMsg({ ok: true, text: v === null ? "階級を未設定にしました。" : `${v}kg級で保存しました。` });
    }
    setSaving(false);
  }

  if (!loaded) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  const chip = (v: number) => (
    <button
      key={v}
      type="button"
      disabled={saving}
      onClick={() => save(value === v ? null : v)}
      className={`rounded-md py-1.5 text-xs font-semibold ${
        value === v
          ? "bg-red-600 text-white"
          : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
      }`}
    >
      {v}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        試合に出る階級を選んでください（kg）。ウェイトの負荷を、階級に応じて評価するために使います。
        {value !== null && (
          <span className="ml-1 font-semibold text-foreground">現在：{value}kg級</span>
        )}
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">男子</span>
        <div className="grid grid-cols-5 gap-1">{MEN_CLASSES.map(chip)}</div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">女子</span>
        <div className="grid grid-cols-5 gap-1">{WOMEN_CLASSES.map(chip)}</div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="その他（kg）"
          className="w-28 rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <button
          type="button"
          disabled={saving || !custom || Number(custom) <= 0}
          onClick={() => save(Math.round(Number(custom)))}
          className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          この階級で保存
        </button>
      </div>
      {msg && (
        <p
          className={`text-[length:calc(11px+var(--fs-add))] ${
            msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
