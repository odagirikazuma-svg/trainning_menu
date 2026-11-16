"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  locations,
  memberRoleText,
  type Role,
  roleLabel,
  type TeamPosition,
  teamPositionLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";
import JoinLinkCard from "./JoinLinkCard";

const roleChoiceLabel: Record<Role, string> = {
  coach: "管理者（監督・コーチ）",
  manager: "マネージャー",
  member: "部員",
  ob: "OB（引退）",
};
// 選べる役割：マネージャーは管理者を選べない
const roleChoices = (me: Role): Role[] =>
  me === "coach" ? ["coach", "manager", "member", "ob"] : ["manager", "member", "ob"];

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
  role: Role;
  team_position: TeamPosition | null;
};

type RosterRow = {
  id: string;
  display_name: string;
  email: string | null;
  role: Role;
  team_position: TeamPosition | null;
  home_location: Location | null;
  entry_year: number | null;
  claimed_by: string | null;
  token: string;
};

type Draft = { role: Role; team_position: TeamPosition | null; home_location: Location };

// 役割＋役職の表示（例：部員・主将）
function roleBadge(role: Role, position: TeamPosition | null) {
  return role === "member" && position ? `部員・${teamPositionLabel[position]}` : roleChoiceLabel[role] ?? memberRoleText(role);
}

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
    Record<string, Draft>
  >({});

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterName, setRosterName] = useState("");
  const [rosterEmail, setRosterEmail] = useState("");
  const [rosterLocation, setRosterLocation] = useState<Location>("tama");
  const [rosterEntryYear, setRosterEntryYear] = useState("");
  const [rosterRole, setRosterRole] = useState<Role>("member");
  const [rosterPosition, setRosterPosition] = useState<TeamPosition | "">("");
  // 管理者でない（マネージャー）は、管理者の行を変更・削除できない
  const canTouch = (role: Role) => profile.role === "coach" || role !== "coach";
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
      .select("id, display_name, home_location, entry_year, role, team_position")
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
      .update({
        role: draft.role,
        team_position: draft.role === "member" ? draft.team_position : null,
        home_location: draft.home_location,
      })
      .eq("id", memberId);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? {
                ...m,
                role: draft.role,
                team_position: draft.role === "member" ? draft.team_position : null,
                home_location: draft.home_location,
              }
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
        "id, display_name, email, role, team_position, home_location, entry_year, claimed_by, token"
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
      team_position: rosterRole === "member" && rosterPosition ? rosterPosition : null,
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
      setRosterPosition("");
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
    rosterPosition,
    setRosterPosition,
    canTouch,
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
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {s.errorMsg}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
          {s.showRoleLocationEdit
            ? "役割（管理者・マネージャー・部員・OB）と、部員なら役職（主将・副主将）、拠点を選べます。変更したら人ごとに「保存する」を押してください。"
            : "メンバーの役割・役職・所属拠点を確認・編集できます。"}
        </p>
        <button
          onClick={() => {
            s.setShowRoleLocationEdit((v) => !v);
            s.setDraftEdits({});
          }}
          className="shrink-0 rounded border border-neutral-400 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
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
                    {roleBadge(m.role, m.team_position)}
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
              const cur: Draft = draft ?? {
                role: m.role,
                team_position: m.team_position,
                home_location: m.home_location ?? "tama",
              };
              const isDirty = !!draft;
              const set = (patch: Partial<Draft>) =>
                s.setDraftEdits((prev) => ({ ...prev, [m.id]: { ...cur, ...patch } }));
              if (!s.canTouch(m.role)) {
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
                    <span className="font-medium text-foreground">{m.display_name}</span>
                    <span className="text-neutral-500">{roleBadge(m.role, m.team_position)}（管理者だけが変更できます）</span>
                  </li>
                );
              }
              const sel =
                "rounded border border-border-color bg-background px-2 py-1 text-xs text-foreground";
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <span className="font-medium text-foreground">
                    {m.display_name}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={cur.home_location}
                      disabled={s.savingRoleId === m.id}
                      onChange={(e) => set({ home_location: e.target.value as Location })}
                      className={sel}
                      aria-label="拠点"
                    >
                      {locations.map((loc) => (
                        <option key={loc} value={loc}>
                          {locationLabel[loc]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={cur.role}
                      disabled={s.savingRoleId === m.id || m.id === profile.id}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        set({ role, team_position: role === "member" ? cur.team_position : null });
                      }}
                      className={sel}
                      aria-label="役割"
                    >
                      {roleChoices(profile.role).map((r) => (
                        <option key={r} value={r}>
                          {roleLabel[r]}
                        </option>
                      ))}
                    </select>
                    {cur.role === "member" && (
                      <select
                        value={cur.team_position ?? ""}
                        disabled={s.savingRoleId === m.id}
                        onChange={(e) => set({ team_position: (e.target.value || null) as TeamPosition | null })}
                        className={sel}
                        aria-label="役職"
                      >
                        <option value="">役職なし</option>
                        <option value="captain">主将</option>
                        <option value="vice_captain">副主将</option>
                      </select>
                    )}
                    <button
                      onClick={() => s.handleSaveMemberEdit(m.id)}
                      disabled={!isDirty || s.savingRoleId === m.id}
                      className="rounded bg-red-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-medium text-white active:bg-red-700 disabled:opacity-40"
                    >
                      保存する
                    </button>
                    {m.id !== profile.id && (
                      <button
                        onClick={() => s.handleDeleteMember(m.id, m.display_name)}
                        disabled={s.savingRoleId === m.id}
                        className="rounded border border-red-700 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-medium text-red-600 active:bg-red-100 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:active:bg-red-950/40"
                      >
                        削除
                      </button>
                    )}
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
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">
          {s.errorMsg}
        </p>
      )}
      <JoinLinkCard />
      <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
        名簿（管理者・マネージャー・部員・OB）。ここに登録した人だけが、参加リンクから自分の名前を選んで登録できます。
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
                      {roleBadge(r.role, r.team_position)}
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
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-medium text-neutral-600 dark:text-neutral-400">
                    未登録
                  </span>
                  {s.canTouch(r.role) && (
                    <button
                      onClick={() => s.handleDeleteRoster(r.id)}
                      className="text-red-600 dark:text-red-500"
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>

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

        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={s.rosterRole}
            onChange={(e) => {
              s.setRosterRole(e.target.value as Role);
              s.setRosterPosition("");
            }}
            className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
            aria-label="役割"
          >
            {roleChoices(profile.role).map((r) => (
              <option key={r} value={r}>
                {roleChoiceLabel[r]}
              </option>
            ))}
          </select>
          {s.rosterRole === "member" && (
            <select
              value={s.rosterPosition}
              onChange={(e) => s.setRosterPosition(e.target.value as TeamPosition | "")}
              className="rounded border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
              aria-label="役職"
            >
              <option value="">役職なし</option>
              <option value="captain">主将</option>
              <option value="vice_captain">副主将</option>
            </select>
          )}
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
