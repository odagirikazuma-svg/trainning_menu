"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";
import { CALC_VERSION, coefficientDefs, type Coefficients } from "../lib/loadEstimate";

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
      .select("coefficients, retention, updated_at")
      .eq("team_id", profile.team_id)
      .maybeSingle();
    if (error) return setMsg({ ok: false, text: error.message });
    const coef = ((data?.coefficients as Coefficients) ?? {}) as Coefficients;
    setCoefDraft(Object.fromEntries(coefficientDefs.map((c) => [c.key, typeof coef[c.key] === "number" ? String(coef[c.key]) : ""])));
    setRetentionDraft(String(Math.round(Number(data?.retention ?? 0.7) * 100)));
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
    setMsg({ ok: true, text: "保存しました。管理ページ「体調」の試算に反映されます。" });
    await load();
  }

  if (!loaded && !msg) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        管理ページ「体調」の疲労度（負荷の試算）に使います。空欄の項目は計算に入れません。
        {updatedAt && `（最終更新 ${new Date(updatedAt).toLocaleDateString("ja-JP")}・計算式 ${CALC_VERSION}）`}
      </p>
      <button
        type="button"
        onClick={() =>
          setCoefDraft(Object.fromEntries(coefficientDefs.map((c) => [c.key, coefDraft[c.key]?.trim() ? coefDraft[c.key] : String(c.suggested)])))
        }
        className="self-start text-xs text-neutral-500 underline"
      >
        空欄におすすめの初期値を入れる
      </button>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {coefficientDefs.map((c) => (
          <label key={c.key} className="flex items-center justify-between gap-2 text-xs text-neutral-700 dark:text-neutral-300">
            <span>
              {c.label}
              <span className="ml-1 text-neutral-400">{c.unit}</span>
            </span>
            <input
              inputMode="decimal"
              value={coefDraft[c.key] ?? ""}
              placeholder={String(c.suggested)}
              onChange={(e) => setCoefDraft((d) => ({ ...d, [c.key]: e.target.value }))}
              className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm text-neutral-900 placeholder:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-700"
            />
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2 border-t border-neutral-200 pt-2 text-xs text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
        <span>
          前日までの蓄積が翌日に残る割合
          <span className="block text-neutral-400">休むと毎日この割合に減ります</span>
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
