"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { isExemptOn, loadExemptions } from "../lib/exemptions";
import { Location, SessionType, TrainingType, trainingTypeLabel } from "../lib/types";
import type { Profile } from "./AuthGate";

/**
 * マイページ「振り返り」タブの上半分。（目標は設定タブで編集し、ヘッダーに表示する）
 * - 直近4週間のまとめ（日報の提出率・連続提出・練習回数）
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

    // マットメニュー（所属拠点＋全体練習）
    type M = { id: string; date: string; start_time: string | null };
    let menuRows: M[] = [];
    if (homeLocation) {
      const [own, joint] = await Promise.all([
        supabase
          .from("menus")
          .select("id, date, start_time")
          .eq("team_id", profile.team_id)
          .eq("location", homeLocation)
          .eq("is_off", false)
          .gte("date", rangeStart)
          .lte("date", todayStr),
        supabase
          .from("menus")
          .select("id, date, start_time")
          .eq("team_id", profile.team_id)
          .eq("is_joint", true)
          .eq("is_off", false)
          .gte("date", rangeStart)
          .lte("date", todayStr),
      ]);
      const map = new Map<string, M>();
      for (const m of [...(own.data ?? []), ...(joint.data ?? [])] as M[]) map.set(m.id, m);
      menuRows = Array.from(map.values()).filter(
        (m) => !m.start_time || new Date() >= new Date(`${m.date}T${m.start_time}`)
      );
    }

    const exemptions = await loadExemptions(
      supabase,
      profile.team_id,
      rangeStart,
      todayStr,
      profile.id
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
    if (homeLocation) {
      const { data } = await supabase
        .from("schedule_days")
        .select("date, sessions:schedule_sessions(session_type)")
        .eq("team_id", profile.team_id)
        .eq("location", homeLocation)
        .eq("is_off", false)
        .gte("date", rangeStart)
        .lte("date", todayStr);
      for (const row of (data ?? []) as unknown as {
        date: string;
        sessions: { session_type: SessionType }[];
      }[]) {
        if (row.sessions.some((s) => s.session_type !== "mat")) trainingDates.add(row.date);
      }
    }

    const { data: logData, error: logError } = await supabase
      .from("weight_logs")
      .select("date, type, title")
      .eq("author_id", profile.id)
      .gte("date", windowStart)
      .lte("date", todayStr);
    if (logError) {
      setErrorMsg(logError.message);
      return;
    }
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

    setSummary({
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
    const { data: maxData } = await supabase
      .from("weight_maxes")
      .select("bench, squat, deadlift, updated_at, event:weight_max_events(created_at)")
      .eq("author_id", profile.id);
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
    const { data: bodyData } = await supabase
      .from("team_event_submissions")
      .select(
        "measurement_date, weight_kg, body_fat_pct, muscle_mass_kg, updated_at, event:team_events!team_event_submissions_event_id_fkey(type, deadline)"
      )
      .eq("author_id", profile.id);
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

  const sectionTitle = (text: string, right?: React.ReactNode) => (
    <div className="flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        {text}
      </h2>
      {right}
    </div>
  );

  const tile = (label: string, value: string, sub?: string | null) => (
    <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">{label}</span>
      <span className="text-xl font-bold text-foreground">{value}</span>
      {sub && (
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">{sub}</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">{errorMsg}</p>
      )}

      {/* 直近4週間のまとめ */}
      <section className="flex flex-col gap-2">
        {sectionTitle("直近4週間のまとめ")}
        {!summary ? (
          <p className="text-xs text-neutral-500">集計中…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {tile(
                "日報の提出率",
                summary.rate == null ? "—" : `${summary.rate}%`,
                summary.required > 0
                  ? `${summary.done}/${summary.required}件${
                      summary.prevRate != null ? `・前の4週 ${summary.prevRate}%` : ""
                    }`
                  : "対象の練習がありません"
              )}
              {tile("連続提出", `${summary.streak}日`, "練習があった日で数えています")}
              {tile(
                "マット練習",
                `${summary.matDone}回`,
                summary.matAbsent > 0 ? `未実施 ${summary.matAbsent}回` : null
              )}
              {tile(
                "トレーニング",
                `${summary.counts.weight + summary.counts.running + summary.counts.other}回`,
                `ウェイト${summary.counts.weight}・ラン${summary.counts.running}・その他${summary.counts.other}`
              )}
            </div>
            {insights(summary).length > 0 && (
              <ul className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-[length:calc(12px+var(--fs-add))] text-neutral-300">
                {insights(summary).map((t) => (
                  <li key={t}>・{t}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* 週ごとの練習量 */}
      {summary && (
        <section className="flex flex-col gap-2">
          {sectionTitle("週ごとの練習量（12週）")}
          <div className="flex flex-wrap gap-3 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
            {bucketOrder.map((b) => (
              <span key={b} className="flex items-center gap-1">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${bucketColor[b]}`} />
                {bucketLabel[b]}
              </span>
            ))}
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex h-32 items-end gap-1">
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
            <div className="mt-1 flex gap-1 border-t border-neutral-800 pt-1">
              {summary.weeks.map((w, i) => (
                <span
                  key={i}
                  className="flex-1 text-center text-[length:calc(8px+var(--fs-add))] text-neutral-500"
                >
                  {i % 2 === 0 ? w.label : ""}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            週の始まり（月曜）の日付です。未実施報告の代替メニューもトレーニングとして数えています。
          </p>
        </section>
      )}

      {/* よくやるメニュー */}
      {summary && summary.topTitles.length > 0 && (
        <section className="flex flex-col gap-2">
          {sectionTitle("よくやるメニュー（12週）")}
          <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
            {summary.topTitles.map((t) => (
              <div key={`${t.type}:${t.title}`} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-neutral-200">{t.title}</span>
                <div className="h-2 flex-1 rounded bg-neutral-800">
                  <div
                    className={`h-2 rounded ${bucketColor[t.type]}`}
                    style={{ width: `${(t.count / summary.topTitles[0].count) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-neutral-400">{t.count}回</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ウェイトMAX */}
      <section className="flex flex-col gap-2">
        {sectionTitle("ウェイトMAXの推移")}
        {maxRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-xs text-neutral-500">
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
      </section>

      {/* 体組成 */}
      <section className="flex flex-col gap-2">
        {sectionTitle("体組成の推移")}
        {bodyRows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-xs text-neutral-500">
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
      </section>
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
    <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-neutral-800 text-neutral-500">
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
              <tr key={`${r.date}-${i}`} className="border-b border-neutral-800 last:border-0">
                <td className="px-3 py-2 text-neutral-400">{formatMonthDay(r.date)}</td>
                {columns.map((c) => {
                  const v = r[c.key] as unknown as number | null;
                  const pv = prev ? (prev[c.key] as unknown as number | null) : null;
                  const d = diffText(v, pv, c.unit);
                  return (
                    <td key={c.key} className="px-3 py-2 text-right text-neutral-100">
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
