"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";

// 設定（監督だけ）：代表種目。部員の振り返り「種目ごとの記録」で先に固定して出す種目。
// 将来のチーム内ランキングもこの種目で行う。BIG3（ベンチ・スクワット・デッド）は測定会の記録があれば自動で入る
export default function FeaturedExercisesSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [exercises, setExercises] = useState<{ id: string; name: string; measure: string }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      const [ex, fe] = await Promise.all([
        supabase.from("exercises").select("id, name, measure").eq("team_id", profile.team_id).order("name"),
        supabase.from("team_featured_exercises").select("exercise_id, sort_order").eq("team_id", profile.team_id).order("sort_order"),
      ]);
      setExercises((ex.data ?? []) as { id: string; name: string; measure: string }[]);
      if (fe.error) setMsg({ ok: false, text: "準備中です（SQLの実行が必要です）。" });
      else setPicked(((fe.data ?? []) as { exercise_id: string }[]).map((r) => r.exercise_id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(id: string) {
    setMsg(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function move(id: string, dir: -1 | 1) {
    setPicked((p) => {
      const i = p.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = p.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    const del = await supabase.from("team_featured_exercises").delete().eq("team_id", profile.team_id);
    const ins =
      !del.error && picked.length > 0
        ? await supabase
            .from("team_featured_exercises")
            .insert(picked.map((id, i) => ({ team_id: profile.team_id, exercise_id: id, sort_order: i })))
        : { error: del.error };
    setBusy(false);
    if (ins.error) return setMsg({ ok: false, text: `保存できませんでした：${ins.error.message}` });
    setMsg({ ok: true, text: "保存しました。部員の振り返りに反映されます。" });
  }

  if (!exercises) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  const nameOf = new Map(exercises.map((e) => [e.id, e.name]));
  const filtered = exercises.filter((e) => !query.trim() || e.name.includes(query.trim()));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        部員の振り返り「種目ごとの記録」で先に並べる種目です（将来のチーム内ランキングにも使います）。BIG3は測定会の記録があれば自動で先頭に入ります。
      </p>
      {picked.length > 0 && (
        <ol className="flex flex-col gap-1">
          {picked.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm dark:bg-red-950/30">
              <span className="w-5 text-xs text-neutral-500">{i + 1}</span>
              <span className="flex-1 text-neutral-900 dark:text-neutral-100">{nameOf.get(id) ?? "（削除された種目）"}</span>
              <button type="button" onClick={() => move(id, -1)} disabled={i === 0} className="px-1 text-neutral-500 disabled:opacity-30">
                ↑
              </button>
              <button type="button" onClick={() => move(id, 1)} disabled={i === picked.length - 1} className="px-1 text-neutral-500 disabled:opacity-30">
                ↓
              </button>
              <button type="button" onClick={() => toggle(id)} className="px-1 text-xs text-red-700 dark:text-red-400">
                外す
              </button>
            </li>
          ))}
        </ol>
      )}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="種目を探す"
        className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
        {filtered
          .filter((e) => !picked.includes(e.id))
          .map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
            >
              ＋ {e.name}
            </button>
          ))}
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      <button type="button" disabled={busy} onClick={save} className="self-end rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
        {busy ? "保存中…" : "保存する"}
      </button>
    </div>
  );
}
