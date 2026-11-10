"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import {
  amountMissing,
  describeAmount,
  formatLabel,
  needsCheck,
  newKey,
  toDraft,
  toRow,
  type MenuItemDraft,
} from "../../lib/menuItems";
import { currentGrade, type Location } from "../../lib/types";
import type { Profile } from "../AuthGate";
import MenuItemsEditor from "./MenuItemsEditor";
import { notifyBoardTasksChanged } from "../shell/useBoardTasks";

// 練習予定表：メニューの下に出す「計算用メニュー」と「練習後の実施報告」。
// - 練習前：予定メニュー（plan）を、テンプレート・前回のメニューから作る
// - 練習後：予定を引き継いで実績（actual）に直し、参加者が休みの報告と合っているかを確認する
// メニューを作る人と実施報告をする人は、別の人でもよい（部員・マネージャー・管理者なら誰でも）

type Member = { id: string; display_name: string; home_location: Location | null; entry_year: number | null };
type Template = { id: string; name: string; purpose: string | null; items: Record<string, unknown>[] };
type Report = {
  attendance_matches: boolean;
  note: string | null;
  reported_by: string | null;
  reported_at: string;
  reporter?: { display_name: string } | null;
};
type DiffKind = "absent_unplanned" | "present_unplanned" | "left_early";
type Diff = { member_id: string; kind: DiffKind; permission: "confirmed" | "unconfirmed" | null };

const diffLabel: Record<DiffKind, string> = {
  absent_unplanned: "参加予定だったが欠席",
  present_unplanned: "欠席予定だったが参加",
  left_early: "途中退出・中抜け",
};

function ItemList({
  items,
  onConfirm,
}: {
  items: MenuItemDraft[];
  onConfirm?: (key: string, basis: "total" | "per_person") => void;
}) {
  if (items.length === 0) return <p className="text-xs text-neutral-500">まだ入力されていません。</p>;
  return (
    <ol className="flex flex-col gap-1">
      {items.map((it, i) => (
        <li key={it.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="w-4 shrink-0 text-right text-xs text-neutral-400">{i + 1}</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{it.name || "（名前未入力）"}</span>
          <span className="text-xs text-neutral-500">
            {describeAmount(it)}
            {it.format !== "all" && `・${formatLabel[it.format]}`}
          </span>
          {!amountMissing(it) && needsCheck(it) && (
            <span className="rounded bg-sky-100 px-1 text-[length:calc(9px+var(--fs-add))] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
              要確認・計算対象外
            </span>
          )}
          {onConfirm && !amountMissing(it) && needsCheck(it) && (
            <span className="flex gap-1">
              <button type="button" onClick={() => onConfirm(it.key, "total")} className="rounded border border-sky-400 px-1.5 text-[length:calc(10px+var(--fs-add))] text-sky-800 dark:text-sky-300">
                全体の本数
              </button>
              <button type="button" onClick={() => onConfirm(it.key, "per_person")} className="rounded border border-sky-400 px-1.5 text-[length:calc(10px+var(--fs-add))] text-sky-800 dark:text-sky-300">
                1人あたり
              </button>
            </span>
          )}
          {amountMissing(it) && (
            <span className="rounded bg-amber-100 px-1 text-[length:calc(9px+var(--fs-add))] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              量が未入力
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function StructuredMenuCard({
  profile,
  menuId,
  date,
  location,
  isJoint,
  started,
  canEdit,
  canConfirm,
}: {
  profile: Profile;
  menuId: string;
  date: string;
  location: Location;
  isJoint: boolean;
  started: boolean;
  canEdit: boolean;
  // 監督・管理者：「要確認」（本数が全体か個人か）を決められる
  canConfirm: boolean;
}) {
  const supabase = createClient();
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [plan, setPlan] = useState<MenuItemDraft[]>([]);
  const [actual, setActual] = useState<MenuItemDraft[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [diffs, setDiffs] = useState<Diff[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [absentIds, setAbsentIds] = useState<Set<string>>(new Set());

  // 編集中の状態
  const [mode, setMode] = useState<"view" | "plan" | "report">("view");
  const [draft, setDraft] = useState<MenuItemDraft[]>([]);
  const [matches, setMatches] = useState<boolean | null>(null);
  const [draftDiffs, setDraftDiffs] = useState<Map<string, Diff>>(new Map());
  const [reportNote, setReportNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    const [itemsRes, repRes, diffRes, tplRes, memRes, absRes] = await Promise.all([
      supabase.from("menu_items").select("*").eq("menu_id", menuId).order("sort_order"),
      supabase
        .from("menu_reports")
        .select("attendance_matches, note, reported_by, reported_at, reporter:profiles!menu_reports_reported_by_fkey(display_name)")
        .eq("menu_id", menuId)
        .maybeSingle(),
      supabase.from("menu_attendance_diffs").select("member_id, kind, permission").eq("menu_id", menuId),
      supabase.from("menu_templates").select("id, name, purpose, items").eq("team_id", profile.team_id).order("name"),
      supabase
        .from("profiles")
        .select("id, display_name, home_location, entry_year")
        .eq("team_id", profile.team_id)
        .not("role", "in", "(coach,manager,ob)"),
      supabase.rpc("team_absences", { p_date: date }),
    ]);
    if (itemsRes.error) {
      setUnavailable(true);
      setLoaded(true);
      return;
    }
    const rows = (itemsRes.data ?? []) as Record<string, unknown>[];
    setPlan(rows.filter((r) => r.phase === "plan").map(toDraft));
    setActual(rows.filter((r) => r.phase === "actual").map(toDraft));
    setReport((repRes.data as Report | null) ?? null);
    setDiffs((diffRes.data ?? []) as Diff[]);
    setTemplates((tplRes.data ?? []) as Template[]);
    setMembers(
      ((memRes.data ?? []) as Member[]).sort(
        (a, b) => (a.entry_year ?? 9999) - (b.entry_year ?? 9999) || a.display_name.localeCompare(b.display_name, "ja")
      )
    );
    setAbsentIds(
      new Set(
        ((absRes.error ? [] : absRes.data) ?? [])
          .filter((a: { status: string }) => a.status === "approved")
          .map((a: { author_id: string }) => a.author_id)
      )
    );
    setLoaded(true);
  }

  useEffect(() => {
    setLoaded(false);
    setMode("view");
    setMsg(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  const targets = members.filter((m) => isJoint || m.home_location === location);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "?";

  async function saveItems(phase: "plan" | "actual", list: MenuItemDraft[]) {
    const del = await supabase.from("menu_items").delete().eq("menu_id", menuId).eq("phase", phase);
    if (del.error) throw new Error(del.error.message);
    const rows = list
      .filter((it) => it.name.trim())
      .map((it, i) => ({
        ...toRow(it, true),
        team_id: profile.team_id,
        menu_id: menuId,
        phase,
        sort_order: i,
        created_by: profile.id,
      }));
    if (rows.length > 0) {
      const ins = await supabase.from("menu_items").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
    }
  }

  async function handleSavePlan() {
    setBusy(true);
    setMsg(null);
    try {
      await saveItems("plan", draft);
      await load();
      setMode("view");
      setMsg({ ok: true, text: "予定メニューを保存しました。" });
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした：${e instanceof Error ? e.message : ""}` });
    }
    setBusy(false);
  }

  function startPlan() {
    setDraft(plan.map((p) => ({ ...p })));
    setMode("plan");
    setMsg(null);
  }

  function startReport() {
    // 実績がまだなら、予定を引き継ぐ（変わったところだけ直せばよい）
    const base = actual.length > 0 ? actual : plan;
    // 目印（item_key）は引き継ぐ。予定と実績、本人の報告の対応がずれないように
    setDraft(base.map((p) => ({ ...p })));
    setMatches(report ? report.attendance_matches : null);
    setDraftDiffs(new Map(diffs.map((d) => [d.member_id, d])));
    setReportNote(report?.note ?? "");
    setMode("report");
    setMsg(null);
  }

  async function handleSaveReport() {
    if (matches === null) {
      setMsg({ ok: false, text: "「予定と実際の参加者は合っていますか？」に答えてください。" });
      return;
    }
    const list = matches ? [] : Array.from(draftDiffs.values());
    if (!matches && list.length === 0) {
      setMsg({ ok: false, text: "違いがあった人を選んでください。" });
      return;
    }
    if (list.some((d) => d.kind === "left_early" && !d.permission)) {
      setMsg({ ok: false, text: "途中退出・中抜けの人は、許可の有無を選んでください。" });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await saveItems("actual", draft);
      const up = await supabase.from("menu_reports").upsert(
        {
          team_id: profile.team_id,
          menu_id: menuId,
          attendance_matches: matches,
          note: reportNote.trim() || null,
          reported_by: profile.id,
          reported_at: new Date().toISOString(),
        },
        { onConflict: "menu_id" }
      );
      if (up.error) throw new Error(up.error.message);
      const del = await supabase.from("menu_attendance_diffs").delete().eq("menu_id", menuId);
      if (del.error) throw new Error(del.error.message);
      if (list.length > 0) {
        const ins = await supabase.from("menu_attendance_diffs").insert(
          list.map((d) => ({
            team_id: profile.team_id,
            menu_id: menuId,
            member_id: d.member_id,
            kind: d.kind,
            permission: d.kind === "left_early" ? d.permission : null,
            recorded_by: profile.id,
          }))
        );
        if (ins.error) throw new Error(ins.error.message);
      }
      await load();
      setMode("view");
      setMsg({ ok: true, text: "実施報告を保存しました。" });
      notifyBoardTasksChanged();
    } catch (e) {
      setMsg({ ok: false, text: `保存できませんでした：${e instanceof Error ? e.message : ""}` });
    }
    setBusy(false);
  }

  function applyTemplate(t: Template) {
    if (draft.length > 0 && !window.confirm(`今の項目を「${t.name}」の内容に置き換えますか？`)) return;
    setDraft((t.items ?? []).map((r) => ({ ...toDraft(r), key: newKey() })));
  }

  async function saveTemplate() {
    const items = draft.filter((d) => d.name.trim());
    if (items.length === 0) return setMsg({ ok: false, text: "項目を入れてから保存してください。" });
    const name = window.prompt("テンプレートの名前（例：通常練習、試合前調整、強化練習）");
    if (!name?.trim()) return;
    const existing = templates.find((t) => t.name === name.trim());
    const payload = { team_id: profile.team_id, name: name.trim(), items: items.map((d) => toRow(d)), created_by: profile.id, updated_at: new Date().toISOString() };
    const res = existing
      ? window.confirm(`「${existing.name}」を上書きしますか？`)
        ? await supabase.from("menu_templates").update(payload).eq("id", existing.id)
        : null
      : await supabase.from("menu_templates").insert(payload);
    if (!res) return;
    if (res.error) return setMsg({ ok: false, text: `テンプレートを保存できませんでした：${res.error.message}` });
    setMsg({ ok: true, text: `テンプレート「${name.trim()}」を保存しました。` });
    const { data } = await supabase.from("menu_templates").select("id, name, purpose, items").eq("team_id", profile.team_id).order("name");
    setTemplates((data ?? []) as Template[]);
  }

  async function deleteTemplate(t: Template) {
    if (!window.confirm(`テンプレート「${t.name}」を削除しますか？`)) return;
    await supabase.from("menu_templates").delete().eq("id", t.id);
    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
  }

  async function copyPrevious() {
    // 同じ拠点の、この日より前のメニューのうち、予定の項目がある直近のもの
    let q = supabase.from("menus").select("id, date").eq("team_id", profile.team_id).lt("date", date);
    q = isJoint ? q.eq("is_joint", true) : q.eq("location", location).eq("is_joint", false);
    const { data: prev } = await q.order("date", { ascending: false }).limit(20);
    const ids = ((prev ?? []) as { id: string }[]).map((m) => m.id);
    if (ids.length === 0) return setMsg({ ok: false, text: "前回のメニューが見つかりませんでした。" });
    const { data: rows } = await supabase.from("menu_items").select("*").in("menu_id", ids).eq("phase", "plan").order("sort_order");
    const list = (rows ?? []) as Record<string, unknown>[];
    const first = ids.find((id) => list.some((r) => r.menu_id === id));
    if (!first) return setMsg({ ok: false, text: "前回までのメニューに、計算用の項目がありませんでした。" });
    if (draft.length > 0 && !window.confirm("今の項目を、前回のメニューに置き換えますか？")) return;
    setDraft(list.filter((r) => r.menu_id === first).map((r) => ({ ...toDraft(r), key: newKey() })));
  }

  function toggleDiff(memberId: string, kind: DiffKind) {
    setDraftDiffs((prev) => {
      const next = new Map(prev);
      const cur = next.get(memberId);
      if (cur?.kind === kind) next.delete(memberId);
      else next.set(memberId, { member_id: memberId, kind, permission: kind === "left_early" ? null : null });
      return next;
    });
  }

  if (!loaded) return null;
  if (unavailable) return null;

  const box = "flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/60";
  const btnSub =
    "rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300";
  const btnMain = "rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white active:bg-red-700 disabled:opacity-50";

  const templateChips = (
    <div className="flex flex-wrap gap-1.5">
      {templates.map((t) => (
        <span key={t.id} className="flex items-center overflow-hidden rounded-full border border-neutral-300 text-xs dark:border-neutral-700">
          <button type="button" onClick={() => applyTemplate(t)} className="px-2.5 py-1 text-neutral-800 dark:text-neutral-200">
            📄 {t.name}
            {t.purpose && <span className="ml-1 text-neutral-400">{t.purpose}</span>}
          </button>
          {mode === "plan" && (
            <button type="button" onClick={() => deleteTemplate(t)} className="border-l border-neutral-300 px-1.5 py-1 text-neutral-400 dark:border-neutral-700" aria-label="テンプレートを削除">
              ×
            </button>
          )}
        </span>
      ))}
      <button type="button" onClick={copyPrevious} className="rounded-full border border-dashed border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
        前回のメニューをコピー
      </button>
    </div>
  );

  // ---------- 予定メニューの編集 ----------
  if (mode === "plan") {
    return (
      <section className={box}>
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">📋 計算用メニュー（予定）を編集</span>
        {templateChips}
        <MenuItemsEditor items={draft} onChange={setDraft} canConfirm={canConfirm} />
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode("view")} className={btnSub}>
            やめる
          </button>
          <button type="button" onClick={saveTemplate} className={btnSub}>
            テンプレートとして保存
          </button>
          <button type="button" disabled={busy} onClick={handleSavePlan} className={`${btnMain} ml-auto`}>
            {busy ? "保存中…" : "予定を保存"}
          </button>
        </div>
      </section>
    );
  }

  // ---------- 実施報告（練習後） ----------
  if (mode === "report") {
    const plannedPresent = targets.filter((m) => !absentIds.has(m.id));
    const plannedAbsent = targets.filter((m) => absentIds.has(m.id));
    return (
      <section className={box}>
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">✅ 実施報告（練習後）</span>
        {plan.length > 0 || actual.length > 0 ? (
          <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            予定メニューを引き継いでいます。実際と違ったところ（本数・時間など）だけ直してください。
          </p>
        ) : (
          <>
            <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
              予定メニューが入っていなかったので、テンプレートか前回のメニューから実際にやった内容を入れてください。
            </p>
            {templateChips}
          </>
        )}
        <MenuItemsEditor items={draft} onChange={setDraft} canConfirm={canConfirm} />

        <div className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-2.5 dark:bg-neutral-950">
          <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">
            予定と実際の参加者は合っていますか？
          </span>
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            参加予定 {plannedPresent.length}人／休みの報告 {plannedAbsent.length}人
            {plannedAbsent.length > 0 && `（${plannedAbsent.map((m) => m.display_name).join("、")}）`}
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setMatches(v)}
                className={`rounded-lg py-2 text-sm font-semibold ${
                  matches === v ? "bg-red-600 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-800"
                }`}
              >
                {v ? "予定どおり" : "違いがある"}
              </button>
            ))}
          </div>

          {matches === false && (
            <div className="flex flex-col gap-2">
              <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">違いがあった人だけ選んでください。</span>
              <ul className="flex flex-col gap-1">
                {plannedPresent.map((m) => {
                  const d = draftDiffs.get(m.id);
                  return (
                    <li key={m.id} className="flex flex-col gap-1 rounded-lg bg-white px-2 py-1.5 dark:bg-neutral-900">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="w-24 shrink-0 truncate font-medium text-neutral-900 dark:text-neutral-100">
                          {m.display_name}
                          {m.entry_year && <span className="ml-1 text-neutral-400">{currentGrade(m.entry_year)}年</span>}
                        </span>
                        {(["absent_unplanned", "left_early"] as DiffKind[]).map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => toggleDiff(m.id, k)}
                            className={`rounded-full px-2 py-0.5 ${
                              d?.kind === k ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                            }`}
                          >
                            {k === "absent_unplanned" ? "欠席" : "途中退出・中抜け"}
                          </button>
                        ))}
                      </div>
                      {d?.kind === "left_early" && (
                        <div className="flex gap-1.5 pl-24 text-xs">
                          {(["confirmed", "unconfirmed"] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() =>
                                setDraftDiffs((prev) => new Map(prev).set(m.id, { ...d, permission: p }))
                              }
                              className={`rounded-full px-2 py-0.5 ${
                                d.permission === p ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                              }`}
                            >
                              {p === "confirmed" ? "許可あり" : "許可を確認できていない"}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
                {plannedAbsent.map((m) => {
                  const d = draftDiffs.get(m.id);
                  return (
                    <li key={m.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-neutral-900">
                      <span className="w-24 shrink-0 truncate font-medium text-neutral-900 dark:text-neutral-100">
                        {m.display_name}
                        <span className="ml-1 text-[length:calc(9px+var(--fs-add))] text-neutral-400">休み報告</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleDiff(m.id, "present_unplanned")}
                        className={`rounded-full px-2 py-0.5 ${
                          d?.kind === "present_unplanned" ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                        }`}
                      >
                        実は参加した
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <input
          value={reportNote}
          maxLength={200}
          onChange={(e) => setReportNote(e.target.value)}
          placeholder="ひとこと（任意）例：雨で外ランを中止、スパーを2本減らした"
          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode("view")} className={btnSub}>
            やめる
          </button>
          <button type="button" disabled={busy} onClick={handleSaveReport} className={`${btnMain} ml-auto`}>
            {busy ? "保存中…" : "実施報告を保存"}
          </button>
        </div>
      </section>
    );
  }

  // 監督・管理者が「要確認」を確定する（予定・実績の同じ項目をまとめて直す）
  async function confirmBasis(key: string, basis: "total" | "per_person") {
    const { error } = await supabase
      .from("menu_items")
      .update({ sets_basis: basis, updated_at: new Date().toISOString() })
      .eq("menu_id", menuId)
      .eq("item_key", key);
    if (error) return setMsg({ ok: false, text: `確定できませんでした：${error.message}` });
    await load();
    setMsg({ ok: true, text: "本数の数え方を確定しました。計算に含めます。" });
  }

  // ---------- 表示 ----------
  const shown = report && actual.length > 0 ? actual : plan;
  return (
    <section className={box}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          📋 計算用メニュー（{report ? "実績" : "予定"}）
        </span>
        {report ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
            実施報告済み
          </span>
        ) : started ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            実施報告まだ
          </span>
        ) : null}
      </div>
      <ItemList items={shown} onConfirm={canConfirm ? confirmBasis : undefined} />
      {report && (
        <div className="flex flex-col gap-1 rounded-lg bg-neutral-50 p-2 text-xs dark:bg-neutral-950">
          <span className="text-neutral-600 dark:text-neutral-400">
            報告：{report.reporter?.display_name ?? "?"}（
            {new Date(report.reported_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}）
            ・参加者は{report.attendance_matches ? "予定どおり" : "予定と違いあり"}
          </span>
          {diffs.map((d) => (
            <span key={d.member_id} className="text-neutral-800 dark:text-neutral-200">
              ・{nameOf(d.member_id)}：{diffLabel[d.kind]}
              {d.kind === "left_early" && d.permission && `（${d.permission === "confirmed" ? "許可あり" : "許可を確認できていない"}）`}
            </span>
          ))}
          {report.note && <span className="text-neutral-600 dark:text-neutral-400">💬 {report.note}</span>}
        </div>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400"}`}>{msg.text}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!report && (
            <button type="button" onClick={startPlan} className={btnSub}>
              {plan.length > 0 ? "予定を編集" : "予定を入力（テンプレート・前回から）"}
            </button>
          )}
          {started && (
            <button type="button" onClick={startReport} className={report ? btnSub : btnMain}>
              {report ? "実施報告を直す" : "練習後の実施報告をする"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
