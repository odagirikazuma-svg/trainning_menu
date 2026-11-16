"use client";

// 授業の時間割
// ・ClassScheduleSection：部員が期間（前期・後期）ごとに、授業のある曜日×時限を登録する
// ・TeamTermsSection：管理者が前期・後期と、授業のない期間（長期休みなど）を登録・編集する
// ・未登録のタスク表示は shell/useClassScheduleTask.ts

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { jstDate } from "../lib/obligations";
import { PERIODS, WEEKDAYS, type ClassMode, type TeamTerm } from "../lib/classSchedule";
import { useProfile } from "./shell/AppShell";
import { CLASS_SCHEDULE_CHANGED_EVENT } from "./shell/useClassScheduleTask";

const today = () => jstDate(new Date());
const md = (d: string) => {
  const [, m, dd] = d.split("-").map(Number);
  return `${m}/${dd}`;
};
const ymd = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `${y}/${m}/${dd}`;
};

// ---------------- 部員：時間割の登録 ----------------
export default function ClassScheduleSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [terms, setTerms] = useState<TeamTerm[] | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  // "曜日-時限" → live（出席必須：練習に出られない）／vod（オンデマンド等：練習に出られる）
  const [cells, setCells] = useState<Map<string, ClassMode>>(new Map());
  const [saved, setSaved] = useState<Map<string, ClassMode>>(new Map());
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("team_terms")
        .select("id, kind, name, start_date, end_date")
        .eq("team_id", profile.team_id)
        .gte("end_date", today())
        .order("start_date");
      if (error) {
        setMsg({ ok: false, text: "時間割の項目がまだデータベースにありません（SQLの実行待ち）。" });
        setTerms([]);
        return;
      }
      const list = (data ?? []) as TeamTerm[];
      setTerms(list);
      const first = list.find((x) => x.kind === "term");
      if (first) setTermId(first.id);
      const { data: regs } = await supabase.from("class_term_registrations").select("term_id").eq("author_id", profile.id);
      setRegistered(new Set(((regs ?? []) as { term_id: string }[]).map((r) => r.term_id)));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  useEffect(() => {
    if (!termId) return;
    setMsg(null);
    const q = (cols: string) =>
      supabase.from("class_schedules").select(cols).eq("author_id", profile.id).eq("term_id", termId);
    // mode 列がまだ無いDB（SQL 27 の実行前）は、全部「出席必須」として読む
    q("weekday, period, mode")
      .then((r) => (r.error ? q("weekday, period") : r))
      .then(({ data }) => {
        const s = new Map(
          ((data ?? []) as unknown as { weekday: number; period: number; mode?: ClassMode }[]).map(
            (r) => [`${r.weekday}-${r.period}`, r.mode ?? "live"] as [string, ClassMode]
          )
        );
        setCells(s);
        setSaved(new Map(s));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  if (!terms) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  const termList = terms.filter((x) => x.kind === "term");
  if (termList.length === 0)
    return (
      <p className="text-xs text-neutral-500">
        {msg?.text ?? "管理者が前期・後期の期間を登録すると、ここで授業の時間割を入れられます。"}
      </p>
    );
  const term = termList.find((x) => x.id === termId) ?? termList[0];
  const breaks = terms.filter((x) => x.kind === "break" && x.start_date <= term.end_date && x.end_date >= term.start_date);
  const dirty = cells.size !== saved.size || [...cells].some(([k, v]) => saved.get(k) !== v);
  const liveCount = [...cells.values()].filter((v) => v === "live").length;
  const vodCount = cells.size - liveCount;

  // タップするたびに 空き → 授業（出席必須）→ オンデマンド（練習OK）→ 空き
  function toggle(k: string) {
    setCells((prev) => {
      const n = new Map(prev);
      const cur = n.get(k);
      if (!cur) n.set(k, "live");
      else if (cur === "live") n.set(k, "vod");
      else n.delete(k);
      return n;
    });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const del = await supabase.from("class_schedules").delete().eq("author_id", profile.id).eq("term_id", term.id);
    let error = del.error;
    if (!error && cells.size > 0) {
      const rows = [...cells].map(([k, mode]) => {
        const [w, p] = k.split("-").map(Number);
        return { team_id: profile.team_id, author_id: profile.id, term_id: term.id, weekday: w, period: p, mode };
      });
      error = (await supabase.from("class_schedules").insert(rows)).error;
    }
    if (!error)
      error = (
        await supabase
          .from("class_term_registrations")
          .upsert({ author_id: profile.id, term_id: term.id, team_id: profile.team_id, registered_at: new Date().toISOString() })
      ).error;
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
      return;
    }
    setSaved(new Map(cells));
    setRegistered((prev) => new Set(prev).add(term.id));
    window.dispatchEvent(new Event(CLASS_SCHEDULE_CHANGED_EVENT));
    setMsg({
      ok: true,
      text:
        cells.size === 0
          ? `${term.name}は「授業なし」で登録しました。`
          : `${term.name}の時間割（出席必須${liveCount}コマ${vodCount > 0 ? `・オンデマンド${vodCount}コマ` : ""}）を保存しました。`,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        授業のあるコマをタップしてください。タップするたびに「授業（出席必須）」→「オンデマンド」→「空き」と切り替わります。出席必須の授業と重なる練習は、休みの申請なしで自動で欠席（代替メニューの記録が必要）・遅れて参加・早めに抜けるになります。オンデマンド（VOD）など、その時間に練習に出られる授業は練習には影響しません。休講・補講・試験など時間割どおりでない日は、ふだんの休みの申請で対応してください。
      </p>
      {termList.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {termList.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTermId(x.id)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                x.id === term.id ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {x.name}
              {!registered.has(x.id) && <span className="ml-1">●</span>}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs font-semibold">
        {term.name}（{ymd(term.start_date)}〜{md(term.end_date)}）
        <span className={`ml-2 ${registered.has(term.id) ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
          {registered.has(term.id) ? "登録済み" : "未登録"}
        </span>
      </p>
      {breaks.length > 0 && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          授業のない期間：{breaks.map((b) => `${b.name}（${md(b.start_date)}〜${md(b.end_date)}）`).join("、")}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-center text-xs">
          <thead>
            <tr>
              <th className="w-14" />
              {WEEKDAYS.map((w) => (
                <th key={w.no} className="py-1 font-semibold">
                  {w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => (
              <tr key={p.no}>
                <th className="py-0.5 pr-1 text-left font-normal">
                  <span className="block font-semibold">{p.no}限</span>
                  <span className="block text-[length:calc(9px+var(--fs-add))] text-neutral-500">
                    {p.start}〜{p.end}
                  </span>
                </th>
                {WEEKDAYS.map((w) => {
                  const k = `${w.no}-${p.no}`;
                  const mode = cells.get(k);
                  const on = !!mode;
                  return (
                    <td key={k} className="p-0.5">
                      <button
                        type="button"
                        onClick={() => toggle(k)}
                        aria-pressed={on}
                        aria-label={`${w.label}曜${p.no}限`}
                        className={`h-10 w-full whitespace-pre-line rounded-md border text-[length:calc(10px+var(--fs-add))] font-bold leading-tight ${
                          mode === "live"
                            ? "border-sky-600 bg-sky-600 text-white"
                            : mode === "vod"
                              ? "border-dashed border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                              : "border-neutral-200 bg-white text-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-600"
                        }`}
                      >
                        {mode === "live" ? "授業" : mode === "vod" ? "オンデ\nマンド" : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[length:calc(10px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-600 align-middle" />
          授業＝出席必須（練習に出られない）
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-sky-500 bg-sky-50 align-middle" />
          オンデマンド＝その時間も練習に出られる
        </span>
      </p>
      <button
        type="button"
        disabled={busy || (!dirty && registered.has(term.id))}
        onClick={save}
        className="rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-40"
      >
        {busy ? "保存中…" : cells.size === 0 ? "授業なしで登録する" : "この時間割で保存する"}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}

// ---------------- 管理者：前期・後期と授業のない期間 ----------------
type Draft = { id: string | null; kind: "term" | "break"; name: string; start: string; end: string };
const emptyDraft = (kind: "term" | "break" = "term"): Draft => ({ id: null, kind, name: "", start: "", end: "" });

export function TeamTermsSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [terms, setTerms] = useState<TeamTerm[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<{ term: TeamTerm; missing: string[]; total: number } | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("team_terms")
      .select("id, kind, name, start_date, end_date")
      .eq("team_id", profile.team_id)
      .order("start_date");
    if (error) {
      setMsg({ ok: false, text: "時間割の項目がまだデータベースにありません（SQLの実行待ち）。" });
      setTerms([]);
      return;
    }
    const list = (data ?? []) as TeamTerm[];
    setTerms(list);
    // 今の期間（なければ次の期間）の登録状況
    const t = today();
    const cur = list.find((x) => x.kind === "term" && x.end_date >= t);
    if (!cur) return setStatus(null);
    const [mRes, rRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name").eq("team_id", profile.team_id).not("role", "in", "(coach,manager,ob)"),
      supabase.from("class_term_registrations").select("author_id").eq("term_id", cur.id),
    ]);
    const done = new Set(((rRes.data ?? []) as { author_id: string }[]).map((r) => r.author_id));
    const mem = (mRes.data ?? []) as { id: string; display_name: string }[];
    setStatus({ term: cur, total: mem.length, missing: mem.filter((m) => !done.has(m.id)).map((m) => m.display_name) });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.start || !draft.end) return setMsg({ ok: false, text: "名前・開始日・終了日を入れてください。" });
    if (draft.end < draft.start) return setMsg({ ok: false, text: "終了日は開始日より後にしてください。" });
    setBusy(true);
    const row = { team_id: profile.team_id, kind: draft.kind, name: draft.name.trim(), start_date: draft.start, end_date: draft.end };
    const { error } = draft.id
      ? await supabase.from("team_terms").update(row).eq("id", draft.id)
      : await supabase.from("team_terms").insert(row);
    setBusy(false);
    if (error) return setMsg({ ok: false, text: `保存できませんでした：${error.message}` });
    setMsg({ ok: true, text: `「${row.name}」を保存しました。` });
    setDraft(null);
    load();
  }

  async function remove(t: TeamTerm) {
    const warn =
      t.kind === "term"
        ? `「${t.name}」を削除しますか？\n部員が登録したこの期間の時間割も消えます。`
        : `「${t.name}」を削除しますか？`;
    if (!window.confirm(warn)) return;
    const { error } = await supabase.from("team_terms").delete().eq("id", t.id);
    if (error) return setMsg({ ok: false, text: `削除できませんでした：${error.message}` });
    setMsg({ ok: true, text: `「${t.name}」を削除しました。` });
    load();
  }

  if (!terms) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  const input =
    "rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900";
  const suggestions = draft?.kind === "break" ? ["夏休み", "冬休み", "春休み"] : ["前期", "後期"];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-600 dark:text-neutral-400">
        前期・後期の期間を入れると、部員がその期間の授業の時間割を登録できます。夏休み・春休みなどの「授業のない期間」は、時間割があっても授業なしとして扱います。
      </p>
      {status && (
        <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
          {status.term.name}の時間割：{status.total - status.missing.length}/{status.total}人が登録済み
          {status.missing.length > 0 && (
            <span className="block text-neutral-500">未登録：{status.missing.join("、")}</span>
          )}
        </p>
      )}
      {terms.length === 0 ? (
        <p className="text-xs text-neutral-500">まだ登録されていません。</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {terms.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
            >
              <span
                className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${
                  t.kind === "term"
                    ? "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                }`}
              >
                {t.kind === "term" ? "授業期間" : "授業なし"}
              </span>
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-neutral-500">
                {ymd(t.start_date)}〜{md(t.end_date)}
              </span>
              <span className="ml-auto flex gap-1.5">
                <button
                  type="button"
                  className="text-xs text-neutral-600 underline dark:text-neutral-300"
                  onClick={() => setDraft({ id: t.id, kind: t.kind, name: t.name, start: t.start_date, end: t.end_date })}
                >
                  編集
                </button>
                <button type="button" className="text-xs text-red-600 underline" onClick={() => remove(t)}>
                  削除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
          <div className="flex gap-1.5">
            {(["term", "break"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setDraft({ ...draft, kind: k })}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  draft.kind === k ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                }`}
              >
                {k === "term" ? "授業期間（前期・後期）" : "授業のない期間（長期休みなど）"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              className={`${input} w-40`}
              placeholder="名前（例：2026年度 後期）"
              value={draft.name}
              maxLength={30}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {suggestions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDraft({ ...draft, name: n })}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-800"
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <input type="date" className={input} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
            〜
            <input type="date" className={input} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "保存中…" : draft.id ? "変更を保存" : "追加する"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDraft(emptyDraft("term"))}
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold dark:border-neutral-700"
          >
            ＋ 授業期間を追加
          </button>
          <button
            type="button"
            onClick={() => setDraft(emptyDraft("break"))}
            className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold dark:border-neutral-700"
          >
            ＋ 授業のない期間を追加
          </button>
        </div>
      )}
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
