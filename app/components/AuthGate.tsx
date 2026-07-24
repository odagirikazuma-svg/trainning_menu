"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";
import { Location, locationLabel, locations, Role } from "../lib/types";

export type Profile = {
  id: string;
  team_id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  grade: string | null;
};

type SignupCategory = "member" | "coach";
type SignupRoleChoice = "captain" | "vice_leader" | "leader" | "member";

const roleChoiceLabel: Record<SignupRoleChoice, string> = {
  captain: "主将",
  vice_leader: "副主将",
  leader: "リーダー",
  member: "役職なし",
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
  const [signupCategory, setSignupCategory] = useState<SignupCategory | "">("");
  const [signupLocation, setSignupLocation] = useState<Location | "">("");
  const [signupGrade, setSignupGrade] = useState("");
  const [signupRoleChoice, setSignupRoleChoice] =
    useState<SignupRoleChoice>("member");
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
      .select("id, team_id, display_name, role, home_location, grade")
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

    // 初回ログイン時：デフォルトチームに参加
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

    const meta = session.user.user_metadata as Record<string, unknown>;
    const metaCategory = meta?.category as SignupCategory | undefined;
    const metaRole =
      metaCategory === "coach"
        ? "coach"
        : ((meta?.role_choice as SignupRoleChoice | undefined) ?? "member");
    const metaLocation =
      metaCategory === "member"
        ? ((meta?.home_location as Location | undefined) ?? null)
        : null;
    const metaGrade =
      metaCategory === "member" ? ((meta?.grade as string | undefined) ?? null) : null;

    const { data: created, error } = await supabase
      .from("profiles")
      .insert({
        id: session.user.id,
        team_id: team.id,
        display_name:
          (meta?.display_name as string | undefined) ||
          session.user.email?.split("@")[0] ||
          "名無し",
        role: metaRole,
        home_location: metaLocation,
        grade: metaGrade,
      })
      .select("id, team_id, display_name, role, home_location, grade")
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
      if (!signupCategory) {
        setErrorMsg("部員かコーチかを選択してください。");
        setSubmitting(false);
        return;
      }
      if (signupCategory === "member" && !signupLocation) {
        setErrorMsg("所属拠点を選択してください。");
        setSubmitting(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
            category: signupCategory,
            home_location: signupCategory === "member" ? signupLocation : null,
            grade: signupCategory === "member" ? signupGrade : null,
            role_choice: signupCategory === "member" ? signupRoleChoice : null,
          },
        },
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
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <>
              <input
                type="text"
                required
                placeholder="氏名"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
              />

              <div className="flex flex-col gap-1">
                <span className="text-[11px] text-neutral-500">区分</span>
                <div className="flex gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
                  {(
                    [
                      { v: "member", label: "部員" },
                      { v: "coach", label: "コーチ" },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setSignupCategory(opt.v)}
                      className={`flex-1 rounded-md py-2 font-medium ${
                        signupCategory === opt.v
                          ? "bg-white text-neutral-900 shadow"
                          : "text-neutral-500"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {signupCategory === "member" && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">
                      所属拠点
                    </span>
                    <div className="flex gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
                      {locations.map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => setSignupLocation(loc)}
                          className={`flex-1 rounded-md py-2 font-medium ${
                            signupLocation === loc
                              ? "bg-white text-neutral-900 shadow"
                              : "text-neutral-500"
                          }`}
                        >
                          {locationLabel[loc]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <input
                    type="text"
                    placeholder="学年（例：2年）"
                    value={signupGrade}
                    onChange={(e) => setSignupGrade(e.target.value)}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">役職</span>
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
                      {(
                        Object.keys(roleChoiceLabel) as SignupRoleChoice[]
                      ).map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSignupRoleChoice(v)}
                          className={`rounded-md py-2 font-medium ${
                            signupRoleChoice === v
                              ? "bg-white text-neutral-900 shadow"
                              : "text-neutral-500"
                          }`}
                        >
                          {roleChoiceLabel[v]}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
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
