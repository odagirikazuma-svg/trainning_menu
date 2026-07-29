"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";
import { currentGrade, Location, locationLabel, locations, Role } from "../lib/types";

export type Profile = {
  id: string;
  team_id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  entry_year: number | null;
};

type SignupCategory = "member" | "coach" | "manager";
type SignupRoleChoice = "captain" | "vice_leader" | "leader" | "member";

const roleChoiceLabel: Record<SignupRoleChoice, string> = {
  captain: "主将",
  vice_leader: "副主将",
  leader: "リーダー",
  member: "役職なし",
};

// member_rosterテーブルのroleカラムの値を表示用に変換する
const rosterRoleDisplayLabel: Record<string, string> = {
  captain: "主将",
  vice_captain: "副主将",
  coach: "管理者",
  manager: "マネージャー",
  member: "役職なし",
};

// 直近4年分を入学年の候補にする
const entryYearOptions: number[] = (() => {
  const now = new Date();
  const academicYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 4 }, (_, i) => academicYear - i);
})();

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
  const [signupEntryYear, setSignupEntryYear] = useState("");
  const [signupRoleChoice, setSignupRoleChoice] =
    useState<SignupRoleChoice>("member");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [rosterPreview, setRosterPreview] = useState<
    | {
        display_name: string;
        role: string;
        home_location: Location | null;
        entry_year: number | null;
      }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) {
      setInviteToken(token);
      setMode("signup");
    }
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      const { data } = await supabase
        .from("member_roster")
        .select("display_name, role, home_location, entry_year")
        .eq("token", inviteToken)
        .is("claimed_by", null)
        .maybeSingle();
      setRosterPreview(data ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

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
      .select("id, team_id, display_name, role, home_location, entry_year")
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

    // 初回ログイン時：まず「招待リンク」のトークン、次に自分のメールアドレスに
    // 一致する「部員の事前登録」がないか確認する。あれば、その内容
    // （氏名・拠点・入学年・役職・チーム）を優先的に使ってプロフィールを作成する。
    const userEmail = session.user.email ?? null;
    const meta0 = session.user.user_metadata as Record<string, unknown>;
    const inviteToken = (meta0?.invite_token as string | undefined) ?? null;
    type RosterMatch = {
      id: string;
      team_id: string;
      display_name: string;
      role: SignupRoleChoice | "coach" | "manager";
      home_location: Location | null;
      entry_year: number | null;
    };
    let rosterMatch: RosterMatch | null = null;

    if (inviteToken) {
      const { data: rosterRow } = await supabase
        .from("member_roster")
        .select("id, team_id, display_name, role, home_location, entry_year")
        .eq("token", inviteToken)
        .is("claimed_by", null)
        .maybeSingle();
      if (rosterRow) {
        rosterMatch = rosterRow as unknown as RosterMatch;
      }
    }

    if (!rosterMatch && userEmail) {
      const { data: rosterRow } = await supabase
        .from("member_roster")
        .select("id, team_id, display_name, role, home_location, entry_year")
        .ilike("email", userEmail)
        .is("claimed_by", null)
        .maybeSingle();
      if (rosterRow) {
        rosterMatch = rosterRow as unknown as RosterMatch;
      }
    }

    let teamId: string;

    if (rosterMatch) {
      teamId = rosterMatch.team_id;
    } else {
      // 事前登録が無い場合は、デフォルトチームに参加する
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
      teamId = team.id;
    }

    const meta = session.user.user_metadata as Record<string, unknown>;
    const metaCategory = meta?.category as SignupCategory | undefined;
    const metaRole =
      metaCategory === "coach"
        ? "coach"
        : metaCategory === "manager"
          ? "manager"
          : ((meta?.role_choice as SignupRoleChoice | undefined) ?? "member");
    const metaLocation =
      metaCategory === "member"
        ? ((meta?.home_location as Location | undefined) ?? null)
        : null;
    const metaEntryYear =
      metaCategory === "member"
        ? ((meta?.entry_year as number | undefined) ?? null)
        : null;

    const { data: created, error } = await supabase
      .from("profiles")
      .insert({
        id: session.user.id,
        team_id: teamId,
        display_name:
          rosterMatch?.display_name ||
          (meta?.display_name as string | undefined) ||
          session.user.email?.split("@")[0] ||
          "名無し",
        role: rosterMatch?.role ?? metaRole,
        home_location: rosterMatch
          ? rosterMatch.home_location
          : metaLocation,
        entry_year: rosterMatch ? rosterMatch.entry_year : metaEntryYear,
      })
      .select("id, team_id, display_name, role, home_location, entry_year")
      .single();

    if (error) {
      setErrorMsg(`プロフィール作成に失敗しました: ${error.message}`);
      return;
    }

    // 事前登録があった場合は「紐付け済み」にする
    if (rosterMatch) {
      await supabase
        .from("member_roster")
        .update({ claimed_by: created.id })
        .eq("id", rosterMatch.id);
    }

    setProfile(created as Profile);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    if (mode === "signup") {
      const usingRosterPreview = Boolean(inviteToken && rosterPreview);
      if (!usingRosterPreview) {
        if (!signupCategory) {
          setErrorMsg("部員か管理者かマネージャーを選択してください。");
          setSubmitting(false);
          return;
        }
        if (signupCategory === "member" && !signupLocation) {
          setErrorMsg("所属拠点を選択してください。");
          setSubmitting(false);
          return;
        }
        if (signupCategory === "member" && !signupEntryYear) {
          setErrorMsg("入学年を選択してください。");
          setSubmitting(false);
          return;
        }
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: usingRosterPreview
            ? {
                display_name: rosterPreview!.display_name,
                invite_token: inviteToken,
              }
            : {
                display_name: displayName,
                category: signupCategory,
                home_location:
                  signupCategory === "member" ? signupLocation : null,
                entry_year:
                  signupCategory === "member" ? Number(signupEntryYear) : null,
                role_choice:
                  signupCategory === "member" ? signupRoleChoice : null,
                invite_token: inviteToken,
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
    return <div className="p-8 text-sm text-neutral-500">読み込み中…</div>;
  }

  if (!session) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 bg-neutral-950 p-6 text-neutral-200">
        <h1 className="flex items-center gap-2 text-lg font-bold text-white">
          <span className="inline-block h-5 w-1.5 rounded-full bg-red-600" />
          練習ノート ログイン
        </h1>
        {inviteToken && rosterPreview && (
          <p className="rounded bg-emerald-950/40 p-2 text-xs text-emerald-400">
            招待リンクから開いています。以下の内容で登録されます。
          </p>
        )}
        {inviteToken && rosterPreview === null && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            この招待リンクは無効か、すでに使用されています。通常の新規登録を行ってください。
          </p>
        )}
        <div className="flex gap-2 text-xs">
          <button
            className={`rounded px-3 py-1 ${
              mode === "login" ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-600"
            }`}
            onClick={() => setMode("login")}
          >
            ログイン
          </button>
          <button
            className={`rounded px-3 py-1 ${
              mode === "signup" ? "bg-red-600 text-white" : "bg-neutral-800 text-neutral-600"
            }`}
            onClick={() => setMode("signup")}
          >
            新規登録
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "signup" && inviteToken && rosterPreview ? (
            <div className="flex flex-col gap-1 rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-neutral-200">
              <p>
                氏名: <span className="font-medium">{rosterPreview.display_name}</span>
              </p>
              <p>
                区分:{" "}
                <span className="font-medium">
                  {rosterPreview.role === "coach"
                    ? "管理者"
                    : rosterPreview.role === "manager"
                      ? "マネージャー"
                      : "部員"}
                </span>
              </p>
              {rosterPreview.home_location && (
                <p>
                  所属拠点:{" "}
                  <span className="font-medium">
                    {locationLabel[rosterPreview.home_location]}
                  </span>
                </p>
              )}
              {rosterPreview.entry_year && (
                <p>
                  入学年:{" "}
                  <span className="font-medium">
                    {rosterPreview.entry_year}年（現在
                    {currentGrade(rosterPreview.entry_year)}年）
                  </span>
                </p>
              )}
              <p>
                役職:{" "}
                <span className="font-medium">
                  {rosterRoleDisplayLabel[rosterPreview.role] ?? "役職なし"}
                </span>
              </p>
            </div>
          ) : (
            mode === "signup" && (
              <>
                <input
                  type="text"
                  required
                  placeholder="氏名"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-neutral-400">区分</span>
                  <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
                    {(
                      [
                        { v: "member", label: "部員" },
                        { v: "coach", label: "管理者" },
                        { v: "manager", label: "マネージャー" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setSignupCategory(opt.v)}
                        className={`flex-1 rounded-md py-2 font-medium ${
                          signupCategory === opt.v
                            ? "bg-red-600 text-white shadow"
                            : "text-neutral-400"
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
                      <span className="text-[11px] text-neutral-400">
                        所属拠点
                      </span>
                      <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
                        {locations.map((loc) => (
                          <button
                            key={loc}
                            type="button"
                            onClick={() => setSignupLocation(loc)}
                            className={`flex-1 rounded-md py-2 font-medium ${
                              signupLocation === loc
                                ? "bg-red-600 text-white shadow"
                                : "text-neutral-400"
                            }`}
                          >
                            {locationLabel[loc]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-neutral-400">
                        入学年（学年は自動計算されます）
                      </span>
                      <select
                        value={signupEntryYear}
                        onChange={(e) => setSignupEntryYear(e.target.value)}
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                      >
                        <option value="">選択してください</option>
                        {entryYearOptions.map((y) => (
                          <option key={y} value={y}>
                            {y}年入学（現在{currentGrade(y)}年）
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] text-neutral-400">
                        役職
                      </span>
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
                        {(
                          Object.keys(roleChoiceLabel) as SignupRoleChoice[]
                        ).map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setSignupRoleChoice(v)}
                            className={`rounded-md py-2 font-medium ${
                              signupRoleChoice === v
                                ? "bg-red-600 text-white shadow"
                                : "text-neutral-400"
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
            )
          )}
          <input
            type="email"
            required
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="パスワード（6文字以上）"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
          />
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >
            {mode === "signup" ? "登録する" : "ログイン"}
          </button>
        </form>
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-sm text-neutral-500">
        {errorMsg ?? "プロフィールを準備しています…"}
      </div>
    );
  }

  return <>{children(profile, signOut)}</>;
}
