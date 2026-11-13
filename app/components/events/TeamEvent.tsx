"use client";

import { useEffect, useMemo, useState } from "react";
import { useProfile, } from "../shell/AppShell";
import { notifyTasksChanged } from "../shell/taskRefreshBus";
import { createClient } from "../../lib/supabase/client";
import {
  teamEventTypeLabel,
} from "../../lib/types";

import {
  matchResultOptions,
  formatMonthDay,
  TeamEventRow,
  SubmissionRow,
  CommentThread,
  MatchSubmissionRow,
  EventTargetPicker,
  useEventMembers,
  } from "./shared";

// イベント「試合の振り返り」「体組成」の共通タブと、管理者の集計

export function TeamEventTab({
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

  // 試合の振り返り：自分の通算戦績
  const record = (() => {
    if (type !== "match_reflection") return null;
    const list = events
      .map((ev) => ({ ev, sub: mine.get(ev.id) }))
      .filter((x) => x.sub && (x.sub.win_count != null || x.sub.loss_count != null || x.sub.match_result));
    if (list.length === 0) return null;
    const wins = list.reduce((a, x) => a + (x.sub!.win_count ?? 0), 0);
    const losses = list.reduce((a, x) => a + (x.sub!.loss_count ?? 0), 0);
    return { list: list.slice(0, 3), wins, losses, count: list.length };
  })();

  return (
    <div className="flex flex-col gap-3">
      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {errorMsg}
        </p>
      )}
      {record && (
        <section className="flex flex-col gap-2 rounded-2xl border border-border-color bg-surface p-4 shadow-sm">
          <span className="text-xs font-semibold text-neutral-500">あなたの通算戦績（{record.count}大会）</span>
          <span className="flex items-baseline gap-3">
            <span className="text-3xl font-extrabold tabular-nums text-foreground">
              {record.wins}
              <span className="mx-0.5 text-base font-bold text-neutral-500">勝</span>
              {record.losses}
              <span className="ml-0.5 text-base font-bold text-neutral-500">敗</span>
            </span>
            {record.wins + record.losses > 0 && (
              <span className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                勝率 {Math.round((record.wins / (record.wins + record.losses)) * 100)}%
              </span>
            )}
          </span>
          <ul className="flex flex-col gap-1">
            {record.list.map(({ ev, sub }) => (
              <li key={ev.id} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs dark:bg-neutral-900">
                <span className="truncate text-neutral-800 dark:text-neutral-200">{sub!.match_title || ev.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {(sub!.win_count != null || sub!.loss_count != null) && (
                    <span className="tabular-nums text-neutral-500">
                      {sub!.win_count ?? 0}勝{sub!.loss_count ?? 0}敗
                    </span>
                  )}
                  {sub!.match_result && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${
                        /優勝|準優勝|3位/.test(sub!.match_result)
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                          : "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      }`}
                    >
                      {sub!.match_result}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {events.map((ev) => {
        const submitted = mine.get(ev.id);
        const isOpenEvent = !ev.closed_at;
        const isOverdue = new Date().toISOString().slice(0, 10) > ev.deadline;
        const isExpanded = expandedId === ev.id;
        return (
          <div
            key={ev.id}
            className="flex flex-col gap-2 rounded-2xl border border-border-color bg-surface p-3.5 text-sm shadow-sm"
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : ev.id)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="font-medium">
                {ev.title}
                <span className="ml-2 text-[length:calc(11px+var(--fs-add))] font-normal text-neutral-500">
                  〜{formatMonthDay(ev.deadline)}
                </span>
              </span>
              {submitted ? (
                <span className="shrink-0 rounded bg-emerald-800/60 px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] font-medium text-emerald-700 dark:text-emerald-300">
                  提出済み
                </span>
              ) : isOpenEvent ? (
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] font-medium ${
                    isOverdue
                      ? "bg-red-600 text-white"
                      : "bg-amber-800/60 text-amber-700 dark:text-amber-300"
                  }`}
                >
                  未提出
                </span>
              ) : (
                <span className="shrink-0 rounded bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300">
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
                    {submitted.improvement_plan && (
                      <p className="whitespace-pre-wrap">
                        今後の改善策：{submitted.improvement_plan}
                      </p>
                    )}
                    {submitted.team_challenges && (
                      <p className="whitespace-pre-wrap">
                        チームとしての課題：{submitted.team_challenges}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {submitted.measurement_date && (
                      <p>測定日：{formatMonthDay(submitted.measurement_date)}</p>
                    )}
                    <p>
                      体脂肪率 <b>{submitted.body_fat_pct ?? "―"}%</b>・体重{" "}
                      {submitted.weight_kg ?? "―"}kg
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
                    <h4 className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-500 dark:text-neutral-400">
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
                      className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted dark:text-neutral-400"
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
                          <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                        出場した試合名
                        <input
                          type="text"
                          value={matchTitle}
                          onChange={(e) => setMatchTitle(e.target.value)}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                          試合数
                          <input
                            type="number"
                            value={matchCount}
                            onChange={(e) => setMatchCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                          勝ち数
                          <input
                            type="number"
                            value={matchWinCount}
                            onChange={(e) => setMatchWinCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                          負け数
                          <input
                            type="number"
                            value={matchLossCount}
                            onChange={(e) => setMatchLossCount(e.target.value)}
                            className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                          />
                        </label>
                      </div>
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                        試合の反省
                        <textarea
                          value={matchReflection}
                          onChange={(e) => setMatchReflection(e.target.value)}
                          rows={3}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                        良かった点
                        <textarea
                          value={matchGoodPoints}
                          onChange={(e) => setMatchGoodPoints(e.target.value)}
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                        課題に感じた点
                        <textarea
                          value={matchChallenges}
                          onChange={(e) => setMatchChallenges(e.target.value)}
                          rows={2}
                          className="rounded border border-border-color bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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
                      <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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

export function TeamEventCoachManagement({
  type,
  profile,
  readOnly = false,
}: {
  type: "match_reflection" | "body_composition";
  profile: ReturnType<typeof useProfile>["profile"];
  // マネージャー用：提出内容の閲覧のみ（イベントの作成・終了はできない）
  readOnly?: boolean;
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
  // 終了した試合の振り返り（提出内容はあとからも見られるように）
  const [pastMatches, setPastMatches] = useState<
    { event: TeamEventRow; rows: MatchSubmissionRow[] }[]
  >([]);
  const [openPastId, setOpenPastId] = useState<string | null>(null);
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

    if (type === "match_reflection") {
      const { data: closedData } = await supabase
        .from("team_events")
        .select("id, type, title, deadline, closed_at")
        .eq("team_id", profile.team_id)
        .eq("type", "match_reflection")
        .not("closed_at", "is", null)
        .order("deadline", { ascending: false });
      const closed = (closedData ?? []) as TeamEventRow[];
      let subs: (MatchSubmissionRow & { event_id: string })[] = [];
      if (closed.length > 0) {
        const { data: subData } = await supabase
          .from("team_event_submissions")
          .select(
            "id, event_id, author_id, updated_at, match_result, match_title, match_count, win_count, loss_count, reflection, good_points, challenges, improvement_plan, team_challenges"
          )
          .in("event_id", closed.map((e) => e.id));
        subs = (subData ?? []) as (MatchSubmissionRow & { event_id: string })[];
      }
      setPastMatches(closed.map((e) => ({ event: e, rows: subs.filter((x) => x.event_id === e.id) })));
    } else {
      setPastMatches([]);
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
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
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
            <MatchSubmissionList rows={matchSubmissions} members={members} profile={profile} />
          )}

          {!readOnly && (
          <button
            onClick={handleEnd}
            className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            このイベントを終了する
          </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          現在開催中のイベントはありません。（イベントの作成は管理者が行います）
        </p>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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
              イベントを作成する
            </button>
          </div>
        </form>
      )}

      {type === "match_reflection" && pastMatches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            これまでの試合の振り返り
          </h3>
          {pastMatches.map(({ event: ev, rows }) => {
            const open = openPastId === ev.id;
            return (
              <div key={ev.id} className="overflow-hidden rounded-lg border border-border-color bg-surface-2">
                <button
                  type="button"
                  onClick={() => setOpenPastId(open ? null : ev.id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{ev.title || "試合の振り返り"}</span>
                    <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                      締切 {formatMonthDay(ev.deadline)}・終了済み
                    </span>
                  </span>
                  <span className="shrink-0 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                    提出 {rows.length}人{open ? " ▲" : " ▼"}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border-color p-2">
                    <MatchSubmissionList rows={rows} members={members} profile={profile} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
                  <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
                    提出済み：{g.submittedCount}人/{eligibleMembers.length}人
                    {isExpanded ? " ▲" : " ▼"}
                  </span>
                </button>
                {isExpanded && (
                  <div className="overflow-x-auto border-t border-border-color">
                    <table className="w-full table-fixed text-[length:calc(11px+var(--fs-add))]">
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
                            体脂肪率
                          </th>
                          <th className="px-1 py-1.5 text-right font-medium">
                            体重
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
                              <td className="px-1 py-1.5 text-right font-bold text-foreground">
                                {r.bodyFatPct ?? "―"}
                                {r.bodyFatPct != null && (
                                  <span className="text-neutral-500 dark:text-neutral-400">
                                    %
                                  </span>
                                )}
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

// 試合の振り返りの提出一覧（名前をタップで中身を開く）。開催中・終了したイベントの両方で使う
function MatchSubmissionList({
  rows,
  members,
  profile,
}: {
  rows: MatchSubmissionRow[];
  members: ReturnType<typeof useEventMembers>;
  profile: ReturnType<typeof useProfile>["profile"];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (rows.length === 0)
    return <p className="text-xs text-neutral-500 dark:text-neutral-400">提出はありません。</p>;
  return (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) =>
                    prev.size === rows.length
                      ? new Set()
                      : new Set(rows.map((s) => s.author_id))
                  )
                }
                className="self-end text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted dark:text-neutral-400"
              >
                {expanded.size === rows.length
                  ? "すべて閉じる"
                  : "全員の詳細を表示"}
              </button>
              {rows
                .map((s) => ({
                  ...s,
                  name:
                    members.find((m) => m.id === s.author_id)?.display_name ??
                    "（不明な部員）",
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "ja"))
                .map((s) => {
                  const isExpanded = expanded.has(s.author_id);
                  return (
                    <div
                      key={s.author_id}
                      className="overflow-hidden rounded-lg border border-border-color bg-background"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((prev) => {
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
                        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
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
  );
}

// イベントページ内のポップアップ用に、未提出のイベント1件をタスクの形に変換する
