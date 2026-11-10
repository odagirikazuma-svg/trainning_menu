"use client";

import { useMemo, useState } from "react";
import { formatSeconds, guessBetter, type Measure } from "./SetLogger";
import InsightCard from "./InsightCard";

/**
 * 振り返りタブ「種目ごとの記録」。
 * 日報で数値を入れた種目ごとに、伸び（推移グラフ）と自己ベストを出す。
 * - 重量×回数の種目：推定MAX（1RM、Brzycki式）で比べる
 * - 重量なしの回数の種目：1セットの最高回数
 * - 時間の種目：1セットの最長時間
 *
 * あわせて「メインセット（ウォーミングアップを除いたセット）」の
 * 平均（練習の質）と練習量（重量×回数の合計）も出す。
 * アップは日報で「UP」を付けたセット。どのセットにも付いていない日は、
 * その日の最高重量の70%未満のセットをアップとみなす。
 */

export type Row = {
  date: string;
  exercise_id: string;
  set_no: number;
  weight_kg: number | null;
  reps: number | null;
  seconds: number | null;
  is_warmup?: boolean | null;
  exercise: { id: string; name: string; measure: Measure; better?: "higher" | "lower" } | null;
};

// time_low = 短いほど良い時間（走るタイム）
type MetricKind = "e1rm" | "reps" | "time" | "time_low";
type SetItem = { w: number | null; r: number | null; s: number | null; warmup: boolean };
type Session = {
  date: string;
  // その日いちばん高く出たセット（推定MAX／最高回数／最長時間）
  value: number;
  // メインセットの平均（練習の質）
  mainAvg: number | null;
  // メインセットの練習量（重量×回数の合計。重量なしは合計回数、時間は合計秒）
  mainVolume: number;
  volume: number;
  sets: SetItem[];
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

// 推定MAX（Brzycki式：重量 × 36 ÷ (37 − 回数)）。
// 1回ならその重量そのものになり、低回数でも高く出すぎない。
// 12回を超える回数は推定が不正確なので使わない
function e1rm(w: number, r: number) {
  if (r <= 0 || r > 12) return null;
  return (w * 36) / (37 - r);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

const kindLabel: Record<MetricKind, string> = {
  e1rm: "推定MAX",
  reps: "最高回数",
  time: "最長時間",
  time_low: "最速タイム",
};

function formatValue(kind: MetricKind, v: number) {
  if (kind === "e1rm") return `${round1(v)}kg`;
  if (kind === "reps") return `${round1(v)}回`;
  return formatSeconds(Math.round(v));
}

function setLabel(set: SetItem) {
  const main = set.s != null ? formatSeconds(set.s) : `${set.r ?? 0}回`;
  const body = set.w != null ? `${Number(set.w)}kg×${main}` : main;
  return set.warmup ? `(アップ)${body}` : body;
}

const volumeLabel: Record<MetricKind, string> = {
  e1rm: "練習量（重量×回数）",
  reps: "練習量（合計回数）",
  time: "練習量（合計時間）",
  time_low: "練習量（合計時間）",
};

function formatVolume(kind: MetricKind, v: number) {
  if (kind === "e1rm") return `${Math.round(v).toLocaleString()}kg`;
  if (kind === "reps") return `${Math.round(v)}回`;
  return formatSeconds(Math.round(v));
}

export default function ExerciseProgress({
  rows,
}: {
  // 1人分のセット記録（1年分）。親（振り返り）がまとめて読み込んで渡す。null は読み込み中
  rows: Row[] | null;
}) {
  const todayStr = toDateKey(new Date());
  const available = true;
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        ex.measure === "time"
          ? (ex.better ?? guessBetter(ex.name, "time")) === "lower"
            ? "time_low"
            : "time"
          : weighted
            ? "e1rm"
            : "reps";
      const byDate = new Map<string, Row[]>();
      for (const r of list) {
        const l = byDate.get(r.date) ?? [];
        l.push(r);
        byDate.set(r.date, l);
      }
      const sessions: Session[] = [];
      for (const [date, rawSets] of byDate) {
        const items: SetItem[] = rawSets
          .slice()
          .sort((a, b) => a.set_no - b.set_no)
          .map((s) => ({
            w: s.weight_kg != null ? Number(s.weight_kg) : null,
            r: s.reps,
            s: s.seconds,
            warmup: !!s.is_warmup,
          }));
        // アップの印が無い日は、最高重量の70%未満をアップとみなす
        const marked = items.some((x) => x.warmup);
        const topW = Math.max(0, ...items.map((x) => x.w ?? 0));
        const sets = marked
          ? items
          : items.map((x) => ({
              ...x,
              warmup: kind === "e1rm" && x.w != null && topW > 0 && x.w < topW * 0.7,
            }));
        const main = sets.filter((x) => !x.warmup);

        const metric = (x: SetItem): number | null => {
          if (kind === "e1rm") return x.w != null && x.r ? e1rm(x.w, x.r) : null;
          if (kind === "reps") return x.r ?? null;
          return x.s ?? null;
        };
        const vals = sets.map(metric).filter((v): v is number => v != null && v > 0);
        if (vals.length === 0) continue;
        // 短いほど良い時間は、その日いちばん速いタイム
        const value = kind === "time_low" ? Math.min(...vals) : Math.max(...vals);
        const mainValues = main.map(metric).filter((v): v is number => v != null && v > 0);
        const mainAvg =
          mainValues.length > 0 ? mainValues.reduce((a, b) => a + b, 0) / mainValues.length : null;
        const mainVolume = main.reduce((a, x) => {
          if (kind === "e1rm") return a + (x.w != null && x.r ? x.w * x.r : 0);
          if (kind === "reps") return a + (x.r ?? 0);
          return a + (x.s ?? 0);
        }, 0);
        const volume = sets.reduce((a, x) => a + (x.w != null && x.r ? x.w * x.r : 0), 0);
        sessions.push({ date, value, mainAvg, mainVolume, volume, sets });
      }
      if (sessions.length === 0) continue;
      sessions.sort((a, b) => a.date.localeCompare(b.date));
      const best = sessions.reduce((a, b) =>
        kind === "time_low" ? (b.value < a.value ? b : a) : b.value > a.value ? b : a
      );
      out.push({ id, name: ex.name, measure: ex.measure, kind, sessions, best });
    }
    // よく記録している種目が先
    return out.sort((a, b) => b.sessions.length - a.sessions.length);
  }, [rows]);

  const selected = stats.find((s) => s.id === selectedId) ?? stats[0] ?? null;


  if (!available) return null;
  if (rows === null) {
    return (
      <InsightCard id="ins-exercise" icon="🏋️" title="種目ごとの記録" subtitle="練習の質・最高・練習量の推移">
        <p className="text-xs text-neutral-500">集計中…</p>
      </InsightCard>
    );
  }
  if (stats.length === 0) {
    return (
      <InsightCard id="ins-exercise" icon="🏋️" title="種目ごとの記録" subtitle="練習の質・最高・練習量の推移">
        <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
          日報のトレーニング欄で「種目を追加」して重量・回数・時間を入れると、ここに伸びのグラフと自己ベストが出ます。
        </p>
      </InsightCard>
    );
  }

  const recentPb = (s: ExerciseStats) => {
    const [y, m, d] = s.best.date.split("-").map(Number);
    const days = (new Date().getTime() - new Date(y, m - 1, d).getTime()) / 86400000;
    return days <= 14;
  };

  return (
    <>
      <InsightCard id="ins-exercise" icon="🏋️" title="種目ごとの記録" subtitle="練習の質・最高・練習量の推移">
        <div className="flex flex-wrap gap-1.5">
          {stats.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`rounded-full border px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-medium ${
                selected?.id === s.id
                  ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-neutral-900 dark:text-neutral-100"
                  : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-neutral-800"
              }`}
            >
              {recentPb(s) && "🏅"}
              {s.name}
            </button>
          ))}
        </div>
        {selected && <ExerciseDetail stats={selected} todayStr={todayStr} />}
      </InsightCard>

      <InsightCard id="ins-best" icon="🏅" title="自己ベスト" subtitle="種目ごとのいちばん良い記録">
        <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl bg-neutral-50 dark:bg-neutral-800/50">
          {stats.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className="flex items-center gap-2 px-3 py-2 text-left text-xs"
            >
              <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-200">
                {recentPb(s) && <span className="mr-1">🏅</span>}
                {s.name}
              </span>
              <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                {kindLabel[s.kind]}
              </span>
              <span className="w-16 text-right font-bold text-neutral-900 dark:text-neutral-100">
                {formatValue(s.kind, s.best.value)}
              </span>
              <span className="w-10 text-right text-neutral-500">{formatMonthDay(s.best.date)}</span>
            </button>
          ))}
        </div>
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          🏅は2週間以内に自己ベストを更新した種目。推定MAXは「重量×36÷(37−回数)」（Brzycki式）で、その日いちばん高く出たセットから計算しています（13回以上のセットは使いません）。
        </p>
      </InsightCard>
    </>
  );
}

function ExerciseDetail({ stats, todayStr }: { stats: ExerciseStats; todayStr: string }) {
  const sessions = stats.sessions.slice(-20);
  // グラフの列を押したときに、その日の中身を下に出す
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const active = sessions.find((s) => s.date === activeDate) ?? null;
  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  // ---- グラフの寸法（viewBox）。上段＝折れ線（質・MAX）、下段＝棒（練習量）で x 軸を共有する ----
  const W = 320;
  const lineTop = 8;
  const lineH = 92;
  const gap = 14;
  const barTop = lineTop + lineH + gap;
  const barH = 46;
  const H = barTop + barH + 2;
  const n = sessions.length;
  const slot = W / Math.max(n, 1);
  const cx = (i: number) => slot * i + slot / 2;

  const lineValues = sessions.flatMap((s) => [s.value, s.mainAvg ?? s.value]);
  const lmin = Math.min(...lineValues);
  const lmax = Math.max(...lineValues);
  const lpad = (lmax - lmin) * 0.15 || Math.max(1, lmax * 0.1);
  const lo = Math.max(0, lmin - lpad);
  const hi = lmax + lpad;
  const ly = (v: number) => lineTop + (1 - (v - lo) / (hi - lo)) * lineH;

  const vmax = Math.max(1, ...sessions.map((s) => s.mainVolume));
  const bh = (v: number) => (v / vmax) * barH;
  const barW = Math.max(4, Math.min(18, slot * 0.55));

  const pathOf = (pick: (s: Session) => number | null) => {
    let d = "";
    let started = false;
    sessions.forEach((s, i) => {
      const v = pick(s);
      if (v == null) {
        started = false;
        return;
      }
      d += `${started ? "L" : "M"}${cx(i)},${ly(v)} `;
      started = true;
    });
    return d.trim();
  };

  const recentQuality = sessions.filter((s) => s.mainAvg != null);
  const lastQ = recentQuality[recentQuality.length - 1];
  // 短いほど良いタイムは、縮んだ分を「伸び」とする
  const diff = stats.kind === "time_low" ? first.value - last.value : last.value - first.value;
  const recentVolume = stats.sessions
    .filter((s) => {
      const [yy, mm, dd] = s.date.split("-").map(Number);
      const [ty, tm, td] = todayStr.split("-").map(Number);
      return (new Date(ty, tm - 1, td).getTime() - new Date(yy, mm - 1, dd).getTime()) / 86400000 < 28;
    })
    .reduce((a, s) => a + s.mainVolume, 0);

  const tile = (label: string, value: string, sub?: string) => (
    <div className="flex flex-col">
      <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">{label}</span>
      <span className="text-lg font-bold text-foreground">{value}</span>
      {sub && <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">{sub}</span>}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
      <div className="grid grid-cols-3 gap-2">
        {tile(
          `自己ベスト（${kindLabel[stats.kind]}）`,
          formatValue(stats.kind, stats.best.value),
          formatMonthDay(stats.best.date)
        )}
        {tile(
          "前回の練習の質",
          lastQ?.mainAvg != null ? formatValue(stats.kind, lastQ.mainAvg) : "—",
          lastQ ? `メインセット平均・${formatMonthDay(lastQ.date)}` : undefined
        )}
        {tile(
          sessions.length > 1 ? `${formatMonthDay(first.date)}からの伸び` : "記録回数",
          sessions.length > 1
            ? `${diff >= 0 ? "+" : "−"}${formatValue(stats.kind, Math.abs(stats.kind === "e1rm" ? round1(diff) : diff))}`
            : "1回",
          recentVolume > 0
            ? `直近4週の練習量 ${formatVolume(stats.kind, recentVolume)}`
            : undefined
        )}
      </div>

      {/* 凡例 */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[length:calc(10px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 rounded bg-red-500" />
          メインセット平均（練習の質）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-neutral-400 dark:border-neutral-500" />
          {kindLabel[stats.kind]}（その日の最高）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-600/70" />
          {volumeLabel[stats.kind]}
        </span>
      </div>

      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${stats.name}の推移`}>
          {/* 上段の目盛り線と値 */}
          {[hi, (hi + lo) / 2, lo].map((v, i) => (
            <g key={i}>
              <line x1={0} x2={W} y1={ly(v)} y2={ly(v)} className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth={0.5} />
              <text x={2} y={ly(v) - 2} fontSize={7} fill="#737373">
                {formatValue(stats.kind, stats.kind === "e1rm" ? round1(v) : Math.round(v))}
              </text>
            </g>
          ))}
          {/* 下段（練習量）の基準線と最大値 */}
          <line x1={0} x2={W} y1={barTop + barH} y2={barTop + barH} className="stroke-neutral-300 dark:stroke-neutral-600" strokeWidth={0.75} />
          <text x={2} y={barTop + 6} fontSize={7} fill="#737373">
            {formatVolume(stats.kind, vmax)}
          </text>

          {/* 押した列のハイライト */}
          {sessions.map((s, i) =>
            s.date === activeDate ? (
              <rect key={`hl-${s.date}`} x={slot * i} y={0} width={slot} height={H} className="fill-neutral-900 dark:fill-white" opacity={0.06} />
            ) : null
          )}

          {/* 棒：メインセットの練習量 */}
          {sessions.map((s, i) => (
            <rect
              key={`bar-${s.date}`}
              x={cx(i) - barW / 2}
              y={barTop + barH - bh(s.mainVolume)}
              width={barW}
              height={Math.max(bh(s.mainVolume), s.mainVolume > 0 ? 1.5 : 0)}
              rx={2}
              fill="#0284c7"
              opacity={0.7}
            />
          ))}

          {/* 折れ線：その日の最高（点線）とメインセット平均（実線） */}
          {n > 1 && (
            <path d={pathOf((s) => s.value)} fill="none" stroke="#737373" strokeWidth={1.25} strokeDasharray="3 3" />
          )}
          {n > 1 && (
            <path
              d={pathOf((s) => s.mainAvg)}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {sessions.map((s, i) => (
            <g key={`pt-${s.date}`}>
              {s.date === stats.best.date && (
                <circle cx={cx(i)} cy={ly(s.value)} r={3.5} fill="#f59e0b" className="stroke-white dark:stroke-neutral-900" strokeWidth={1} />
              )}
              {s.mainAvg != null && (
                <circle cx={cx(i)} cy={ly(s.mainAvg)} r={2.75} fill="#ef4444" className="stroke-white dark:stroke-neutral-900" strokeWidth={1} />
              )}
            </g>
          ))}

          {/* 押せる範囲（列ごと） */}
          {sessions.map((s, i) => (
            <rect
              key={`hit-${s.date}`}
              x={slot * i}
              y={0}
              width={slot}
              height={H}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => setActiveDate(s.date === activeDate ? null : s.date)}
            >
              <title>{formatMonthDay(s.date)}</title>
            </rect>
          ))}
        </svg>
        <div className="flex justify-between text-[length:calc(9px+var(--fs-add))] text-neutral-500">
          <span>{formatMonthDay(first.date)}</span>
          <span>列を押すとその日の中身／黄色の点が自己ベスト</span>
          <span>{formatMonthDay(last.date)}</span>
        </div>
        {stats.kind === "e1rm" && (
          <p className="mt-0.5 text-right text-[length:calc(9px+var(--fs-add))] text-neutral-500">
            ※推定MAXはブリジッキー（Brzycki）式：重量×36÷(37−回数)
          </p>
        )}
        {active && (
          <div className="mt-1 flex flex-col gap-0.5 rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-1.5 text-xs text-neutral-800 dark:text-neutral-200">
            <span className="font-semibold">
              {formatMonthDay(active.date)}　質 {active.mainAvg != null ? formatValue(stats.kind, active.mainAvg) : "—"}
              　最高 {formatValue(stats.kind, active.value)}　練習量 {formatVolume(stats.kind, active.mainVolume)}
            </span>
            <span className="text-neutral-600 dark:text-neutral-400">{active.sets.map(setLabel).join(" / ")}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-neutral-200 dark:border-neutral-800 pt-2">
        {stats.sessions
          .slice(-5)
          .reverse()
          .map((s) => (
            <div key={s.date} className="flex gap-2 text-xs">
              <span className="w-10 shrink-0 text-neutral-500">{formatMonthDay(s.date)}</span>
              <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-200">
                {s.sets.map((x, i) => (
                  <span key={i} className={x.warmup ? "text-neutral-500" : ""}>
                    {i > 0 && " / "}
                    {setLabel(x)}
                  </span>
                ))}
              </span>
              <span className="shrink-0 text-neutral-600 dark:text-neutral-400">
                {s.mainAvg != null ? formatValue(stats.kind, s.mainAvg) : "—"}
              </span>
            </div>
          ))}
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          右の数字はメインセット平均。グレーの(アップ)はウォーミングアップで、質と練習量の計算から外しています。
        </p>
      </div>
    </div>
  );
}
