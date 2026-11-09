"use client";

import { useEffect, useMemo, useState } from "react";
import type { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

/**
 * トレーニングの数値記録（種目ごと・セットごと）。
 * - 種目は部員が自分で追加でき、チーム内で共有される（他の人が追加した種目も選べる）
 * - 種目ごとに「回数で記録」か「時間で記録」かを決める
 * - 1セットごとに重量（任意）と、回数または時間を入れる。セットごとに変えてよい
 */

export type Measure = "reps" | "time";
export type Exercise = { id: string; name: string; measure: Measure; created_by?: string | null };
// warmup = ウォーミングアップのセット（分析の「メインセット」から外す）
export type SetDraft = {
  weight: string;
  reps: string;
  min: string;
  sec: string;
  warmup: boolean;
};
export type ExerciseBlock = { key: string; exercise: Exercise; sets: SetDraft[] };

type SetRow = {
  exercise_id: string;
  exercise_order: number;
  set_no: number;
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
  is_warmup?: boolean | null;
  exercise: Exercise | null;
};

export const measureLabel: Record<Measure, string> = { reps: "回数", time: "時間" };

let keySeq = 0;
function newKey() {
  keySeq += 1;
  return `b${Date.now()}-${keySeq}`;
}

export function emptySet(): SetDraft {
  return { weight: "", reps: "", min: "", sec: "", warmup: false };
}

function toNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function setSeconds(s: SetDraft): number | null {
  const m = toNum(s.min);
  const sec = toNum(s.sec);
  if (m == null && sec == null) return null;
  const total = Math.round((m ?? 0) * 60 + (sec ?? 0));
  return total > 0 ? total : null;
}

// そのセットに記録として残す値があるか（回数か時間が入っていれば有効）
function setIsFilled(measure: Measure, s: SetDraft) {
  if (measure === "reps") return (toNum(s.reps) ?? 0) > 0;
  return setSeconds(s) != null;
}

export function blocksHaveData(blocks: ExerciseBlock[]) {
  return blocks.some((b) => b.sets.some((s) => setIsFilled(b.exercise.measure, s)));
}

export function formatSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}秒`;
}

function formatWeight(w: number) {
  return `${Number.isInteger(w) ? w : Number(w.toFixed(2))}kg`;
}

function rowToDraft(r: SetRow): SetDraft {
  return {
    weight: r.weight_kg != null ? String(Number(r.weight_kg)) : "",
    reps: r.reps != null ? String(r.reps) : "",
    min: r.seconds != null ? String(Math.floor(r.seconds / 60)) : "",
    sec: r.seconds != null ? String(r.seconds % 60) : "",
    warmup: !!r.is_warmup,
  };
}

function rowsToBlocks(rows: SetRow[]): ExerciseBlock[] {
  const byOrder = new Map<number, ExerciseBlock>();
  const sorted = rows
    .slice()
    .sort((a, b) => a.exercise_order - b.exercise_order || a.set_no - b.set_no);
  for (const r of sorted) {
    if (!r.exercise) continue;
    let b = byOrder.get(r.exercise_order);
    if (!b) {
      b = { key: newKey(), exercise: r.exercise, sets: [] };
      byOrder.set(r.exercise_order, b);
    }
    b.sets.push(rowToDraft(r));
  }
  return Array.from(byOrder.values());
}

const SET_COLUMNS =
  "exercise_id, exercise_order, set_no, weight_kg, reps, seconds, is_warmup, exercise:exercises(id, name, measure)";
// is_warmup 列がまだ無いDB向けの読み込み列
const SET_COLUMNS_LEGACY =
  "exercise_id, exercise_order, set_no, weight_kg, reps, seconds, exercise:exercises(id, name, measure)";

/** トレ報1件分のセット記録を読み込む（テーブル未作成の環境では空） */
export async function loadSetsForLog(
  supabase: SupabaseBrowserClient,
  logId: string
): Promise<ExerciseBlock[]> {
  let res: { data: unknown[] | null; error: unknown } = await supabase
    .from("training_sets")
    .select(SET_COLUMNS)
    .eq("weight_log_id", logId);
  if (res.error) {
    res = await supabase
      .from("training_sets")
      .select(SET_COLUMNS_LEGACY)
      .eq("weight_log_id", logId);
  }
  if (res.error) return [];
  return rowsToBlocks((res.data ?? []) as unknown as SetRow[]);
}

/** トレ報1件分のセット記録を、入力内容で置き換える */
export async function saveSetsForLog(
  supabase: SupabaseBrowserClient,
  args: { teamId: string; authorId: string; logId: string; date: string; blocks: ExerciseBlock[] }
): Promise<string | null> {
  const rows: Record<string, unknown>[] = [];
  args.blocks.forEach((b, bi) => {
    let setNo = 0;
    for (const s of b.sets) {
      if (!setIsFilled(b.exercise.measure, s)) continue;
      setNo += 1;
      rows.push({
        team_id: args.teamId,
        author_id: args.authorId,
        weight_log_id: args.logId,
        date: args.date,
        exercise_id: b.exercise.id,
        exercise_order: bi + 1,
        set_no: setNo,
        weight_kg: toNum(s.weight),
        reps: b.exercise.measure === "reps" ? Math.round(toNum(s.reps) ?? 0) : null,
        seconds: b.exercise.measure === "time" ? setSeconds(s) : null,
        is_warmup: s.warmup,
      });
    }
  });
  const { error: delError } = await supabase
    .from("training_sets")
    .delete()
    .eq("weight_log_id", args.logId);
  if (delError) {
    // テーブルがまだ無い環境で、数値を入れていなければ何もしない
    return rows.length > 0 ? delError.message : null;
  }
  if (rows.length === 0) return null;
  const { error } = await supabase.from("training_sets").insert(rows);
  if (error && error.message.includes("is_warmup")) {
    // is_warmup 列がまだ無いDBでは、アップの印なしで保存する
    const { error: retryError } = await supabase
      .from("training_sets")
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .insert(rows.map(({ is_warmup: _omit, ...rest }) => rest));
    return retryError ? retryError.message : null;
  }
  return error ? error.message : null;
}

/** 前回（指定日より前）のこの種目の記録を読み込む */
async function loadPreviousSets(
  supabase: SupabaseBrowserClient,
  authorId: string,
  exerciseId: string,
  beforeDate: string
): Promise<SetDraft[] | null> {
  const query = (cols: string) =>
    supabase
      .from("training_sets")
      .select(cols)
      .eq("author_id", authorId)
      .eq("exercise_id", exerciseId)
      .lt("date", beforeDate)
      .order("date", { ascending: false })
      .order("set_no", { ascending: true })
      .limit(40);
  let { data, error } = await query("date, set_no, weight_kg, reps, seconds, is_warmup");
  if (error) ({ data, error } = await query("date, set_no, weight_kg, reps, seconds"));
  const rows = (data ?? []) as unknown as {
    date: string;
    set_no: number;
    weight_kg: number | null;
    reps: number | null;
    seconds: number | null;
    is_warmup: boolean | null;
  }[];
  if (rows.length === 0) return null;
  const last = rows[0].date;
  return rows
    .filter((r) => r.date === last)
    .map((r) =>
      rowToDraft({
        ...r,
        exercise_id: exerciseId,
        exercise_order: 1,
        exercise: null,
      })
    );
}

/** 前回のトレ報（weight_logs.id）のセット記録を、そのまま入力欄に写す */
export async function copyBlocksFromLog(
  supabase: SupabaseBrowserClient,
  logId: string
): Promise<ExerciseBlock[]> {
  return loadSetsForLog(supabase, logId);
}

/** 1セットを文字にする（例：60kg×10、1:30、20kg×1:00） */
function setText(measure: Measure, s: SetDraft) {
  const w = toNum(s.weight);
  const main =
    measure === "reps" ? `${Math.round(toNum(s.reps) ?? 0)}回` : formatSeconds(setSeconds(s) ?? 0);
  const body = w != null ? `${formatWeight(w)}×${main}` : main;
  return s.warmup ? `(アップ)${body}` : body;
}

/**
 * 記録を文字にまとめる（例：「ベンチプレス 60kg×10回 / 80kg×8回」）。
 * メモ欄が空のときは、これをトレ報の本文として保存し、
 * 練習予定表やチームページなど本文を表示する画面でも中身が分かるようにする。
 */
export function blocksSummaryText(blocks: ExerciseBlock[]) {
  return blocks
    .filter((b) => b.sets.some((s) => setIsFilled(b.exercise.measure, s)))
    .map(
      (b) =>
        `${b.exercise.name} ${b.sets
          .filter((s) => setIsFilled(b.exercise.measure, s))
          .map((s) => setText(b.exercise.measure, s))
          .join(" / ")}`
    )
    .join("\n");
}

/** 提出済みの記録を読みやすく表示する */
export function SetSummary({ blocks }: { blocks: ExerciseBlock[] }) {
  const shown = blocks.filter((b) => b.sets.some((s) => setIsFilled(b.exercise.measure, s)));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((b) => (
        <div key={b.key} className="text-sm">
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">{b.exercise.name}</span>
          <span className="ml-2 text-neutral-700 dark:text-neutral-300">
            {b.sets
              .filter((s) => setIsFilled(b.exercise.measure, s))
              .map((s) => setText(b.exercise.measure, s))
              .join(" / ")}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 入力欄。blocks（種目ごとのセット）を親が持ち、変更は onChange で返す。
 */
export default function SetLogger({
  supabase,
  profile,
  date,
  blocks,
  onChange,
}: {
  supabase: SupabaseBrowserClient;
  profile: Profile;
  date: string;
  blocks: ExerciseBlock[];
  onChange: (blocks: ExerciseBlock[]) => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [available, setAvailable] = useState(true);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [newMeasure, setNewMeasure] = useState<Measure>("reps");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 編集中の種目（自分が追加した種目だけ、名前・記録方法の修正と削除ができる）
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [ex, used] = await Promise.all([
        supabase
          .from("exercises")
          .select("id, name, measure, created_by")
          .eq("team_id", profile.team_id)
          .order("name"),
        supabase
          .from("training_sets")
          .select("exercise_id")
          .eq("author_id", profile.id)
          .order("date", { ascending: false })
          .limit(500),
      ]);
      if (cancelled) return;
      if (ex.error) {
        setAvailable(false);
        return;
      }
      setExercises((ex.data ?? []) as Exercise[]);
      const counts = new Map<string, number>();
      for (const r of (used.data ?? []) as { exercise_id: string }[]) {
        counts.set(r.exercise_id, (counts.get(r.exercise_id) ?? 0) + 1);
      }
      setUsage(counts);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.team_id, profile.id]);

  // よく使う種目が先、それ以外は名前順
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises
      .filter((e) => !blocks.some((b) => b.exercise.id === e.id))
      .filter((e) => q === "" || e.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name, "ja")
      )
      .slice(0, 12);
  }, [exercises, usage, query, blocks]);

  const exactMatch = exercises.find((e) => e.name === query.trim());
  const myExercises = exercises
    .filter((e) => e.created_by === profile.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const isMine = (id: string) => exercises.some((e) => e.id === id && e.created_by === profile.id);

  // 種目を直した・消したあと、一覧と入力中の記録に反映する
  function handleExerciseUpdated(ex: Exercise) {
    setExercises((prev) => prev.map((e) => (e.id === ex.id ? { ...e, ...ex } : e)));
    onChange(blocks.map((b) => (b.exercise.id === ex.id ? { ...b, exercise: { ...b.exercise, ...ex } } : b)));
    setEditingExerciseId(null);
  }
  function handleExerciseDeleted(id: string) {
    setExercises((prev) => prev.filter((e) => e.id !== id));
    onChange(blocks.filter((b) => b.exercise.id !== id));
    setEditingExerciseId(null);
  }

  function update(next: ExerciseBlock[]) {
    setMessage(null);
    onChange(next);
  }

  function addBlock(exercise: Exercise) {
    update([...blocks, { key: newKey(), exercise, sets: [emptySet()] }]);
    setPicking(false);
    setQuery("");
  }

  async function createExercise() {
    const name = query.trim().slice(0, 30);
    if (!name) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("exercises")
      .insert({
        team_id: profile.team_id,
        name,
        measure: newMeasure,
        created_by: profile.id,
      })
      .select("id, name, measure, created_by")
      .single();
    setBusy(false);
    if (error || !data) {
      setMessage(
        error?.code === "23505"
          ? "同じ名前の種目がすでにあります。一覧から選んでください。"
          : `種目を追加できませんでした（${error?.message ?? "不明なエラー"}）`
      );
      return;
    }
    const ex = data as Exercise;
    setExercises((prev) => [...prev, ex]);
    addBlock(ex);
  }

  function updateSet(bi: number, si: number, patch: Partial<SetDraft>) {
    update(
      blocks.map((b, i) =>
        i !== bi ? b : { ...b, sets: b.sets.map((s, j) => (j === si ? { ...s, ...patch } : s)) }
      )
    );
  }

  // 新しいセットは、直前のセットと同じ値で始める（重量だけ変える、などが楽になる）
  function addSet(bi: number) {
    update(
      blocks.map((b, i) =>
        i !== bi
          ? b
          : {
              ...b,
              sets: [
                ...b.sets,
                { ...(b.sets[b.sets.length - 1] ?? emptySet()), warmup: false },
              ],
            }
      )
    );
  }

  function removeSet(bi: number, si: number) {
    update(
      blocks.map((b, i) =>
        i !== bi ? b : { ...b, sets: b.sets.length > 1 ? b.sets.filter((_, j) => j !== si) : [emptySet()] }
      )
    );
  }

  function removeBlock(bi: number) {
    update(blocks.filter((_, i) => i !== bi));
  }

  function moveBlock(bi: number, dir: -1 | 1) {
    const to = bi + dir;
    if (to < 0 || to >= blocks.length) return;
    const next = blocks.slice();
    [next[bi], next[to]] = [next[to], next[bi]];
    update(next);
  }

  async function copyPrevious(bi: number) {
    const b = blocks[bi];
    setBusy(true);
    const prev = await loadPreviousSets(supabase, profile.id, b.exercise.id, date);
    setBusy(false);
    if (!prev) {
      setMessage(`「${b.exercise.name}」の前回の記録はありません。`);
      return;
    }
    update(blocks.map((x, i) => (i === bi ? { ...x, sets: prev } : x)));
  }

  if (!available) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-2 text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        種目ごとの数値記録は準備中です（データベースの設定が必要です）。
      </p>
    );
  }

  const numCls =
    "w-full min-w-0 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1.5 text-right text-sm text-neutral-900 dark:text-neutral-100";

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, bi) => (
        <div key={b.key} className="flex flex-col gap-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {b.exercise.name}
              <span className="ml-1.5 text-[length:calc(10px+var(--fs-add))] font-normal text-neutral-500">
                {measureLabel[b.exercise.measure]}で記録
              </span>
            </span>
            {isMine(b.exercise.id) && (
              <button
                type="button"
                onClick={() =>
                  setEditingExerciseId(editingExerciseId === b.exercise.id ? null : b.exercise.id)
                }
                className="shrink-0 text-[length:calc(10px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
              >
                種目を直す
              </button>
            )}
            <button
              type="button"
              onClick={() => copyPrevious(bi)}
              disabled={busy}
              className="shrink-0 rounded border border-neutral-300 dark:border-neutral-700 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800 disabled:opacity-50"
            >
              前回をコピー
            </button>
            <button
              type="button"
              onClick={() => moveBlock(bi, -1)}
              disabled={bi === 0}
              aria-label="上へ"
              className="shrink-0 px-1 text-neutral-500 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => removeBlock(bi)}
              aria-label="この種目を消す"
              className="shrink-0 px-1 text-neutral-500 active:text-red-700 dark:active:text-red-400"
            >
              ✕
            </button>
          </div>
          {editingExerciseId === b.exercise.id && (
            <ExerciseEditor
              supabase={supabase}
              profileId={profile.id}
              exercise={exercises.find((e) => e.id === b.exercise.id) ?? b.exercise}
              onSaved={handleExerciseUpdated}
              onDeleted={handleExerciseDeleted}
              onClose={() => setEditingExerciseId(null)}
            />
          )}
          <div className="grid grid-cols-[2rem_1fr_1fr_1.5rem] items-center gap-x-2 gap-y-1 text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            <span />
            <span className="text-center">重量kg（任意）</span>
            <span className="text-center">{b.exercise.measure === "reps" ? "回数" : "時間（分・秒）"}</span>
            <span />
            {b.sets.map((s, si) => (
              <div key={si} className="contents">
                <button
                  type="button"
                  onClick={() => updateSet(bi, si, { warmup: !s.warmup })}
                  aria-label={s.warmup ? "アップを解除" : "アップにする"}
                  className={`rounded py-1 text-center text-[length:calc(10px+var(--fs-add))] font-bold ${
                    s.warmup
                      ? "bg-amber-600/80 text-white"
                      : "text-neutral-600 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-neutral-800"
                  }`}
                >
                  {s.warmup ? "UP" : si + 1 - b.sets.slice(0, si).filter((x) => x.warmup).length}
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  value={s.weight}
                  onChange={(e) => updateSet(bi, si, { weight: e.target.value })}
                  placeholder="—"
                  className={numCls}
                />
                {b.exercise.measure === "reps" ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    value={s.reps}
                    onChange={(e) => updateSet(bi, si, { reps: e.target.value })}
                    placeholder="回"
                    className={numCls}
                  />
                ) : (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={s.min}
                      onChange={(e) => updateSet(bi, si, { min: e.target.value })}
                      placeholder="分"
                      className={numCls}
                    />
                    <span>:</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={s.sec}
                      onChange={(e) => updateSet(bi, si, { sec: e.target.value })}
                      placeholder="秒"
                      className={numCls}
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeSet(bi, si)}
                  aria-label={`${si + 1}セット目を消す`}
                  className="text-neutral-500 active:text-red-700 dark:active:text-red-400"
                >
                  −
                </button>
              </div>
            ))}
          </div>
          <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            左の番号を押すと「UP（ウォーミングアップ）」になり、練習の質の計算から外れます。
          </p>
          <button
            type="button"
            onClick={() => addSet(bi)}
            className="self-start rounded border border-dashed border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
          >
            ＋ セットを追加
          </button>
        </div>
      ))}

      {picking ? (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 p-2.5">
          <input
            type="text"
            value={query}
            autoFocus
            maxLength={30}
            onChange={(e) => {
              setQuery(e.target.value);
              setMessage(null);
            }}
            placeholder="種目名で探す・新しく追加する（例：ベンチプレス）"
            className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
          />
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => addBlock(e)}
                  className="rounded-full border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-800 dark:text-neutral-200 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  {e.name}
                  {e.measure === "time" && <span className="ml-1 text-neutral-500">⏱</span>}
                </button>
              ))}
            </div>
          )}
          {query.trim() && !exactMatch && (
            <div className="flex flex-col gap-1.5 border-t border-neutral-200 dark:border-neutral-800 pt-2">
              <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                「{query.trim()}」を新しい種目として追加（チームのみんなも選べるようになります）
              </span>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
                  {(["reps", "time"] as Measure[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setNewMeasure(m)}
                      className={`rounded-md px-3 py-1.5 font-medium ${
                        newMeasure === m ? "bg-red-600 text-white" : "text-neutral-600 dark:text-neutral-400"
                      }`}
                    >
                      {measureLabel[m]}で記録
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={createExercise}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                >
                  追加
                </button>
              </div>
            </div>
          )}
          {myExercises.length > 0 && (
            <details className="border-t border-neutral-200 dark:border-neutral-800 pt-2">
              <summary className="cursor-pointer text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                自分が追加した種目を直す・消す（{myExercises.length}）
              </summary>
              <div className="mt-2 flex flex-col gap-1.5">
                {myExercises.map((e) =>
                  editingExerciseId === e.id ? (
                    <ExerciseEditor
                      key={e.id}
                      supabase={supabase}
                      profileId={profile.id}
                      exercise={e}
                      onSaved={handleExerciseUpdated}
                      onDeleted={handleExerciseDeleted}
                      onClose={() => setEditingExerciseId(null)}
                    />
                  ) : (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setEditingExerciseId(e.id)}
                      className="flex items-center justify-between rounded border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-left text-xs text-neutral-800 dark:text-neutral-200 active:bg-neutral-100 dark:active:bg-neutral-800"
                    >
                      <span>
                        {e.name}
                        <span className="ml-1.5 text-neutral-500">{measureLabel[e.measure]}で記録</span>
                      </span>
                      <span className="text-neutral-500">✎</span>
                    </button>
                  )
                )}
              </div>
            </details>
          )}
          <button
            type="button"
            onClick={() => {
              setPicking(false);
              setQuery("");
            }}
            className="self-start text-[length:calc(11px+var(--fs-add))] text-neutral-500"
          >
            閉じる
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-600 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
        >
          ＋ 種目を追加（重量・回数・時間を記録）
        </button>
      )}
      {message && (
        <p className="text-[length:calc(11px+var(--fs-add))] text-amber-700 dark:text-amber-400">{message}</p>
      )}
    </div>
  );
}

/**
 * 自分が追加した種目の修正・削除。
 * - 名前はいつでも直せる
 * - 「回数／時間」は、まだ誰の記録にも使われていない間だけ変えられる
 * - 削除は、他の部員が記録に使っていなければできる（自分の記録は一緒に消える）
 */
function ExerciseEditor({
  supabase,
  profileId,
  exercise,
  onSaved,
  onDeleted,
  onClose,
}: {
  supabase: SupabaseBrowserClient;
  profileId: string;
  exercise: Exercise;
  onSaved: (ex: Exercise) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(exercise.name);
  const [measure, setMeasure] = useState<Measure>(exercise.measure);
  const [counts, setCounts] = useState<{ mine: number; others: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mine, others] = await Promise.all([
        supabase
          .from("training_sets")
          .select("id", { count: "exact", head: true })
          .eq("exercise_id", exercise.id)
          .eq("author_id", profileId),
        supabase
          .from("training_sets")
          .select("id", { count: "exact", head: true })
          .eq("exercise_id", exercise.id)
          .neq("author_id", profileId),
      ]);
      if (!cancelled) setCounts({ mine: mine.count ?? 0, others: others.count ?? 0 });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, profileId]);

  const used = counts ? counts.mine + counts.others > 0 : true;

  async function handleSave() {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) {
      setError("種目名を入れてください。");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("exercises")
      .update({ name: trimmed, measure: used ? exercise.measure : measure })
      .eq("id", exercise.id);
    setBusy(false);
    if (err) {
      setError(
        err.code === "23505" ? "同じ名前の種目がすでにあります。" : `保存できませんでした（${err.message}）`
      );
      return;
    }
    onSaved({ ...exercise, name: trimmed, measure: used ? exercise.measure : measure });
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("exercises")
      .delete()
      .eq("id", exercise.id)
      .select("id");
    setBusy(false);
    if (err || !data || data.length === 0) {
      setError(
        err
          ? `削除できませんでした（${err.message}）`
          : "削除できませんでした。他の部員が記録に使っているか、削除の設定（SQL）がまだの可能性があります。"
      );
      return;
    }
    onDeleted(exercise.id);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20 p-2.5">
      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        種目名
        <input
          type="text"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
        />
      </label>
      <div className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        記録のしかた
        <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
          {(["reps", "time"] as Measure[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={used}
              onClick={() => setMeasure(m)}
              className={`flex-1 rounded-md py-1.5 font-medium ${
                (used ? exercise.measure : measure) === m ? "bg-red-600 text-white" : "text-neutral-600 dark:text-neutral-400"
              } disabled:opacity-60`}
            >
              {measureLabel[m]}で記録
            </button>
          ))}
        </div>
        {counts && used && (
          <span className="text-neutral-500">
            すでに記録があるため、回数／時間は変えられません。間違えた場合は、この種目を削除して作り直してください。
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          保存する
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-300"
        >
          やめる
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={busy || !counts || counts.others > 0}
          className="ml-auto rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs text-red-700 dark:text-red-400 active:bg-red-50 dark:active:bg-red-950 disabled:opacity-40"
        >
          この種目を削除
        </button>
      </div>
      {counts && counts.others > 0 && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          他の部員がこの種目を記録に使っているため、削除できません（名前の修正はできます）。
        </p>
      )}
      {confirmDelete && counts && (
        <div className="flex flex-col gap-2 rounded border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-800 dark:text-red-200">
          <span>
            「{exercise.name}」を削除します。
            {counts.mine > 0 ? `あなたのこの種目の記録（${counts.mine}セット）も一緒に消えます。` : ""}
            元には戻せません。
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="rounded bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              削除する
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-neutral-700 dark:text-neutral-300"
            >
              やめる
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
    </div>
  );
}
