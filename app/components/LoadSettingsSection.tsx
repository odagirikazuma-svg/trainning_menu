"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";
import {
  CALC_VERSION,
  coefficientDefs,
  EXERCISE_COEF_PREFIX,
  exerciseCoefKey,
  pendingCategories,
  resolveSettings,
  type Coefficients,
  type LoadSettingsRow,
} from "../lib/loadEstimate";

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
  // チームの種目（トレ報で使う種目）。種目ごとの係数を入れる
  const [exercises, setExercises] = useState<{ id: string; name: string; measure: string }[]>([]);
  const [newEx, setNewEx] = useState({ name: "", measure: "reps", coef: "" });
  const [exMsg, setExMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("load_settings")
      .select("coefficients, retention, calc_version, updated_at")
      .eq("team_id", profile.team_id)
      .maybeSingle();
    if (error) return setMsg({ ok: false, text: error.message });
    const { coef, retention } = resolveSettings((data as LoadSettingsRow) ?? null);
    const keys = [
      ...coefficientDefs.map((c) => c.key),
      ...pendingCategories.map((c) => c.key),
      ...Object.keys(coef).filter((k) => k.startsWith(EXERCISE_COEF_PREFIX)),
    ];
    setCoefDraft(Object.fromEntries(keys.map((k) => [k, typeof coef[k] === "number" ? String(coef[k]) : ""])));
    setRetentionDraft(String(Math.round(retention * 100)));
    setUpdatedAt((data?.updated_at as string | undefined) ?? null);
    const ex = await supabase.from("exercises").select("id, name, measure").eq("team_id", profile.team_id).order("name");
    setExercises((ex.data ?? []) as { id: string; name: string; measure: string }[]);
    setLoaded(true);
  }

  // 設定から新しい種目を追加する（トレ報の種目の候補にも出る）。係数は「保存する」で反映
  async function addExercise() {
    const name = newEx.name.trim();
    if (!name) return setExMsg({ ok: false, text: "種目名を入れてください。" });
    if (name.length > 30) return setExMsg({ ok: false, text: "種目名は30文字までです。" });
    const n = Number(newEx.coef);
    if (newEx.coef.trim() !== "" && (!Number.isFinite(n) || n < 0)) return setExMsg({ ok: false, text: "係数は0以上の数字で入れてください。" });
    if (!exercises.some((e) => e.name === name)) {
      const { data, error } = await supabase
        .from("exercises")
        .insert({ team_id: profile.team_id, name, measure: newEx.measure, created_by: profile.id })
        .select("id, name, measure")
        .single();
      if (error) return setExMsg({ ok: false, text: `追加できませんでした：${error.message}` });
      setExercises((prev) => [...prev, data as { id: string; name: string; measure: string }].sort((a, b) => a.name.localeCompare(b.name, "ja")));
    }
    if (newEx.coef.trim() !== "") setCoefDraft((d) => ({ ...d, [exerciseCoefKey(name)]: newEx.coef.trim() }));
    setNewEx({ name: "", measure: "reps", coef: "" });
    setExMsg({ ok: true, text: `「${name}」を追加しました。係数は下の「保存する」で反映されます。` });
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
        <span className="ml-1">空欄（未定）の係数は、その種類を計算に入れません（倍率は掛けません）。</span>
      </p>
      <button
        type="button"
        onClick={() =>
          setCoefDraft((d) => ({
            ...d,
            ...Object.fromEntries(
              coefficientDefs.filter((c) => typeof c.suggested === "number").map((c) => [c.key, String(c.suggested)])
            ),
          }))
        }
        className="self-start text-xs text-neutral-500 underline"
      >
        標準の値に戻す
      </button>
      {["マット", "ラン", "ウェイト", "蓄積"].map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <span className={groupTitle}>{g}</span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {coefficientDefs
              .filter((c) => c.group === g)
              .map((c) => field(c.key, c.label, c.unit, c.suggested === null ? "未定" : String(c.suggested)))}
          </div>
          {g === "ラン" && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">
              階級（kg級）で軽量級・中量級・重量級を分けます。階級が未登録の人は中量級で計算します。強度の倍率は、メニューで選んだ強度（トレ報はタイムから出したペース）に掛けます。
            </span>
          )}
          {g === "ウェイト" && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">
              アップのセットは0です。種目ごとに変えたいときは、下の「種目ごとの係数」に入れてください。
            </span>
          )}
        </div>
      ))}
      <div className="flex flex-col gap-1.5 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        <span className={groupTitle}>種目ごとの係数（トレ報・メイン1セットあたり）</span>
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">
          入れた種目は、上の「ウェイト」の係数のかわりにこの係数で計算します。空欄の種目は上の係数のままです。
        </span>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {exercises.map((e) => field(exerciseCoefKey(e.name), e.name, e.measure === "time" ? "時間で記録" : "", "—"))}
        </div>
        <div className="flex flex-wrap items-end gap-1.5 rounded-lg bg-neutral-50 p-2 dark:bg-neutral-900">
          <input
            value={newEx.name}
            onChange={(e) => setNewEx((x) => ({ ...x, name: e.target.value }))}
            placeholder="新しい種目名"
            maxLength={30}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <select
            value={newEx.measure}
            onChange={(e) => setNewEx((x) => ({ ...x, measure: e.target.value }))}
            className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            aria-label="記録のしかた"
          >
            <option value="reps">回数で記録</option>
            <option value="time">時間で記録</option>
          </select>
          <input
            inputMode="decimal"
            value={newEx.coef}
            onChange={(e) => setNewEx((x) => ({ ...x, coef: e.target.value }))}
            placeholder="係数"
            className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-right text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <button
            type="button"
            onClick={addExercise}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-neutral-200 dark:text-neutral-900"
          >
            追加
          </button>
        </div>
        {exMsg && <p className={`text-xs ${exMsg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{exMsg.text}</p>}
      </div>
      {pendingCategories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={groupTitle}>まだ決まっていない種類（1分あたり）</span>
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-400">空欄のあいだは計算に入れません。決まったら数字を入れてください。</span>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {pendingCategories.map((c) => field(c.key, c.label, "1分あたり", "未定"))}
          </div>
        </div>
      )}
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
