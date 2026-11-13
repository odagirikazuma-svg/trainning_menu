"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";

// パソコンからも使えるように、メールアドレスとパスワードを登録する（LINEで始めた人向け）。
// メールでアカウントを作った人は、ここでパスワードを変えられる。
export default function EmailLoginSection({ onSaved }: { onSaved?: () => void }) {
  const supabase = createClient();
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadCurrent() {
    const { data } = await supabase.auth.getUser();
    const e = data.user?.email ?? null;
    setCurrent(e && !e.endsWith("@line-login.local") ? e : null);
  }
  useEffect(() => {
    loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
        body: JSON.stringify({ email: email || current, password }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; tokenHash?: string | null };
      if (!res.ok || json.error) throw new Error(json.error ?? "保存できませんでした");
      // ログインし直す（パスワードを変えると前のログインが切れるため）
      if (json.tokenHash) await supabase.auth.verifyOtp({ type: "magiclink", token_hash: json.tokenHash });
      await loadCurrent();
      setPassword("");
      setOpen(false);
      setMsg({ ok: true, text: "登録しました。パソコンでは、このメールアドレスとパスワードでログインできます。" });
      onSaved?.();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "保存できませんでした" });
    }
    setBusy(false);
  }

  if (current === undefined) return <p className="text-xs text-neutral-500">読み込み中…</p>;

  const input =
    "w-full rounded-lg border border-border-color bg-background px-3 py-2.5 text-sm text-foreground";

  return (
    <div className="flex flex-col gap-2">
      {current ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          ✓ メールアドレス（{current}）でもログインできます。
        </p>
      ) : (
        <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
          メールアドレスとパスワードを登録しておくと、パソコンなどLINEのない端末からもログインできます。
        </p>
      )}
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </p>
      )}
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setEmail(current ?? "");
            setOpen(true);
          }}
          className="self-start rounded-lg border border-border-color px-3 py-2 text-xs font-medium text-foreground"
        >
          {current ? "メールアドレス・パスワードを変える" : "メールアドレスを登録する"}
        </button>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-2">
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メールアドレス"
            className={input}
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワード（6文字以上）"
            className={input}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {busy ? "登録しています…" : "登録する"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-border-color px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300"
            >
              やめる
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
