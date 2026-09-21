"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile, useSubNav } from "../../components/shell/AppShell";
import SubTabBar from "../../components/shell/SubTabBar";
import { notifyTasksChanged } from "../../components/shell/taskRefreshBus";
import TaskQueuePopup, {
  type QueueTask,
} from "../../components/TaskQueuePopup";
import {
  useMyEventPendingTasks,
  type EventPendingTask,
} from "../../components/shell/useMyEventPendingTasks";
import { createClient } from "../../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  teamEventTypeLabel,
} from "../../lib/types";
import { useEventResultsPref } from "../../components/shell/EventResultsPrefProvider";

type EventTab = "weight_max" | "body_composition" | "match_reflection";

const tabLabel: Record<EventTab, string> = {
  weight_max: "ウェイトMAX",
  body_composition: "体組成",
  match_reflection: "試合の振り返り",
};

const matchResultOptions = [
  "優勝",
  "準優勝",
  "3位",
  "4位",
  "5位",
  "ベスト16",
  "ベスト32",
  "3回戦敗退",
  "2回戦敗退",
  "1回戦敗退",
];

function formatMonthDay(dateStr: string) {
  const [, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!m || !d) return dateStr;
  return `${m}月${d}日`;
}

type WeightMaxEventRow = {
  id: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
};

function WeightMaxTab({ profile }: { profile: ReturnType<typeof useProfile>["profile"] }) {
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
            className={`ml-1 text-[11px] ${
              diff.zero
                ? "text-neutral-500"
                : diff.positive
                  ? "text-emerald-400"
                  : "text-red-400"
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
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
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
            className="flex flex-col gap-2 rounded-lg border border-border-color bg-surface-2 p-3 text-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-neutral-500 dark:text-neutral-400">
                測定会（〜{formatMonthDay(ev.deadline)}）
              </span>
              {submitted ? (
                <span className="rounded bg-emerald-800/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  提出済み
                </span>
              ) : isOpenEvent ? (
                <span
                  className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                    isOverdue
                      ? "bg-red-600 text-white"
                      : "bg-amber-800/60 text-amber-300"
                  }`}
                >
                  未提出
                </span>
              ) : (
                <span className="rounded bg-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">
                  締切済み
                </span>
              )}
            </div>
            {submitted ? (
              <p className="flex flex-wrap gap-x-3 text-neutral-700 dark:text-neutral-200">
                {renderLiftValue("BP", submitted.bench, profile.id, idx, "bench")}
                {renderLiftValue("SQ", submitted.squat, profile.id, idx, "squat")}
                {renderLiftValue(
                  "DL",
                  submitted.deadlift,
                  profile.id,
                  idx,
                  "deadlift"
                )}
              </p>
            ) : isOpenEvent ? (
              openEventId === ev.id ? (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      ベンチプレス(kg)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={bench}
                        onChange={(e) => setBench(e.target.value)}
                        className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                      スクワット(kg)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={squat}
                        onChange={(e) => setSquat(e.target.value)}
                        className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
                          ? "border-red-600/60 bg-red-950/10"
                          : "border-border-color bg-background"
                      }`}
                    >
                      <span className="font-medium text-foreground">
                        {r.display_name}
                        {r.id === profile.id && (
                          <span className="ml-1 text-[10px] text-red-400">
                            (自分)
                          </span>
                        )}
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

type TeamEventRow = {
  id: string;
  type: "match_reflection" | "body_composition";
  title: string;
  deadline: string;
  closed_at: string | null;
};

type SubmissionRow = {
  id: string;
  event_id: string;
  updated_at: string;
  match_result: string | null;
  match_title: string | null;
  match_count: number | null;
  win_count: number | null;
  loss_count: number | null;
  reflection: string | null;
  good_points: string | null;
  challenges: string | null;
  improvement_plan: string | null;
  team_challenges: string | null;
  measurement_date: string | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  lean_body_mass_kg: number | null;
};

type EventCommentRow = {
  id: string;
  submission_id: string;
  author_id: string;
  text: string;
  created_at: string;
};

// イベントの提出内容（試合の振り返りなど）に対するコメントスレッド。
// コーチ・本人どちらからもコメントでき、お互いのフィードバックに使える。
function CommentThread({
  submissionId,
  profile,
  members,
}: {
  submissionId: string;
  profile: ReturnType<typeof useProfile>["profile"];
  members: EventMemberRow[];
}) {
  const supabase = createClient();
  const [comments, setComments] = useState<EventCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("team_event_comments")
      .select("id, submission_id, author_id, text, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: true });
    if (error) setErrorMsg(error.message);
    setComments((data ?? []) as EventCommentRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  async function handlePost() {
    if (!text.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("team_event_comments").insert({
      submission_id: submissionId,
      team_id: profile.team_id,
      author_id: profile.id,
      text: text.trim(),
    });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setText("");
      await load();
    }
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-color pt-2">
      <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
        コメント
      </p>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-neutral-500">まだコメントはありません。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {comments.map((c) => {
            const name =
              c.author_id === profile.id
                ? "自分"
                : members.find((m) => m.id === c.author_id)?.display_name ??
                  "（不明な部員）";
            return (
              <div
                key={c.id}
                className="rounded-lg border border-border-color bg-background p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="text-[10px] text-neutral-500">
                    {formatMonthDay(c.created_at.slice(0, 10))}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
                  {c.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-[11px] text-red-400">
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="コメントを入力"
          className="flex-1 rounded-lg border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
}

type BodyCompositionSubmissionRow = SubmissionRow & { author_id: string };

type MatchSubmissionRow = {
  id: string;
  author_id: string;
  updated_at: string;
  match_result: string | null;
  match_title: string | null;
  match_count: number | null;
  win_count: number | null;
  loss_count: number | null;
  reflection: string | null;
  good_points: string | null;
  challenges: string | null;
  improvement_plan: string | null;
  team_challenges: string | null;
};

// 体組成専用のタブ。体組成は「前回比」を表示しない代わりに、記録が増えても
// 見づらくならないよう計測日ごとにまとめ、タップで詳細を開閉できるようにする。
function BodyCompositionTab({
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
              <span className="ml-2 text-[11px] font-normal text-neutral-500">
                〜{formatMonthDay(openEvent.deadline)}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
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
              <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                測定日
                <input
                  type="date"
                  value={measurementDate}
                  onChange={(e) => setMeasurementDate(e.target.value)}
                  className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  体重(kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={weightKg}
                    onChange={(e) => setWeightKg(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  体脂肪率(%)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={bodyFatPct}
                    onChange={(e) => setBodyFatPct(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                  骨格筋量(kg)
                  <input
                    type="number"
                    inputMode="decimal"
                    value={muscleMassKg}
                    onChange={(e) => setMuscleMassKg(e.target.value)}
                    className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
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
                                <span className="ml-1 text-[10px] text-red-400">
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

function TeamEventTab({
  type,
  profile,
}: {
  type: "body_composition" | "match_reflection";
  profile: ReturnType<typeof useProfile>["profile"];
}) {
  const supabase = createClient();
  const members = useEventMembers(profile.team_id);
  const [events, setEvents] = useState<TeamEventRow[]>([]);
  const [mine, setMine] = useState<Map<string, SubmissionRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 試合の振り返りは、全部員分の提出を全員が閲覧できるようにする
  const [allSubmissions, setAllSubmissions] = useState<
    Map<string, MatchSubmissionRow[]>
  >(new Map());
  const [expandedAllIds, setExpandedAllIds] = useState<Set<string>>(
    new Set()
  );

  const [matchResult, setMatchResult] = useState("");
  const [matchTitle, setMatchTitle] = useState("");
  const [matchCount, setMatchCount] = useState("");
  const [matchWinCount, setMatchWinCount] = useState("");
  const [matchLossCount, setMatchLossCount] = useState("");
  const [matchReflection, setMatchReflection] = useState("");
  const [matchGoodPoints, setMatchGoodPoints] = useState("");
  const [matchChallenges, setMatchChallenges] = useState("");
  const [matchImprovementPlan, setMatchImprovementPlan] = useState("");
  const [matchTeamChallenges, setMatchTeamChallenges] = useState("");
  const [measurementDate, setMeasurementDate] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [bodyFatPct, setBodyFatPct] = useState("");
  const [muscleMassKg, setMuscleMassKg] = useState("");
  const [leanBodyMassKg, setLeanBodyMassKg] = useState("");

  async function load() {
    setLoading(true);
    const { data: eventData, error: eventError } = await supabase
      .from("team_events")
      .select("id, type, title, deadline, closed_at")
      .eq("team_id", profile.team_id)
      .eq("type", type)
      .order("created_at", { ascending: false });
    if (eventError) {
      setErrorMsg(eventError.message);
      setLoading(false);
      return;
    }
    const rows = (eventData ?? []) as TeamEventRow[];
    setEvents(rows);

    const { data: subData } = await supabase
      .from("team_event_submissions")
      .select(
        "id, event_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, measurement_date, weight_kg, body_fat_pct, muscle_mass_kg, lean_body_mass_kg"
      )
      .eq("author_id", profile.id)
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    const map = new Map<string, SubmissionRow>();
    for (const r of (subData ?? []) as SubmissionRow[]) map.set(r.event_id, r);
    setMine(map);

    if (type === "match_reflection" && rows.length > 0) {
      const { data: allData } = await supabase
        .from("team_event_submissions")
        .select(
          "id, event_id, author_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges"
        )
        .in(
          "event_id",
          rows.map((r) => r.id)
        );
      const grouped = new Map<string, MatchSubmissionRow[]>();
      for (const r of (allData ?? []) as (MatchSubmissionRow & {
        event_id: string;
      })[]) {
        const list = grouped.get(r.event_id) ?? [];
        list.push(r);
        grouped.set(r.event_id, list);
      }
      setAllSubmissions(grouped);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function handleSave(eventId: string) {
    setSaving(true);
    const payload: Record<string, unknown> = {
      team_id: profile.team_id,
      event_id: eventId,
      author_id: profile.id,
      updated_at: new Date().toISOString(),
      content: "",
    };
    if (type === "match_reflection") {
      payload.match_result = matchResult;
      payload.match_title = matchTitle;
      payload.match_count = matchCount ? Number(matchCount) : null;
      payload.win_count = matchWinCount ? Number(matchWinCount) : null;
      payload.loss_count = matchLossCount ? Number(matchLossCount) : null;
      payload.reflection = matchReflection;
      payload.good_points = matchGoodPoints;
      payload.challenges = matchChallenges;
      payload.improvement_plan = matchImprovementPlan;
      payload.team_challenges = matchTeamChallenges;
    } else {
      payload.measurement_date = measurementDate || null;
      payload.weight_kg = weightKg ? Number(weightKg) : null;
      payload.body_fat_pct = bodyFatPct ? Number(bodyFatPct) : null;
      payload.muscle_mass_kg = muscleMassKg ? Number(muscleMassKg) : null;
      payload.lean_body_mass_kg = leanBodyMassKg ? Number(leanBodyMassKg) : null;
    }
    const { error } = await supabase
      .from("team_event_submissions")
      .upsert(payload, { onConflict: "event_id,author_id" });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setOpenEventId(null);
      await load();
      notifyTasksChanged();
    }
    setSaving(false);
  }

  if (loading) return <p className="text-xs text-neutral-500">読み込み中…</p>;
  if (events.length === 0)
    return (
      <p className="rounded-lg border border-dashed border-neutral-400 p-4 text-xs text-neutral-500 dark:border-neutral-700">
        まだ{teamEventTypeLabel[type]}のイベントはありません。
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
      {events.map((ev) => {
        const submitted = mine.get(ev.id);
        const isOpenEvent = !ev.closed_at;
        const isOverdue = new Date().toISOString().slice(0, 10) > ev.deadline;
        const isExpanded = expandedId === ev.id;
        return (
          <div
            key={ev.id}
            className="flex flex-col gap-2 rounded-lg border border-border-color bg-surface-2 p-3 text-sm"
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : ev.id)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="font-medium">
                {ev.title}
                <span className="ml-2 text-[11px] font-normal text-neutral-500">
                  〜{formatMonthDay(ev.deadline)}
                </span>
              </span>
              {submitted ? (
                <span className="shrink-0 rounded bg-emerald-800/60 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  提出済み
                </span>
              ) : isOpenEvent ? (
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${
                    isOverdue
                      ? "bg-red-600 text-white"
                      : "bg-amber-800/60 text-amber-300"
                  }`}
                >
                  未提出
                </span>
              ) : (
                <span className="shrink-0 rounded bg-neutral-700 px-2 py-0.5 text-[11px] text-neutral-300">
                  締切済み
                </span>
              )}
            </button>

            {isExpanded && submitted && (
              <div className="flex flex-col gap-1.5 border-t border-border-color pt-2 text-neutral-700 dark:text-neutral-200">
                {type === "match_reflection" ? (
                  <>
                    {submitted.match_title && <p>試合名：{submitted.match_title}</p>}
                    {submitted.match_result && <p>結果：{submitted.match_result}</p>}
                    {submitted.match_count != null && (
                      <p>
                        {submitted.match_count}試合（{submitted.win_count ?? 0}勝{" "}
                        {submitted.loss_count ?? 0}敗）
                      </p>
                    )}
                    {submitted.reflection && (
                      <p className="whitespace-pre-wrap">反省：{submitted.reflection}</p>
                    )}
                    {submitted.good_points && (
                      <p className="whitespace-pre-wrap">良かった点：{submitted.good_points}</p>
                    )}
                    {submitted.challenges && (
                      <p className="whitespace-pre-wrap">課題：{submitted.challenges}</p>
                    )}
                  </>
                ) : (
                  <>
                    {submitted.measurement_date && (
                      <p>測定日：{formatMonthDay(submitted.measurement_date)}</p>
                    )}
                    <p>
                      体重 {submitted.weight_kg ?? "―"}kg・体脂肪率{" "}
                      {submitted.body_fat_pct ?? "―"}%
                    </p>
                    <p>
                      骨格筋量 {submitted.muscle_mass_kg ?? "―"}kg・除脂肪体重{" "}
                      {submitted.lean_body_mass_kg ?? "―"}kg
                    </p>
                  </>
                )}
                {type === "match_reflection" && (
                  <CommentThread
                    submissionId={submitted.id}
                    profile={profile}
                    members={members}
                  />
                )}
              </div>
            )}

            {isExpanded && type === "match_reflection" && (() => {
              const others = (allSubmissions.get(ev.id) ?? [])
                .filter((s) => s.author_id !== profile.id)
                .map((s) => ({
                  ...s,
                  name:
                    members.find((m) => m.id === s.author_id)?.display_name ??
                    "（不明な部員）",
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"));
              if (others.length === 0) return null;
              const allOpen = others.every((s) => expandedAllIds.has(s.id));
              return (
                <div className="flex flex-col gap-1.5 border-t border-border-color pt-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400">
                      他の部員の振り返り
                    </h4>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAllIds((prev) => {
                          const next = new Set(prev);
                          if (allOpen) others.forEach((s) => next.delete(s.id));
                          else others.forEach((s) => next.add(s.id));
                          return next;
                        })
                      }
                      className="text-[11px] text-neutral-500 underline decoration-dotted dark:text-neutral-400"
                    >
                      {allOpen ? "すべて閉じる" : "全員の詳細を表示"}
                    </button>
                  </div>
                  {others.map((s) => {
                    const isOpen = expandedAllIds.has(s.id);
                    return (
                      <div
                        key={s.id}
                        className="overflow-hidden rounded-lg border border-border-color bg-background"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedAllIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id);
                              else next.add(s.id);
                              return next;
                            })
                          }
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                        >
                          <span className="font-medium text-foreground">
                            {s.name}
                          </span>
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                            {s.match_result ?? ""}
                            {isOpen ? " ▲" : " ▼"}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="flex flex-col gap-1.5 border-t border-border-color p-2.5 text-xs text-neutral-700 dark:text-neutral-200">
                            {s.match_title && <p>試合名：{s.match_title}</p>}
                            {s.match_result && <p>結果：{s.match_result}</p>}
                            {s.match_count != null && (
                              <p>
                                {s.match_count}試合（{s.win_count ?? 0}勝{" "}
                                {s.loss_count ?? 0}敗）
                              </p>
                            )}
                            {s.reflection && (
                              <p className="whitespace-pre-wrap">
                                反省：{s.reflection}
                              </p>
                            )}
                            {s.good_points && (
                              <p className="whitespace-pre-wrap">
                                良かった点：{s.good_points}
                              </p>
                            )}
                            {s.challenges && (
                              <p className="whitespace-pre-wrap">
                                課題：{s.challenges}
                              </p>
                            )}
                            {s.improvement_plan && (
                              <p className="whitespace-pre-wrap">
                                今後の改善策：{s.improvement_plan}
                              </p>
                            )}
                            {s.team_challenges && (
                              <p className="whitespace-pre-wrap">
                                チームとしての課題：{s.team_challenges}
                              </p>
                            )}
                            <CommentThread
                              submissionId={s.id}
                              profile={profile}
                              members={members}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {!submitted && isOpenEvent && (
              openEventId === ev.id ? (
                <div className="flex flex-col gap-2 border-t border-border-color pt-2">
                  {type === "match_reflection" ? (
                    <>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        出場した試合名
                        <input
                          type="text"
                          value={matchTitle}
                          onChange={(e) => setMatchTitle(e.target.value)}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        試合結果
                        <select
                          value={matchResult}
                          onChange={(e) => setMatchResult(e.target.value)}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="">選択してください</option>
                          {matchResultOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          試合数
                          <input
                            type="number"
                            value={matchCount}
                            onChange={(e) => setMatchCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          勝ち数
                          <input
                            type="number"
                            value={matchWinCount}
                            onChange={(e) => setMatchWinCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          負け数
                          <input
                            type="number"
                            value={matchLossCount}
                            onChange={(e) => setMatchLossCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        試合の反省
                        <textarea
                          value={matchReflection}
                          onChange={(e) => setMatchReflection(e.target.value)}
                          rows={3}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        良かった点
                        <textarea
                          value={matchGoodPoints}
                          onChange={(e) => setMatchGoodPoints(e.target.value)}
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        課題に感じた点
                        <textarea
                          value={matchChallenges}
                          onChange={(e) => setMatchChallenges(e.target.value)}
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        今後の改善策
                        <textarea
                          value={matchImprovementPlan}
                          onChange={(e) =>
                            setMatchImprovementPlan(e.target.value)
                          }
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        チームとしての課題
                        <textarea
                          value={matchTeamChallenges}
                          onChange={(e) => setMatchTeamChallenges(e.target.value)}
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                        測定日
                        <input
                          type="date"
                          value={measurementDate}
                          onChange={(e) => setMeasurementDate(e.target.value)}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          体重(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={weightKg}
                            onChange={(e) => setWeightKg(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          体脂肪率(%)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={bodyFatPct}
                            onChange={(e) => setBodyFatPct(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                          骨格筋量(kg)
                          <input
                            type="number"
                            inputMode="decimal"
                            value={muscleMassKg}
                            onChange={(e) => setMuscleMassKg(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
                    </>
                  )}
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
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===== コーチ向け：イベントの作成・集計管理 =====

type EventMemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  role: string;
  entry_year: number | null;
};

// 「全員の数値」表示の並び順：自分を一番上、その下は学年が上の人から
// （同学年内は多摩→大塚の順）。学年が分からない場合は一番下に回す。
function sortForAllView<T extends EventMemberRow>(
  members: T[],
  selfId: string
): T[] {
  const grade = (m: T) => (m.entry_year != null ? currentGrade(m.entry_year) : -1);
  const locRank = (m: T) => (m.home_location === "otsuka" ? 1 : 0);
  return [...members].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    const gradeDiff = grade(b) - grade(a);
    if (gradeDiff !== 0) return gradeDiff;
    const locDiff = locRank(a) - locRank(b);
    if (locDiff !== 0) return locDiff;
    return a.display_name.localeCompare(b.display_name, "ja");
  });
}

// 学年ラベル（不明な場合は「学年不明」）
function gradeGroupLabel<T extends EventMemberRow>(m: T): string {
  return m.entry_year != null ? `${currentGrade(m.entry_year)}年` : "学年不明";
}

// 前回の記録との差分を「+2kg」「-1kg」の形に整形する（差が無ければ「±0kg」、
// 前回の記録が無ければnullを返し、呼び出し側で非表示にする）
function formatDiff(
  current: number | null,
  previous: number | null | undefined
): { text: string; positive: boolean; zero: boolean } | null {
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { text: "±0kg", positive: false, zero: true };
  return {
    text: `${diff > 0 ? "+" : ""}${diff}kg`,
    positive: diff > 0,
    zero: false,
  };
}

type WeightMaxAuthorRow = {
  event_id: string;
  author_id: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

// events は created_at 降順（0番目が最新）。著者ごとに提出をidx昇順で並べておき、
// 「あるイベント(idx)より後ろ（＝より過去）で、そのリフトの値がある直近の提出」を
// 前回の記録として引けるようにする。
function buildPrevValueLookup(
  events: WeightMaxEventRow[],
  rows: WeightMaxAuthorRow[]
): Map<string, { idx: number; row: WeightMaxAuthorRow }[]> {
  const eventIndexById = new Map(events.map((e, i) => [e.id, i]));
  const byAuthor = new Map<string, { idx: number; row: WeightMaxAuthorRow }[]>();
  for (const r of rows) {
    const idx = eventIndexById.get(r.event_id);
    if (idx == null) continue;
    const list = byAuthor.get(r.author_id) ?? [];
    list.push({ idx, row: r });
    byAuthor.set(r.author_id, list);
  }
  for (const list of byAuthor.values()) list.sort((a, b) => a.idx - b.idx);
  return byAuthor;
}

function getPreviousValue(
  byAuthor: Map<string, { idx: number; row: WeightMaxAuthorRow }[]>,
  authorId: string,
  idx: number,
  lift: "bench" | "squat" | "deadlift"
): number | null {
  const list = byAuthor.get(authorId);
  if (!list) return null;
  for (const entry of list) {
    if (entry.idx > idx && entry.row[lift] != null) return entry.row[lift];
  }
  return null;
}

/**
 * 学年ごとに折りたたんで表示するための汎用リスト。
 * collapseByGradeがfalseならそのままrenderRowを並べるだけ、
 * trueなら学年ごとにグループ化し、タップで開閉できるアコーディオンにする。
 */
function GradedMemberList<T extends EventMemberRow>({
  rows,
  collapseByGrade,
  renderRow,
}: {
  rows: T[];
  collapseByGrade: boolean;
  renderRow: (row: T) => React.ReactNode;
}) {
  const [openGrades, setOpenGrades] = useState<Set<string>>(new Set());

  if (!collapseByGrade) {
    return <div className="flex flex-col gap-1.5">{rows.map(renderRow)}</div>;
  }

  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const label = gradeGroupLabel(r);
    const list = groups.get(label) ?? [];
    list.push(r);
    groups.set(label, list);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {Array.from(groups.entries()).map(([label, groupRows]) => {
        const isOpen = openGrades.has(label);
        return (
          <div
            key={label}
            className="overflow-hidden rounded-lg border border-border-color"
          >
            <button
              type="button"
              onClick={() =>
                setOpenGrades((prev) => {
                  const next = new Set(prev);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return next;
                })
              }
              className="flex w-full items-center justify-between bg-background px-3 py-2 text-xs font-semibold text-foreground"
            >
              <span>{label}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {groupRows.length}人{isOpen ? " ▲" : " ▼"}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1.5 p-2">
                {groupRows.map(renderRow)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EventTargetPicker({
  members,
  selectedIds,
  onChange,
}: {
  members: EventMemberRow[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          対象者(選ばなければ全員が対象になります)
        </span>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-[11px] text-neutral-500 underline dark:text-neutral-400"
          >
            選択をクリア
          </button>
        )}
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-border-color bg-background p-2">
        <div className="flex flex-col gap-1">
          {members
            .filter(
              (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
            )
            .map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(m.id)}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    onChange(next);
                  }}
                  className="h-3.5 w-3.5"
                />
                {m.display_name}
                <span className="text-neutral-500 dark:text-neutral-500">
                  （{locationLabel[m.home_location ?? "tama"]}）
                </span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}

function useEventMembers(teamId: string) {
  const supabase = createClient();
  const [members, setMembers] = useState<EventMemberRow[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, home_location, role, entry_year")
        .eq("team_id", teamId);
      setMembers((data ?? []) as EventMemberRow[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);
  return members;
}

function WeightMaxCoachManagement({
  profile,
}: {
  profile: ReturnType<typeof useProfile>["profile"];
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
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
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
                    className={`ml-1 text-[10px] ${
                      diff.zero
                        ? "text-neutral-500"
                        : diff.positive
                          ? "text-emerald-400"
                          : "text-red-400"
                    }`}
                  >
                    ({diff.text})
                  </span>
                );
              };
              return (
                <div className="max-w-md overflow-x-auto rounded-lg border border-border-color">
                  <table className="w-full table-fixed text-[11px]">
                    <colgroup>
                      <col className="w-[34%]" />
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                      <col className="w-[22%]" />
                    </colgroup>
                    <thead>
                      <tr className="border-b border-border-color bg-background text-neutral-500 dark:text-neutral-400">
                        <th className="px-1.5 py-1.5 text-left font-medium">氏名</th>
                        <th className="px-1 py-1.5 text-right font-medium">
                          ベンチ
                        </th>
                        <th className="px-1 py-1.5 text-right font-medium">
                          スクワット
                        </th>
                        <th className="px-1 py-1.5 text-right font-medium">
                          デッド
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-border-color last:border-b-0"
                        >
                          <td className="truncate px-1.5 py-1.5 text-foreground">
                            {r.display_name}
                          </td>
                          <td className="px-1 py-1.5 text-right text-foreground">
                            {r.bench ?? "―"}
                            {r.bench != null && (
                              <span className="text-neutral-500 dark:text-neutral-400">
                                kg
                              </span>
                            )}
                            {diffSpan(r.bench, r.id, "bench")}
                          </td>
                          <td className="px-1 py-1.5 text-right text-foreground">
                            {r.squat ?? "―"}
                            {r.squat != null && (
                              <span className="text-neutral-500 dark:text-neutral-400">
                                kg
                              </span>
                            )}
                            {diffSpan(r.squat, r.id, "squat")}
                          </td>
                          <td className="px-1 py-1.5 text-right text-foreground">
                            {r.deadlift ?? "―"}
                            {r.deadlift != null && (
                              <span className="text-neutral-500 dark:text-neutral-400">
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
          <button
            onClick={handleEnd}
            className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            この集計を終了する
          </button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <EventTargetPicker
            members={members}
            selectedIds={selectedTargetIds}
            onChange={setSelectedTargetIds}
          />
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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

function TeamEventCoachManagement({
  type,
  profile,
}: {
  type: "match_reflection" | "body_composition";
  profile: ReturnType<typeof useProfile>["profile"];
}) {
  const supabase = createClient();
  const members = useEventMembers(profile.team_id);
  const [event, setEvent] = useState<TeamEventRow | null | undefined>(
    undefined
  );
  const [submittedCount, setSubmittedCount] = useState(0);
  const [targetCount, setTargetCount] = useState<number | null>(null);
  const [bodyGroups, setBodyGroups] = useState<
    {
      key: string;
      label: string;
      submittedCount: number;
      rows: {
        authorId: string;
        name: string;
        weightKg: number | null;
        bodyFatPct: number | null;
        muscleMassKg: number | null;
      }[];
    }[]
  >([]);
  const [expandedBodyKeys, setExpandedBodyKeys] = useState<Set<string>>(
    new Set()
  );
  const [matchSubmissions, setMatchSubmissions] = useState<
    MatchSubmissionRow[]
  >([]);
  const [expandedMatchAuthorIds, setExpandedMatchAuthorIds] = useState<
    Set<string>
  >(new Set());
  const [newDeadline, setNewDeadline] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [selectedTargetIds, setSelectedTargetIds] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const eligibleMembers = useMemo(
    () =>
      members.filter(
        (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
      ),
    [members]
  );

  async function load() {
    const { data, error } = await supabase
      .from("team_events")
      .select("id, type, title, deadline, closed_at")
      .eq("team_id", profile.team_id)
      .eq("type", type)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const ev = (data as TeamEventRow | null) ?? null;
    setEvent(ev);
    if (ev) {
      if (type === "match_reflection") {
        const { data: subData } = await supabase
          .from("team_event_submissions")
          .select(
            "id, author_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges"
          )
          .eq("event_id", ev.id);
        const rows = (subData ?? []) as MatchSubmissionRow[];
        setSubmittedCount(rows.length);
        setMatchSubmissions(rows);
      } else {
        const { data: subData } = await supabase
          .from("team_event_submissions")
          .select("author_id")
          .eq("event_id", ev.id);
        setSubmittedCount((subData ?? []).length);
        setMatchSubmissions([]);
      }

      const { data: targetData } = await supabase
        .from("team_event_targets")
        .select("member_id")
        .eq("event_id", ev.id);
      setTargetCount(
        targetData && targetData.length > 0 ? targetData.length : null
      );
    } else {
      setTargetCount(null);
      setMatchSubmissions([]);
    }

    if (type === "body_composition") {
      const { data: allEventsData } = await supabase
        .from("team_events")
        .select("id, type, title, deadline, closed_at")
        .eq("team_id", profile.team_id)
        .eq("type", "body_composition")
        .order("created_at", { ascending: false });
      const allEvents = (allEventsData ?? []) as TeamEventRow[];
      const eventById = new Map(allEvents.map((e) => [e.id, e]));
      const { data: allSubData } = await supabase
        .from("team_event_submissions")
        .select(
          "event_id, author_id, measurement_date, weight_kg, body_fat_pct, muscle_mass_kg"
        )
        .in(
          "event_id",
          allEvents.map((e) => e.id)
        );
      const allSubs = (allSubData ?? []) as {
        event_id: string;
        author_id: string;
        measurement_date: string | null;
        weight_kg: number | null;
        body_fat_pct: number | null;
        muscle_mass_kg: number | null;
      }[];
      const byKey = new Map<string, typeof allSubs>();
      for (const s of allSubs) {
        const evForSub = eventById.get(s.event_id);
        const key = s.measurement_date ?? evForSub?.deadline ?? s.event_id;
        const list = byKey.get(key) ?? [];
        list.push(s);
        byKey.set(key, list);
      }
      const groups = Array.from(byKey.entries())
        .map(([key, subs]) => ({
          key,
          label: formatMonthDay(key),
          submittedCount: subs.length,
          rows: subs.map((s) => ({
            authorId: s.author_id,
            name:
              members.find((m) => m.id === s.author_id)?.display_name ??
              "（不明な部員）",
            weightKg: s.weight_kg,
            bodyFatPct: s.body_fat_pct,
            muscleMassKg: s.muscle_mass_kg,
          })),
        }))
        .sort((a, b) => a.key.localeCompare(b.key));
      setBodyGroups(groups);
    } else {
      setBodyGroups([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeadline) return;
    if (type === "match_reflection" && !newTitle.trim()) return;
    setSaving(true);
    const { data: inserted, error } = await supabase
      .from("team_events")
      .insert({
        team_id: profile.team_id,
        type,
        title: newTitle.trim(),
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
    if (type === "match_reflection" && selectedTargetIds.size > 0 && inserted) {
      const targetRows = Array.from(selectedTargetIds).map((memberId) => ({
        event_id: (inserted as { id: string }).id,
        member_id: memberId,
      }));
      const { error: targetError } = await supabase
        .from("team_event_targets")
        .insert(targetRows);
      if (targetError) setErrorMsg(targetError.message);
    }
    setNewDeadline("");
    setNewTitle("");
    setSelectedTargetIds(new Set());
    await load();
    setSaving(false);
  }

  async function handleEnd() {
    if (!event) return;
    if (
      !window.confirm(
        "このイベントを終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("team_events")
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
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
      {event === undefined ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : event ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border-color bg-surface-2 p-3">
          {event.title && (
            <p className="text-sm font-semibold text-foreground">
              {event.title}
            </p>
          )}
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

          {type === "match_reflection" && matchSubmissions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setExpandedMatchAuthorIds((prev) =>
                    prev.size === matchSubmissions.length
                      ? new Set()
                      : new Set(matchSubmissions.map((s) => s.author_id))
                  )
                }
                className="self-end text-[11px] text-neutral-500 underline decoration-dotted dark:text-neutral-400"
              >
                {expandedMatchAuthorIds.size === matchSubmissions.length
                  ? "すべて閉じる"
                  : "全員の詳細を表示"}
              </button>
              {matchSubmissions
                .map((s) => ({
                  ...s,
                  name:
                    members.find((m) => m.id === s.author_id)?.display_name ??
                    "（不明な部員）",
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                .map((s) => {
                  const isExpanded = expandedMatchAuthorIds.has(s.author_id);
                  return (
                    <div
                      key={s.author_id}
                      className="overflow-hidden rounded-lg border border-border-color bg-background"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMatchAuthorIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(s.author_id)) next.delete(s.author_id);
                            else next.add(s.author_id);
                            return next;
                          })
                        }
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                      >
                        <span className="font-medium text-foreground">
                          {s.name}
                        </span>
                        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {s.match_result ?? ""}
                          {isExpanded ? " ▲" : " ▼"}
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="flex flex-col gap-1.5 border-t border-border-color p-2.5 text-xs text-neutral-700 dark:text-neutral-200">
                          {s.match_title && <p>試合名：{s.match_title}</p>}
                          {s.match_result && <p>結果：{s.match_result}</p>}
                          {s.match_count != null && (
                            <p>
                              {s.match_count}試合（{s.win_count ?? 0}勝{" "}
                              {s.loss_count ?? 0}敗）
                            </p>
                          )}
                          {s.reflection && (
                            <p className="whitespace-pre-wrap">
                              反省：{s.reflection}
                            </p>
                          )}
                          {s.good_points && (
                            <p className="whitespace-pre-wrap">
                              良かった点：{s.good_points}
                            </p>
                          )}
                          {s.challenges && (
                            <p className="whitespace-pre-wrap">
                              課題：{s.challenges}
                            </p>
                          )}
                          {s.improvement_plan && (
                            <p className="whitespace-pre-wrap">
                              今後の改善策：{s.improvement_plan}
                            </p>
                          )}
                          {s.team_challenges && (
                            <p className="whitespace-pre-wrap">
                              チームとしての課題：{s.team_challenges}
                            </p>
                          )}
                          <CommentThread
                            submissionId={s.id}
                            profile={profile}
                            members={members}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          <button
            onClick={handleEnd}
            className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            このイベントを終了する
          </button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {type === "match_reflection"
              ? "タイトル(例：全日本学生選手権、東日本学生リーグ戦)"
              : "タイトル(任意)"}
            <input
              type="text"
              required={type === "match_reflection"}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="rounded border border-border-color bg-background px-2 py-1.5 text-sm text-foreground"
            />
          </label>
          {type === "match_reflection" && (
            <EventTargetPicker
              members={members}
              selectedIds={selectedTargetIds}
              onChange={setSelectedTargetIds}
            />
          )}
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
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
              イベントを作成する
            </button>
          </div>
        </form>
      )}

      {type === "body_composition" && bodyGroups.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            計測記録
          </h3>
          {bodyGroups.map((g) => {
            const isExpanded = expandedBodyKeys.has(g.key);
            return (
              <div
                key={g.key}
                className="max-w-md overflow-hidden rounded-lg border border-border-color bg-surface-2"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedBodyKeys((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.key)) next.delete(g.key);
                      else next.add(g.key);
                      return next;
                    })
                  }
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                >
                  <span className="font-medium text-foreground">
                    計測日：{g.label}
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    提出済み：{g.submittedCount}人/{eligibleMembers.length}人
                    {isExpanded ? " ▲" : " ▼"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto border-t border-border-color">
                    <table className="w-full table-fixed text-[11px]">
                      <colgroup>
                        <col className="w-[34%]" />
                        <col className="w-[22%]" />
                        <col className="w-[22%]" />
                        <col className="w-[22%]" />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-border-color bg-background text-neutral-500 dark:text-neutral-400">
                          <th className="px-1.5 py-1.5 text-left font-medium">
                            氏名
                          </th>
                          <th className="px-1 py-1.5 text-right font-medium">
                            体重
                          </th>
                          <th className="px-1 py-1.5 text-right font-medium">
                            体脂肪率
                          </th>
                          <th className="px-1 py-1.5 text-right font-medium">
                            筋肉量
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...g.rows]
                          .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                          .map((r) => (
                            <tr
                              key={r.authorId}
                              className="border-b border-border-color last:border-b-0"
                            >
                              <td className="truncate px-1.5 py-1.5 text-foreground">
                                {r.name}
                              </td>
                              <td className="px-1 py-1.5 text-right text-foreground">
                                {r.weightKg ?? "―"}
                                {r.weightKg != null && (
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    kg
                                  </span>
                                )}
                              </td>
                              <td className="px-1 py-1.5 text-right text-foreground">
                                {r.bodyFatPct ?? "―"}
                                {r.bodyFatPct != null && (
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    %
                                  </span>
                                )}
                              </td>
                              <td className="px-1 py-1.5 text-right text-foreground">
                                {r.muscleMassKg ?? "―"}
                                {r.muscleMassKg != null && (
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    kg
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// イベントページ内のポップアップ用に、未提出のイベント1件をタスクの形に変換する
function buildEventQueueTask(
  type: EventTab,
  task: EventPendingTask,
  setTab: (t: EventTab) => void
): QueueTask {
  return {
    key: `event-${type}-${task.id}`,
    badgeLabel: `イベント：${tabLabel[type]} 未提出${
      task.overdue ? "（期限切れ）" : ""
    }`,
    title: task.title || `〜${formatMonthDay(task.deadline)}`,
    urgent: task.overdue,
    content: (close: () => void) => (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-neutral-400">
          締切：{formatMonthDay(task.deadline)}
        </p>
        <button
          onClick={() => {
            setTab(type);
            close();
          }}
          className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700"
        >
          {tabLabel[type]}タブへ移動して入力する
        </button>
      </div>
    ),
  };
}

export default function EventsPage() {
  const { profile } = useProfile();
  const [tab, setTab] = useState<EventTab>("weight_max");
  const isCoach = profile.role === "coach";
  const pendingTasks = useMyEventPendingTasks(isCoach ? null : profile);

  const pendingByTab: Record<EventTab, EventPendingTask | null> = {
    weight_max: pendingTasks.weightMax,
    body_composition: pendingTasks.bodyComposition,
    match_reflection: pendingTasks.matchReflection,
  };

  const eventQueueTasks = useMemo(() => {
    if (isCoach) return [];
    const list: QueueTask[] = [];
    (Object.keys(tabLabel) as EventTab[]).forEach((t) => {
      const pending = pendingByTab[t];
      if (pending) list.push(buildEventQueueTask(t, pending, setTab));
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoach, pendingTasks]);

  // node は useMemo で安定させる（毎レンダー新しいJSXを渡すと無限ループの原因になる）
  const eventsSubNav = useMemo(
    () => (
      <SubTabBar
        items={(Object.keys(tabLabel) as EventTab[]).map((t) => ({
          value: t,
          label: tabLabel[t],
          badge: !isCoach && pendingByTab[t] ? 1 : 0,
        }))}
        active={tab}
        onChange={setTab}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, isCoach, pendingTasks]
  );
  useSubNav(eventsSubNav);

  return (
    <div className="mx-auto flex w-full flex-col gap-4 p-4 sm:p-5">
      {!isCoach && <TaskQueuePopup tasks={eventQueueTasks} />}
      {isCoach && (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          イベントを作成する
        </h2>
      )}
      {tab === "weight_max" &&
        (isCoach ? (
          <WeightMaxCoachManagement profile={profile} />
        ) : (
          <WeightMaxTab profile={profile} />
        ))}
      {tab === "body_composition" &&
        (isCoach ? (
          <TeamEventCoachManagement type="body_composition" profile={profile} />
        ) : (
          <BodyCompositionTab profile={profile} />
        ))}
      {tab === "match_reflection" &&
        (isCoach ? (
          <TeamEventCoachManagement type="match_reflection" profile={profile} />
        ) : (
          <TeamEventTab type="match_reflection" profile={profile} />
        ))}
    </div>
  );
}
