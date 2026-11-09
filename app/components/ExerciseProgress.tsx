"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";
import { formatSeconds, type Measure } from "./SetLogger";

/**
 * 振り返りタブ「種目ごとの記録」。
 * 日報で数値を入れた種目ごとに、伸び（推移グラフ）と自己ベストを出す。
 * - 重量×回数の種目：推定MAX（1RM、Epley式）で比べる
 * - 重量なしの回数の種目：1セットの最高回数
 * - 時間の種目：1セットの最長時間
 */

type Row = {
  date: string;
  exercise_id: string;
  set_no: number;
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
  exercise: { id: string; name: string; measure: Measure } | null;
};

type MetricKind = "e1rm" | "reps" | "time";
type Session = {
  date: string;
  value: number;
  volume: number;
  sets: { w: number | null; r: number | null; s: number | null }[];
};
type ExerciseStats = {
  id: string;
  name: string;
  measure: Measure;
  kind: MetricKind;
  sessions: Session[];
  best: Session;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthDay(s: string) {
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 推定MAX（Epley式）。1回ならその重量、12回を超える回数は推定が不正確なので使わない
function e1rm(w: number, r: number) {
  if (r <= 0 || r > 12) return null;
  return r === 1 ? w : w * (1 + r / 30);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

const kindLabel: Record<MetricKind, string> = {
  e1rm: "推定MAX",
  reps: "最高回数",
  time: "最長時間",
};

function formatValue(kind: MetricKind, v: number) {
  if (kind === "e1rm") return `${round1(v)}kg`;
  if (kind === "reps") return `${v}回`;
  return formatSeconds(v);
}

function setLabel(set: { w: number | null; r: number | null; s: number | null }) {
  const main = set.s != null ? formatSeconds(set.s) : `${set.r ?? 0}回`;
  return set.w != null ? `${Number(set.w)}kg×${main}` : main;
}

export default function ExerciseProgress({
  profile,
  refreshKey = 0,
}: {
  profile: Profile;
  refreshKey?: number;
}) {
  const supabase = createClient();
  const todayStr = toDateKey(new Date());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const { data, error } = await supabase
        .from("training_sets")
        .select(
          "date, exercise_id, set_no, weight_kg, reps, seconds, exercise:exercises(id, name, measure)"
        )
        .eq("author_id", profile.id)
        .gte("date", toDateKey(since))
        .order("date", { ascending: true })
        .limit(5000);
      if (cancelled) return;
      if (error) {
        setAvailable(false);
        setRows([]);
        return;
      }
      setRows((data ?? []) as unknown as Row[]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, refreshKey]);

  const stats = useMemo<ExerciseStats[]>(() => {
    if (!rows) return [];
    const byExercise = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.exercise) continue;
      const list = byExercise.get(r.exercise_id) ?? [];
      list.push(r);
      byExercise.set(r.exercise_id, list);
    }
    const out: ExerciseStats[] = [];
    for (const [id, list] of byExercise) {
      const ex = list[0].exercise!;
      const weighted = list.some((r) => r.weight_kg != null && (r.reps ?? 0) > 0);
      const kind: MetricKind =
        ex.measure === "time" ? "time" : weighted ? "e1rm" : "reps";
      const byDate = new Map<string, Row[]>();
      for (const r of list) {
        const l = byDate.get(r.date) ?? [];
        l.push(r);
        byDate.set(r.date, l);
      }
      const sessions: Session[] = [];
      for (const [date, sets] of byDate) {
        let value = 0;
        let volume = 0;
        for (const s of sets) {
          const w = s.weight_kg != null ? Number(s.weight_kg) : null;
          if (kind === "e1rm" && w != null && s.reps) {
            value = Math.max(value, e1rm(w, s.reps) ?? 0);
          } else if (kind === "reps") {
            value = Math.max(value, s.reps ?? 0);
          } else if (kind === "time") {
            value = Math.max(value, s.seconds ?? 0);
          }
          if (w != null && s.reps) volume += w * s.reps;
        }
        if (value <= 0) continue;
        sessions.push({
          date,
          value,
          volume,
          sets: sets
            .slice()
            .sort((a, b) => a.set_no - b.set_no)
            .map((s) => ({
              w: s.weight_kg != null ? Number(s.weight_kg) : null,
              r: s.reps,
              s: s.seconds,
            })),
        });
      }
      if (sessions.length === 0) continue;
      sessions.sort((a, b) => a.date.localeCompare(b.date));
      const best = sessions.reduce((a, b) => (b.value > a.value ? b : a));
      out.push({ id, name: ex.name, measure: ex.measure, kind, sessions, best });
    }
    // よく記録している種目が先
    return out.sort((a, b) => b.sessions.length - a.sessions.length);
  }, [rows]);

  const selected = stats.find((s) => s.id === selectedId) ?? stats[0] ?? null;

  const sectionTitle = (text: string) => (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
      {text}
    </h2>
  );

  if (!available) return null;
  if (rows === null) {
    return (
      <section className="flex flex-col gap-2">
        {sectionTitle("種目ごとの記録")}
        <p className="text-xs text-neutral-500">集計中…</p>
      </section>
    );
  }
  if (stats.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        {sectionTitle("種目ごとの記録")}
        <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-xs text-neutral-500">
          日報のトレーニング欄で「種目を追加」して重量・回数・時間を入れると、ここに伸びのグラフと自己ベストが出ます。
        </p>
      </section>
    );
  }

  const recentPb = (s: ExerciseStats) => {
    const [y, m, d] = s.best.date.split("-").map(Number);
    const days = (new Date().getTime() - new Date(y, m - 1, d).getTime()) / 86400000;
    return days <= 14;
  };

  return (
    <>
      <section className="flex flex-col gap-2">
        {sectionTitle("種目ごとの記録")}
        <div className="flex flex-wrap gap-1.5">
          {stats.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`rounded-full border px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-medium ${
                selected?.id === s.id
                  ? "border-red-500 bg-red-950/40 text-neutral-100"
                  : "border-neutral-700 text-neutral-400 active:bg-neutral-800"
              }`}
            >
              {recentPb(s) && "🏅"}
              {s.name}
            </button>
          ))}
        </div>
        {selected && <ExerciseDetail stats={selected} todayStr={todayStr} />}
      </section>

      <section className="flex flex-col gap-2">
        {sectionTitle("自己ベスト")}
        <div className="flex flex-col divide-y divide-neutral-800 rounded-lg border border-neutral-800 bg-neutral-900">
          {stats.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className="flex items-center gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-neutral-200">
                {recentPb(s) && <span className="mr-1">🏅</span>}
                {s.name}
              </span>
              <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                {kindLabel[s.kind]}
              </span>
              <span className="w-16 text-right font-bold text-neutral-100">
                {formatValue(s.kind, s.best.value)}
              </span>
              <span className="w-10 text-right text-neutral-500">{formatMonthDay(s.best.date)}</span>
            </button>
          ))}
        </div>
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          🏅は2週間以内に自己ベストを更新した種目。推定MAXは「重量×(1＋回数÷30)」で計算しています（13回以上のセットは使いません）。
        </p>
      </section>
    </>
  );
}

function ExerciseDetail({ stats, todayStr }: { stats: ExerciseStats; todayStr: string }) {
  const sessions = stats.sessions.slice(-30);
  // グラフの点を押したときに、その日の中身を下に出す
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const active = sessions.find((s) => s.date === activeDate) ?? null;
  const first = sessions[0];
  const last = sessions[sessions.length - 1];
  const values = sessions.map((s) => s.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;

  // グラフ（viewBox 300×120）
  const W = 300;
  const H = 120;
  const left = 4;
  const right = 4;
  const top = 10;
  const bottom = 10;
  const x = (i: number) =>
    sessions.length === 1 ? W / 2 : left + (i * (W - left - right)) / (sessions.length - 1);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const path = sessions.map((s, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(s.value)}`).join(" ");

  const diff = last.value - first.value;
  const recentVolume = stats.sessions
    .filter((s) => {
      const [yy, mm, dd] = s.date.split("-").map(Number);
      const [ty, tm, td] = todayStr.split("-").map(Number);
      return (new Date(ty, tm - 1, td).getTime() - new Date(yy, mm - 1, dd).getTime()) / 86400000 < 28;
    })
    .reduce((a, s) => a + s.volume, 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col">
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            自己ベスト（{kindLabel[stats.kind]}）
          </span>
          <span className="text-lg font-bold text-foreground">
            {formatValue(stats.kind, stats.best.value)}
          </span>
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            {formatMonthDay(stats.best.date)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">前回</span>
          <span className="text-lg font-bold text-foreground">
            {formatValue(stats.kind, last.value)}
          </span>
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            {formatMonthDay(last.date)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            {sessions.length > 1 ? `${formatMonthDay(first.date)}からの伸び` : "記録回数"}
          </span>
          <span className="text-lg font-bold text-foreground">
            {sessions.length > 1
              ? `${diff >= 0 ? "+" : "−"}${formatValue(stats.kind, Math.abs(stats.kind === "e1rm" ? round1(diff) : diff))}`
              : "1回"}
          </span>
          {stats.kind === "e1rm" && recentVolume > 0 && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
              直近4週 総挙上量 {Math.round(recentVolume).toLocaleString()}kg
            </span>
          )}
        </div>
      </div>

      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label={`${stats.name}の推移`}>
          <line x1={0} x2={W} y1={y(stats.best.value)} y2={y(stats.best.value)} stroke="currentColor" className="text-neutral-700" strokeDasharray="3 3" strokeWidth={1} />
          {sessions.length > 1 && (
            <path d={path} fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {sessions.map((s, i) => (
            <g key={s.date}>
              <circle
                cx={x(i)}
                cy={y(s.value)}
                r={s.date === stats.best.date ? 4.5 : 3}
                fill={s.date === stats.best.date ? "#f59e0b" : "#ef4444"}
                stroke="#171717"
                strokeWidth={1.5}
              />
              <circle
                cx={x(i)}
                cy={y(s.value)}
                r={10}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => setActiveDate(s.date === activeDate ? null : s.date)}
              >
                <title>{`${formatMonthDay(s.date)}：${formatValue(stats.kind, s.value)}（${s.sets.map(setLabel).join(" / ")}）`}</title>
              </circle>
            </g>
          ))}
        </svg>
        <div className="flex justify-between text-[length:calc(9px+var(--fs-add))] text-neutral-500">
          <span>{formatMonthDay(first.date)}</span>
          <span>
            {kindLabel[stats.kind]}（点を押すと詳細／黄色が自己ベスト）
          </span>
          <span>{formatMonthDay(last.date)}</span>
        </div>
        {active && (
          <p className="mt-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200">
            {formatMonthDay(active.date)}：{formatValue(stats.kind, active.value)}（
            {active.sets.map(setLabel).join(" / ")}）
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
        {stats.sessions
          .slice(-5)
          .reverse()
          .map((s) => (
            <div key={s.date} className="flex gap-2 text-xs">
              <span className="w-10 shrink-0 text-neutral-500">{formatMonthDay(s.date)}</span>
              <span className="min-w-0 flex-1 text-neutral-200">{s.sets.map(setLabel).join(" / ")}</span>
              <span className="shrink-0 text-neutral-400">{formatValue(stats.kind, s.value)}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
