"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";

// 管理設定：監督・コーチに毎晩送る LINE のまとめ通知の確認とテスト送信
export default function LineSummarySection() {
  const supabase = createClient();
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(send: boolean) {
    setBusy(true);
    setMsg(null);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      const res = await fetch("/api/line/daily-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ send }),
      });
      const json = (await res.json()) as { text?: string; error?: string; sent?: number; targets?: number };
      if (json.text) setText(json.text);
      if (!res.ok || json.error) {
        setMsg({ ok: false, text: json.error ?? `エラー（${res.status}）` });
      } else if (send) {
        setMsg({ ok: true, text: `LINEに送りました（${json.sent}件）。` });
      } else if (json.targets === 0) {
        setMsg({ ok: false, text: "送り先がまだ設定されていません（プレビューのみ）。" });
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "通信に失敗しました" });
    }
    setBusy(false);
  }

  async function setupRichMenu() {
    if (!window.confirm("公式LINEのリッチメニュー（部員用・監督用）を作り直しますか？")) return;
    setBusy(true);
    setMsg(null);
    const { data } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/line/richmenu", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const json = (await res.json()) as { error?: string; linkedCoaches?: number };
      setMsg(
        res.ok
          ? { ok: true, text: `リッチメニューを設定しました（監督用を${json.linkedCoaches ?? 0}人に表示）。LINEのトーク画面を開き直すと反映されます。` }
          : { ok: false, text: json.error ?? `エラー（${res.status}）` }
      );
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "通信に失敗しました" });
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
        毎晩、今日の日報の提出状況・疲労度・明日の休み申請をまとめて、公式LINEから送ります。
        ここでは、今の時点の内容を確認したり、すぐに送ったりできます。
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(false)}
          className="flex-1 rounded-lg border border-neutral-300 py-2 text-xs font-medium text-neutral-700 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300"
        >
          内容を確認する
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("今の内容をLINEに送りますか？（通数を1回分使います）")) run(true);
          }}
          className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white disabled:opacity-50"
        >
          今すぐLINEに送る
        </button>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={setupRichMenu}
        className="rounded-lg border border-red-300 py-2 text-xs font-medium text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-400"
      >
        リッチメニュー（トーク画面のボタン）を設定し直す
      </button>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </p>
      )}
      {text && (
        <pre className="whitespace-pre-wrap rounded-lg bg-[#8cabd9]/30 p-3 font-sans text-xs leading-relaxed text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
          {text}
        </pre>
      )}
    </div>
  );
}
