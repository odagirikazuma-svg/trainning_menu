"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile, } from "../shell/AppShell";
import { notifyTasksChanged } from "../shell/taskRefreshBus";
import { createClient } from "../../lib/supabase/client";
import { useEventResultsPref } from "../shell/EventResultsPrefProvider";

import {
  formatMonthDay,
  WeightMaxEventRow,
  sortForAllView,
  formatDiff,
  WeightMaxAuthorRow,
  buildPrevValueLookup,
  getPreviousValue,
  GradedMemberList,
  EventTargetPicker,
  useEventMembers,
  Sparkline,
  DiffBadge,
  StatTile,
  } from "./shared";

const LIFTS = [
  { key: "bench", label: "ベンチプレス" },
  { key: "squat", label: "スクワット" },
  { key: "deadlift", label: "デッドリフト" },
] as const;

function big3(r: WeightMaxAuthorRow | undefined | null) {
  if (!r || r.bench == null || r.squat == null || r.deadlift == null) return null;
  return Math.round((r.bench + r.squat + r.deadlift) * 10) / 10;
}

// イベント「ウェイトMAX」（部員の提出・管理者の集計）

export function WeightMaxTab({ profile }: { profile: ReturnType<typeof useProfile>["profile"] }) {
  const supabase = createClient();
  const { pref } = useEventResultsPref();
  const members = useEventMembers(profile.team_id);
  const [events, setEvents] = useState<WeightMaxEventRow[]>([]);
  const [allRows, setAllRows] = useState<WeightMaxAuthorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [bench, setBench] = useState("");
  const [squat, setSquat] = useState("");
  const [deadlift, setDeadlift] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data: eventData, error: eventError } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at, closed_at")
      .eq("team_id", profile.team_id)
      .order("created_at", { ascending: false });
    if (eventError) {
      setErrorMsg(eventError.message);
      setLoading(false);
      return;
    }
    const rows = (eventData ?? []) as WeightMaxEventRow[];
    setEvents(rows);

    const { data: maxData } = await supabase
      .from("weight_maxes")
      .select("event_id, author_id, bench, squat, deadlift")
      .eq("team_id", profile.team_id)
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    setAllRows((maxData ?? []) as WeightMaxAuthorRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevLookup = useMemo(
    () => buildPrevValueLookup(events, allRows),
    [events, allRows]
  );

  const mine = useMemo(() => {
    const map = new Map<string, WeightMaxAuthorRow>();
    for (const r of allRows) {
      if (r.author_id === profile.id) map.set(r.event_id, r);
    }
    return map;
  }, [allRows, profile.id]);

  const eligibleMembers = useMemo(
    () =>
      members.filter(
        (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
      ),
    [members]
  );

  async function handleSave(eventId: string) {
    setSaving(true);
    const toNum = (v: string) => (v.trim() === "" ? null : Number(v));
    const { error } = await supabase.from("weight_maxes").upsert(
      {
        team_id: profile.team_id,
        author_id: profile.id,
        event_id: eventId,
        bench: toNum(bench),
        squat: toNum(squat),
        deadlift: toNum(deadlift),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "author_id,event_id" }
    );
    if (error) {
      setErrorMsg(error.message);
    } else {
      setOpenEventId(null);
      setBench("");
      setSquat("");
      setDeadlift("");
      await load();
      notifyTasksChanged();
    }
    setSaving(false);
  }

  if (loading) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  if (events.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-neutral-400 p-4 text-xs text-neutral-500 dark:border-neutral-700">
        まだウェイトMAXの測定会はありません。
      </p>
    );

  function renderLiftValue(
    label: string,
    value: number | null,
    authorId: string,
    idx: number,
    lift: "bench" | "squat" | "deadlift"
  ) {
    const diff = formatDiff(
      value,
      getPreviousValue(prevLookup, authorId, idx, lift)
    );
    return (
      <span>
        {label} {value ?? "―"}kg
        {diff && (
          <span
            className={`ml-1 text-[length:calc(11px+var(--fs-add))] ${
              diff.zero
                ? "text-neutral-500"
                : diff.positive
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-red-700 dark:text-red-400"
            }`}
          >
            ({diff.text})
          </span>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </p>
      )}
      <WeightMaxSummary events={events} allRows={allRows} profileId={profile.id} members={members} />
      {events.length > 0 && (
        <h3 className="mt-1 text-xs font-semibold text-neutral-500">測定会</h3>
      )}
      {events.map((ev, idx) => {
        const submitted = mine.get(ev.id);
        const isOpenEvent = !ev.closed_at;
        const isOverdue = new Date().toISOString().slice(0, 10) > ev.deadline;

        const allRowsForEvent = sortForAllView(
          eligibleMembers
            .map((m) => ({
              ...m,
              data: allRows.find(
                (r) => r.event_id === ev.id && r.author_id === m.id
              ),
            }))
            .filter((r) => r.data),
          profile.id
        );

        return (
          <div
            key={ev.id}
            className="flex flex-col gap-2 rounded-2xl border border-border-color bg-surface p-3.5 text-sm shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-baseline gap-2">
                <span className="font-bold text-foreground">ウェイトMAX測定会</span>
                <span className="text-xs text-neutral-500">〜{formatMonthDay(ev.deadline)}</span>
              </span>
              {submitted ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                  提出済み
                </span>
              ) : isOpenEvent ? (
                <span
                  className={`rounded px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] font-medium ${
                    isOverdue
                      ? "bg-red-600 text-white"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                  }`}
                >
                  未提出
                </span>
              ) : (
                <span className="rounded bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300">
                  締切済み
                </span>
              )}
            </div>
            {submitted ? (
              <div className="grid grid-cols-4 gap-1.5">
                {LIFTS.map(({ key, label }) => (
                  <StatTile
                    key={key}
                    label={label.replace("ベンチプレス", "ベンチ").replace("デッドリフト", "デッド")}
                    value={submitted[key]}
                    unit="kg"
                    sub={<DiffBadge current={submitted[key]} previous={getPreviousValue(prevLookup, profile.id, idx, key)} unit="kg" />}
                  />
                ))}
                <StatTile label="合計" value={big3(submitted)} unit="kg" />
              </div>
            ) : isOpenEvent ? (
              openEventId === ev.id ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                      ベンチプレス(kg)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={bench}
                        onChange={(e) => setBench(e.target.value)}
                        className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                      スクワット(kg)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={squat}
                        onChange={(e) => setSquat(e.target.value)}
                        className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                      デッドリフト(kg)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={deadlift}
                        onChange={(e) => setDeadlift(e.target.value)}
                        className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                  <button
                    onClick={() => handleSave(ev.id)}
                    disabled={saving}
                    className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
                  >
                    提出する
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setOpenEventId(ev.id)}
                  className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                >
                  提出する
                </button>
              )
            ) : (
              <p className="text-xs text-neutral-500">未提出のまま締め切られました。</p>
            )}

            {pref.viewMode === "all" && allRowsForEvent.length > 0 && (
              <div className="border-t border-border-color pt-2">
                <GradedMemberList
                  rows={allRowsForEvent}
                  collapseByGrade={pref.collapseByGrade}
                  renderRow={(r) => (
                    <div
                      key={r.id}
                      className={`flex flex-col gap-0.5 rounded-lg border p-2 text-xs ${
                        r.id === profile.id
                          ? "border-red-600/60 bg-red-50 dark:bg-red-950/10"
                          : "border-border-color bg-background"
                      }`}
                    >
                      <span className="flex items-baseline justify-between font-medium text-foreground">
                        <span>
                          {r.display_name}
                          {r.id === profile.id && (
                            <span className="ml-1 text-[length:calc(10px+var(--fs-add))] text-red-700 dark:text-red-400">
                              (自分)
                            </span>
                          )}
                          {r.weight_class && <span className="ml-1 text-[length:calc(10px+var(--fs-add))] font-normal text-neutral-500">{r.weight_class}kg級</span>}
                        </span>
                        {big3(r.data) != null && <span className="tabular-nums">合計 {big3(r.data)}kg</span>}
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-neutral-700 dark:text-neutral-200">
                        {renderLiftValue(
                          "BP",
                          r.data?.bench ?? null,
                          r.id,
                          idx,
                          "bench"
                        )}
                        {renderLiftValue(
                          "SQ",
                          r.data?.squat ?? null,
                          r.id,
                          idx,
                          "squat"
                        )}
                        {renderLiftValue(
                          "DL",
                          r.data?.deadlift ?? null,
                          r.id,
                          idx,
                          "deadlift"
                        )}
                      </span>
                    </div>
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function WeightMaxCoachManagement({
  profile,
  readOnly = false,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
  // マネージャー用：結果の閲覧のみ（集計の開始・終了はできない）
  readOnly?: boolean;
}) {
  const supabase = createClient();
  const members = useEventMembers(profile.team_id);
  const [event, setEvent] = useState<WeightMaxEventRow | null | undefined>(
    undefined
  );
  const [submittedCount, setSubmittedCount] = useState(0);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [results, setResults] = useState<
    {
      authorId: string;
      bench: number | null;
      squat: number | null;
      deadlift: number | null;
    }[]
  >([]);
  const [prevLookup, setPrevLookup] = useState<
    Map<string, { idx: number; row: WeightMaxAuthorRow }[]>
  >(new Map());
  const [eventIndex, setEventIndex] = useState(-1);
  const [newDeadline, setNewDeadline] = useState("");
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    const { data: allEventsData, error } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at, closed_at")
      .eq("team_id", profile.team_id)
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const allEvents = (allEventsData ?? []) as WeightMaxEventRow[];
    const ev = allEvents.find((e) => !e.closed_at) ?? null;
    setEvent(ev);
    if (ev) {
      const { data: maxData } = await supabase
        .from("weight_maxes")
        .select("author_id, event_id, bench, squat, deadlift")
        .eq("team_id", profile.team_id)
        .in(
          "event_id",
          allEvents.map((e) => e.id)
        );
      const allRows = (maxData ?? []) as WeightMaxAuthorRow[];
      setPrevLookup(buildPrevValueLookup(allEvents, allRows));
      setEventIndex(allEvents.findIndex((e) => e.id === ev.id));
      const rows = allRows.filter((r) => r.event_id === ev.id);
      setSubmittedCount(rows.length);
      setResults(
        rows.map((r) => ({
          authorId: r.author_id,
          bench: r.bench,
          squat: r.squat,
          deadlift: r.deadlift,
        }))
      );

      const { data: targetData } = await supabase
        .from("weight_max_event_targets")
        .select("member_id")
        .eq("event_id", ev.id);
      setTargetCount(
        targetData && targetData.length > 0 ? targetData.length : null
      );
    } else {
      setTargetCount(null);
      setResults([]);
      setPrevLookup(new Map());
      setEventIndex(-1);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeadline) return;
    setSaving(true);
    const { data: inserted, error } = await supabase
      .from("weight_max_events")
      .insert({
        team_id: profile.team_id,
        deadline: newDeadline,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) {
      setErrorMsg(error.message);
      setSaving(false);
      return;
    }
    if (selectedTargetIds.size > 0 && inserted) {
      const targetRows = Array.from(selectedTargetIds).map((memberId) => ({
        event_id: (inserted as { id: string }).id,
        member_id: memberId,
      }));
      const { error: targetError } = await supabase
        .from("weight_max_event_targets")
        .insert(targetRows);
      if (targetError) setErrorMsg(targetError.message);
    }
    setNewDeadline("");
    setSelectedTargetIds(new Set());
    await load();
    setSaving(false);
  }

  async function handleEnd() {
    if (!event) return;
    if (
      !window.confirm(
        "このウェイトMAX集計を終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("weight_max_events")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await load();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </p>
      )}
      {event === undefined ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : event ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border-color bg-surface-2 p-3">
          <p className="text-sm text-foreground">
            締切: <span className="font-semibold">{event.deadline}</span>
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            提出済み {submittedCount}人 /{" "}
            {targetCount ??
              members.filter(
                (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
              ).length}
            人
            {targetCount != null && "（対象者を限定しています）"}
          </p>
          {results.length > 0 &&
            (() => {
              const rows = sortForAllView(
                results.map((r) => {
                  const member = members.find((m) => m.id === r.authorId);
                  return {
                    id: r.authorId,
                    display_name: member?.display_name ?? "（不明な部員）",
                    home_location: member?.home_location ?? null,
                    role: member?.role ?? "member",
                    entry_year: member?.entry_year ?? null,
                    bench: r.bench,
                    squat: r.squat,
                    deadlift: r.deadlift,
                  };
                }),
                ""
              );
              const diffSpan = (
                current: number | null,
                authorId: string,
                lift: "bench" | "squat" | "deadlift"
              ) => {
                const diff = formatDiff(
                  current,
                  getPreviousValue(prevLookup, authorId, eventIndex, lift)
                );
                if (!diff) return null;
                return (
                  <span
                    className={`ml-1 text-[length:calc(11px+var(--fs-add))] font-medium ${
                      diff.zero
                        ? "text-neutral-500"
                        : diff.positive
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    ({diff.text})
                  </span>
                );
              };
              return (
                <div className="max-w-md overflow-x-auto rounded-lg border border-neutral-300 bg-surface dark:border-neutral-700">
                  <table className="w-full table-fixed text-[length:calc(12px+var(--fs-add))]">
                    <colgroup>
                      <col className="w-[34%]" />
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-neutral-300 bg-surface-2 text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                        <th className="px-2 py-2 text-left font-semibold">氏名</th>
                        <th className="px-1.5 py-2 text-right font-semibold">
                          ベンチ
                        </th>
                        <th className="px-1.5 py-2 text-right font-semibold">
                          スクワット
                        </th>
                        <th className="px-1.5 py-2 text-right font-semibold">
                          デッド
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-800"
                        >
                          <td className="truncate px-2 py-2.5 text-[length:calc(13px+var(--fs-add))] font-medium text-foreground">
                            {r.display_name}
                          </td>
                          <td className="px-1.5 py-2.5 text-right text-[length:calc(13px+var(--fs-add))] font-semibold tabular-nums text-foreground">
                            {r.bench ?? "―"}
                            {r.bench != null && (
                              <span className="text-[length:calc(11px+var(--fs-add))] font-normal text-neutral-500 dark:text-neutral-400">
                                kg
                              </span>
                            )}
                            {diffSpan(r.bench, r.id, "bench")}
                          </td>
                          <td className="px-1.5 py-2.5 text-right text-[length:calc(13px+var(--fs-add))] font-semibold tabular-nums text-foreground">
                            {r.squat ?? "―"}
                            {r.squat != null && (
                              <span className="text-[length:calc(11px+var(--fs-add))] font-normal text-neutral-500 dark:text-neutral-400">
                                kg
                              </span>
                            )}
                            {diffSpan(r.squat, r.id, "squat")}
                          </td>
                          <td className="px-1.5 py-2.5 text-right text-[length:calc(13px+var(--fs-add))] font-semibold tabular-nums text-foreground">
                            {r.deadlift ?? "―"}
                            {r.deadlift != null && (
                              <span className="text-[length:calc(11px+var(--fs-add))] font-normal text-neutral-500 dark:text-neutral-400">
                                kg
                              </span>
                            )}
                            {diffSpan(r.deadlift, r.id, "deadlift")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          {!readOnly && (
          <button
            onClick={handleEnd}
            className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            この集計を終了する
          </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          現在開催中の集計はありません。（集計の開始は管理者が行います）
        </p>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <EventTargetPicker
            members={members}
            selectedIds={selectedTargetIds}
            onChange={setSelectedTargetIds}
          />
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
              締切日
              <input
                type="date"
                required
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="rounded border border-border-color bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              集計を開始する
            </button>
          </div>
        </form>
      )}
    </div>
  );
}



// 自分の記録のまとめ：BIG3合計・前回比・自己ベスト・チーム内の順位・推移
function WeightMaxSummary({
  events,
  allRows,
  profileId,
  members,
}: {
  events: WeightMaxEventRow[];
  allRows: WeightMaxAuthorRow[];
  profileId: string;
  members: { id: string; weight_class?: number | null; role: string }[];
}) {
  // events は新しい順。自分の提出を古い順に並べる
  const idxOf = new Map(events.map((e, i) => [e.id, i]));
  const mine = allRows
    .filter((r) => r.author_id === profileId && idxOf.has(r.event_id))
    .sort((a, b) => idxOf.get(b.event_id)! - idxOf.get(a.event_id)!);
  if (mine.length === 0) return null;
  const latest = mine[mine.length - 1];
  const prev = mine.length > 1 ? mine[mine.length - 2] : null;
  const me = members.find((m) => m.id === profileId);
  const total = big3(latest);
  const prevTotal = big3(prev);
  const bestOf = (k: "bench" | "squat" | "deadlift", upto: WeightMaxAuthorRow[]) =>
    upto.reduce<number | null>((a, r) => (r[k] != null && (a == null || r[k]! > a) ? r[k]! : a), null);
  const totals = mine.map(big3).filter((v): v is number => v != null);
  const bestTotal = totals.length ? Math.max(...totals) : null;

  // 最新の測定会でのチーム内順位（3種目そろっている人だけ）
  const students = new Set(members.filter((m) => !["coach", "manager", "ob"].includes(m.role)).map((m) => m.id));
  const ranked = allRows
    .filter((r) => r.event_id === latest.event_id && students.has(r.author_id) && big3(r) != null)
    .sort((a, b) => big3(b)! - big3(a)!);
  const rank = total != null ? ranked.findIndex((r) => r.author_id === profileId) + 1 : 0;
  const wc = me?.weight_class ?? null;
  const classRanked = wc ? ranked.filter((r) => members.find((m) => m.id === r.author_id)?.weight_class === wc) : [];
  const classRank = classRanked.findIndex((r) => r.author_id === profileId) + 1;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border-color bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-neutral-500">あなたのBIG3合計</span>
          <span className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tabular-nums text-foreground">{total ?? "―"}</span>
            {total != null && <span className="text-sm text-neutral-500">kg</span>}
            <DiffBadge current={total} previous={prevTotal} unit="kg" />
            {total != null && prevTotal != null && total === bestTotal && total > prevTotal && (
              <span className="rounded bg-amber-100 px-1.5 text-[length:calc(10px+var(--fs-add))] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                自己ベスト更新
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-x-3 text-[length:calc(11px+var(--fs-add))] text-neutral-500">
            {rank > 0 && (
              <span>
                チーム内 <b className="text-foreground">{rank}位</b>／{ranked.length}人
              </span>
            )}
            {wc && classRank > 0 && (
              <span>
                {wc}kg級で <b className="text-foreground">{classRank}位</b>／{classRanked.length}人
              </span>
            )}
            {wc && total != null && <span>体重比 ×{(total / wc).toFixed(1)}</span>}
          </span>
        </div>
        <Sparkline values={totals} className="shrink-0 text-red-600" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LIFTS.map(({ key, label }) => {
          const v = latest[key];
          const best = bestOf(key, mine);
          const before = bestOf(key, mine.slice(0, -1));
          return (
            <StatTile
              key={key}
              label={label}
              value={v}
              unit="kg"
              sub={<DiffBadge current={v} previous={prev?.[key]} unit="kg" />}
              highlight={v != null && before != null && v > before ? "ベスト更新" : best != null && v !== best ? `ベスト${best}` : null}
            />
          );
        })}
      </div>
    </section>
  );
}
