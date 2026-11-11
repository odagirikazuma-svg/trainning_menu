"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";
import { CALC_VERSION, coefficientDefs, pendingCategories, resolveSettings, type Coefficients, type LoadSettingsRow } from "../lib/loadEstimate";

// 設定（監督だけ）：疲労度（負荷の試算）の係数と、蓄積が翌日に残る割合
export default function LoadSettingsSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [loaded, setLoaded] = useState(false);
  const [coefDraft, setCoefDraft] = useState<Record<string, string>>({});
  const [retentionDraft, setRetentionDraft] = useState("70");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("load_settings")
      .select("coefficients, retention, calc_version, updated_at")
      .eq("team_id", profile.team_id)
      .maybeSingle();
    if (error) return setMsg({ ok: false, text: error.message });
    const { coef, retention } = resolveSettings((data as LoadSettingsRow) ?? null);
    const keys = [...coefficientDefs.map((c) => c.key), ...pendingCategories.map((c) => c.key)];
    setCoefDraft(Object.fromEntries(keys.map((k) => [k, typeof coef[k] === "number" ? String(coef[k]) : ""])));
    setRetentionDraft(String(Math.round(retention * 100)));
    setUpdatedAt((data?.updated_at as string | undefined) ?? null);
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const c: Coefficients = {};
    for (const [k, v] of Object.entries(coefDraft)) {
      const n = Number(v);
      if (v.trim() !== "" && Number.isFinite(n) && n >= 0) c[k] = n;
    }
    const r = Number(retentionDraft);
    if (!Number.isFinite(r) || r < 0 || r >= 100) return setMsg({ ok: false, text: "残る割合は0〜99%で入れてください。" });
    setBusy(true);
    const { error } = await supabase.from("load_settings").upsert(
      {
        team_id: profile.team_id,
        coefficients: c,
        retention: r / 100,
        calc_version: CALC_VERSION,
        updated_by: profile.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id" }
    );
    setBusy(false);
    if (error) return setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
    setMsg({ ok: true, text: "保存しました。疲労度の計算に反映されます。" });
    await load();
  }

  if (!loaded && !msg) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  const field = (key: string, label: string, unit: string, placeholder: string) => (
    <label key={key} className="flex items-center justify-between gap-2 text-xs text-neutral-700 dark:text-neutral-300">
      <span>
        {label}
        <span className="ml-1 text-neutral-400">{unit}</span>
      </span>
      <input
        inputMode="decimal"
        value={coefDraft[key] ?? ""}
        placeholder={placeholder}
        onChange={(e) => setCoefDraft((d) => ({ ...d, [key]: e.target.value }))}
        className={"w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm text-neutral-900 placeholder:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-700"}
      />
    </label>
  );
  const groupTitle = "text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-800 dark:text-neutral-200";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        管理ページ「体調」と、部員本人の振り返りの疲労度に使います。0＝疲れなしで、練習するほど積み上がります。
        {updatedAt && `（最終更新 ${new Date(updatedAt).toLocaleDateString("ja-JP")}）`}
        <span className="ml-1">計算式 {CALC_VERSION}</span>
      </p>
      <button
        type="button"
        onClick={() =>
          setCoefDraft((d) => ({ ...d, ...Object.fromEntries(coefficientDefs.map((c) => [c.key, String(c.suggested)])) }))
        }
        className="self-start text-xs text-neutral-500 underline"
      >
        標準の値に戻す
      </button>
      {["マット", "ラン", "ウェイト", "蓄積"].map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <span className={groupTitle}>{g}</span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {coefficientDefs.filter((c) => c.group === g).map((c) => field(c.key, c.label, c.unit, String(c.suggested)))}
          </div>
          {g === "ラン" && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">
              階級（kg級）で軽量級・中量級・重量級を分けます。階級が未登録の人は中量級で計算します。
            </span>
          )}
          {g === "ウェイト" && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">アップのセットは0です。</span>
          )}
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <span className={groupTitle}>まだ決まっていない種類（1分あたり）</span>
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">空欄のあいだは計算に入れません。決まったら数字を入れてください。</span>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {pendingCategories.map((c) => field(c.key, c.label, "1分あたり", "未定"))}
        </div>
      </div>
      <label className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-2 text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
        <span>
          前日までの蓄積が翌日に残る割合
          <span className="block text-neutral-400">日付が変わるたびにこの割合に減ります（オフの日はさらに上の「オフの日の回復」を引きます）</span>
        </span>
        <span className="flex items-center gap-1">
          <input
            inputMode="numeric"
            value={retentionDraft}
            onChange={(e) => setRetentionDraft(e.target.value)}
            className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          %
        </span>
      </label>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="self-end rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? "保存中…" : "保存する"}
      </button>
    </div>
  );
}
