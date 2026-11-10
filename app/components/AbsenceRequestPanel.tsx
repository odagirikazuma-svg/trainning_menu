"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";
import SetLogger, { blocksHaveData, SetSummary, type ExerciseBlock } from "./SetLogger";
import {
  blocksToPlan,
  planToBlocks,
  absencePlanLabel,
  absencePlanText,
  absenceReasonLabel,
  absenceReasonText,
  absenceStatusCls,
  absenceStatusLabel,
  type AbsencePlanType,
  type AbsenceReasonType,
  type AbsenceRequest,
} from "../lib/absence";

// 日報の上に出す「休み申請」欄。
// - 今日以降の日：申請・修正・取り消しができる
// - 過去の日：申請があれば表示だけ
// - readOnly（管理者が部員のページを見ているとき）：表示だけ
export default function AbsenceRequestPanel({
  profile,
  memberId,
  teamId,
  date,
  todayStr,
  readOnly = false,
  onChange,
}: {
  profile: Profile;
  memberId: string;
  teamId: string;
  date: string;
  todayStr: string;
  readOnly?: boolean;
  onChange?: (req: AbsenceRequest | null) => void;
}) {
  const supabase = createClient();
  const [req, setReq] = useState<AbsenceRequest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reasonType, setReasonType] = useState<AbsenceReasonType | null>(null);
  const [reason, setReason] = useState("");
  const [planType, setPlanType] = useState<AbsencePlanType | null>(null);
  const [plan, setPlan] = useState("");
  const [planBlocks, setPlanBlocks] = useState<ExerciseBlock[]>([]);

  const canEdit = !readOnly && date >= todayStr;

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setEditing(false);
    setError(null);
    supabase
      .from("absence_requests")
      .select("*")
      .eq("author_id", memberId)
      .eq("date", date)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setUnavailable(true);
          setReq(null);
        } else {
          setUnavailable(false);
          const r = (data as AbsenceRequest | null) ?? null;
          setReq(r);
          onChange?.(r);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, date]);

  function startEdit() {
    setReasonType(req?.reason_type ?? null);
    setReason(req?.reason ?? "");
    setPlanType(req?.plan_type ?? null);
    setPlan(req?.plan ?? "");
    setPlanBlocks(planToBlocks(req?.plan_sets));
    setError(null);
    setEditing(true);
  }

  async function submit() {
    if (!reasonType) return setError("休む理由を選んでください。");
    if (reasonType === "other" && !reason.trim()) return setError("「その他」の場合は理由を書いてください。");
    if (!planType) return setError("代替メニューを選んでください。");
    if (planType === "weight" && !blocksHaveData(planBlocks) && !plan.trim()) {
      return setError("ウェイトの予定（種目とセット）を入れてください。");
    }
    if ((planType === "running" || planType === "other") && !plan.trim()) {
      return setError("代替メニューの内容を書いてください。");
    }
    setSaving(true);
    setError(null);
    const body = {
      team_id: teamId,
      author_id: memberId,
      date,
      reason_type: reasonType,
      reason: reason.trim(),
      plan_type: planType,
      plan: plan.trim(),
      plan_sets: planType === "weight" && blocksHaveData(planBlocks) ? blocksToPlan(planBlocks) : null,
      status: "pending" as const,
      review_comment: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    };
    const res = req
      ? await supabase.from("absence_requests").update(body).eq("id", req.id).select("*").single()
      : await supabase.from("absence_requests").insert(body).select("*").single();
    if (res.error) {
      setError(`送信できませんでした：${res.error.message}`);
    } else {
      const r = res.data as AbsenceRequest;
      setReq(r);
      onChange?.(r);
      setEditing(false);
    }
    setSaving(false);
  }

  async function cancelRequest() {
    if (!req) return;
    if (!window.confirm("この休み申請を取り消しますか？")) return;
    setSaving(true);
    const { error } = await supabase.from("absence_requests").delete().eq("id", req.id);
    if (error) {
      setError(`取り消せませんでした：${error.message}`);
    } else {
      setReq(null);
      onChange?.(null);
    }
    setSaving(false);
  }

  if (!loaded || unavailable) return null;
  if (!req && !canEdit) return null;

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-medium ${
      active
        ? "bg-red-600 text-white"
        : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700"
    }`;
  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

  // 申請フォーム
  if (editing) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">🙋 休み申請</p>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">休む理由</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(absenceReasonLabel) as AbsenceReasonType[]).map((t) => (
              <button key={t} type="button" onClick={() => setReasonType(t)} className={chip(reasonType === t)}>
                {absenceReasonLabel[t]}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={reason}
            maxLength={100}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonType === "other" ? "理由を書いてください" : "補足（任意）例：発熱38度、〇〇大学へ出稽古"}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">代替メニュー（予定）</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(absencePlanLabel) as AbsencePlanType[]).map((t) => (
              <button key={t} type="button" onClick={() => setPlanType(t)} className={chip(planType === t)}>
                {absencePlanLabel[t]}
              </button>
            ))}
          </div>
          {planType === "weight" && (
            <div className="rounded-lg bg-white p-2 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:ring-neutral-800">
              <SetLogger
                supabase={supabase}
                profile={profile}
                date={date}
                blocks={planBlocks}
                onChange={setPlanBlocks}
              />
            </div>
          )}
          {planType !== "none" && (
            <textarea
              value={plan}
              maxLength={300}
              rows={3}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={
                planType === "weight"
                  ? "補足（任意）例：〇〇ジムで実施"
                  : planType === "running"
                    ? "例：ジョグ30分、インターバル400m×8"
                    : "例：出稽古先の練習に参加"
              }
              className={inputCls}
            />
          )}
          <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
            休みが承認されても、日報の提出は必要です。当日は、この予定がトレーニング欄に入った状態で開くので、実際にやった内容に直して提出してください（予定と変わっても大丈夫です）。
          </span>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex-1 rounded-lg border border-neutral-300 py-2.5 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="flex-[2] rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white active:bg-red-700 disabled:opacity-50"
          >
            {saving ? "送信中…" : req ? "直して申請し直す" : "申請する"}
          </button>
        </div>
      </section>
    );
  }

  // まだ申請していない
  if (!req) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-neutral-300 py-2.5 text-xs font-medium text-neutral-600 active:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:active:bg-neutral-800"
      >
        🙋 この日の練習を休む申請をする
      </button>
    );
  }

  // 申請済み
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">🙋 休み申請</span>
        <span className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${absenceStatusCls[req.status]}`}>
          {absenceStatusLabel[req.status]}
        </span>
      </div>
      <p className="text-xs text-neutral-700 dark:text-neutral-300">
        <span className="text-neutral-500">理由：</span>
        {absenceReasonText(req)}
      </p>
      <p className="whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
        <span className="text-neutral-500">代替メニュー（予定）：</span>
        {absencePlanText(req)}
      </p>
      {req.plan_sets && req.plan_sets.length > 0 && (
        <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:ring-neutral-800">
          <SetSummary blocks={planToBlocks(req.plan_sets)} />
        </div>
      )}
      {req.review_comment && (
        <p className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-neutral-800 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:text-neutral-200 dark:ring-neutral-800">
          💬 {req.review_comment}
        </p>
      )}
      {req.status === "approved" && !readOnly && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-emerald-700 dark:text-emerald-400">
          休みでも日報の提出は必要です。当日は、実際にやった代替メニューを日報（トレーニング）に記録してください。
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {canEdit && req.status !== "approved" && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            {req.status === "rejected" ? "直して申請し直す" : "内容を直す"}
          </button>
          <button
            type="button"
            onClick={cancelRequest}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 underline decoration-dotted"
          >
            申請を取り消す
          </button>
        </div>
      )}
    </section>
  );
}
