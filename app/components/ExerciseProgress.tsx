"use client";

import { useMemo, useState } from "react";
import { formatSeconds, guessBetter, type Measure } from "./SetLogger";
import InsightCard from "./InsightCard";
import DualAxisChart from "./DualAxisChart";

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
 *
 * 種目は「代表種目」（監督が設定で選ぶ・将来のチーム内ランキング用）を先に固定で並べる。
 * BIG3（ベンチプレス・スクワット・デッドリフト）は、イベントの測定会の記録も推移と自己ベストに入れる。
 */

// イベント「ウェイトMAX測定会」の記録
export type Big3Row = { date: string; bench: number | null; squat: number | null; deadlift: number | null };
type Big3Key = "bench" | "squat" | "deadlift";
const BIG3: { key: Big3Key; name: string; match: RegExp }[] = [
  { key: "bench", name: "ベンチプレス", match: /ベンチ/ },
  { key: "squat", name: "スクワット", match: /スクワット/ },
  { key: "deadlift", name: "デッドリフト", match: /デッド/ },
];

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
  // 測定会の記録（BIG3だけ）
  events: { date: string; value: number }[];
  // 自己ベスト（日報の推定MAX と 測定会 のうち良いほう）
  bestValue: number;
  bestDate: string;
  bestFrom: "daily" | "event";
  featured: boolean;
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
  featuredIds = [],
  exercises = [],
  big3 = [],
}: {
  // 1人分のセット記録（1年分）。親（振り返り）がまとめて読み込んで渡す。null は読み込み中
  rows: Row[] | null;
  // 代表種目（並び順どおり）
  featuredIds?: string[];
  // チームの種目一覧（代表種目・BIG3を、記録がなくても名前で出すため）
  exercises?: { id: string; name: string; measure: Measure }[];
  // 測定会の記録
  big3?: Big3Row[];
}) {
  const todayStr = toDateKey(new Date());
  const available = true;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

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
      out.push({
        id,
        name: ex.name,
        measure: ex.measure,
        kind,
        sessions,
        events: [],
        bestValue: best.value,
        bestDate: best.date,
        bestFrom: "daily",
        featured: false,
      });
    }

    // BIG3：測定会の記録を、その種目（なければ名前だけの枠）に入れる
    for (const b of BIG3) {
      const ev = big3.filter((r) => r[b.key] != null).map((r) => ({ date: r.date, value: Number(r[b.key]) }));
      const exId =
        exercises.find((e) => e.name === b.name)?.id ?? exercises.find((e) => b.match.test(e.name) && e.measure === "reps")?.id;
      let st = out.find((x) => x.id === exId) ?? out.find((x) => b.match.test(x.name) && x.kind === "e1rm");
      if (!st) {
        if (ev.length === 0) continue;
        st = {
          id: exId ?? `big3-${b.key}`,
          name: exercises.find((e) => e.id === exId)?.name ?? b.name,
          measure: "reps",
          kind: "e1rm",
          sessions: [],
          events: [],
          bestValue: 0,
          bestDate: "",
          bestFrom: "event",
          featured: false,
        };
        out.push(st);
      }
      st.events = ev;
      st.featured = true;
      for (const e of ev) {
        if (e.value > st.bestValue) {
          st.bestValue = e.value;
          st.bestDate = e.date;
          st.bestFrom = "event";
        }
      }
    }
    for (const st of out) if (featuredIds.includes(st.id)) st.featured = true;

    // 並び：BIG3 → 代表種目（設定の順）→ よく記録している種目
    const big3Rank = (st: ExerciseStats) => {
      const i = BIG3.findIndex((b) => b.match.test(st.name));
      return st.events.length > 0 || (i >= 0 && st.featured) ? i : 99;
    };
    const featRank = (st: ExerciseStats) => {
      const i = featuredIds.indexOf(st.id);
      return i < 0 ? 999 : i;
    };
    return out.sort(
      (a, b) =>
        Number(b.featured) - Number(a.featured) ||
        big3Rank(a) - big3Rank(b) ||
        featRank(a) - featRank(b) ||
        b.sessions.length - a.sessions.length
    );
  }, [rows, featuredIds, exercises, big3]);

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
    if (!s.bestDate) return false;
    const [y, m, d] = s.bestDate.split("-").map(Number);
    const days = (new Date().getTime() - new Date(y, m - 1, d).getTime()) / 86400000;
    return days <= 14;
  };

  return (
    <>
      <InsightCard id="ins-exercise" icon="🏋️" title="種目ごとの記録" subtitle="練習の質・最高・練習量の推移">
        {stats.some((s) => s.featured) && (
          <span className="text-[length:calc(10px+var(--fs-add))] font-semibold text-neutral-500">代表種目</span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {stats.filter((s) => s.featured || showOthers || !stats.some((x) => x.featured)).map((s) => (
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
          {stats.some((s) => s.featured) && stats.some((s) => !s.featured) && (
            <button
              type="button"
              onClick={() => setShowOthers((v) => !v)}
              className="rounded-full px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline"
            >
              {showOthers ? "代表種目だけにする" : `ほかの種目（${stats.filter((s) => !s.featured).length}）`}
            </button>
          )}
        </div>
        {selected && <ExerciseDetail stats={selected} todayStr={todayStr} />}
      </InsightCard>

      <InsightCard id="ins-best" icon="🏅" title="自己ベスト" subtitle="種目ごとのいちばん良い記録">
        <div className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800 rounded-xl bg-neutral-50 dark:bg-neutral-800/50">
          {stats.filter((s) => s.featured || showOthers || !stats.some((x) => x.featured)).map((s) => (
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
                {s.bestFrom === "event" ? "測定会" : kindLabel[s.kind]}
              </span>
              <span className="w-16 text-right font-bold text-neutral-900 dark:text-neutral-100">
                {formatValue(s.kind, s.bestValue)}
              </span>
              <span className="w-10 text-right text-neutral-500">{s.bestDate ? formatMonthDay(s.bestDate) : ""}</span>
            </button>
          ))}
        </div>
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          🏅は2週間以内に自己ベストを更新した種目。BIG3はイベントの測定会の記録（実際に挙げた重量）も含めます。推定MAXは「重量×36÷(37−回数)」（Brzycki式）で、その日いちばん高く出たセットから計算しています（13回以上のセットは使いません）。
        </p>
      </InsightCard>
    </>
  );
}

function ExerciseDetail({ stats, todayStr }: { stats: ExerciseStats; todayStr: string }) {
  // 日報の記録と測定会の日を合わせて、新しい20日分
  const dates = Array.from(new Set([...stats.sessions.map((s) => s.date), ...stats.events.map((e) => e.date)]))
    .sort()
    .slice(-20);
  const sessionOf = new Map(stats.sessions.map((s) => [s.date, s]));
  const eventOf = new Map(stats.events.map((e) => [e.date, e.value]));
  const sessions = stats.sessions.filter((s) => dates.includes(s.date));
  const first = sessions[0];
  const last = sessions[sessions.length - 1];

  const recentQuality = sessions.filter((s) => s.mainAvg != null);
  const lastQ = recentQuality[recentQuality.length - 1];
  const diff = first && last ? (stats.kind === "time_low" ? first.value - last.value : last.value - first.value) : 0;
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
  const fmtLeft = (v: number) => (stats.kind === "e1rm" ? `${Math.round(v)}` : stats.kind === "reps" ? `${Math.round(v)}` : formatSeconds(Math.round(v)));
  const leftUnit = stats.kind === "e1rm" ? "重さ（kg）" : stats.kind === "reps" ? "回数" : "時間";
  const fmtRight = (v: number) =>
    stats.kind === "e1rm" ? (v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v)}`) : stats.kind === "reps" ? `${Math.round(v)}` : formatSeconds(Math.round(v));

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
      <div className="grid grid-cols-3 gap-2">
        {tile(
          `自己ベスト（${stats.bestFrom === "event" ? "測定会" : kindLabel[stats.kind]}）`,
          formatValue(stats.kind, stats.bestValue),
          stats.bestDate ? formatMonthDay(stats.bestDate) : undefined
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
            : `${sessions.length}回`,
          recentVolume > 0 ? `直近4週の練習量 ${formatVolume(stats.kind, recentVolume)}` : undefined
        )}
      </div>

      {dates.length > 0 && (
        <DualAxisChart
          labels={dates.map(formatMonthDay)}
          leftLabel={leftUnit}
          rightLabel={volumeLabel[stats.kind].replace("練習量", "練習量")}
          formatLeft={fmtLeft}
          formatRight={fmtRight}
          series={[
            { label: "練習量", axis: "right", kind: "bar", color: "#0284c7", values: dates.map((d) => sessionOf.get(d)?.mainVolume ?? null) },
            { label: "メインセット平均", axis: "left", kind: "line", color: "#ef4444", values: dates.map((d) => sessionOf.get(d)?.mainAvg ?? null) },
            { label: kindLabel[stats.kind], axis: "left", kind: "dashed", color: "#737373", values: dates.map((d) => sessionOf.get(d)?.value ?? null) },
            ...(stats.events.length > 0
              ? [{ label: "測定会", axis: "left" as const, kind: "point" as const, color: "#f59e0b", values: dates.map((d) => eventOf.get(d) ?? null) }]
              : []),
          ]}
          highlight={(i) => dates[i] === stats.bestDate}
          detail={(i) => {
            const d = dates[i];
            const s = sessionOf.get(d);
            const ev = eventOf.get(d);
            return (
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold">
                  {formatMonthDay(d)}
                  {s && `　質 ${s.mainAvg != null ? formatValue(stats.kind, s.mainAvg) : "—"}　最高 ${formatValue(stats.kind, s.value)}　練習量 ${formatVolume(stats.kind, s.mainVolume)}`}
                  {ev != null && `　測定会 ${ev}kg`}
                </span>
                {s && <span className="text-neutral-600 dark:text-neutral-400">{s.sets.map(setLabel).join(" / ")}</span>}
              </span>
            );
          }}
        />
      )}
      <p className="text-[length:calc(9px+var(--fs-add))] leading-relaxed text-neutral-500">
        左の目盛り＝重さ（メインセット平均・{kindLabel[stats.kind]}
        {stats.events.length > 0 ? "・測定会" : ""}）、右の目盛り＝その日のメインセットの練習量。黄色の列が自己ベストの日。
        {stats.kind === "e1rm" && "推定MAXはブリジッキー（Brzycki）式：重量×36÷(37−回数)。"}
      </p>

      {stats.sessions.length > 0 && (
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
      )}
    </div>
  );
}
