"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { currentGrade, Location, locationLabel, locations, teamEventTypeLabel, TeamEventType } from "../lib/types";
import type { Profile } from "./AuthGate";

type RosterRoleChoice = "captain" | "vice_captain" | "coach" | "manager" | "member";

const rosterRoleLabel: Record<RosterRoleChoice, string> = {
  captain: "主将",
  vice_captain: "副主将",
  coach: "管理者",
  manager: "マネージャー",
  member: "役職なし",
};

type MemberRoleForEdit = "captain" | "vice_captain" | "leader" | "vice_leader" | "manager" | "member";

const memberRoleEditLabel: Record<MemberRoleForEdit, string> = {
  captain: "主将",
  vice_captain: "副主将",
  leader: "リーダー",
  vice_leader: "副リーダー",
  manager: "マネージャー",
  member: "役職なし",
};

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
  role: MemberRoleForEdit;
};

type InjuryRow = {
  id: string;
  author_id: string;
  symptom_name: string;
  body_part: string;
  detail: string | null;
  expected_recovery_date: string | null;
  surgery_possibility: "yes" | "no" | "unknown";
  next_hospital_date: string | null;
  mat_participation: "yes" | "no" | "conditional";
  mat_participation_detail: string | null;
  is_recovered: boolean;
  progress_note: string | null;
  progress_updated_at: string | null;
  created_at: string;
  author: { display_name: string } | null;
};

const matParticipationLabel: Record<"yes" | "no" | "conditional", string> = {
  yes: "可",
  no: "非",
  conditional: "条件付きで可",
};

type WeightMaxEventRow = {
  id: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
};

type TeamEventRow = {
  id: string;
  type: TeamEventType;
  title: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
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

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

export default function CoachAdminPage({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const [weightMaxEvent, setWeightMaxEvent] = useState<
    WeightMaxEventRow | null | undefined
  >(undefined);
  const [weightMaxSubmittedCount, setWeightMaxSubmittedCount] = useState(0);
  const [newDeadline, setNewDeadline] = useState("");
  const [savingWeightMaxEvent, setSavingWeightMaxEvent] = useState(false);

  const [selectedEventType, setSelectedEventType] = useState<
    "weight_max" | TeamEventType
  >("weight_max");
  const [teamEvents, setTeamEvents] = useState<
    Record<TeamEventType, TeamEventRow | null | undefined>
  >({ match_reflection: undefined, body_composition: undefined });
  const [teamEventSubmittedCounts, setTeamEventSubmittedCounts] = useState<
    Record<TeamEventType, number>
  >({ match_reflection: 0, body_composition: 0 });
  const [newEventTitle, setNewEventTitle] = useState("");
  const [savingTeamEvent, setSavingTeamEvent] = useState(false);

  const rosterEntryYearOptions: number[] = (() => {
    const now = new Date();
    const academicYear =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 4 }, (_, i) => academicYear - i);
  })();

  useEffect(() => {
    loadMembers();
    loadRoster();
    loadWeightMaxEvent();
    loadTeamEvents();
    loadInjuries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadInjuries() {
    setLoadingInjuries(true);
    const { data, error } = await supabase
      .from("injuries")
      .select(
        "id, author_id, symptom_name, body_part, detail, expected_recovery_date, surgery_possibility, next_hospital_date, mat_participation, mat_participation_detail, is_recovered, progress_note, progress_updated_at, created_at, author:profiles!injuries_author_id_fkey(display_name)"
      )
      .eq("team_id", profile.team_id)
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setInjuries((data ?? []) as unknown as InjuryRow[]);
    }
    setLoadingInjuries(false);
  }

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, entry_year, role")
      .eq("team_id", profile.team_id)
      .neq("role", "coach")
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((data ?? []) as MemberRow[]);
    }
    setLoadingMembers(false);
  }


  const [showRoleLocationEdit, setShowRoleLocationEdit] = useState(false);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<
    Record<string, { role: MemberRoleForEdit; home_location: Location }>
  >({});

  const [injuries, setInjuries] = useState<InjuryRow[]>([]);
  const [loadingInjuries, setLoadingInjuries] = useState(true);
  const [expandedInjuryId, setExpandedInjuryId] = useState<string | null>(
    null
  );
  const [showPastInjuries, setShowPastInjuries] = useState(false);

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

  async function loadWeightMaxEvent() {
    const { data, error } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at, closed_at")
      .eq("team_id", profile.team_id)
      .is("closed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const event = (data as WeightMaxEventRow | null) ?? null;
    setWeightMaxEvent(event);

    if (event) {
      const { data: maxData, error: maxError } = await supabase
        .from("weight_maxes")
        .select("author_id")
        .eq("team_id", profile.team_id)
        .eq("event_id", event.id);
      if (maxError) {
        setErrorMsg(maxError.message);
      } else {
        setWeightMaxSubmittedCount((maxData ?? []).length);
      }
    }
  }

  async function handleCreateWeightMaxEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeadline) return;
    setSavingWeightMaxEvent(true);

    const { error } = await supabase.from("weight_max_events").insert({
      team_id: profile.team_id,
      deadline: newDeadline,
      created_by: profile.id,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setNewDeadline("");
      await loadWeightMaxEvent();
    }
    setSavingWeightMaxEvent(false);
  }

  async function handleEndWeightMaxEvent() {
    if (!weightMaxEvent) return;
    if (
      !window.confirm(
        "このウェイトMAX集計を終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("weight_max_events")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", weightMaxEvent.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadWeightMaxEvent();
    }
  }

  async function loadTeamEvents() {
    for (const type of ["match_reflection", "body_composition"] as TeamEventType[]) {
      const { data, error } = await supabase
        .from("team_events")
        .select("id, type, title, deadline, created_at, closed_at")
        .eq("team_id", profile.team_id)
        .eq("type", type)
        .is("closed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        setErrorMsg(error.message);
        continue;
      }
      const event = (data as TeamEventRow | null) ?? null;
      setTeamEvents((prev) => ({ ...prev, [type]: event }));

      if (event) {
        const { data: subData, error: subError } = await supabase
          .from("team_event_submissions")
          .select("author_id")
          .eq("event_id", event.id);
        if (subError) {
          setErrorMsg(subError.message);
        } else {
          setTeamEventSubmittedCounts((prev) => ({
            ...prev,
            [type]: (subData ?? []).length,
          }));
        }
      }
    }
  }

  async function handleCreateTeamEvent(
    type: TeamEventType,
    e: React.FormEvent
  ) {
    e.preventDefault();
    if (!newDeadline) return;
    setSavingTeamEvent(true);

    const { error } = await supabase.from("team_events").insert({
      team_id: profile.team_id,
      type,
      title: newEventTitle.trim(),
      deadline: newDeadline,
      created_by: profile.id,
    });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setNewDeadline("");
      setNewEventTitle("");
      await loadTeamEvents();
    }
    setSavingTeamEvent(false);
  }

  async function handleEndTeamEvent(type: TeamEventType) {
    const event = teamEvents[type];
    if (!event) return;
    if (
      !window.confirm(
        "このイベントを終了しますか？（これまでの提出内容はチームページの履歴に残ります）"
      )
    )
      return;
    const { error } = await supabase
      .from("team_events")
      .update({ closed_at: new Date().toISOString() })
      .eq("id", event.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadTeamEvents();
    }
  }

  async function loadRoster() {
    setLoadingRoster(true);
    const { data, error } = await supabase
      .from("member_roster")
      .select(
        "id, display_name, email, role, home_location, entry_year, claimed_by, token"
      )
      .eq("team_id", profile.team_id)
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
  const sortedRoster = [...roster].sort((a, b) => {
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

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          管理ページ
        </h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-400">
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            掲示板に戻る
          </button>
          <button
            onClick={() => router.push("/team")}
            className="rounded border border-neutral-700 px-2.5 py-1.5 active:bg-neutral-800"
          >
            チームページ
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}

        {/* イベントを作成する */}
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            イベントを作成する
          </h2>
          <p className="text-[11px] text-neutral-500">
            締切日を設定すると、部員のマイページの「タスク一覧」に提出タスクが表示されます(期日を過ぎると赤く強調され、提出すると一覧から消えます)。提出内容はチームページで確認できます。
          </p>

          <div className="flex gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
            {(
              [
                ["weight_max", "ウェイトMAX集計"],
                ["match_reflection", "試合の振り返り"],
                ["body_composition", "体組成の提出"],
              ] as [typeof selectedEventType, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedEventType(key)}
                className={`flex-1 rounded-md py-2 font-medium ${
                  selectedEventType === key
                    ? "bg-red-600 text-white shadow"
                    : "text-neutral-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {selectedEventType === "weight_max" ? (
            weightMaxEvent === undefined ? (
              <p className="text-xs text-neutral-500">読み込み中…</p>
            ) : weightMaxEvent ? (
              <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
                <p className="text-sm text-neutral-200">
                  締切:{" "}
                  <span className="font-semibold">
                    {weightMaxEvent.deadline}
                  </span>
                </p>
                <p className="text-xs text-neutral-400">
                  提出済み {weightMaxSubmittedCount}人 /{" "}
                  {members.filter((m) => m.role !== "manager").length}人
                </p>
                <button
                  onClick={handleEndWeightMaxEvent}
                  className="self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                >
                  この集計を終了する
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleCreateWeightMaxEvent}
                className="flex items-end gap-2"
              >
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                  締切日
                  <input
                    type="date"
                    required
                    value={newDeadline}
                    onChange={(e) => setNewDeadline(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingWeightMaxEvent}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                >
                  集計を開始する
                </button>
              </form>
            )
          ) : teamEvents[selectedEventType] === undefined ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : teamEvents[selectedEventType] ? (
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3">
              {teamEvents[selectedEventType]!.title && (
                <p className="text-sm font-semibold text-neutral-100">
                  {teamEvents[selectedEventType]!.title}
                </p>
              )}
              <p className="text-sm text-neutral-200">
                締切:{" "}
                <span className="font-semibold">
                  {teamEvents[selectedEventType]!.deadline}
                </span>
              </p>
              <p className="text-xs text-neutral-400">
                提出済み {teamEventSubmittedCounts[selectedEventType]}人 /{" "}
                {members.filter((m) => m.role !== "manager").length}人
              </p>
              <button
                onClick={() => handleEndTeamEvent(selectedEventType)}
                className="self-start rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
              >
                このイベントを終了する
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => handleCreateTeamEvent(selectedEventType, e)}
              className="flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1 text-[11px] text-neutral-400">
                タイトル(任意。例：関東大会 一回戦)
                <input
                  type="text"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-400">
                  締切日
                  <input
                    type="date"
                    required
                    value={newDeadline}
                    onChange={(e) => setNewDeadline(e.target.value)}
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingTeamEvent}
                  className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
                >
                  イベントを作成する
                </button>
              </div>
            </form>
          )}
        </section>


        {/* 怪我人一覧 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            怪我人一覧
          </h2>
          <p className="text-[11px] text-neutral-500">
            部員がマイページから報告した怪我の一覧です。タップすると詳細が開きます。完治してから1週間が経過した怪我は、下の「過去の怪我情報を見る」から確認できます。
          </p>
          {loadingInjuries ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : injuries.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              報告されている怪我はありません。
            </p>
          ) : (
            <>
              {(() => {
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                const activeInjuries = injuries.filter((inj) => {
                  if (!inj.is_recovered) return true;
                  if (!inj.progress_updated_at) return true;
                  return new Date(inj.progress_updated_at) >= oneWeekAgo;
                });

                if (activeInjuries.length === 0) {
                  return (
                    <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
                      現在対応中の怪我はありません。
                    </p>
                  );
                }

                return (
                  <ul className="flex flex-col gap-2">
                    {activeInjuries.map((inj) => (
                      <InjuryListItem
                        key={inj.id}
                        inj={inj}
                        isOpen={expandedInjuryId === inj.id}
                        onToggle={() =>
                          setExpandedInjuryId(
                            expandedInjuryId === inj.id ? null : inj.id
                          )
                        }
                      />
                    ))}
                  </ul>
                );
              })()}
              <button
                onClick={() => setShowPastInjuries(true)}
                className="self-end text-xs font-medium text-neutral-400 underline"
              >
                過去の怪我情報を見る
              </button>
            </>
          )}
        </section>

        {showPastInjuries && (
          <div
            className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
            onClick={() => setShowPastInjuries(false)}
          >
            <div
              className="relative flex max-h-[85vh] w-full max-w-md flex-col gap-2 overflow-y-auto rounded-lg bg-neutral-900 p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setShowPastInjuries(false)}
                aria-label="閉じる"
                className="sticky top-0 float-right -mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-neutral-500 shadow active:bg-neutral-800"
              >
                ✕
              </button>
              <h3 className="text-sm font-semibold text-neutral-200">
                過去の怪我情報
              </h3>
              {injuries.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  報告されている怪我はありません。
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {injuries.map((inj) => (
                    <InjuryListItem
                      key={inj.id}
                      inj={inj}
                      isOpen={expandedInjuryId === inj.id}
                      onToggle={() =>
                        setExpandedInjuryId(
                          expandedInjuryId === inj.id ? null : inj.id
                        )
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* 部員の役職を編集 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
              部員の役職・所属拠点を編集
            </h2>
            <button
              onClick={() => {
                setShowRoleLocationEdit((v) => !v);
                setDraftEdits({});
              }}
              className="shrink-0 rounded border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 active:bg-neutral-800"
            >
              {showRoleLocationEdit ? "閉じる" : "編集する"}
            </button>
          </div>
          {showRoleLocationEdit && (
            <p className="text-[11px] text-neutral-500">
              役職は主将・副主将・リーダー・副リーダー・役職なし、拠点は多摩・大塚から選べます。変更したら部員ごとに「保存する」を押してください。
            </p>
          )}
          {loadingMembers ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              部員が登録されていません。
            </p>
          ) : !showRoleLocationEdit ? (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
              <ul className="divide-y divide-neutral-800">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <span className="font-medium text-neutral-100">
                      {m.display_name}
                    </span>
                    <div className="flex items-center gap-1.5 text-neutral-400">
                      <span className="rounded bg-neutral-800 px-2 py-1">
                        {m.home_location
                          ? locationLabel[m.home_location]
                          : "拠点未設定"}
                      </span>
                      <span className="rounded bg-neutral-800 px-2 py-1">
                        {memberRoleEditLabel[m.role]}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-800">
              <ul className="divide-y divide-neutral-800">
                {members.map((m) => {
                  const draft = draftEdits[m.id];
                  const currentRole = draft?.role ?? m.role;
                  const currentLocation =
                    draft?.home_location ?? m.home_location ?? "tama";
                  const isDirty = !!draft;
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                    >
                      <span className="font-medium text-neutral-100">
                        {m.display_name}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={currentLocation}
                          disabled={savingRoleId === m.id}
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
                              ...prev,
                              [m.id]: {
                                role: prev[m.id]?.role ?? m.role,
                                home_location: e.target.value as Location,
                              },
                            }))
                          }
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        >
                          {locations.map((loc) => (
                            <option
                              key={loc}
                              value={loc}
                              className="bg-neutral-900 text-neutral-100"
                            >
                              {locationLabel[loc]}
                            </option>
                          ))}
                        </select>
                        <select
                          value={currentRole}
                          disabled={savingRoleId === m.id}
                          onChange={(e) =>
                            setDraftEdits((prev) => ({
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
                          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                        >
                          {(
                            Object.keys(
                              memberRoleEditLabel
                            ) as MemberRoleForEdit[]
                          ).map((r) => (
                            <option
                              key={r}
                              value={r}
                              className="bg-neutral-900 text-neutral-100"
                            >
                              {memberRoleEditLabel[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleSaveMemberEdit(m.id)}
                          disabled={!isDirty || savingRoleId === m.id}
                          className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white active:bg-red-700 disabled:opacity-40"
                        >
                          保存する
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* 新規メンバー登録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            新規メンバー登録
          </h2>
          <p className="text-[11px] text-neutral-500">
            部員だけでなく、管理者・マネージャーもここから事前登録できます。氏名とメールアドレスをあらかじめ登録しておくと、本人がそのメールアドレスで新規登録した際に、氏名・拠点・学年・役職が自動で反映されます。
          </p>

          {loadingRoster ? (
            <p className="text-xs text-neutral-500">読み込み中…</p>
          ) : roster.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-xs text-neutral-500">
              まだ事前登録がありません。
            </p>
          ) : (
            <ul className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
              {sortedRoster.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-neutral-100">
                          {r.display_name}
                        </span>
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                          {rosterRoleLabel[r.role]}
                        </span>
                        {r.home_location && (
                          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                            {locationLabel[r.home_location]}
                          </span>
                        )}
                      </span>
                      {editingEmailId !== r.id &&
                        (r.email ? (
                          <span className="truncate text-neutral-500">
                            {r.email}
                          </span>
                        ) : (
                          <span className="text-amber-400">
                            メール未設定
                          </span>
                        ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.claimed_by ? (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          連携済み
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                          未登録
                        </span>
                      )}
                      <button
                        onClick={() => handleDeleteRoster(r.id)}
                        className="text-red-500"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {editingEmailId === r.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        autoFocus
                        placeholder="メールアドレス"
                        value={editingEmailValue}
                        onChange={(e) => setEditingEmailValue(e.target.value)}
                        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100"
                      />
                      <button
                        onClick={() => handleSaveEmail(r.id)}
                        disabled={savingEmail}
                        className="rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingEmailId(null)}
                        className="rounded border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleStartEditEmail(r)}
                        className="text-[11px] font-medium text-neutral-400 underline"
                      >
                        {r.email ? "メールを編集" : "メールを追加"}
                      </button>
                      {!r.claimed_by && (
                        <button
                          onClick={() => handleCopyInviteLink(r)}
                          className="text-[11px] font-medium text-blue-600 underline"
                        >
                          {copiedTokenId === r.id
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
            onSubmit={handleAddRoster}
            className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-3"
          >
            <p className="text-xs font-semibold text-neutral-300">
              1件ずつ登録
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="氏名"
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
              <input
                type="email"
                placeholder="メールアドレス（あとで追加可）"
                value={rosterEmail}
                onChange={(e) => setRosterEmail(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={rosterRole}
                onChange={(e) =>
                  setRosterRole(e.target.value as RosterRoleChoice)
                }
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              >
                {(
                  Object.keys(rosterRoleLabel) as RosterRoleChoice[]
                ).map((r) => (
                  <option key={r} value={r}>
                    {rosterRoleLabel[r]}
                  </option>
                ))}
              </select>
              {rosterRole !== "coach" && rosterRole !== "manager" && (
                <select
                  value={rosterLocation}
                  onChange={(e) =>
                    setRosterLocation(e.target.value as Location)
                  }
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                >
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>
                      {locationLabel[loc]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rosterRole !== "coach" && rosterRole !== "manager" && (
              <select
                value={rosterEntryYear}
                onChange={(e) => setRosterEntryYear(e.target.value)}
                className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              >
                <option value="">入学年を選択</option>
                {rosterEntryYearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}年入学（現在{currentGrade(y)}年）
                  </option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={savingRoster}
              className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              追加する
            </button>
          </form>
        </section>

        <div className="border-t border-neutral-800 pt-4">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-neutral-700 py-3 text-sm font-medium text-neutral-300 active:bg-neutral-800"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}

function InjuryListItem({
  inj,
  isOpen,
  onToggle,
}: {
  inj: InjuryRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={`rounded-lg border ${
        inj.is_recovered
          ? "border-emerald-900/60 bg-emerald-950/40"
          : "border-neutral-800"
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs active:bg-black/5"
      >
        <span className="flex flex-col">
          <span className="font-medium text-neutral-100">
            {inj.author?.display_name ?? "不明"}
          </span>
          <span className="text-neutral-400">
            {inj.symptom_name}（{inj.body_part}）
            {inj.is_recovered && (
              <span className="ml-1.5 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                完治
              </span>
            )}
          </span>
        </span>
        <span className="text-neutral-600">{isOpen ? "︿" : "﹀"}</span>
      </button>
      {isOpen && (
        <div className="flex flex-col gap-1 border-t border-neutral-800 px-3 py-2.5 text-xs text-neutral-300">
          {inj.detail && <p className="whitespace-pre-wrap">{inj.detail}</p>}
          <p>
            完治見込み日:{" "}
            {inj.expected_recovery_date
              ? formatMonthDay(inj.expected_recovery_date)
              : "未定"}
          </p>
          <p>
            次回通院日:{" "}
            {inj.next_hospital_date
              ? formatMonthDay(inj.next_hospital_date)
              : "未定"}
          </p>
          <p>
            手術の可能性:{" "}
            {inj.surgery_possibility === "yes"
              ? "あり"
              : inj.surgery_possibility === "no"
                ? "なし"
                : "未定"}
          </p>
          <p>
            マット参加の可否: {matParticipationLabel[inj.mat_participation]}
          </p>
          {inj.mat_participation === "conditional" &&
            inj.mat_participation_detail && (
              <p>条件: {inj.mat_participation_detail}</p>
            )}
          {inj.progress_note && (
            <p className="rounded bg-neutral-900/60 p-2">
              最新の経過報告: {inj.progress_note}
            </p>
          )}
          {inj.progress_updated_at && (
            <p className="text-[10px] text-neutral-500">
              経過報告日:{" "}
              {formatMonthDay(toDateKey(new Date(inj.progress_updated_at)))}
            </p>
          )}
          <p className="text-[10px] text-neutral-500">
            報告日: {formatMonthDay(toDateKey(new Date(inj.created_at)))}
          </p>
        </div>
      )}
    </li>
  );
}
