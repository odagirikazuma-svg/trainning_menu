"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { LIFF_ID } from "../lib/liffConfig";
import { currentGrade, locationLabel, type Location } from "../lib/types";

// LINEログインの入口。
// - LINEの中（リッチメニュー・招待リンク）から開くと、そのままLINEで本人確認してログインする
// - ふつうのブラウザ（設定の「LINEと連携する」）から開くと、LINEのログイン画面を経由して連携する
// ログインできたら ?to= のページへ移動する。

type RosterRow = {
  id: string;
  display_name: string;
  role: string;
  home_location: Location | null;
  entry_year: number | null;
};

type Stage =
  | { kind: "loading"; text: string }
  | { kind: "error"; text: string }
  | { kind: "unlinked"; lineName: string; roster: RosterRow[] }
  | { kind: "password"; lineName: string };

function markLinked(userId: string) {
  try {
    localStorage.setItem(`line-linked:${userId}`, "1");
  } catch {
    // 保存できなくても、次回LINEで確認し直すだけ
  }
}

// LIFF を読み込む前に、行き先（?to=）を取り出す。
// LINEから開いたときは ?liff.state=%3Fto%3D... の形で届く
function earlyDestination() {
  const q = new URLSearchParams(window.location.search);
  const direct = q.get("to");
  if (direct) return safeTo(direct);
  const state = q.get("liff.state");
  if (state) {
    const inner = new URLSearchParams(state.startsWith("?") ? state.slice(1) : state.split("?")[1] ?? "");
    return safeTo(inner.get("to"));
  }
  return "/";
}

function safeTo(raw: string | null) {
  // 自分のアプリの中のページだけに移動する
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export default function LiffPage() {
  const supabase = createClient();
  const [stage, setStage] = useState<Stage>({ kind: "loading", text: "LINEで確認しています…" });
  const [idToken, setIdToken] = useState<string | null>(null);
  const [to, setTo] = useState("/");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<RosterRow | null>(null);

  async function call(action: string, extra: Record<string, unknown> = {}, bearer?: string) {
    const res = await fetch("/api/line/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ idToken: extra.idToken ?? idToken, action, ...extra }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: string;
      tokenHash?: string;
      error?: string;
      lineName?: string;
      roster?: RosterRow[];
    };
    if (!res.ok || json.error) throw new Error(json.error ?? `エラー（${res.status}）`);
    return json;
  }

  async function finishWithToken(tokenHash: string, dest: string) {
    setStage({ kind: "loading", text: "ログインしています…" });
    const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
    if (error) throw new Error(error.message);
    if (data.user) markLinked(data.user.id);
    window.location.replace(dest);
  }

  useEffect(() => {
    (async () => {
      try {
        // 近道：このブラウザがすでにアプリにログイン済みで、LINE連携も済んでいれば、
        // LINEの確認（LIFFの読み込み）を飛ばして、すぐ目的のページを開く
        const early = earlyDestination();
        const { data: s0 } = await supabase.auth.getSession();
        const forceLink = new URLSearchParams(window.location.search).get("link") === "1";
        if (s0.session && !forceLink && localStorage.getItem(`line-linked:${s0.session.user.id}`) === "1") {
          window.location.replace(early);
          return;
        }

        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: LIFF_ID });
        const dest = safeTo(new URLSearchParams(window.location.search).get("to"));
        setTo(dest);
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const tok = liff.getIDToken();
        if (!tok) throw new Error("LINEの情報を取得できませんでした。もう一度開いてください。");
        setIdToken(tok);

        // まず、このLINEがどのアカウントに連携されているかを確かめる
        const { data } = await supabase.auth.getSession();
        const r = await call("login", { idToken: tok });
        if (r.status === "ok" && r.tokenHash) {
          // 連携済み：このブラウザで別のアカウントにログインしていても、LINEに連携されたアカウントに切り替える
          // （設定の「LINEと連携する」から来たときだけは、今のアカウントに連携し直そうとする）
          if (data.session && forceLink) {
            setStage({ kind: "loading", text: "LINEと連携しています…" });
            await call("link", { idToken: tok }, data.session.access_token);
            markLinked(data.session.user.id);
            window.location.replace(dest);
            return;
          }
          await finishWithToken(r.tokenHash, dest);
          return;
        }
        // まだ連携されていない：アプリにログイン中なら、そのアカウントに連携する
        if (data.session) {
          setStage({ kind: "loading", text: "LINEと連携しています…" });
          await call("link", { idToken: tok }, data.session.access_token);
          markLinked(data.session.user.id);
          window.location.replace(dest);
          return;
        }
        setStage({ kind: "unlinked", lineName: r.lineName ?? "", roster: r.roster ?? [] });
      } catch (e) {
        setStage({ kind: "error", text: e instanceof Error ? e.message : "うまくいきませんでした" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function register() {
    if (!picked) return;
    if (!window.confirm(`「${picked.display_name}」として登録します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const r = await call("register", { rosterId: picked.id });
      if (r.tokenHash) await finishWithToken(r.tokenHash, to);
    } catch (e) {
      setStage({ kind: "error", text: e instanceof Error ? e.message : "登録できませんでした" });
    }
    setBusy(false);
  }

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error("メールアドレスかパスワードが違います");
      await call("link", {}, data.session.access_token);
      markLinked(data.session.user.id);
      window.location.replace(to);
    } catch (err) {
      alert(err instanceof Error ? err.message : "ログインできませんでした");
    }
    setBusy(false);
  }

  const card = "mx-auto flex w-full max-w-md flex-col gap-4 p-5";
  const btn =
    "w-full rounded-xl bg-[#06C755] py-3 text-sm font-bold text-white active:opacity-80 disabled:opacity-50";
  const input =
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className={card}>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <span className="inline-block h-5 w-1 rounded-full bg-red-600" />
          練習ノート
        </h1>

        {stage.kind === "loading" && <p className="text-sm text-neutral-500">{stage.text}</p>}

        {stage.kind === "error" && (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {stage.text}
            </p>
            <a href="/" className="text-center text-sm text-neutral-500 underline">
              メールアドレスでログインする
            </a>
          </div>
        )}

        {stage.kind === "unlinked" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {stage.lineName && <b>{stage.lineName}</b>}
              {stage.lineName && " さん、"}はじめまして。
              <br />
              名簿から<b>自分の名前</b>を選んでください。
              <br />
              <span className="text-xs text-neutral-500">名前が見つからないときは、監督に名簿への登録を頼んでください。</span>
            </p>
            {stage.roster.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
                登録待ちの名簿がありません。管理者に名簿への登録を頼んでください。
              </p>
            ) : (
              <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
                {stage.roster.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(r)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm ${
                        picked?.id === r.id
                          ? "bg-red-600 text-white"
                          : "bg-neutral-50 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
                      }`}
                    >
                      <span className="font-semibold">{r.display_name}</span>
                      <span className={`text-xs ${picked?.id === r.id ? "text-white/80" : "text-neutral-500"}`}>
                        {[
                          r.home_location ? locationLabel[r.home_location] : null,
                          r.entry_year ? `${currentGrade(r.entry_year)}年` : null,
                        ]
                          .filter(Boolean)
                          .join("・")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" disabled={!picked || busy} onClick={register} className={btn}>
              {busy ? "登録しています…" : "この名前で登録する"}
            </button>
            <button
              type="button"
              onClick={() => setStage({ kind: "password", lineName: stage.lineName })}
              className="text-sm text-neutral-500 underline"
            >
              すでにアカウントを持っている（メールでログインして連携）
            </button>
          </div>
        )}

        {stage.kind === "password" && (
          <form onSubmit={loginWithPassword} className="flex flex-col gap-3">
            <p className="text-sm">
              今までのメールアドレスとパスワードでログインすると、このLINEと連携されます。次からはLINEだけでログインできます。
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              className={input}
            />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              className={input}
            />
            <button type="submit" disabled={busy} className={btn}>
              {busy ? "連携しています…" : "ログインしてLINEと連携する"}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-sm text-neutral-500 underline"
            >
              戻る
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
