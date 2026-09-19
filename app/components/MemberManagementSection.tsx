"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { currentGrade, Location, locationLabel, locations } from "../lib/types";
import type { Profile } from "./AuthGate";

type RosterRoleChoice =
  | "coach"
  | "captain"
  | "vice_captain"
  | "leader"
  | "manager"
  | "member";

const rosterRoleLabel: Record<RosterRoleChoice, string> = {
  coach: "管理者（コーチ）",
  captain: "主将",
  vice_captain: "副主将",
  leader: "リーダー",
  manager: "マネージャー",
  member: "役職なし",
};

type MemberRoleForEdit =
  | "coach"
  | "captain"
  | "vice_captain"
  | "leader"
  | "vice_leader"
  | "manager"
  | "member"
  | "ob";

const memberRoleEditLabel: Record<MemberRoleForEdit, string> = {
  coach: "管理者（コーチ）",
  captain: "主将",
  vice_captain: "副主将",
  leader: "リーダー",
  vice_leader: "副リーダー",
  manager: "マネージャー",
  member: "役職なし",
  ob: "OB(引退)",
};

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
  role: MemberRoleForEdit;
};

type RosterRow = {
  id: string;
  display_name: string;
  email: string | null;
  role: RosterRoleChoice;
  home_location: Location | null;
  entry_year: number | null;
  claimed_by: string | null;
  token: string;
};

// 「メンバー情報の編集」「新規メンバー登録」の両方で使うデータ読み込み・保存ロジックをまとめたフック。
// 設定ページ側で2つの独立した折りたたみセクションとして表示できるよう、
// コンポーネントを分けた上でそれぞれこのフックを呼び出す構成にしている。
function useMemberManagement(profile: Profile) {
  const supabase = createClient();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showRoleLocationEdit, setShowRoleLocationEdit] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<
    Record<string, { role: MemberRoleForEdit; home_location: Location }>
  >({});

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterName, setRosterName] = useState("");
  const [rosterEmail, setRosterEmail] = useState("");
  const [rosterLocation, setRosterLocation] = useState<Location>("tama");
  const [rosterEntryYear, setRosterEntryYear] = useState("");
  const [rosterRole, setRosterRole] = useState<RosterRoleChoice>("member");
  const [savingRoster, setSavingRoster] = useState(false);

  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);

  const rosterEntryYearOptions: number[] = (() => {
    const now = new Date();
    const newAcademicYearStarted =
      now.getMonth() > 2 || (now.getMonth() === 2 && now.getDate() >= 15);
    const academicYear = newAcademicYearStarted
      ? now.getFullYear()
      : now.getFullYear() - 1;
    return Array.from({ length: 4 }, (_, i) => academicYear - i);
  })();

  useEffect(() => {
    loadMembers();
    loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, entry_year, role")
      .eq("team_id", profile.team_id)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((data ?? []) as MemberRow[]);
    }
    setLoadingMembers(false);
  }

  async function handleSaveMemberEdit(memberId: string) {
    const draft = draftEdits[memberId];
    if (!draft) return;
    setSavingRoleId(memberId);
    const { error } = await supabase
      .from("profiles")
      .update({ role: draft.role, home_location: draft.home_location })
      .eq("id", memberId);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? { ...m, role: draft.role, home_location: draft.home_location }
            : m
        )
      );
      setDraftEdits((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
    }
    setSavingRoleId(null);
  }

  async function handleDeleteMember(memberId: string, displayName: string) {
    if (memberId === profile.id) {
      setErrorMsg("自分自身は削除できません。");
      return;
    }
    if (
      !window.confirm(
        `${displayName}さんを本当に削除しますか？\nこの操作は元に戻せません。提出済みの記録も全て削除されます。`
      )
    )
      return;
    setSavingRoleId(memberId);
    setErrorMsg(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setErrorMsg("認証情報が確認できませんでした。もう一度ログインし直してください。");
      setSavingRoleId(null);
      return;
    }

    try {
      const res = await fetch("/api/admin/delete-member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.error ?? "削除に失敗しました。");
      } else {
        setMembers((prev) => prev.filter((m) => m.id !== memberId));
        setDraftEdits((prev) => {
          const next = { ...prev };
          delete next[memberId];
          return next;
        });
      }
    } catch {
      setErrorMsg("削除に失敗しました。通信環境を確認してください。");
    }
    setSavingRoleId(null);
  }

  async function loadRoster() {
    setLoadingRoster(true);
    const { data, error } = await supabase
      .from("member_roster")
      .select(
        "id, display_name, email, role, home_location, entry_year, claimed_by, token"
      )
      .eq("team_id", profile.team_id)
      .is("claimed_by", null)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setRoster((data ?? []) as RosterRow[]);
    }
    setLoadingRoster(false);
  }

  async function handleAddRoster(e: React.FormEvent) {
    e.preventDefault();
    if (!rosterName.trim()) return;
    setSavingRoster(true);

    const { error } = await supabase.from("member_roster").insert({
      team_id: profile.team_id,
      display_name: rosterName.trim(),
      email: rosterEmail.trim() || null,
      role: rosterRole,
      home_location:
        rosterRole === "coach" || rosterRole === "manager"
          ? null
          : rosterLocation,
      entry_year:
        rosterRole === "coach" || rosterRole === "manager" || !rosterEntryYear
          ? null
          : Number(rosterEntryYear),
      created_by: profile.id,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setRosterName("");
      setRosterEmail("");
      setRosterEntryYear("");
      setRosterRole("member");
      setRosterLocation("tama");
      await loadRoster();
    }
    setSavingRoster(false);
  }

  function handleStartEditEmail(row: RosterRow) {
    setEditingEmailId(row.id);
    setEditingEmailValue(row.email ?? "");
  }

  async function handleSaveEmail(id: string) {
    setSavingEmail(true);
    const { error } = await supabase
      .from("member_roster")
      .update({ email: editingEmailValue.trim() || null })
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setEditingEmailId(null);
      setEditingEmailValue("");
      await loadRoster();
    }
    setSavingEmail(false);
  }

  async function handleCopyInviteLink(row: RosterRow) {
    const url = `${window.location.origin}/?invite=${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTokenId(row.id);
      setTimeout(() => setCopiedTokenId(null), 2000);
    } catch {
      window.prompt("このリンクをコピーしてください", url);
    }
  }

  async function handleDeleteRoster(id: string) {
    if (!window.confirm("この事前登録を削除しますか？")) return;
    const { error } = await supabase
      .from("member_roster")
      .delete()
      .eq("id", id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadRoster();
    }
  }

  // 新規メンバー登録欄の並び順：コーチを先頭に、その後は学年（上級生から）→拠点の順
  const sortedRoster = [...roster]
    .filter((r) => !r.claimed_by)
    .sort((a, b) => {
      if (a.role === "coach" && b.role !== "coach") return -1;
      if (b.role === "coach" && a.role !== "coach") return 1;
      const gradeA = a.entry_year != null ? currentGrade(a.entry_year) : -1;
      const gradeB = b.entry_year != null ? currentGrade(b.entry_year) : -1;
      if (gradeA !== gradeB) return gradeB - gradeA;
      const locA = a.home_location ?? "";
      const locB = b.home_location ?? "";
      if (locA !== locB) return locA.localeCompare(locB);
      return a.display_name.localeCompare(b.display_name, "ja");
    });

  return {
    errorMsg,
    members,
    loadingMembers,
    showRoleLocationEdit,
    setShowRoleLocationEdit,
    savingRoleId,
    draftEdits,
    setDraftEdits,
    handleSaveMemberEdit,
    handleDeleteMember,
    roster,
    loadingRoster,
    sortedRoster,
    rosterName,
    setRosterName,
    rosterEmail,
    setRosterEmail,
    rosterLocation,
    setRosterLocation,
    rosterEntryYear,
    setRosterEntryYear,
    rosterRole,
    setRosterRole,
    rosterEntryYearOptions,
    savingRoster,
    handleAddRoster,
    editingEmailId,
    setEditingEmailId,
    editingEmailValue,
    setEditingEmailValue,
    savingEmail,
    handleStartEditEmail,
    handleSaveEmail,
    copiedTokenId,
    handleCopyInviteLink,
    handleDeleteRoster,
  };
}

/** 部員の役職・拠点を編集する一覧（設定ページの「メンバー情報の編集」欄の中身） */
export function MemberRoleEditSection({ profile }: { profile: Profile }) {
  const s = useMemberManagement(profile);

  return (
    <div className="flex flex-col gap-2">
      {s.errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {s.errorMsg}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {s.showRoleLocationEdit
            ? "役職は主将・副主将・リーダー・副リーダー・役職なし、拠点は多摩・大塚から選べます。変更したら部員ごとに「保存する」を押してください。"
            : "部員の役職・所属拠点を確認・編集できます。"}
        </p>
        <button
          onClick={() => {
            s.setShowRoleLocationEdit((v) => !v);
            s.setDraftEdits({});
          }}
          className="shrink-0 rounded border border-neutral-400 px-2.5 py-1 text-[11px] text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
        >
          {s.showRoleLocationEdit ? "閉じる" : "編集する"}
        </button>
      </div>
      {s.loadingMembers ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : s.members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-400 p-4 text-xs text-neutral-500 dark:border-neutral-700">
          部員が登録されていません。
        </p>
      ) : !s.showRoleLocationEdit ? (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border-color">
          <ul className="divide-y divide-border-color">
            {s.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
              >
                <span className="font-medium text-foreground">
                  {m.display_name}
                </span>
                <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                  <span className="rounded bg-surface-2 px-2 py-1">
                    {m.home_location
                      ? locationLabel[m.home_location]
                      : "拠点未設定"}
                  </span>
                  <span className="rounded bg-surface-2 px-2 py-1">
                    {memberRoleEditLabel[m.role]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border-color">
          <ul className="divide-y divide-border-color">
            {s.members.map((m) => {
              const draft = s.draftEdits[m.id];
              const currentRole = draft?.role ?? m.role;
              const currentLocation =
                draft?.home_location ?? m.home_location ?? "tama";
              const isDirty = !!draft;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <span className="font-medium text-foreground">
                    {m.display_name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={currentLocation}
                      disabled={s.savingRoleId === m.id}
                      onChange={(e) =>
                        s.setDraftEdits((prev) => ({
                          ...prev,
                          [m.id]: {
                            role: prev[m.id]?.role ?? m.role,
                            home_location: e.target.value as Location,
                          },
                        }))
                      }
                      className="rounded border border-border-color bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {locations.map((loc) => (
                        <option key={loc} value={loc}>
                          {locationLabel[loc]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={currentRole}
                      disabled={s.savingRoleId === m.id}
                      onChange={(e) =>
                        s.setDraftEdits((prev) => ({
                          ...prev,
                          [m.id]: {
                            role: e.target.value as MemberRoleForEdit,
                            home_location:
                              prev[m.id]?.home_location ??
                              m.home_location ??
                              "tama",
                          },
                        }))
                      }
                      className="rounded border border-border-color bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {(
                        Object.keys(memberRoleEditLabel) as MemberRoleForEdit[]
                      ).map((r) => (
                        <option key={r} value={r}>
                          {memberRoleEditLabel[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => s.handleSaveMemberEdit(m.id)}
                      disabled={!isDirty || s.savingRoleId === m.id}
                      className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white active:bg-red-700 disabled:opacity-40"
                    >
                      保存する
                    </button>
                    <button
                      onClick={() => s.handleDeleteMember(m.id, m.display_name)}
                      disabled={s.savingRoleId === m.id}
                      className="rounded border border-red-700 px-2.5 py-1 text-[11px] font-medium text-red-600 active:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:active:bg-red-950/40"
                    >
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 新規メンバーの事前登録（設定ページの「新規メンバー登録」欄の中身） */
export function NewMemberRegistrationSection({ profile }: { profile: Profile }) {
  const s = useMemberManagement(profile);

  return (
    <div className="flex flex-col gap-2">
      {s.errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {s.errorMsg}
        </p>
      )}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        部員だけでなく、管理者・マネージャーもここから事前登録できます。氏名とメールアドレスをあらかじめ登録しておくと、本人がそのメールアドレスで新規登録した際に、氏名・拠点・学年・役職が自動で反映されます。
      </p>

      {s.loadingRoster ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : s.roster.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-400 p-4 text-xs text-neutral-500 dark:border-neutral-700">
          まだ事前登録がありません。
        </p>
      ) : (
        <ul className="divide-y divide-border-color rounded-lg border border-border-color">
          {s.sortedRoster.map((r) => (
            <li key={r.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">
                      {r.display_name}
                    </span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-400">
                      {rosterRoleLabel[r.role]}
                    </span>
                    {r.home_location && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-neutral-600 dark:text-neutral-400">
                        {locationLabel[r.home_location]}
                      </span>
                    )}
                  </span>
                  {s.editingEmailId !== r.id &&
                    (r.email ? (
                      <span className="truncate text-neutral-500 dark:text-neutral-500">
                        {r.email}
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400">
                        メール未設定
                      </span>
                    ))}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:text-neutral-400">
                    未登録
                  </span>
                  <button
                    onClick={() => s.handleDeleteRoster(r.id)}
                    className="text-red-600 dark:text-red-500"
                  >
                    削除
                  </button>
                </div>
              </div>

              {s.editingEmailId === r.id ? (
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    autoFocus
                    placeholder="メールアドレス"
                    value={s.editingEmailValue}
                    onChange={(e) => s.setEditingEmailValue(e.target.value)}
                    className="flex-1 rounded border border-border-color bg-background px-2 py-1 text-xs text-foreground"
                  />
                  <button
                    onClick={() => s.handleSaveEmail(r.id)}
                    disabled={s.savingEmail}
                    className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => s.setEditingEmailId(null)}
                    className="rounded border border-border-color px-2.5 py-1 text-[11px] text-neutral-600 dark:text-neutral-300"
                  >
                    キャンセル
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => s.handleStartEditEmail(r)}
                    className="text-[11px] font-medium text-neutral-600 underline dark:text-neutral-400"
                  >
                    {r.email ? "メールを編集" : "メールを追加"}
                  </button>
                  {!r.claimed_by && (
                    <button
                      onClick={() => s.handleCopyInviteLink(r)}
                      className="text-[11px] font-medium text-blue-600 underline dark:text-blue-400"
                    >
                      {s.copiedTokenId === r.id
                        ? "コピーしました！"
                        : "招待リンクをコピー"}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={s.handleAddRoster}
        className="flex flex-col gap-2 rounded-lg border border-border-color p-3"
      >
        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          1件ずつ登録
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            required
            placeholder="氏名"
            value={s.rosterName}
            onChange={(e) => s.setRosterName(e.target.value)}
            className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
          />
          <input
            type="email"
            placeholder="メールアドレス（あとで追加可）"
            value={s.rosterEmail}
            onChange={(e) => s.setRosterEmail(e.target.value)}
            className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={s.rosterRole}
            onChange={(e) => s.setRosterRole(e.target.value as RosterRoleChoice)}
            className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {(Object.keys(rosterRoleLabel) as RosterRoleChoice[]).map((r) => (
              <option key={r} value={r}>
                {rosterRoleLabel[r]}
              </option>
            ))}
          </select>
          {s.rosterRole !== "coach" && s.rosterRole !== "manager" && (
            <select
              value={s.rosterLocation}
              onChange={(e) => s.setRosterLocation(e.target.value as Location)}
              className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
            >
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {locationLabel[loc]}
                </option>
              ))}
            </select>
          )}
        </div>
        {s.rosterRole !== "coach" && s.rosterRole !== "manager" && (
          <select
            value={s.rosterEntryYear}
            onChange={(e) => s.setRosterEntryYear(e.target.value)}
            className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="">入学年を選択</option>
            {s.rosterEntryYearOptions.map((y) => (
              <option key={y} value={y}>
                {y}年入学（現在{currentGrade(y)}年）
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          disabled={s.savingRoster}
          className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          追加する
        </button>
      </form>
    </div>
  );
}
