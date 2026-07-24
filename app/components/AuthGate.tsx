"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";
import { Location, Role, roleLabel } from "../lib/types";

export type Profile = {
  id: string;
  team_id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
};

export default function AuthGate({
  children,
}: {
  children: (profile: Profile, signOut: () => void) => React.ReactNode;
}) {
  const supabase = createClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    loadOrCreateProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function loadOrCreateProfile() {
    if (!session) return;
    const { data: existing, error: existingError } = await supabase
      .from("profiles")
      .select("id, team_id, display_name, role, home_location")
      .eq("id", session.user.id)
      .maybeSingle();

    if (existingError) {
      setErrorMsg(`プロフィール取得エラー: ${existingError.message}`);
      return;
    }

    if (existing) {
      setProfile(existing as Profile);
      return;
    }

    // 初回ログイン時：デフォルトチームに部員として自動参加
    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id")
      .limit(1)
      .maybeSingle();

    if (teamError) {
      setErrorMsg(`チーム取得エラー: ${teamError.message}`);
      return;
    }

    if (!team) {
      setErrorMsg(
        "チームが見つかりません。先にSupabaseでteamsテーブルにチームを1件作成してください。"
      );
      return;
    }

    const { data: created, error } = await supabase
      .from("profiles")
      .insert({
        id: session.user.id,
        team_id: team.id,
        display_name:
          (session.user.user_metadata?.display_name as string | undefined) ||
          session.user.email?.split("@")[0] ||
          "名無し",
        role: "member",
      })
      .select("id, team_id, display_name, role, home_location")
      .single();

    if (error) {
      setErrorMsg(`プロフィール作成に失敗しました: ${error.message}`);
      return;
    }
    setProfile(created as Profile);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg(
          "確認メールを送信しました。メール内のリンクを開いてから、このページに戻ってログインしてください。"
        );
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setErrorMsg(error.message);
    }
    setSubmitting(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return <div className="p-8 text-sm text-neutral-400">読み込み中…</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-lg font-bold">練習ノート ログイン</h1>
        <div className="flex gap-2 text-xs">
          <button
            className={`rounded px-3 py-1 ${
              mode === "login" ? "bg-neutral-900 text-white" : "bg-neutral-100"
            }`}
            onClick={() => setMode("login")}
          >
            ログイン
          </button>
          <button
            className={`rounded px-3 py-1 ${
              mode === "signup" ? "bg-neutral-900 text-white" : "bg-neutral-100"
            }`}
            onClick={() => setMode("signup")}
          >
            新規登録
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          {mode === "signup" && (
            <input
              type="text"
              required
              placeholder="氏名"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          )}
          <input
            type="email"
            required
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="パスワード（6文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {mode === "signup" ? "登録する" : "ログイン"}
          </button>
        </form>
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-sm text-neutral-400">
        {errorMsg ?? "プロフィールを準備しています…"}
      </div>
    );
  }

  return <>{children(profile, signOut)}</>;
}
