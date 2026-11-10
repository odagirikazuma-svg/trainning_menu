"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile, } from "../shell/AppShell";
import { notifyTasksChanged } from "../shell/taskRefreshBus";
import { createClient } from "../../lib/supabase/client";
import { useEventResultsPref } from "../shell/EventResultsPrefProvider";

import {
  formatMonthDay,
  TeamEventRow,
  BodyCompositionSubmissionRow,
  sortForAllView,
  GradedMemberList,
  useEventMembers,
  } from "./shared";

// イベント「体組成」（部員の提出）

export function BodyCompositionTab({
  profile,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
}) {
  const supabase = createClient();
  const { pref } = useEventResultsPref();
  const members = useEventMembers(profile.team_id);
  const [events, setEvents] = useState<TeamEventRow[]>([]);
  const [submissions, setSubmissions] = useState<BodyCompositionSubmissionRow[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [openForm, setOpenForm] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [measurementDate, setMeasurementDate] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [muscleMassKg, setMuscleMassKg] = useState("");
  const [leanBodyMassKg, setLeanBodyMassKg] = useState("");

  async function load() {
    setLoading(true);
    const { data: eventData, error } = await supabase
      .from("team_events")
      .select("id, type, title, deadline, closed_at")
      .eq("team_id", profile.team_id)
      .eq("type", "body_composition")
      .order("created_at", { ascending: false });
    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }
    const rows = (eventData ?? []) as TeamEventRow[];
    setEvents(rows);
    const { data: subData } = await supabase
      .from("team_event_submissions")
      .select(
        "event_id, author_id, updated_at, measurement_date, weight_kg, body_fat_pct, muscle_mass_kg, lean_body_mass_kg, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges"
      )
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    setSubmissions((subData ?? []) as BodyCompositionSubmissionRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eligibleMembers = useMemo(
    () =>
      members.filter(
        (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
      ),
    [members]
  );

  const eventById = useMemo(
    () => new Map(events.map((e) => [e.id, e])),
    [events]
  );

  const groups = useMemo(() => {
    const byKey = new Map<string, BodyCompositionSubmissionRow[]>();
    for (const s of submissions) {
      const ev = eventById.get(s.event_id);
      const key = s.measurement_date ?? ev?.deadline ?? s.event_id;
      const list = byKey.get(key) ?? [];
      list.push(s);
      byKey.set(key, list);
    }
    return Array.from(byKey.entries())
      .map(([key, subs]) => ({
        key,
        label: formatMonthDay(key),
        submittedCount: subs.length,
        totalCount: eligibleMembers.length,
        rows: eligibleMembers.map((m) => ({
          ...m,
          submission: subs.find((s) => s.author_id === m.id) ?? null,
        })),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [submissions, eventById, eligibleMembers]);

  const openEvent = events.find((e) => !e.closed_at) ?? null;
  const myOpenSubmission = openEvent
    ? submissions.find(
        (s) => s.event_id === openEvent.id && s.author_id === profile.id
      ) ?? null
    : null;

  async function handleSave() {
    if (!openEvent) return;
    setSaving(true);
    const { error } = await supabase.from("team_event_submissions").upsert(
      {
        team_id: profile.team_id,
        event_id: openEvent.id,
        author_id: profile.id,
        updated_at: new Date().toISOString(),
        content: "",
        measurement_date: measurementDate || null,
        weight_kg: weightKg ? Number(weightKg) : null,
        body_fat_pct: bodyFatPct ? Number(bodyFatPct) : null,
        muscle_mass_kg: muscleMassKg ? Number(muscleMassKg) : null,
        lean_body_mass_kg: leanBodyMassKg ? Number(leanBodyMassKg) : null,
      },
      { onConflict: "event_id,author_id" }
    );
    if (error) {
      setErrorMsg(error.message);
    } else {
      setOpenForm(false);
      setMeasurementDate("");
      setWeightKg("");
      setBodyFatPct("");
      setMuscleMassKg("");
      setLeanBodyMassKg("");
      await load();
      notifyTasksChanged();
    }
    setSaving(false);
  }

  if (loading) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  if (events.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-neutral-400 p-4 text-xs text-neutral-500 dark:border-neutral-700">
        まだ体組成のイベントはありません。
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}

      {openEvent && !myOpenSubmission && (
        <div className="flex flex-col gap-2 rounded-lg border border-border-color bg-surface-2 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              {openEvent.title || "体組成測定"}
              <span className="ml-2 text-[length:calc(11px+var(--fs-add))] font-normal text-neutral-500">
                〜{formatMonthDay(openEvent.deadline)}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] font-medium ${
                new Date().toISOString().slice(0, 10) > openEvent.deadline
                  ? "bg-red-600 text-white"
                  : "bg-amber-800/60 text-amber-300"
              }`}
            >
              未提出
            </span>
          </div>
          {openForm ? (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                測定日
                <input
                  type="date"
                  value={measurementDate}
                  onChange={(e) => setMeasurementDate(e.target.value)}
                  className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                  体重(kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                  体脂肪率(%)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={bodyFatPct}
                    onChange={(e) => setBodyFatPct(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                  骨格筋量(kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={muscleMassKg}
                    onChange={(e) => setMuscleMassKg(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                  除脂肪体重(kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={leanBodyMassKg}
                    onChange={(e) => setLeanBodyMassKg(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <button
                onClick={handleSave}
                disabled={saving}
                className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
              >
                提出する
              </button>
            </div>
          ) : (
            <button
              onClick={() => setOpenForm(true)}
              className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
            >
              提出する
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
          計測記録
        </h3>
        {groups.length === 0 ? (
          <p className="text-xs text-neutral-500">まだ記録はありません。</p>
        ) : (
          groups.map((g) => {
            const isExpanded = expandedKey === g.key;
            const visibleRows =
              pref.viewMode === "all"
                ? sortForAllView(
                    g.rows.filter((r) => r.submission),
                    profile.id
                  )
                : g.rows.filter((r) => r.id === profile.id && r.submission);
            return (
              <div
                key={g.key}
                className="overflow-hidden rounded-lg border border-border-color bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() => setExpandedKey(isExpanded ? null : g.key)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                >
                  <span className="font-medium text-foreground">
                    計測日：{g.label}
                  </span>
                  <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                    提出済み：{g.submittedCount}人/{g.totalCount}人
                    {isExpanded ? " ▲" : " ▼"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="border-t border-border-color p-2">
                    {visibleRows.length === 0 ? (
                      <p className="text-xs text-neutral-500">
                        まだ提出がありません。
                      </p>
                    ) : pref.viewMode === "all" ? (
                      <GradedMemberList
                        rows={visibleRows}
                        collapseByGrade={pref.collapseByGrade}
                        renderRow={(r) => (
                          <div
                            key={r.id}
                            className={`flex flex-col gap-0.5 rounded-lg border p-2 text-xs ${
                              r.id === profile.id
                                ? "border-red-600/60 bg-red-950/10"
                                : "border-border-color bg-background"
                            }`}
                          >
                            <span className="font-medium text-foreground">
                              {r.display_name}
                              {r.id === profile.id && (
                                <span className="ml-1 text-[length:calc(10px+var(--fs-add))] text-red-400">
                                  (自分)
                                </span>
                              )}
                            </span>
                            <span className="text-neutral-700 dark:text-neutral-200">
                              体重 {r.submission?.weight_kg ?? "―"}kg・体脂肪率{" "}
                              {r.submission?.body_fat_pct ?? "―"}%
                            </span>
                            <span className="text-neutral-700 dark:text-neutral-200">
                              骨格筋量 {r.submission?.muscle_mass_kg ?? "―"}kg・
                              除脂肪体重{" "}
                              {r.submission?.lean_body_mass_kg ?? "―"}kg
                            </span>
                          </div>
                        )}
                      />
                    ) : (
                      visibleRows.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-col gap-0.5 text-xs text-neutral-700 dark:text-neutral-200"
                        >
                          <span>
                            体重 {r.submission?.weight_kg ?? "―"}kg・体脂肪率{" "}
                            {r.submission?.body_fat_pct ?? "―"}%
                          </span>
                          <span>
                            骨格筋量 {r.submission?.muscle_mass_kg ?? "―"}kg・
                            除脂肪体重{" "}
                            {r.submission?.lean_body_mass_kg ?? "―"}kg
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

