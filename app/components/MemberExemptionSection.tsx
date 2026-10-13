"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { Location, locationLabel } from "../lib/types";
import type { Profile } from "./AuthGate";
import { formatExemptionDate } from "../lib/exemptions";

// 管理設定「免除設定」：
// 国際試合・慶弔などで長期間練習を休む部員について、期間を決めて
// 「練習の実施報告」「自主トレ記録」のタスクを免除する（管理者のみ）。
// 理由メモは管理者だけが見られる別テーブルに保存し、部員本人には期間だけを表示する。

type MemberOption = {
  id: string;
  display_name: string;
  home_location: Location | null;
};

type ExemptionItem = {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string;
  reason: string;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function MemberExemptionSection({
  profile,
}: {
  profile: Profile;
}) {
  const supabase = useMemo(() => createClient(), []);
  const todayStr = toDateKey(new Date());

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [items, setItems] = useState<ExemptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberId, setMemberId] = useState("");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: memberData } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, role")
      .eq("team_id", profile.team_id)
      .not("role", "in", "(coach,manager,ob)")
      .order("display_name");
    setMembers((memberData ?? []) as MemberOption[]);

    // 終了日が今日以降（実施中・これから始まる）の免除だけを一覧に出す
    const { data: exemptionData, error } = await supabase
      .from("member_exemptions")
      .select("id, member_id, start_date, end_date")
      .eq("team_id", profile.team_id)
      .gte("end_date", todayStr)
      .order("start_date", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
      return;
    }
    const rows = (exemptionData ?? []) as {
      id: string;
      member_id: string;
      start_date: string;
      end_date: string;
    }[];

    // 理由メモ（管理者のみ読める別テーブル）。読めなくても一覧は出す
    const reasonById = new Map<string, string>();
    if (rows.length > 0) {
      const { data: reasonData } = await supabase
        .from("member_exemption_reasons")
        .select("exemption_id, reason")
        .in(
          "exemption_id",
          rows.map((r) => r.id)
        );
      for (const r of (reasonData ?? []) as {
        exemption_id: string;
        reason: string | null;
      }[]) {
        reasonById.set(r.exemption_id, r.reason ?? "");
      }
    }
    setItems(rows.map((r) => ({ ...r, reason: reasonById.get(r.id) ?? "" })));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.team_id, todayStr]);

  useEffect(() => {
    load();
  }, [load]);

  const nameOf = (id: string) =>
    members.find((m) => m.id === id)?.display_name ?? "（不明な部員）";

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);
    if (!memberId) {
      setErrorMsg("部員を選んでください。");
      return;
    }
    if (!startDate || !endDate) {
      setErrorMsg("開始日と終了日を入力してください。");
      return;
    }
    if (endDate < startDate) {
      setErrorMsg("終了日は開始日以降にしてください。");
      return;
    }
    setSaving(true);
    const { data: inserted, error } = await supabase
      .from("member_exemptions")
      .insert({
        team_id: profile.team_id,
        member_id: memberId,
        start_date: startDate,
        end_date: endDate,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      setErrorMsg(error?.message ?? "登録に失敗しました。");
      setSaving(false);
      return;
    }
    const trimmed = reason.trim();
    if (trimmed) {
      const { error: reasonError } = await supabase
        .from("member_exemption_reasons")
        .insert({ exemption_id: (inserted as { id: string }).id, reason: trimmed });
      if (reasonError) {
        setNoticeMsg(
          `免除は登録しましたが、理由メモの保存に失敗しました（${reasonError.message}）。`
        );
      }
    }
    setMemberId("");
    setReason("");
    setSaving(false);
    await load();
  }

  async function handleDelete(item: ExemptionItem) {
    if (
      !window.confirm(
        `${nameOf(item.member_id)}さんの免除（${formatExemptionDate(
          item.start_date
        )}〜${formatExemptionDate(item.end_date)}）を取り消しますか？`
      )
    )
      return;
    setErrorMsg(null);
    setNoticeMsg(null);
    await supabase
      .from("member_exemption_reasons")
      .delete()
      .eq("exemption_id", item.id);
    const { error } = await supabase
      .from("member_exemptions")
      .delete()
      .eq("id", item.id);
    if (error) setErrorMsg(error.message);
    await load();
  }

  const inputClass =
    "rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        国際試合・慶弔などで練習を休む部員の、期間中の「練習の実施報告」「自主トレ記録」を免除します。
        免除期間中はタスク・通知・提出人数の対象から外れ、終了日の翌日から自動で元に戻ります。
        怪我の経過報告やイベントは免除されません。理由メモは管理者だけが見られます。
      </p>

      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 rounded-lg border border-border-color p-3"
      >
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          免除を追加
        </p>
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className={inputClass}
        >
          <option value="">部員を選択</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
              {m.home_location ? `（${locationLabel[m.home_location]}）` : ""}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5 text-[10px] text-neutral-500">
            開始日
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[10px] text-neutral-500">
            終了日
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <input
          type="text"
          placeholder="理由メモ（任意・管理者のみ閲覧）例：国際大会遠征"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          {saving ? "登録中…" : "免除を登録"}
        </button>
      </form>

      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
      {noticeMsg && (
        <p className="rounded bg-amber-950/30 p-2 text-xs text-amber-300">
          {noticeMsg}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          登録中・予定の免除
        </p>
        {loading ? (
          <p className="text-xs text-neutral-500">読み込み中…</p>
        ) : items.length === 0 ? (
          <p className="text-xs text-neutral-500">
            現在、免除中・予定の部員はいません。
          </p>
        ) : (
          items.map((item) => {
            const active = item.start_date <= todayStr;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border-color px-2.5 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                    {nameOf(item.member_id)}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        active
                          ? "bg-amber-950/40 text-amber-400"
                          : "bg-surface-2 text-neutral-500 dark:text-neutral-400"
                      }`}
                    >
                      {active ? "免除中" : "予定"}
                    </span>
                  </p>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {formatExemptionDate(item.start_date)}〜
                    {formatExemptionDate(item.end_date)}
                    {item.reason ? `　${item.reason}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  className="shrink-0 rounded border border-border-color px-2 py-1 text-[11px] text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
                >
                  取り消す
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
