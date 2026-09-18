"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let settled = false;

    // メール内のリンクから開くと、SupabaseがPASSWORD_RECOVERYイベントを発行し、
    // 一時的な復旧セッションを確立する（非同期のため即時にgetSessionだけでは
    // 間に合わないことがあるので、状態変化も監視する）
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "PASSWORD_RECOVERY" || session) {
          settled = true;
          setReady(true);
          setErrorMsg(null);
        }
      }
    );

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setReady(true);
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        setErrorMsg(
          "このリンクは無効か期限切れです。もう一度「パスワードをお忘れですか？」からやり直してください。"
        );
      }
    }, 3000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setDone(true);
    }
    setSubmitting(false);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-neutral-950 p-4 text-neutral-200">
      <h1 className="flex items-center gap-2 text-lg font-bold text-white">
        <span className="inline-block h-5 w-1.5 rounded-full bg-red-600" />
        パスワードの再設定
      </h1>

      {done ? (
        <div className="flex flex-col gap-3">
          <p className="rounded bg-emerald-950/40 p-2 text-xs text-emerald-400">
            パスワードを変更しました。
          </p>
          <button
            onClick={() => router.push("/")}
            className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            トップページに戻る
          </button>
        </div>
      ) : !ready ? (
        <p className="text-xs text-neutral-500">確認しています…</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            type="password"
            required
            minLength={6}
            placeholder="新しいパスワード（6文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            パスワードを変更する
          </button>
        </form>
      )}

      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
