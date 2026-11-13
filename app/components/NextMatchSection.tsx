"use client";

import { useEffect, useState } from "react";
import { useProfile } from "./shell/AppShell";
import { createClient } from "../lib/supabase/client";

// 次の試合（設定と、はじめての設定で使う）
type MatchRow = {
  id: string;
  name: string;
  date: string;
};

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export default function NextMatchSection({ onSaved }: { onSaved?: () => void } = {}) {
  const { profile } = useProfile();
  const supabase = createClient();
  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadNextMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadNextMatch() {
    setLoading(true);
    const todayStr = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    const { data, error } = await supabase
      .from("matches")
      .select("id, name, date")
      .eq("team_id", profile.team_id)
      .eq("member_id", profile.id)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
    } else {
      setNextMatch((data as MatchRow | null) ?? null);
    }
    setLoading(false);
  }

  async function handleAddMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newDate) return;
    const { error } = await supabase.from("matches").insert({
      team_id: profile.team_id,
      name: newName.trim(),
      date: newDate,
      created_by: profile.id,
      member_id: profile.id,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewName("");
    setNewDate("");
    setShowForm(false);
    await loadNextMatch();
  }

  function startEditing() {
    if (!nextMatch) return;
    setEditDate(nextMatch.date);
    setEditing(true);
  }

  async function handleUpdateDate(e: React.FormEvent) {
    e.preventDefault();
    if (!nextMatch || !editDate) return;
    const { data, error } = await supabase
      .from("matches")
      .update({ date: editDate })
      .eq("id", nextMatch.id)
      .select("id");
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg(
        "試合日を更新できませんでした。データベース側の権限設定（matches_update_selfポリシー）が未反映の可能性があります。"
      );
      return;
    }
    setEditing(false);
    await loadNextMatch();
  }

  async function handleDelete() {
    if (!nextMatch) return;
    const { error } = await supabase.from("matches").delete().eq("id", nextMatch.id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setEditing(false);
    await loadNextMatch();
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;

  return (
    <>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : nextMatch ? (
        <div className="relative rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-4 text-center">
          <p className="text-xs text-red-700 dark:text-red-400">次の試合【{nextMatch.name}】まで</p>
          <p className="text-3xl font-bold text-red-500">あと{matchDays}日</p>
          <p className="text-[length:calc(11px+var(--fs-add))] text-red-500">{formatMonthDay(nextMatch.date)}</p>

          {editing ? (
            <form
              onSubmit={handleUpdateDate}
              className="mt-3 flex flex-col items-center gap-2"
            >
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="rounded-lg border border-red-300 dark:border-red-800 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm"
                required
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                >
                  日付を更新
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs text-red-700 dark:text-red-400 active:bg-red-100 dark:active:bg-red-900/40"
                >
                  削除する
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
                >
                  閉じる
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={startEditing}
              className="absolute bottom-2 right-2 rounded border border-red-200 dark:border-red-900/60 bg-neutral-50 dark:bg-neutral-900 px-2 py-1 text-[length:calc(10px+var(--fs-add))] text-red-500 active:bg-red-100 dark:active:bg-red-900/40"
            >
              編集
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-center text-xs text-neutral-500">
          次の試合はまだ登録されていません。
        </p>
      )}

      <button
        onClick={() => setShowForm((v) => !v)}
        className="self-start text-[length:calc(11px+var(--fs-add))] font-medium text-red-700 dark:text-red-400 active:text-red-900"
      >
        {showForm ? "キャンセル" : "＋ 試合を登録する"}
      </button>
      {showForm && (
        <form
          onSubmit={handleAddMatch}
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3"
        >
          <input
            type="text"
            placeholder="試合名（例：全日本学生選手権）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
            required
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
            required
          />
          <button
            type="submit"
            className="rounded-lg bg-red-600 py-2 text-sm font-medium text-white active:bg-red-700"
          >
            登録する
          </button>
        </form>
      )}

      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">{errorMsg}</p>
      )}
    </>
  );
}
