"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { toDraft, toRow, type MenuItemDraft } from "../lib/menuItems";
import { parseMenuText } from "../lib/menuParse";
import {
  CALC_VERSION,
  accumulate,
  addDays,
  coefficientDefs,
  dateRange,
  excludeReasonLabel,
  menuLoadFor,
  weightLoad,
  type Coefficients,
  type ExcludeReason,
  type Participation,
} from "../lib/loadEstimate";
import { needsCheck, describeAmount } from "../lib/menuItems";
import { currentGrade } from "../lib/types";
import { fatigueColor } from "./FatigueSelector";

// 管理ページ「練習」タブ（監督だけ）
// 1) 要確認：申請なしの欠席・許可未確認の途中退出・本人の報告と出欠確認の食い違い・本数の数え方が未確認
// 2) 負荷の試算：メニューの量 × 係数 の目安と、その人のいつもとの比較

type Loc = "tama" | "otsuka";
const LOC_LABEL: Record<Loc, string> = { tama: "多摩", otsuka: "大塚" };
type Member = {
  id: string;
  display_name: string;
  home_location: Loc | null;
  entry_year: number | null;
  weight_class: number | null;
};
type Menu = { id: string; date: string; start_time: string | null; location: Loc; is_joint: boolean };
type DiffKind = "absent_unplanned" | "present_unplanned" | "left_early";
type Diff = { menu_id: string; member_id: string; kind: DiffKind; permission: "confirmed" | "unconfirmed" | null };
type PartRow = Participation & { menu_id: string; member_id: string };
type ReviewKind = DiffKind | "mismatch";
type Review = { menu_id: string; member_id: string; kind: ReviewKind; decision: "ok" | "ng"; note: string | null };
type SetRow = { author_id: string; date: string; weight_kg: number | null; reps: number | null; is_warmup: boolean | null };

const reviewKindLabel: Record<ReviewKind, string> = {
  absent_unplanned: "休みの報告なしで欠席",
  left_early: "途中退出・中抜け",
  present_unplanned: "休みの報告があったが参加",
  mismatch: "本人の日報と出欠確認が合わない",
};
const decisionLabel: Record<ReviewKind, { ok: string; ng?: string }> = {
  absent_unplanned: { ok: "連絡あり", ng: "無断" },
  left_early: { ok: "許可あり", ng: "許可なし" },
  present_unplanned: { ok: "確認した" },
  mismatch: { ok: "確認した" },
};

function jstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
function md(date: string) {
  const [, m, d] = date.split("-");
  const w = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${Number(m)}/${Number(d)}（${w}）`;
}

// 1000行を超えるときのために、ページを分けて全部読む
async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type Data = {
  members: Member[];
  menus: Menu[];
  items: Map<string, { plan: MenuItemDraft[]; actual: MenuItemDraft[] }>;
  reported: Set<string>;
  diffs: Diff[];
  parts: PartRow[];
  absences: { author_id: string; date: string }[];
  sets: SetRow[];
  fatigue: { author_id: string; date: string; fatigue: number }[];
  reviews: Review[];
  settings: { coefficients: Coefficients; retention: number; calc_version: string } | null;
};

// part：checks＝「報告」タブの練習の確認事項／load＝「体調」タブの負荷の試算
export default function PracticeCheckSection({
  teamId,
  coachId,
  part,
}: {
  teamId: string;
  coachId: string;
  part: "checks" | "load";
}) {
  const supabase = createClient();
  const [base, setBase] = useState(jstToday());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loc, setLoc] = useState<Loc>("tama");
  const [showReviewed, setShowReviewed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const from = addDays(base, -55);
      const [memRes, menuRes, absRes, setRows, fatRes, setRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, home_location, entry_year, weight_class")
          .eq("team_id", teamId)
          .not("role", "in", "(coach,manager,ob)"),
        supabase
          .from("menus")
          .select("id, date, start_time, location, is_joint")
          .eq("team_id", teamId)
          .eq("is_off", false)
          .gte("date", from)
          .lte("date", base),
        supabase.from("absence_requests").select("author_id, date").eq("team_id", teamId).eq("status", "approved").gte("date", from).lte("date", base),
        fetchAll<SetRow>((a, b) =>
          supabase
            .from("training_sets")
            .select("author_id, date, weight_kg, reps, is_warmup")
            .eq("team_id", teamId)
            .gte("date", from)
            .lte("date", base)
            .order("id")
            .range(a, b)
        ),
        supabase.from("daily_conditions").select("author_id, date, fatigue").eq("team_id", teamId).gte("date", addDays(base, -6)).lte("date", base),
        supabase.from("load_settings").select("coefficients, retention, calc_version").eq("team_id", teamId).maybeSingle(),
      ]);
      if (memRes.error) throw new Error(memRes.error.message);
      if (menuRes.error) throw new Error(menuRes.error.message);
      if (setRes.error) throw new Error(`負荷の設定を読めませんでした（SQLが未実行かもしれません）：${setRes.error.message}`);
      const menus = (menuRes.data ?? []) as Menu[];
      const ids = menus.map((m) => m.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
      const per = await Promise.all(
        chunks.map(async (c) => {
          const [it, rep, df, pt, rv] = await Promise.all([
            fetchAll<Record<string, unknown>>((a, b) => supabase.from("menu_items").select("*").in("menu_id", c).order("id").range(a, b)),
            supabase.from("menu_reports").select("menu_id").in("menu_id", c),
            supabase.from("menu_attendance_diffs").select("menu_id, member_id, kind, permission").in("menu_id", c),
            fetchAll<PartRow>((a, b) =>
              supabase.from("menu_participation").select("menu_id, member_id, scope, boundary_key, item_keys, free_amounts").in("menu_id", c).order("id").range(a, b)
            ),
            supabase.from("attendance_reviews").select("menu_id, member_id, kind, decision, note").in("menu_id", c),
          ]);
          if (rv.error) throw new Error(`確認結果を読めませんでした（SQLが未実行かもしれません）：${rv.error.message}`);
          return { it, rep: rep.data ?? [], df: df.data ?? [], pt, rv: rv.data ?? [] };
        })
      );
      const items = new Map<string, { plan: MenuItemDraft[]; actual: MenuItemDraft[] }>();
      const allItems = per.flatMap((p) => p.it).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
      for (const r of allItems) {
        const id = r.menu_id as string;
        const e = items.get(id) ?? { plan: [], actual: [] };
        (r.phase === "actual" ? e.actual : e.plan).push(toDraft(r));
        items.set(id, e);
      }
      setData({
        members: ((memRes.data ?? []) as Member[]).sort(
          (a, b) => (a.entry_year ?? 9999) - (b.entry_year ?? 9999) || a.display_name.localeCompare(b.display_name, "ja")
        ),
        menus,
        items,
        reported: new Set(per.flatMap((p) => (p.rep as { menu_id: string }[]).map((r) => r.menu_id))),
        // 途中退出・中抜けは扱わない（以前のデータが残っていても無視する）
        diffs: per.flatMap((p) => p.df as Diff[]).filter((d) => d.kind !== "left_early"),
        parts: per.flatMap((p) => p.pt),
        absences: (absRes.data ?? []) as { author_id: string; date: string }[],
        sets: setRows,
        fatigue: (fatRes.data ?? []) as Data["fatigue"],
        reviews: per.flatMap((p) => p.rv as Review[]),
        settings: (setRes.data as Data["settings"]) ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込めませんでした");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const memberById = useMemo(() => new Map((data?.members ?? []).map((m) => [m.id, m])), [data]);
  const targetsOf = (m: Menu) => (data?.members ?? []).filter((x) => m.is_joint || x.home_location === m.location);

  // ---------- 1) 要確認 ----------
  type CheckRow = { key: string; menu: Menu; member: Member; kind: ReviewKind; detail: string; review: Review | undefined };
  type BasisRow = { key: string; menu: Menu; item: MenuItemDraft };
  const checks = useMemo(() => {
    if (!data) return { rows: [] as CheckRow[], basis: [] as BasisRow[] };
    const since = addDays(base, -13);
    const rows: CheckRow[] = [];
    const basis: BasisRow[] = [];
    const absentSet = new Set(data.absences.map((a) => `${a.author_id}:${a.date}`));
    for (const menu of data.menus) {
      if (menu.date < since) continue;
      const it = data.items.get(menu.id);
      if (data.reported.has(menu.id)) {
        for (const item of it?.actual.length ? it.actual : it?.plan ?? []) {
          if (needsCheck(item)) basis.push({ key: `${menu.id}:${item.key}`, menu, item });
        }
      } else continue;
      const diffs = data.diffs.filter((d) => d.menu_id === menu.id);
      const parts = new Map(data.parts.filter((p) => p.menu_id === menu.id).map((p) => [p.member_id, p]));
      const review = (memberId: string, kind: ReviewKind) =>
        data.reviews.find((r) => r.menu_id === menu.id && r.member_id === memberId && r.kind === kind);
      for (const d of diffs) {
        const member = memberById.get(d.member_id);
        if (!member) continue;
        rows.push({ key: `${menu.id}:${d.member_id}:${d.kind}`, menu, member, kind: d.kind, detail: "", review: review(d.member_id, d.kind) });
      }
      for (const member of targetsOf(menu)) {
        const p = parts.get(member.id);
        const d = diffs.find((x) => x.member_id === member.id);
        let detail = "";
        if (p && d?.kind === "absent_unplanned") detail = `出欠確認は「欠席」、本人は「${scopeText(p)}」と報告`;
        else if (p && absentSet.has(`${member.id}:${menu.date}`) && d?.kind !== "present_unplanned")
          detail = `休みの報告あり、本人は「${scopeText(p)}」と報告`;
        if (detail)
          rows.push({ key: `${menu.id}:${member.id}:mismatch`, menu, member, kind: "mismatch", detail, review: review(member.id, "mismatch") });
      }
    }
    const sort = (a: { menu: Menu }, b: { menu: Menu }) => b.menu.date.localeCompare(a.menu.date);
    return { rows: rows.sort(sort), basis: basis.sort(sort) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, base, memberById]);

  async function decide(row: CheckRow, decision: "ok" | "ng" | null) {
    setBusyKey(row.key);
    const q = supabase.from("attendance_reviews");
    const res =
      decision === null
        ? await q.delete().eq("menu_id", row.menu.id).eq("member_id", row.member.id).eq("kind", row.kind)
        : await q.upsert(
            {
              team_id: teamId,
              menu_id: row.menu.id,
              member_id: row.member.id,
              kind: row.kind,
              decision,
              reviewed_by: coachId,
              reviewed_at: new Date().toISOString(),
            },
            { onConflict: "menu_id,member_id,kind" }
          );
    setBusyKey(null);
    if (res.error) return setError(`保存できませんでした：${res.error.message}`);
    await load();
  }

  async function confirmBasis(row: BasisRow, basis: "total" | "per_person") {
    setBusyKey(row.key);
    const { error: e } = await supabase
      .from("menu_items")
      .update({ sets_basis: basis, updated_at: new Date().toISOString() })
      .eq("menu_id", row.menu.id)
      .eq("item_key", row.item.key);
    setBusyKey(null);
    if (e) return setError(`確定できませんでした：${e.message}`);
    await load();
  }

  // ---------- 2) 負荷の試算 ----------
  const coef: Coefficients = data?.settings?.coefficients ?? {};
  const retention = Number(data?.settings?.retention ?? 0.7);
  const hasCoef = Object.values(coef).some((v) => typeof v === "number");

  const estimate = useMemo(() => {
    if (!data) return null;
    const from = addDays(base, -55);
    const dates = dateRange(from, base);
    const absentSet = new Set(data.absences.map((a) => `${a.author_id}:${a.date}`));
    const week = addDays(base, -6);
    const excluded: Partial<Record<ExcludeReason, number>> = {};
    let unanswered = 0;
    let noClass = 0;
    const unreported = data.menus.filter(
      (m) => m.date >= week && !data.reported.has(m.id) && new Date(`${m.date}T${m.start_time ?? "00:00:00"}+09:00`).getTime() <= Date.now()
    ).length;
    const rows = data.members
      .filter((m) => m.home_location)
      .map((member) => {
        const daily = new Map<string, number>();
        for (const menu of data.menus) {
          if (!data.reported.has(menu.id)) continue;
          if (!menu.is_joint && menu.location !== member.home_location) continue;
          const d = data.diffs.find((x) => x.menu_id === menu.id && x.member_id === member.id);
          const p = data.parts.find((x) => x.menu_id === menu.id && x.member_id === member.id) ?? null;
          if (d?.kind === "absent_unplanned" && !p) continue;
          if (absentSet.has(`${member.id}:${menu.date}`) && d?.kind !== "present_unplanned" && !p) continue;
          const it = data.items.get(menu.id);
          const list = it?.actual.length ? it.actual : it?.plan ?? [];
          if (list.length === 0) continue;
          const r = menuLoadFor(list, p, coef);
          daily.set(menu.date, (daily.get(menu.date) ?? 0) + r.load);
          if (menu.date >= week) {
            if (!p) unanswered++;
            for (const [k, v] of Object.entries(r.excluded)) excluded[k as ExcludeReason] = (excluded[k as ExcludeReason] ?? 0) + (v ?? 0);
          }
        }
        const setsByDate = new Map<string, SetRow[]>();
        for (const s of data.sets) {
          if (s.author_id !== member.id) continue;
          const l = setsByDate.get(s.date) ?? [];
          l.push(s);
          setsByDate.set(s.date, l);
        }
        let classMissing = false;
        for (const [date, list] of setsByDate) {
          const w = weightLoad(list, member.weight_class, coef);
          if (w === null) {
            if (date >= week) classMissing = true;
            continue;
          }
          daily.set(date, (daily.get(date) ?? 0) + w);
        }
        if (classMissing && !member.weight_class) noClass++;
        const acc = accumulate(dates, daily, retention);
        const today = acc.get(base) ?? 0;
        const prev28 = dates.slice(-29, -1).map((d) => acc.get(d) ?? 0);
        const avg = prev28.reduce((a, b) => a + b, 0) / (prev28.length || 1);
        // 記録が始まって2週間たつまでは平均が小さすぎて比較にならないので出さない
        const first = dates.find((d) => (daily.get(d) ?? 0) > 0);
        const enough = !!first && first <= addDays(base, -14);
        const week7 = dates.slice(-7).reduce((a, d) => a + (daily.get(d) ?? 0), 0);
        const fat = data.fatigue
          .filter((f) => f.author_id === member.id)
          .sort((a, b) => b.date.localeCompare(a.date))[0];
        return {
          member,
          day: daily.get(base) ?? 0,
          week7,
          acc: today,
          ratio: enough && avg > 0 ? today / avg : null,
          short: !enough,
          fatigue: fat ? { value: fat.fatigue, date: fat.date } : null,
        };
      });
    return { rows, excluded, unanswered, noClass, unreported };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, base, coef, retention]);


  const card = "flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/70";
  const h2 = "flex items-center gap-2 text-sm font-semibold text-foreground";
  const small = "text-[length:calc(10px+var(--fs-add))] text-neutral-500";
  const btn = "rounded-lg border px-2.5 py-1 text-xs disabled:opacity-50";

  const rowsShown = checks.rows.filter((r) => (showReviewed ? true : !r.review));
  const basisShown = checks.basis;

  return (
    <div className="flex flex-col gap-5">
      {part === "checks" && <LegacyMenuConvert teamId={teamId} coachId={coachId} />}
      {part === "load" && (
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
          {(["tama", "otsuka"] as Loc[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLoc(l)}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ${
                loc === l ? "bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100" : "text-neutral-500"
              }`}
            >
              {LOC_LABEL[l]}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={base}
          max={jstToday()}
          onChange={(e) => e.target.value && setBase(e.target.value)}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </div>
      )}

      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
      {!data && !error && <p className="text-xs text-neutral-500">読み込み中…</p>}

      {data && part === "checks" && (
        <section className="flex flex-col gap-2">
          <h2 className={h2}>
            <span className="inline-block h-3.5 w-1 rounded-full bg-amber-500" />
            練習の確認事項（直近2週間）
          </h2>
          {rowsShown.length === 0 && basisShown.length === 0 && (
            <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
              練習の実施報告から出た確認事項はありません。
            </p>
          )}
          {rowsShown.map((r) => (
            <div key={r.key} className={card}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-neutral-500">
                  {md(r.menu.date)} {r.menu.start_time?.slice(0, 5)} {r.menu.is_joint ? "全体" : LOC_LABEL[r.menu.location]}
                </span>
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {r.member.display_name}
                  {r.member.entry_year && <span className="ml-1 text-xs font-normal text-neutral-400">{currentGrade(r.member.entry_year)}年</span>}
                </span>
              </div>
              <p className="text-xs text-neutral-800 dark:text-neutral-200">{reviewKindLabel[r.kind]}</p>
              {r.detail && <p className={small}>{r.detail}</p>}
              {r.review ? (
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${
                      r.review.decision === "ok"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                        : "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                    }`}
                  >
                    {r.review.decision === "ok" ? decisionLabel[r.kind].ok : decisionLabel[r.kind].ng}
                  </span>
                  <button type="button" disabled={busyKey === r.key} onClick={() => decide(r, null)} className={`${btn} border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400`}>
                    確認を戻す
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyKey === r.key}
                    onClick={() => decide(r, "ok")}
                    className={`${btn} border-emerald-500 font-bold text-emerald-700 dark:text-emerald-400`}
                  >
                    {decisionLabel[r.kind].ok}
                  </button>
                  {decisionLabel[r.kind].ng && (
                    <button
                      type="button"
                      disabled={busyKey === r.key}
                      onClick={() => decide(r, "ng")}
                      className={`${btn} border-red-400 font-bold text-red-700 dark:text-red-400`}
                    >
                      {decisionLabel[r.kind].ng}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {basisShown.map((b) => (
            <div key={b.key} className={card}>
              <span className="text-xs text-neutral-500">
                {md(b.menu.date)} {b.menu.start_time?.slice(0, 5)} {b.menu.is_joint ? "全体" : LOC_LABEL[b.menu.location]}
              </span>
              <p className="text-xs text-neutral-800 dark:text-neutral-200">
                本数の数え方が未確認：<b>{b.item.name}</b> {describeAmount(b.item, true)}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={busyKey === b.key} onClick={() => confirmBasis(b, "total")} className={`${btn} border-sky-400 text-sky-800 dark:text-sky-300`}>
                  全体の本数
                </button>
                <button type="button" disabled={busyKey === b.key} onClick={() => confirmBasis(b, "per_person")} className={`${btn} border-sky-400 text-sky-800 dark:text-sky-300`}>
                  1人あたり
                </button>
              </div>
            </div>
          ))}
          {checks.rows.some((r) => r.review) && (
            <button type="button" onClick={() => setShowReviewed((v) => !v)} className="self-start text-xs text-neutral-500 underline">
              {showReviewed ? "確認済みを隠す" : "確認済みも表示"}
            </button>
          )}
        </section>
      )}

      {data && estimate && part === "load" && (
        <section className="flex flex-col gap-2">
          <h2 className={h2}>
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            疲労度（負荷の試算）
            <span className="text-xs font-normal text-neutral-500">
              {md(base)}・計算式 {data.settings?.calc_version ?? CALC_VERSION}・残る割合{Math.round(retention * 100)}%
            </span>
          </h2>
          <p className={small}>
            実測ではなく、メニューの量×係数で出した目安です。「いつもと」は、その人の直近28日の平均を100%としたときの今日の蓄積です（記録が2週間分たまるまでは出しません）。
          </p>

          {!hasCoef && (
            <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              係数がまだ設定されていません。「設定 › 管理設定 › 疲労度の係数」から入れると計算されます。
            </p>
          )}

          {hasCoef && (
            <div className={card}>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-baseline gap-x-3 gap-y-1.5 text-xs">
                <span className={small}>名前</span>
                <span className={`${small} text-right`}>今日</span>
                <span className={`${small} text-right`}>7日</span>
                <span className={`${small} text-right`}>いつもと</span>
                <span className={`${small} text-right`}>自己評価</span>
                {estimate.rows
                  .filter((r) => r.member.home_location === loc)
                  .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1))
                  .map((r) => (
                    <div key={r.member.id} className="contents">
                      <span className="truncate text-neutral-900 dark:text-neutral-100">
                        {r.member.display_name}
                        {r.member.entry_year && <span className="ml-1 text-neutral-400">{currentGrade(r.member.entry_year)}年</span>}
                      </span>
                      <span className="text-right tabular-nums text-neutral-700 dark:text-neutral-300">{Math.round(r.day) || "-"}</span>
                      <span className="text-right tabular-nums text-neutral-700 dark:text-neutral-300">{Math.round(r.week7) || "-"}</span>
                      <span
                        className={`text-right font-bold tabular-nums ${
                          r.ratio === null
                            ? "text-neutral-400"
                            : r.ratio >= 1.3
                              ? "text-red-600 dark:text-red-400"
                              : r.ratio <= 0.7
                                ? "text-sky-600 dark:text-sky-400"
                                : "text-neutral-800 dark:text-neutral-200"
                        }`}
                      >
                        {r.ratio === null ? (r.short ? <span className="text-[length:calc(10px+var(--fs-add))] font-normal">記録不足</span> : "-") : `${Math.round(r.ratio * 100)}%`}
                      </span>
                      <span className="text-right">
                        {r.fatigue ? (
                          <span className={`rounded-full px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${fatigueColor(r.fatigue.value)}`}>
                            {r.fatigue.value}
                            {r.fatigue.date !== base && <span className="ml-0.5 font-normal opacity-70">{md(r.fatigue.date).replace(/（.）/, "")}</span>}
                          </span>
                        ) : (
                          <span className="text-neutral-400">-</span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {hasCoef && (
            <ul className={`${small} flex flex-col gap-0.5`}>
              <li>直近7日で計算に入っていないもの：</li>
              {estimate.unreported > 0 && <li>・実施報告がない練習 {estimate.unreported}件</li>}
              {(Object.keys(estimate.excluded) as ExcludeReason[]).map((k) => (
                <li key={k}>
                  ・{excludeReasonLabel[k]}：のべ{estimate.excluded[k]}項目
                </li>
              ))}
              {estimate.noClass > 0 && <li>・階級が未登録でウェイトを計算できない人 {estimate.noClass}人</li>}
              {estimate.unanswered > 0 && <li>・参加範囲の未回答 のべ{estimate.unanswered}回（自由参加以外は全部参加とみなしています）</li>}
              {estimate.unreported === 0 && Object.keys(estimate.excluded).length === 0 && estimate.noClass === 0 && estimate.unanswered === 0 && <li>・なし</li>}
            </ul>
          )}

          <p className={small}>係数と残る割合は「設定 › 管理設定 › 疲労度の係数」で変えられます。</p>
        </section>
      )}
    </div>
  );
}

function scopeText(p: Participation) {
  return { full: "全メニュー参加", until: "途中まで参加", from: "遅れて参加", partial: "一部だけ参加・中抜け" }[p.scope];
}

// これまでの自由記述だけのメニューを、メニュー項目（予定）に変換する（監督だけ・何度押しても同じ）。
// 自由記述の本文はそのまま残す。読み取れなかった量は空のまま、本数の数え方は「未確認」になる
export function LegacyMenuConvert({ teamId, coachId }: { teamId: string; coachId: string }) {
  const supabase = createClient();
  const [targets, setTargets] = useState<{ id: string; content: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function count() {
    const menus = await fetchAll<{ id: string; content: string }>((a, b) =>
      supabase.from("menus").select("id, content").eq("team_id", teamId).eq("is_off", false).neq("content", "").order("id").range(a, b)
    );
    const withItems = new Set(
      (
        await fetchAll<{ menu_id: string }>((a, b) =>
          supabase.from("menu_items").select("menu_id").eq("team_id", teamId).order("id").range(a, b)
        )
      ).map((r) => r.menu_id)
    );
    setTargets(menus.filter((m) => !withItems.has(m.id)));
  }

  useEffect(() => {
    count().catch((e) => setMsg(e instanceof Error ? e.message : "読み込めませんでした"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  async function run() {
    if (!targets || targets.length === 0) return;
    if (!window.confirm(`${targets.length}件のメニューを、メニュー項目に変換しますか？（自由記述の本文はそのまま残ります）`)) return;
    setBusy(true);
    let done = 0;
    for (const m of targets) {
      const rows = parseMenuText(m.content).map((it, i) => ({
        ...toRow(it, true),
        team_id: teamId,
        menu_id: m.id,
        phase: "plan",
        sort_order: i,
        created_by: coachId,
      }));
      if (rows.length === 0) continue;
      const { error: e } = await supabase.from("menu_items").insert(rows);
      if (e) {
        setMsg(`途中で止まりました（${done}件変換済み）：${e.message}`);
        break;
      }
      done++;
    }
    setBusy(false);
    if (done === targets.length) setMsg(`${done}件を変換しました。量が読み取れなかった項目は「量が未入力」になっています。`);
    await count();
  }

  if (!targets || (targets.length === 0 && !msg)) return null;
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
      <span className="text-xs text-neutral-700 dark:text-neutral-300">
        自由記述だけのメニューが <b>{targets.length}件</b> あります。メニュー項目に変換すると、練習予定表で項目として表示され、試算にも使えます。
      </span>
      {msg && <span className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</span>}
      {targets.length > 0 && (
        <button type="button" disabled={busy} onClick={run} className="self-start rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 dark:bg-neutral-200 dark:text-neutral-900">
          {busy ? "変換中…" : "まとめて変換する"}
        </button>
      )}
    </section>
  );
}
