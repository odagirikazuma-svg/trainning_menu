"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";
import { TitleColor, TrainingType, trainingTypeLabel } from "../lib/types";
import type { Profile } from "./AuthGate";

type TodoMenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: string;
  start_time: string | null;
  is_off: boolean;
};

/**
 * マイページのタスクポップアップ内で使う、マットの実施報告・未実施報告フォーム。
 * マット掲示板本体（意見欄・スレッド返信など）とは独立した、その場での提出専用の
 * 軽量フォーム。中身はマット掲示板の comments テーブルへ直接 insert する。
 */
export function MatReportInlineForm({
  menu,
  profileId,
  supabase,
  onSubmitted,
  onError,
}: {
  menu: TodoMenuRow;
  profileId: string;
  supabase: ReturnType<typeof createClient>;
  onSubmitted: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"select" | "report" | "absent">("select");
  const [reportText, setReportText] = useState("");
  const [absentReason, setAbsentReason] = useState("");
  const [absentAltType, setAbsentAltType] = useState<TrainingType | null>(
    null
  );
  const [absentAlternative, setAbsentAlternative] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!reportText.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from("comments").insert({
      menu_id: menu.id,
      author_id: profileId,
      kind: "report",
      parent_id: null,
      text: reportText.trim(),
      alt_type: null,
    });
    setSubmitting(false);
    if (error) {
      onError(error.message);
      return;
    }
    await onSubmitted();
  }

  async function submitAbsent(e: React.FormEvent) {
    e.preventDefault();
    if (!absentReason.trim() || !absentAlternative.trim() || !absentAltType)
      return;
    setSubmitting(true);
    const altTypeLabel = trainingTypeLabel[absentAltType];
    const combined = `理由: ${absentReason.trim()}\n代替メニュー: ${altTypeLabel}\n詳細: ${absentAlternative.trim()}`;
    const { error } = await supabase.from("comments").insert({
      menu_id: menu.id,
      author_id: profileId,
      kind: "absent",
      parent_id: null,
      text: combined,
      alt_type: absentAltType,
    });
    setSubmitting(false);
    if (error) {
      onError(error.message);
      return;
    }
    await onSubmitted();
  }

  return (
    <div className="flex flex-col gap-2">
      {menu.content ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-800 p-3 text-sm whitespace-pre-wrap text-neutral-100">
          {menu.content}
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          このメニューにはまだ詳細が登録されていません。
        </p>
      )}

      {mode === "select" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("report")}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white active:bg-emerald-700"
          >
            実施した
          </button>
          <button
            type="button"
            onClick={() => setMode("absent")}
            className="flex-1 rounded-lg bg-neutral-700 px-3 py-2.5 text-sm font-medium text-white active:bg-neutral-600"
          >
            実施できなかった
          </button>
        </div>
      )}

      {mode === "report" && (
        <form onSubmit={submitReport} className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder="実施した内容を記入してください"
            rows={4}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
          />
          <button
            type="submit"
            disabled={submitting || !reportText.trim()}
            className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white active:bg-emerald-700 disabled:opacity-50"
          >
            実施報告を提出する
          </button>
        </form>
      )}

      {mode === "absent" && (
        <form onSubmit={submitAbsent} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            理由
            <input
              type="text"
              value={absentReason}
              onChange={(e) => setAbsentReason(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            代替メニューの種類
            <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
              {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setAbsentAltType(t)}
                  className={`flex-1 rounded-md py-2 font-medium ${
                    absentAltType === t
                      ? "bg-red-600 text-white shadow"
                      : "text-neutral-400"
                  }`}
                >
                  {trainingTypeLabel[t]}
                </button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
            代替メニューの詳細
            <textarea
              value={absentAlternative}
              onChange={(e) => setAbsentAlternative(e.target.value)}
              rows={3}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <button
            type="submit"
            disabled={
              submitting ||
              !absentReason.trim() ||
              !absentAlternative.trim() ||
              !absentAltType
            }
            className="self-start rounded-lg bg-neutral-600 px-4 py-2 text-xs font-medium text-white active:bg-neutral-700 disabled:opacity-50"
          >
            未実施報告を提出する
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * マイページのタスクポップアップ内で使う、自主トレ（ラン・ウェイト・その他）記録フォーム。
 * weight_logsテーブルへ直接保存する（マイページ本体のトレーニング記入欄と同じ形）。
 */
export function SelfTrainingInlineForm({
  date,
  profile,
  supabase,
  titleOptions,
  titleColors,
  onSubmitted,
  onError,
}: {
  date: string;
  profile: Profile;
  supabase: ReturnType<typeof createClient>;
  titleOptions: Record<TrainingType, string[]>;
  titleColors?: Record<TrainingType, Map<string, TitleColor>>;
  onSubmitted: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [type, setType] = useState<TrainingType | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!type) return;
    if (startTime && startTime < "06:00") {
      onError("開始時間はその日の6時以降で入力してください。");
      return;
    }
    setSaving(true);
    const trimmedTitle = title.trim();
    const { error } = await supabase.from("weight_logs").upsert(
      {
        team_id: profile.team_id,
        author_id: profile.id,
        date,
        content: text,
        type,
        title: trimmedTitle ? trimmedTitle : null,
        start_time: startTime || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "author_id,date" }
    );
    setSaving(false);
    if (error) {
      onError(error.message);
      return;
    }
    await onSubmitted();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
        {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`flex-1 rounded-md py-2 font-medium ${
              type === t ? "bg-red-600 text-white shadow" : "text-neutral-400"
            }`}
          >
            {trainingTypeLabel[t]}
          </button>
        ))}
      </div>
      {type && (
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
          開始時間
          <input
            type="time"
            min="06:00"
            max="23:59"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          />
        </label>
      )}
      {type && (
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
          タイトル
          <input
            type="text"
            list={`popup-${type}-title-options`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例：BIG3、上半身の日、インターバル走 など"
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          />
          <datalist id={`popup-${type}-title-options`}>
            {titleOptions[type].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {titleOptions[type].length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {titleOptions[type].map((t) => {
                const c = titleColors?.[type].get(t);
                const selected = title.trim() === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTitle(t)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      selected
                        ? `${c?.border ?? "border-neutral-600"} ${c?.fill ?? "bg-neutral-800"} ${c?.text ?? "text-neutral-200"}`
                        : "border-neutral-700 text-neutral-400 active:bg-neutral-800"
                    }`}
                  >
                    {c && (
                      <span
                        className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${c.dot}`}
                      />
                    )}
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </label>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          "例：\nBP\n60・80・90・100\n110kg×7、3\n\nトレーニングしながら、その場でメモしていってOKです"
        }
        rows={6}
        className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-sm text-neutral-100"
      />
      <button
        onClick={handleSave}
        disabled={saving || !type}
        className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? "提出中…" : "提出する"}
      </button>
    </div>
  );
}
