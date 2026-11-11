"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Profile } from "./AuthGate";
import SetLogger, { blocksHaveData, SetSummary, type ExerciseBlock } from "./SetLogger";
import {
  sickStreakHeads,
  hasHospitalReport,
  blocksToPlan,
  planToBlocks,
  absencePlanLabel,
  absencePlanText,
  absenceReasonLabel,
  absenceReasonText,
  absenceStateText,
  absenceStatusCls,
  approvalMethodLabel,
  noPermissionNeeded,
  type ApprovalMethod,
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
  onOpenRequestTab,
}: {
  profile: Profile;
  memberId: string;
  teamId: string;
  date: string;
  todayStr: string;
  readOnly?: boolean;
  onChange?: (req: AbsenceRequest | null) => void;
  // 指定すると、ここでは申請・変更をせず「申請」タブへ案内する（日報の画面用）
  onOpenRequestTab?: () => void;
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
  const [permittedBy, setPermittedBy] = useState<string | null>(null);
  const [method, setMethod] = useState<ApprovalMethod | null>(null);
  // 許可をくれる人の候補（監督・管理者）
  const [coaches, setCoaches] = useState<{ id: string; display_name: string }[]>([]);

  const canEdit = !readOnly && !onOpenRequestTab && date >= todayStr;

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
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setUnavailable(true);
          setReq(null);
        } else {
          setUnavailable(false);
          const r = (data as AbsenceRequest | null) ?? null;
          setReq(r);
          onChange?.(r);
          const { data: cs } = await supabase
            .from("profiles")
            .select("id, display_name")
            .eq("team_id", teamId)
            .eq("role", "coach")
            .order("display_name");
          if (!cancelled) setCoaches((cs ?? []) as { id: string; display_name: string }[]);
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
    setPermittedBy(req?.permitted_by ?? null);
    setMethod(req?.approval_method ?? null);
    setError(null);
    setEditing(true);
  }

  async function submit() {
    if (!reasonType) return setError("休む理由を選んでください。");
    if (reasonType === "other" && !reason.trim()) return setError("「その他」の場合は理由を書いてください。");
    const needPermission = !noPermissionNeeded(reasonType);
    if (needPermission && !permittedBy) return setError("許可をくれた監督・管理者を選んでください。");
    if (needPermission && !method) return setError("許可をもらった方法（LINE・電話）を選んでください。");
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
      status: "approved" as const,
      permitted_by: needPermission ? permittedBy : null,
      approval_method: needPermission ? method : null,
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
    if (!window.confirm("この休みの報告を取り消しますか？（練習に参加する場合など）")) return;
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
  if (!req && onOpenRequestTab && !readOnly && date >= todayStr && loaded && !unavailable) {
    return (
      <button
        type="button"
        onClick={onOpenRequestTab}
        className="self-start text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
      >
        この日の練習を休む場合は「申請」タブから
      </button>
    );
  }
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
        <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">🙋 休みの報告</p>
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
        {reasonType && noPermissionNeeded(reasonType) && (
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
            授業・学業は、届け出だけで大丈夫です（許可は不要です）。
          </p>
        )}
        {reasonType && !noPermissionNeeded(reasonType) && (
          <div className="flex flex-col gap-2 rounded-lg bg-amber-100/60 p-2.5 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              ⚠️ 先に、監督・管理者からLINEか電話で直接許可をもらってから報告してください。
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">許可をくれた人</span>
              <div className="flex flex-wrap gap-1.5">
                {coaches.map((c) => (
                  <button key={c.id} type="button" onClick={() => setPermittedBy(c.id)} className={chip(permittedBy === c.id)}>
                    {c.display_name}
                  </button>
                ))}
                {coaches.length === 0 && <span className="text-xs text-neutral-500">監督・管理者が登録されていません</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">許可をもらった方法</span>
              <div className="flex gap-1.5">
                {(["line", "phone"] as ApprovalMethod[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} className={chip(method === m)}>
                    {approvalMethodLabel[m]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
            休みでも、日報の提出は必要です。当日は、この予定がトレーニング欄に入った状態で開くので、実際にやった内容に直して提出してください（予定と変わっても大丈夫です）。
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
            {saving ? "送信中…" : req ? "直して報告し直す" : "休みを報告する"}
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
        🙋 この日の練習の休みを報告する
      </button>
    );
  }

  // 申請済み
  return (
    <section className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">🙋 休みの報告</span>
        <span className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${absenceStatusCls[req.status]}`}>
          {absenceStateText(req, coaches.find((c) => c.id === req.permitted_by)?.display_name)}
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
      {req.reason_type === "sick" && req.status !== "rejected" && (
        <HospitalReport
          req={req}
          readOnly={readOnly}
          onSaved={(r) => {
            setReq(r);
            onChange?.(r);
          }}
        />
      )}
      {req.status === "approved" && !readOnly && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-emerald-700 dark:text-emerald-400">
          休みでも日報の提出は必要です。当日は、実際にやった代替メニューを日報（トレーニング）に記録してください。
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {req.status === "rejected" && !readOnly && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-red-700 dark:text-red-400">
          監督・管理者がこの報告を取り消しました。理由を確認して、直接相談してください。
        </p>
      )}
      {canEdit && req.status === "rejected" && (
        <div className="pt-1">
          <button
            type="button"
            onClick={cancelRequest}
            disabled={saving}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            この報告を消す（相談のうえ出し直す場合）
          </button>
        </div>
      )}
      {onOpenRequestTab && !readOnly && (
        <button
          type="button"
          onClick={onOpenRequestTab}
          className="self-start pt-1 text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
        >
          申請の内容を直す・取り消す（「申請」タブ）
        </button>
      )}
      {canEdit && req.status !== "rejected" && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300"
          >
            内容を直す
          </button>
          <button
            type="button"
            onClick={cancelRequest}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 underline decoration-dotted"
          >
            報告を取り消す（練習に出る）
          </button>
        </div>
      )}
    </section>
  );
}


// 体調不良のときの病院の報告（行った病院と結果）。休みの日を過ぎてからでも書ける
function HospitalReport({
  req,
  readOnly,
  onSaved,
}: {
  req: AbsenceRequest;
  readOnly?: boolean;
  onSaved: (r: AbsenceRequest) => void;
}) {
  const supabase = createClient();
  // 前日から続く体調不良なら、最初の日の休みに病院の報告をまとめて書く
  const [head, setHead] = useState<AbsenceRequest | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    const from = new Date(Date.parse(`${req.date}T00:00:00Z`) - 14 * 86400_000).toISOString().slice(0, 10);
    supabase
      .from("absence_requests")
      .select("*")
      .eq("author_id", req.author_id)
      .eq("reason_type", "sick")
      .gte("date", from)
      .lte("date", req.date)
      .then(({ data }) => {
        const list = (data ?? []) as AbsenceRequest[];
        const h = sickStreakHeads(list.some((r) => r.id === req.id) ? list : [...list, req]).get(req.id);
        setHead(h && h.id !== req.id ? h : null);
        setChecked(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id]);
  const target = head ?? req;
  const done = hasHospitalReport(target);
  const [editing, setEditing] = useState(false);
  const [hospital, setHospital] = useState(req.hospital_name ?? "");
  const [result, setResult] = useState(req.hospital_result ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!hospital.trim() || !result.trim()) return setError("病院の名前と結果を入れてください。");
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.rpc("report_absence_hospital", {
      p_id: target.id,
      p_hospital: hospital,
      p_result: result,
    });
    setSaving(false);
    if (e) return setError(`保存できませんでした：${e.message}`);
    setEditing(false);
    const saved = { ...target, hospital_name: hospital.trim(), hospital_result: result.trim(), hospital_reported_at: new Date().toISOString() };
    if (head) {
      setHead(saved);
      onSaved(req);
    } else onSaved(saved);
  }

  function startEditing() {
    setHospital(target.hospital_name ?? "");
    setResult(target.hospital_result ?? "");
    setEditing(true);
  }
  const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const streakNote = head ? (
    <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
      {fmt(head.date)}から続いている体調不良なので、病院の報告は{fmt(head.date)}の分でまとめて済みます。
    </span>
  ) : null;
  if (!checked) return null;

  const input =
    "rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

  if (editing && !readOnly) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-white p-2.5 ring-1 ring-sky-200 dark:bg-neutral-950 dark:ring-sky-900">
        <span className="text-xs font-semibold text-sky-800 dark:text-sky-300">🏥 病院の報告{head ? `（${fmt(head.date)}の分）` : ""}</span>
        <input value={hospital} onChange={(e) => setHospital(e.target.value)} maxLength={60} placeholder="行った病院（例：○○クリニック 内科）" className={input} />
        <textarea
          value={result}
          onChange={(e) => setResult(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="結果（診断・医師に言われたこと・いつから練習できそうか）"
          className={input}
        />
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
            やめる
          </button>
          <button type="button" onClick={save} disabled={saving} className="ml-auto rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50">
            {saving ? "保存中…" : "報告する"}
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-0.5 rounded-lg bg-white px-2.5 py-2 text-xs ring-1 ring-sky-200 dark:bg-neutral-950 dark:ring-sky-900">
        <span className="font-semibold text-sky-800 dark:text-sky-300">🏥 {target.hospital_name}</span>
        <span className="whitespace-pre-wrap text-neutral-800 dark:text-neutral-200">{target.hospital_result}</span>
        {streakNote}
        {!readOnly && (
          <button type="button" onClick={startEditing} className="self-start pt-0.5 text-[length:calc(10px+var(--fs-add))] text-neutral-500 underline">
            直す
          </button>
        )}
      </div>
    );
  }

  if (readOnly) return <p className="text-xs text-amber-700 dark:text-amber-400">🏥 病院の報告：まだ</p>;
  return (
    <button
      type="button"
      onClick={startEditing}
      className="flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-2 text-left text-xs text-sky-900 ring-1 ring-sky-200 dark:bg-sky-950/30 dark:text-sky-200 dark:ring-sky-900"
    >
      <span>
        {head
          ? `🏥 ${fmt(head.date)}からの体調不良です。病院の報告は1回でOK（まだです）`
          : "🏥 病院に行ったら、病院と結果を報告してください"}
      </span>
      <span className="font-bold">報告する ›</span>
    </button>
  );
}
