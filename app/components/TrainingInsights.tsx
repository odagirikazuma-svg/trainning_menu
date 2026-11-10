"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isExemptOn, loadExemptions } from "../lib/exemptions";
import { Location, SessionType, TrainingType, trainingTypeLabel } from "../lib/types";
import type { Profile } from "./AuthGate";
import ExerciseProgress from "./ExerciseProgress";
import MatchReflectionList from "./MatchReflectionList";
import InsightCard, { InsightJumpBar } from "./InsightCard";
import {
  balanceLabel,
  computeDailyLoad,
  e1rm,
  loadBalance,
  MAT_PRACTICE_LOAD,
  type BalanceStatus,
  type LoadSetRow,
} from "../lib/trainingLoad";

/**
 * マイページ「振り返り」タブの上半分。（目標は設定タブで編集し、ヘッダーに表示する）
 * - 直近4週間のまとめ（日報の提出率・連続提出・練習負荷・平均強度・自己ベスト更新・負荷バランス）
 *   練習負荷＝重量×回数×セット数＋マット練習（参加1回につき一定値）
 * - 試合の振り返り（イベントで提出したもの）
 * - 週ごとの練習量（12週）・よくやるメニュー・ひとことコメント
 * - ウェイトMAX・体組成の推移（イベントで提出した記録）
 */

type Bucket = "mat" | TrainingType;
const bucketOrder: Bucket[] = ["mat", "weight", "running", "other"];
const bucketLabel: Record<Bucket, string> = {
  mat: "マット",
  weight: trainingTypeLabel.weight,
  running: trainingTypeLabel.running,
  other: trainingTypeLabel.other,
};
const bucketColor: Record<Bucket, string> = {
  mat: "bg-violet-500",
  weight: "bg-blue-500",
  running: "bg-red-500",
  other: "bg-neutral-400",
};

type Summary = {
  rate: number | null;
  done: number;
  required: number;
  prevRate: number | null;
  streak: number;
  matDone: number;
  matAbsent: number;
  counts: Record<TrainingType, number>;
  prevTrainingTotal: number;
  weeks: { label: string; counts: Record<Bucket, number> }[];
  topTitles: { title: string; type: TrainingType; count: number }[];
  lastByType: Partial<Record<TrainingType, string>>;
  // ---- 強度・負荷（日報で数値を入れたウェイトのセットから） ----
  hasLoad: boolean;
  load4w: number;
  loadPrev4w: number;
  intensity4w: number | null; // メインセットの平均相対強度（%）
  intensityPrev4w: number | null;
  pbCount4w: number;
  balance: { ratio: number | null; status: BalanceStatus | null };
  dailyLoads: { date: string; load: number; intensity: number | null }[]; // 直近28日
  improving: { name: string; from: number; to: number }[];
};

// 種目ごとの記録（ExerciseProgress）と共有する、セット記録1行
export type SetRowWithExercise = LoadSetRow & {
  seconds: number | null;
  exercise: { id: string; name: string; measure: "reps" | "time" } | null;
};

type MaxRow = {
  date: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

type BodyRow = {
  date: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s: string, n: number) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

function daysBetween(a: string, b: string) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

// その週の月曜日
function weekStart(s: string) {
  const d = parseDate(s);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return toDateKey(d);
}

function formatMonthDay(s: string) {
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function diffText(cur: number | null, prev: number | null, unit: string, digits = 1) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (Math.abs(diff) < 1e-9) return "±0";
  return `${diff > 0 ? "+" : ""}${diff.toFixed(digits).replace(/\.0+$/, "")}${unit}`;
}

export default function TrainingInsights({
  profile,
  refreshKey = 0,
}: {
  profile: Profile;
  refreshKey?: number;
}) {
  const supabase = createClient();
  const todayStr = toDateKey(new Date());
  const homeLocation: Location | null =
    profile.role === "manager" ? "tama" : profile.home_location;

  const [summary, setSummary] = useState<Summary | null>(null);
  // セット記録（1年分）。種目ごとの記録にもそのまま渡して、二重に読み込まない
  const [setRows, setSetRows] = useState<SetRowWithExercise[] | null>(null);
  const [maxRows, setMaxRows] = useState<MaxRow[]>([]);
  const [bodyRows, setBodyRows] = useState<BodyRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadSummary();
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function loadSummary() {
    const joined = toDateKey(new Date(profile.created_at));
    const windowStart = addDays(todayStr, -83); // 12週間
    const rangeStart = windowStart > joined ? windowStart : joined;

    // ---- 必要なデータをまとめて（並行して）読み込む ----
    type M = { id: string; date: string; start_time: string | null };
    const empty = Promise.resolve({ data: [] as unknown[], error: null });
    const setsSince = addDays(todayStr, -365);
    const setQuery = (cols: string) =>
      supabase
        .from("training_sets")
        .select(cols)
        .eq("author_id", profile.id)
        .gte("date", setsSince)
        .lte("date", todayStr)
        .order("date", { ascending: true })
        .limit(5000);
    // 種目名は行ごとに付けず（通信量が増えるため）、種目一覧を1回だけ読んで後から結びつける
    const setBase = "date, exercise_id, set_no, weight_kg, reps, seconds";
    const [own, joint, exemptions, schedRes, logRes, setResFirst, exRes] = await Promise.all([
      homeLocation
        ? supabase
            .from("menus")
            .select("id, date, start_time")
            .eq("team_id", profile.team_id)
            .eq("location", homeLocation)
            .eq("is_off", false)
            .gte("date", rangeStart)
            .lte("date", todayStr)
        : empty,
      homeLocation
        ? supabase
            .from("menus")
            .select("id, date, start_time")
            .eq("team_id", profile.team_id)
            .eq("is_joint", true)
            .eq("is_off", false)
            .gte("date", rangeStart)
            .lte("date", todayStr)
        : empty,
      loadExemptions(supabase, profile.team_id, rangeStart, todayStr, profile.id),
      homeLocation
        ? supabase
            .from("schedule_days")
            .select("date, sessions:schedule_sessions(session_type)")
            .eq("team_id", profile.team_id)
            .eq("location", homeLocation)
            .eq("is_off", false)
            .gte("date", rangeStart)
            .lte("date", todayStr)
        : empty,
      supabase
        .from("weight_logs")
        .select("date, type, title")
        .eq("author_id", profile.id)
        .gte("date", windowStart)
        .lte("date", todayStr),
      setQuery(`${setBase}, is_warmup`),
      supabase.from("exercises").select("id, name, measure").eq("team_id", profile.team_id),
    ]);
    // is_warmup 列がまだ無いDBでは、列なしで読み直す
    const setRes = setResFirst.error ? await setQuery(setBase) : setResFirst;
    const exerciseById = new Map(
      ((exRes.data ?? []) as { id: string; name: string; measure: "reps" | "time" }[]).map((e) => [
        e.id,
        e,
      ])
    );
    const allSetRows = (
      ((setRes.error ? [] : setRes.data) ?? []) as unknown as Omit<SetRowWithExercise, "exercise">[]
    ).map((r) => ({ ...r, exercise: exerciseById.get(r.exercise_id) ?? null }));
    setSetRows(allSetRows);

    const menuMap = new Map<string, M>();
    for (const m of [...(own.data ?? []), ...(joint.data ?? [])] as M[]) menuMap.set(m.id, m);
    const menuRows = Array.from(menuMap.values()).filter(
      (m) => !m.start_time || new Date() >= new Date(`${m.date}T${m.start_time}`)
    );

    const reportsByMenu = new Map<string, { kind: string; alt_type: TrainingType | null }>();
    if (menuRows.length > 0) {
      const { data } = await supabase
        .from("comments")
        .select("menu_id, kind, alt_type")
        .eq("author_id", profile.id)
        .in(
          "menu_id",
          menuRows.map((m) => m.id)
        )
        .in("kind", ["report", "absent"])
        .is("parent_id", null);
      for (const r of (data ?? []) as {
        menu_id: string;
        kind: string;
        alt_type: TrainingType | null;
      }[]) {
        reportsByMenu.set(r.menu_id, r);
      }
    }

    const trainingDates = new Set<string>();
    for (const row of (schedRes.data ?? []) as unknown as {
      date: string;
      sessions: { session_type: SessionType }[];
    }[]) {
      if (row.sessions.some((s) => s.session_type !== "mat")) trainingDates.add(row.date);
    }

    if (logRes.error) {
      setErrorMsg(logRes.error.message);
      return;
    }
    const logData = logRes.data;
    const logs = (logData ?? []) as { date: string; type: TrainingType; title: string | null }[];
    const logDates = new Set(logs.map((l) => l.date));

    // 日ごとの「やるべき報告」と「提出済み」
    const perDay = new Map<string, { required: number; done: number }>();
    const bump = (d: string, done: boolean) => {
      const cur = perDay.get(d) ?? { required: 0, done: 0 };
      cur.required += 1;
      if (done) cur.done += 1;
      perDay.set(d, cur);
    };
    for (const m of menuRows) {
      if (isExemptOn(exemptions, profile.id, m.date)) continue;
      bump(m.date, reportsByMenu.has(m.id));
    }
    for (const d of trainingDates) {
      if (isExemptOn(exemptions, profile.id, d)) continue;
      bump(d, logDates.has(d));
    }

    const recentStart = addDays(todayStr, -27);
    const prevStart = addDays(todayStr, -55);
    let done = 0,
      required = 0,
      prevDone = 0,
      prevRequired = 0;
    for (const [d, v] of perDay) {
      if (d >= recentStart) {
        done += v.done;
        required += v.required;
      } else if (d >= prevStart) {
        prevDone += v.done;
        prevRequired += v.required;
      }
    }

    // 連続提出：やることがあった日を新しい順に見て、全部出せている日が何日続いているか
    // （今日がまだ途中の場合は、今日は数えずに昨日から数える）
    let streak = 0;
    const days = Array.from(perDay.keys()).sort().reverse();
    for (const d of days) {
      const v = perDay.get(d)!;
      if (v.done >= v.required) streak += 1;
      else if (d === todayStr) continue;
      else break;
    }

    // 回数（直近4週間）
    const counts: Record<TrainingType, number> = { running: 0, weight: 0, other: 0 };
    let prevTrainingTotal = 0;
    let matDone = 0,
      matAbsent = 0;
    const menuDate = new Map(menuRows.map((m) => [m.id, m.date]));
    for (const l of logs) {
      if (l.date >= recentStart) counts[l.type] += 1;
      else if (l.date >= prevStart) prevTrainingTotal += 1;
    }
    for (const [menuId, r] of reportsByMenu) {
      const d = menuDate.get(menuId)!;
      if (d >= recentStart) {
        if (r.kind === "report") matDone += 1;
        else {
          matAbsent += 1;
          if (r.alt_type) counts[r.alt_type] += 1;
        }
      } else if (d >= prevStart && r.kind === "absent" && r.alt_type) {
        prevTrainingTotal += 1;
      }
    }

    // 週ごとの練習量（12週）
    const firstWeek = weekStart(addDays(todayStr, -7 * 11));
    const weeks: Summary["weeks"] = [];
    for (let i = 0; i < 12; i++) {
      const ws = addDays(firstWeek, i * 7);
      weeks.push({
        label: formatMonthDay(ws),
        counts: { mat: 0, weight: 0, running: 0, other: 0 },
      });
    }
    const weekIndex = (d: string) => Math.floor(daysBetween(firstWeek, weekStart(d)) / 7);
    for (const l of logs) {
      const i = weekIndex(l.date);
      if (i >= 0 && i < 12) weeks[i].counts[l.type] += 1;
    }
    for (const [menuId, r] of reportsByMenu) {
      const i = weekIndex(menuDate.get(menuId)!);
      if (i < 0 || i >= 12) continue;
      if (r.kind === "report") weeks[i].counts.mat += 1;
      else if (r.alt_type) weeks[i].counts[r.alt_type] += 1;
    }

    // よくやるメニュー（タイトル別・12週）
    const titleCount = new Map<string, { title: string; type: TrainingType; count: number }>();
    const lastByType: Partial<Record<TrainingType, string>> = {};
    for (const l of logs) {
      if (!lastByType[l.type] || lastByType[l.type]! < l.date) lastByType[l.type] = l.date;
      const t = l.title?.trim();
      if (!t) continue;
      const key = `${l.type}:${t}`;
      const cur = titleCount.get(key) ?? { title: t, type: l.type, count: 0 };
      cur.count += 1;
      titleCount.set(key, cur);
    }
    const topTitles = Array.from(titleCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // ---- 強度・負荷 ----
    const setRows = allSetRows;
    const dayLoads = computeDailyLoad(setRows);
    // マット練習に参加（実施報告）した日は、一定の負荷を足す
    let matLoadDays = 0;
    for (const [menuId, r] of reportsByMenu) {
      if (r.kind !== "report") continue;
      const d = menuDate.get(menuId);
      if (!d) continue;
      const cur = dayLoads.get(d) ?? { date: d, load: 0, intensities: [], pbExerciseIds: [] };
      cur.load += MAT_PRACTICE_LOAD;
      dayLoads.set(d, cur);
      matLoadDays += 1;
    }
    const dailyLoads: Summary["dailyLoads"] = [];
    for (let i = 27; i >= 0; i--) {
      const d = addDays(todayStr, -i);
      const dl = dayLoads.get(d);
      dailyLoads.push({
        date: d,
        load: dl?.load ?? 0,
        intensity:
          dl && dl.intensities.length > 0
            ? dl.intensities.reduce((a, b) => a + b, 0) / dl.intensities.length
            : null,
      });
    }
    let load4w = 0,
      loadPrev4w = 0,
      acute7 = 0,
      pbCount4w = 0;
    const int4w: number[] = [];
    const intPrev: number[] = [];
    const acuteStart = addDays(todayStr, -6);
    for (const [d, dl] of dayLoads) {
      if (d >= recentStart) {
        load4w += dl.load;
        int4w.push(...dl.intensities);
        pbCount4w += dl.pbExerciseIds.length;
        if (d >= acuteStart) acute7 += dl.load;
      } else if (d >= prevStart) {
        loadPrev4w += dl.load;
        intPrev.push(...dl.intensities);
      }
    }
    const avgPct = (xs: number[]) =>
      xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : null;

    // 伸びている種目：直近4週の推定MAXの最高 と それより前の最高 を比べる
    const bestBefore = new Map<string, number>();
    const bestRecent = new Map<string, number>();
    const exName = new Map<string, string>();
    for (const r of setRows) {
      if (r.weight_kg == null || !r.reps) continue;
      const v = e1rm(Number(r.weight_kg), r.reps);
      if (!v) continue;
      exName.set(r.exercise_id, r.exercise?.name ?? "");
      const m = r.date >= recentStart ? bestRecent : bestBefore;
      m.set(r.exercise_id, Math.max(m.get(r.exercise_id) ?? 0, v));
    }
    const improving = Array.from(bestRecent.entries())
      .filter(([id, v]) => (bestBefore.get(id) ?? 0) > 0 && v > bestBefore.get(id)!)
      .map(([id, v]) => ({ name: exName.get(id) ?? "", from: bestBefore.get(id)!, to: v }))
      .sort((a, b) => b.to / b.from - a.to / a.from)
      .slice(0, 3);

    setSummary({
      hasLoad: matLoadDays > 0 || setRows.some((r) => r.weight_kg != null && (r.reps ?? 0) > 0),
      load4w,
      loadPrev4w,
      intensity4w: avgPct(int4w),
      intensityPrev4w: avgPct(intPrev),
      pbCount4w,
      balance: loadBalance(acute7, load4w),
      dailyLoads,
      improving,
      rate: required > 0 ? Math.round((done / required) * 100) : null,
      done,
      required,
      prevRate: prevRequired > 0 ? Math.round((prevDone / prevRequired) * 100) : null,
      streak,
      matDone,
      matAbsent,
      counts,
      prevTrainingTotal,
      weeks,
      topTitles,
      lastByType,
    });
  }

  async function loadRecords() {
    // ウェイトMAX（イベントで提出した記録）
    const maxPromise = supabase
      .from("weight_maxes")
      .select("bench, squat, deadlift, updated_at, event:weight_max_events(created_at)")
      .eq("author_id", profile.id);
    const bodyPromise = supabase
      .from("team_event_submissions")
      .select(
        "measurement_date, weight_kg, body_fat_pct, muscle_mass_kg, updated_at, event:team_events!team_event_submissions_event_id_fkey(type, deadline)"
      )
      .eq("author_id", profile.id);
    const [{ data: maxData }, { data: bodyData }] = await Promise.all([maxPromise, bodyPromise]);
    const maxes = ((maxData ?? []) as unknown as {
      bench: number | null;
      squat: number | null;
      deadlift: number | null;
      updated_at: string;
      event: { created_at: string } | null;
    }[])
      .map((r) => ({
        date: toDateKey(new Date(r.event?.created_at ?? r.updated_at)),
        bench: r.bench,
        squat: r.squat,
        deadlift: r.deadlift,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    setMaxRows(maxes);

    // 体組成（イベントで提出した記録）
    const body = ((bodyData ?? []) as unknown as {
      measurement_date: string | null;
      weight_kg: number | null;
      body_fat_pct: number | null;
      muscle_mass_kg: number | null;
      updated_at: string;
      event: { type: string; deadline: string } | null;
    }[])
      .filter((r) => r.event?.type === "body_composition")
      .map((r) => ({
        date: r.measurement_date ?? r.event?.deadline ?? toDateKey(new Date(r.updated_at)),
        weight_kg: r.weight_kg,
        body_fat_pct: r.body_fat_pct,
        muscle_mass_kg: r.muscle_mass_kg,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    setBodyRows(body);
  }

  // ---- ひとことコメント（数字から自動で作る） ----
  function insights(s: Summary): string[] {
    const out: string[] = [];
    if (s.rate != null && s.prevRate != null && s.rate !== s.prevRate) {
      out.push(
        s.rate > s.prevRate
          ? `日報の提出率が前の4週間より${s.rate - s.prevRate}ポイント上がっています。`
          : `日報の提出率が前の4週間より${s.prevRate - s.rate}ポイント下がっています。出し忘れに注意。`
      );
    }
    const total = s.counts.running + s.counts.weight + s.counts.other;
    const perWeek = Math.round((total / 4) * 10) / 10;
    if (total > 0) {
      const diff = total - s.prevTrainingTotal;
      out.push(
        `マット以外のトレーニングは週平均${perWeek}回${
          s.prevTrainingTotal > 0 && diff !== 0
            ? `（前の4週間より${diff > 0 ? "+" : ""}${diff}回）`
            : ""
        }。`
      );
    }
    for (const t of ["weight", "running"] as TrainingType[]) {
      const last = s.lastByType[t];
      if (last) {
        const n = daysBetween(last, todayStr);
        if (n >= 10) out.push(`最後の${trainingTypeLabel[t]}から${n}日あいています。`);
      }
    }
    if (s.streak >= 5) out.push(`${s.streak}日連続で日報を出せています。この調子！`);
    for (const im of s.improving) {
      const pct = Math.round((im.to / im.from - 1) * 1000) / 10;
      out.push(
        `「${im.name}」の推定MAXが ${Math.round(im.from * 10) / 10}kg → ${Math.round(im.to * 10) / 10}kg に伸びています（+${pct}%）。`
      );
    }
    if (s.hasLoad && s.loadPrev4w > 0) {
      const pct = Math.round((s.load4w / s.loadPrev4w - 1) * 100);
      if (Math.abs(pct) >= 10)
        out.push(`練習負荷は前の4週間より${pct > 0 ? `${pct}%増えて` : `${-pct}%減って`}います。`);
    }
    if (s.topTitles[0]) {
      out.push(`いちばん多いメニューは「${s.topTitles[0].title}」（${s.topTitles[0].count}回）。`);
    }
    return out;
  }

  const maxWeekTotal = summary
    ? Math.max(
        1,
        ...summary.weeks.map((w) => bucketOrder.reduce((a, b) => a + w.counts[b], 0))
      )
    : 1;

  type Trend = { up: boolean | null; text: string } | null;
  // 前の4週との比較（▲▼と文字で表す。色だけに頼らない）
  const trendOf = (cur: number | null, prev: number | null, unit = "", isPct = false): Trend => {
    if (cur == null || prev == null || prev === 0) return null;
    const diff = isPct ? cur - prev : Math.round((cur / prev - 1) * 100);
    if (diff === 0) return { up: null, text: "前の4週と同じ" };
    return {
      up: diff > 0,
      text: `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}${isPct ? "pt" : "%"}${unit}`,
    };
  };

  const tile = (icon: string, label: string, value: string, sub?: string | null, trend?: Trend) => (
    <div className="flex flex-col gap-1 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
      <span className="flex items-center gap-1 text-[length:calc(10px+var(--fs-add))] font-medium text-neutral-500">
        <span>{icon}</span>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="text-2xl font-extrabold leading-none text-foreground">{value}</span>
        {trend && (
          <span
            className={`text-[length:calc(10px+var(--fs-add))] font-bold ${
              trend.up == null
                ? "text-neutral-500"
                : trend.up
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
            }`}
          >
            {trend.text}
          </span>
        )}
      </span>
      {sub && (
        <span className="text-[length:calc(10px+var(--fs-add))] leading-snug text-neutral-500">{sub}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">{errorMsg}</p>
      )}

      <InsightJumpBar
        items={[
          { id: "ins-summary", label: "📊 まとめ" },
          { id: "ins-exercise", label: "🏋️ 種目ごと" },
          { id: "ins-best", label: "🏅 自己ベスト" },
          { id: "ins-match", label: "🤼 試合" },
          { id: "ins-events", label: "📈 イベント" },
        ]}
      />

      {/* 直近4週間のまとめ */}
      <InsightCard id="ins-summary" icon="📊" title="直近4週間のまとめ" subtitle="▲▼は前の4週間との比較">
        {!summary ? (
          <p className="text-xs text-neutral-500">集計中…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {tile(
                "📝",
                "日報の提出率",
                summary.rate == null ? "—" : `${summary.rate}%`,
                summary.required > 0 ? `${summary.done}/${summary.required}件` : "対象の練習がありません",
                trendOf(summary.rate, summary.prevRate, "", true)
              )}
              {tile("🔥", "連続提出", `${summary.streak}日`, "練習があった日で数えています")}
              {tile(
                "⚡",
                "練習負荷",
                summary.hasLoad ? Math.round(summary.load4w).toLocaleString() : "—",
                "重量×回数×セット数＋マット練習の4週合計",
                summary.hasLoad ? trendOf(summary.load4w, summary.loadPrev4w) : null
              )}
              {tile(
                "💪",
                "平均強度",
                summary.intensity4w != null ? `${summary.intensity4w}%` : "—",
                "メインセットの重さ÷推定MAX",
                trendOf(summary.intensity4w, summary.intensityPrev4w, "", true)
              )}
              {tile(
                "🏅",
                "自己ベスト更新",
                `${summary.pbCount4w}回`,
                summary.improving[0] ? `いちばん伸びた：${summary.improving[0].name}` : "推定MAXの更新回数"
              )}
              {tile(
                "🤼",
                "マット練習",
                `${summary.matDone}回`,
                summary.matAbsent > 0 ? `未実施 ${summary.matAbsent}回` : "実施報告の回数"
              )}
            </div>

            {summary.hasLoad && (
              <DailyLoadChart
                days={summary.dailyLoads}
                balance={summary.balance}
                todayStr={todayStr}
              />
            )}
            {insights(summary).length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                <span className="text-[length:calc(11px+var(--fs-add))] font-bold text-amber-800 dark:text-amber-300">
                  💡 ひとことコメント
                </span>
                <ul className="flex flex-col gap-1 text-[length:calc(12px+var(--fs-add))] text-neutral-800 dark:text-neutral-200">
                  {insights(summary).map((t) => (
                    <li key={t}>・{t}</li>
                  ))}
                </ul>
              </div>
            )}

            <details className="rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/50">
              <summary className="cursor-pointer text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-600 dark:text-neutral-400">
                練習回数の内訳とよくやるメニュー（12週）
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-wrap gap-3 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
                  {bucketOrder.map((b) => (
                    <span key={b} className="flex items-center gap-1">
                      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${bucketColor[b]}`} />
                      {bucketLabel[b]}
                    </span>
                  ))}
                </div>
                <div>
                  <div className="flex h-28 items-end gap-1">
                    {summary.weeks.map((w, i) => {
                      const total = bucketOrder.reduce((a, b) => a + w.counts[b], 0);
                      const tip = `${w.label}の週：${bucketOrder
                        .map((b) => `${bucketLabel[b]}${w.counts[b]}`)
                        .join("・")}（計${total}回）`;
                      return (
                        <div
                          key={i}
                          title={tip}
                          className="flex h-full flex-1 flex-col items-center justify-end gap-0.5"
                        >
                          {total > 0 && (
                            <span className="text-[length:calc(9px+var(--fs-add))] text-neutral-500">
                              {total}
                            </span>
                          )}
                          <div
                            className="flex w-full flex-col-reverse gap-[2px] overflow-hidden rounded-t"
                            style={{ height: `${(total / maxWeekTotal) * 100}%` }}
                          >
                            {bucketOrder.map((b) =>
                              w.counts[b] > 0 ? (
                                <div
                                  key={b}
                                  className={bucketColor[b]}
                                  style={{ flexGrow: w.counts[b], minHeight: 3 }}
                                />
                              ) : null
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex gap-1 border-t border-neutral-200 pt-1 dark:border-neutral-700">
                    {summary.weeks.map((w, i) => (
                      <span
                        key={i}
                        className="flex-1 text-center text-[length:calc(8px+var(--fs-add))] text-neutral-500"
                      >
                        {i % 2 === 0 ? w.label : ""}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                    週の始まり（月曜）の日付。未実施報告の代替メニューも数えています。
                  </p>
                </div>
                {summary.topTitles.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-600 dark:text-neutral-400">
                      よくやるメニュー
                    </span>
                    {summary.topTitles.map((t) => (
                      <div key={`${t.type}:${t.title}`} className="flex items-center gap-2 text-xs">
                        <span className="w-24 shrink-0 truncate text-neutral-800 dark:text-neutral-200">{t.title}</span>
                        <div className="h-2 flex-1 rounded bg-neutral-200 dark:bg-neutral-700">
                          <div
                            className={`h-2 rounded ${bucketColor[t.type]}`}
                            style={{ width: `${(t.count / summary.topTitles[0].count) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-neutral-600 dark:text-neutral-400">{t.count}回</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </>
        )}
      </InsightCard>

      {/* 種目ごとの記録・自己ベスト（日報で入れた数値から） */}
      <ExerciseProgress rows={setRows} />

      {/* 試合の振り返り（イベントで提出したもの） */}
      <MatchReflectionList profile={profile} />

      {/* イベントの推移（ウェイトMAX・体組成） */}
      <InsightCard id="ins-events" icon="📈" title="イベントの推移" subtitle="イベントで提出したウェイトMAX・体組成">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">ウェイトMAX</span>
          {maxRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
              まだ記録がありません（イベントの「ウェイトMAX」で提出すると、ここに並びます）。
            </p>
          ) : (
            <RecordTable
              columns={[
                { key: "bench", label: "ベンチ", unit: "kg" },
                { key: "squat", label: "スクワット", unit: "kg" },
                { key: "deadlift", label: "デッド", unit: "kg" },
              ]}
              rows={maxRows}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">体組成</span>
          {bodyRows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
              まだ記録がありません（イベントの「体組成」で提出すると、ここに並びます）。
            </p>
          ) : (
            <RecordTable
              columns={[
                { key: "weight_kg", label: "体重", unit: "kg" },
                { key: "body_fat_pct", label: "体脂肪率", unit: "%" },
                { key: "muscle_mass_kg", label: "筋肉量", unit: "kg" },
              ]}
              rows={bodyRows}
            />
          )}
        </div>
      </InsightCard>
    </div>
  );
}

// 記録の推移を表で見せる（新しい順・前回からの増減つき）
function RecordTable<T extends { date: string }>({
  columns,
  rows,
}: {
  columns: { key: keyof T & string; label: string; unit: string }[];
  rows: T[];
}) {
  const desc = rows.slice().reverse();
  return (
    <div className="overflow-x-auto rounded-xl bg-neutral-50 dark:bg-neutral-800/50">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
            <th className="px-3 py-2 text-left font-medium">日付</th>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {desc.map((r, i) => {
            const prev = desc[i + 1];
            return (
              <tr key={`${r.date}-${i}`} className="border-b border-neutral-200 dark:border-neutral-800 last:border-0">
                <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{formatMonthDay(r.date)}</td>
                {columns.map((c) => {
                  const v = r[c.key] as unknown as number | null;
                  const pv = prev ? (prev[c.key] as unknown as number | null) : null;
                  const d = diffText(v, pv, c.unit);
                  return (
                    <td key={c.key} className="px-3 py-2 text-right text-neutral-900 dark:text-neutral-100">
                      {v == null ? "—" : `${v}${c.unit}`}
                      {d && (
                        <span className="ml-1 text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                          ({d})
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 毎日の練習負荷（直近28日）と、負荷バランス（直近7日 ÷ 4週平均）
function DailyLoadChart({
  days,
  balance,
  todayStr,
}: {
  days: { date: string; load: number; intensity: number | null }[];
  balance: { ratio: number | null; status: BalanceStatus | null };
  todayStr: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...days.map((d) => d.load));
  const act = days.find((d) => d.date === active) ?? null;
  const statusStyle: Record<BalanceStatus, string> = {
    low: "border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300",
    good: "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300",
    high: "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300",
    danger: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300",
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">毎日の練習負荷（28日）</span>
        {balance.status && balance.ratio != null && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold ${statusStyle[balance.status]}`}
          >
            負荷バランス {balance.ratio.toFixed(2)}・{balanceLabel[balance.status].label}
          </span>
        )}
      </div>
      <div className="flex h-24 items-end gap-[2px]">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setActive(d.date === active ? null : d.date)}
            className="flex h-full flex-1 items-end"
            aria-label={`${d.date} 負荷${Math.round(d.load)}`}
          >
            <span
              className={`w-full rounded-t ${
                d.date === active
                  ? "bg-red-400"
                  : d.date === todayStr
                    ? "bg-red-600"
                    : d.load > 0
                      ? "bg-red-600/60"
                      : "bg-neutral-100 dark:bg-neutral-800"
              }`}
              style={{ height: d.load > 0 ? `${Math.max(4, (d.load / max) * 100)}%` : "2px" }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[length:calc(9px+var(--fs-add))] text-neutral-500">
        <span>{formatMonthDay(days[0].date)}</span>
        <span>今日</span>
      </div>
      {act ? (
        <p className="rounded bg-neutral-100 dark:bg-neutral-800 px-2 py-1 text-xs text-neutral-800 dark:text-neutral-200">
          {formatMonthDay(act.date)}：負荷 {Math.round(act.load).toLocaleString()}
          {act.intensity != null ? `・平均強度 ${Math.round(act.intensity * 100)}%` : "・ウェイトの記録なし"}
        </p>
      ) : (
        balance.status && (
          <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
            {balanceLabel[balance.status].note}
          </p>
        )
      )}
      <p className="text-[length:calc(9px+var(--fs-add))] leading-relaxed text-neutral-500">
        ※練習負荷＝メインセット（アップを除く）の「重量×回数」をセットごとに足したもの（＝重量×回数×セット数）。例：80kg×8回×3セットなら 1,920。
        マット練習に参加した日は {MAT_PRACTICE_LOAD.toLocaleString()} を足しています。重量なし・時間の種目とランは含みません。
        負荷バランス＝直近7日の負荷÷4週間の1週あたり平均（0.8〜1.3がちょうどいい範囲）。
      </p>
    </div>
  );
}
