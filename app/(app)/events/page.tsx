"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile, useSubNav } from "../../components/shell/AppShell";
import SubTabBar from "../../components/shell/SubTabBar";
import { createClient } from "../../lib/supabase/client";
import { teamEventTypeLabel } from "../../lib/types";

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

type WeightMaxRow = {
  event_id: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
  updated_at: string;
};

function WeightMaxTab({ profile }: { profile: ReturnType<typeof useProfile>["profile"] }) {
  const supabase = createClient();
  const [events, setEvents] = useState<WeightMaxEventRow[]>([]);
  const [mine, setMine] = useState<Map<string, WeightMaxRow>>(new Map());
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

    const { data: myData } = await supabase
      .from("weight_maxes")
      .select("event_id, bench, squat, deadlift, updated_at")
      .eq("author_id", profile.id)
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    const map = new Map<string, WeightMaxRow>();
    for (const r of (myData ?? []) as WeightMaxRow[]) map.set(r.event_id, r);
    setMine(map);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <p className="text-neutral-700 dark:text-neutral-200">
                BP {submitted.bench ?? "―"}kg・SQ {submitted.squat ?? "―"}kg・DL{" "}
                {submitted.deadlift ?? "―"}kg
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

function TeamEventTab({
  type,
  profile,
}: {
  type: "body_composition" | "match_reflection";
  profile: ReturnType<typeof useProfile>["profile"];
}) {
  const supabase = createClient();
  const [events, setEvents] = useState<TeamEventRow[]>([]);
  const [mine, setMine] = useState<Map<string, SubmissionRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        "event_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges, measurement_date, weight_kg, body_fat_pct, muscle_mass_kg, lean_body_mass_kg"
      )
      .eq("author_id", profile.id)
      .in(
        "event_id",
        rows.map((r) => r.id)
      );
    const map = new Map<string, SubmissionRow>();
    for (const r of (subData ?? []) as SubmissionRow[]) map.set(r.event_id, r);
    setMine(map);
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
              onClick={() =>
                submitted && setExpandedId(isExpanded ? null : ev.id)
              }
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

            {submitted && isExpanded && (
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
              </div>
            )}

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

const eventSubTabItems = (Object.keys(tabLabel) as EventTab[]).map((t) => ({
  value: t,
  label: tabLabel[t],
}));

export default function EventsPage() {
  const { profile } = useProfile();
  const [tab, setTab] = useState<EventTab>("weight_max");

  // node は useMemo で安定させる（毎レンダー新しいJSXを渡すと無限ループの原因になる）
  const eventsSubNav = useMemo(
    () => <SubTabBar items={eventSubTabItems} active={tab} onChange={setTab} />,
    [tab]
  );
  useSubNav(eventsSubNav);

  return (
    <div className="mx-auto flex w-full flex-col gap-4 p-4 sm:p-5">
      {tab === "weight_max" && <WeightMaxTab profile={profile} />}
      {tab === "body_composition" && (
        <TeamEventTab type="body_composition" profile={profile} />
      )}
      {tab === "match_reflection" && (
        <TeamEventTab type="match_reflection" profile={profile} />
      )}
    </div>
  );
}
