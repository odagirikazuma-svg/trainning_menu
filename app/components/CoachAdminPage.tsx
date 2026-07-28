"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { currentGrade, Location, locationLabel, locations } from "../lib/types";
import type { Profile } from "./AuthGate";

type RosterRoleChoice = "captain" | "vice_captain" | "coach" | "member";

const rosterRoleLabel: Record<RosterRoleChoice, string> = {
  captain: "主将",
  vice_captain: "副主将",
  coach: "コーチ",
  member: "役職なし",
};

type MemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  entry_year: number | null;
};

type MenuRow = {
  id: string;
  date: string;
  location: Location;
  is_off: boolean;
};

type WeightMaxEventRow = {
  id: string;
  deadline: string;
  created_at: string;
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

  // 直近3日間（今日は提出期間中の可能性があるため、昨日から3日分をさかのぼる）
  const [recentDates] = useState<string[]>(() => {
    const dates: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(toDateKey(d));
    }
    return dates.sort();
  });

  const [menusByDateLocation, setMenusByDateLocation] = useState<
    Map<string, MenuRow>
  >(new Map());
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());
  const [loadingReports, setLoadingReports] = useState(true);

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterName, setRosterName] = useState("");
  const [rosterEmail, setRosterEmail] = useState("");
  const [rosterLocation, setRosterLocation] = useState<Location>("tama");
  const [rosterEntryYear, setRosterEntryYear] = useState("");
  const [rosterRole, setRosterRole] = useState<RosterRoleChoice>("member");
  const [savingRoster, setSavingRoster] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importingCsv, setImportingCsv] = useState(false);
  const [csvResult, setCsvResult] = useState<string | null>(null);

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

  const rosterEntryYearOptions: number[] = (() => {
    const now = new Date();
    const academicYear =
      now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 4 }, (_, i) => academicYear - i);
  })();

  useEffect(() => {
    loadMembers();
    loadReports();
    loadRoster();
    loadWeightMaxEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, home_location, entry_year")
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

  async function loadReports() {
    setLoadingReports(true);
    const rangeStart = recentDates[0];
    const rangeEnd = recentDates[recentDates.length - 1];

    const { data: menuData, error: menuError } = await supabase
      .from("menus")
      .select("id, date, location, is_off")
      .eq("team_id", profile.team_id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (menuError) {
      setErrorMsg(menuError.message);
      setLoadingReports(false);
      return;
    }

    const menuRows = (menuData ?? []) as MenuRow[];
    const map = new Map<string, MenuRow>();
    for (const m of menuRows) {
      if (!m.is_off) map.set(`${m.date}:${m.location}`, m);
    }
    setMenusByDateLocation(map);

    const menuIds = menuRows.filter((m) => !m.is_off).map((m) => m.id);
    if (menuIds.length === 0) {
      setSubmittedKeys(new Set());
      setLoadingReports(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, author_id, kind")
      .in("menu_id", menuIds)
      .in("kind", ["report", "absent"])
      .is("parent_id", null);

    if (commentError) {
      setErrorMsg(commentError.message);
      setLoadingReports(false);
      return;
    }

    const keys = new Set<string>();
    for (const row of (commentData ?? []) as {
      menu_id: string;
      author_id: string | null;
    }[]) {
      if (row.author_id) keys.add(`${row.author_id}:${row.menu_id}`);
    }
    setSubmittedKeys(keys);
    setLoadingReports(false);
  }

  const loading = loadingMembers || loadingReports;

  async function loadWeightMaxEvent() {
    const { data, error } = await supabase
      .from("weight_max_events")
      .select("id, deadline, created_at")
      .eq("team_id", profile.team_id)
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
        .select("author_id, updated_at")
        .eq("team_id", profile.team_id)
        .gte("updated_at", event.created_at);
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
    if (!window.confirm("このウェイトMAX集計を終了しますか？")) return;
    const { error } = await supabase
      .from("weight_max_events")
      .delete()
      .eq("id", weightMaxEvent.id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      await loadWeightMaxEvent();
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
      home_location: rosterRole === "coach" ? null : rosterLocation,
      entry_year:
        rosterRole === "coach" || !rosterEntryYear
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

  const rosterRoleFromLabel: Record<string, RosterRoleChoice> = {
    主将: "captain",
    副主将: "vice_captain",
    コーチ: "coach",
    役職なし: "member",
    captain: "captain",
    vice_captain: "vice_captain",
    coach: "coach",
    member: "member",
  };

  const locationFromLabel: Record<string, Location> = {
    多摩: "tama",
    大塚: "otsuka",
    tama: "tama",
    otsuka: "otsuka",
  };

  // シンプルなCSVパーサー（ダブルクォートで囲まれたカンマ・改行にも対応）
  function parseCsvText(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        field = "";
        if (row.some((v) => v.trim() !== "")) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length > 0) {
      row.push(field);
      if (row.some((v) => v.trim() !== "")) rows.push(row);
    }
    return rows;
  }

  async function handleImportCsv() {
    if (!csvFile) return;
    setImportingCsv(true);
    setCsvResult(null);

    const text = await csvFile.text();
    const rows = parseCsvText(text);

    if (rows.length === 0) {
      setCsvResult("CSVにデータが見つかりませんでした。");
      setImportingCsv(false);
      return;
    }

    // 1行目が見出し（「氏名」や"name"を含む）ならスキップする
    const header = (rows[0][0] ?? "").trim().toLowerCase();
    const dataRows =
      header.includes("氏名") || header.includes("name")
        ? rows.slice(1)
        : rows;

    const inserts: Record<string, unknown>[] = [];
    const skipped: number[] = [];

    dataRows.forEach((r, idx) => {
      const name = (r[0] ?? "").trim();
      const email = (r[1] ?? "").trim();
      const roleRaw = (r[2] ?? "").trim();
      const locationRaw = (r[3] ?? "").trim();
      const entryYearRaw = (r[4] ?? "").trim();

      if (!name) {
        skipped.push(idx + 1);
        return;
      }

      const role = rosterRoleFromLabel[roleRaw] ?? "member";
      const location =
        role === "coach" ? null : locationFromLabel[locationRaw] ?? "tama";
      // 「2023年」のように「年」が付いていても数字だけ取り出せるようにする
      const entryYearDigits = entryYearRaw.match(/\d+/)?.[0];
      const entryYearNum = entryYearDigits ? Number(entryYearDigits) : NaN;
      const entryYear =
        role === "coach" || !entryYearDigits || Number.isNaN(entryYearNum)
          ? null
          : entryYearNum;

      inserts.push({
        team_id: profile.team_id,
        display_name: name,
        email: email || null,
        role,
        home_location: location,
        entry_year: entryYear,
        created_by: profile.id,
      });
    });

    if (inserts.length === 0) {
      setCsvResult("有効な行が見つかりませんでした。");
      setImportingCsv(false);
      return;
    }

    const { error } = await supabase
      .from("member_roster")
      .upsert(inserts, { onConflict: "team_id,email" });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setCsvResult(
        `${inserts.length}件を登録しました。` +
          (skipped.length > 0
            ? `（氏名またはメールアドレスが空のためスキップした行: ${skipped.join("、")}行目）`
            : "")
      );
      setCsvFile(null);
      await loadRoster();
    }
    setImportingCsv(false);
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

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">管理ページ</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            掲示板に戻る
          </button>
          <button
            onClick={() => router.push("/team")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            チームページ
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">
            直近3日間の提出状況
          </h2>
          <p className="text-[11px] text-neutral-400">
            各部員の所属拠点のメニューに対して、実施報告・未実施報告のいずれかを提出済みかどうかを表示しています。「対象外」はその日の練習がオフ、またはメニュー自体が作成されていない場合です。
          </p>

          {loading ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              部員が登録されていません。
            </p>
          ) : (
            <div className="max-h-[75vh] overflow-y-auto rounded-lg border border-neutral-200">
              <ul className="divide-y divide-neutral-100">
                {members.map((m) => {
                  const gradeLabel =
                    m.entry_year != null
                      ? `${currentGrade(m.entry_year)}年`
                      : null;
                  return (
                    <li key={m.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-800">
                          {m.display_name}
                        </span>
                        {gradeLabel && (
                          <span className="text-neutral-400">{gradeLabel}</span>
                        )}
                        {m.home_location && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                            {locationLabel[m.home_location]}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {recentDates.map((date) => {
                          const menu = m.home_location
                            ? menusByDateLocation.get(
                                `${date}:${m.home_location}`
                              )
                            : undefined;
                          const status = !menu
                            ? "n/a"
                            : submittedKeys.has(`${m.id}:${menu.id}`)
                              ? "done"
                              : "missing";
                          return (
                            <div
                              key={date}
                              className={`flex flex-col items-center gap-0.5 rounded px-1.5 py-1.5 ${
                                status === "done"
                                  ? "bg-emerald-50"
                                  : status === "missing"
                                    ? "bg-red-50"
                                    : "bg-neutral-50"
                              }`}
                            >
                              <span className="text-[10px] text-neutral-400">
                                {formatMonthDay(date)}
                              </span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  status === "done"
                                    ? "text-emerald-600"
                                    : status === "missing"
                                      ? "text-red-600"
                                      : "text-neutral-400"
                                }`}
                              >
                                {status === "done"
                                  ? "提出済み"
                                  : status === "missing"
                                    ? "未提出"
                                    : "対象外"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* ウェイトMAXを集計する */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            ウェイトMAXを集計する
          </h2>
          <p className="text-[11px] text-neutral-400">
            締切日を設定すると、部員のマイページの「やることリスト」にBIG3(ベンチプレス・スクワット・デッドリフト)のMAX重量を提出するタスクが表示されます。提出内容はチームページの「ウェイトMAX一覧」で確認できます。
          </p>

          {weightMaxEvent === undefined ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : weightMaxEvent ? (
            <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
              <p className="text-sm text-neutral-700">
                締切:{" "}
                <span className="font-semibold">
                  {weightMaxEvent.deadline}
                </span>
              </p>
              <p className="text-xs text-neutral-500">
                提出済み {weightMaxSubmittedCount}人 / {members.length}人
              </p>
              <button
                onClick={handleEndWeightMaxEvent}
                className="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
              >
                この集計を終了する
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleCreateWeightMaxEvent}
              className="flex items-end gap-2"
            >
              <label className="flex flex-1 flex-col gap-1 text-[11px] text-neutral-500">
                締切日
                <input
                  type="date"
                  required
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={savingWeightMaxEvent}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white active:bg-neutral-700 disabled:opacity-50"
              >
                集計を開始する
              </button>
            </form>
          )}
        </section>

        {/* 部員の事前登録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            部員の事前登録
          </h2>
          <p className="text-[11px] text-neutral-400">
            氏名とメールアドレスをあらかじめ登録しておくと、本人がそのメールアドレスで新規登録した際に、氏名・拠点・学年・役職が自動で反映されます。
          </p>

          {loadingRoster ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : roster.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              まだ事前登録がありません。
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
              {roster.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium text-neutral-800">
                          {r.display_name}
                        </span>
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                          {rosterRoleLabel[r.role]}
                        </span>
                        {r.home_location && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                            {locationLabel[r.home_location]}
                          </span>
                        )}
                      </span>
                      {editingEmailId !== r.id &&
                        (r.email ? (
                          <span className="truncate text-neutral-400">
                            {r.email}
                          </span>
                        ) : (
                          <span className="text-amber-600">
                            メール未設定
                          </span>
                        ))}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.claimed_by ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                          連携済み
                        </span>
                      ) : (
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
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
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                      />
                      <button
                        onClick={() => handleSaveEmail(r.id)}
                        disabled={savingEmail}
                        className="rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingEmailId(null)}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-[11px] text-neutral-600"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleStartEditEmail(r)}
                        className="text-[11px] font-medium text-neutral-500 underline"
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
            className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3"
          >
            <p className="text-xs font-semibold text-neutral-600">
              1件ずつ登録
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="氏名"
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
              />
              <input
                type="email"
                placeholder="メールアドレス（あとで追加可）"
                value={rosterEmail}
                onChange={(e) => setRosterEmail(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={rosterRole}
                onChange={(e) =>
                  setRosterRole(e.target.value as RosterRoleChoice)
                }
                className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
              >
                {(
                  Object.keys(rosterRoleLabel) as RosterRoleChoice[]
                ).map((r) => (
                  <option key={r} value={r}>
                    {rosterRoleLabel[r]}
                  </option>
                ))}
              </select>
              {rosterRole !== "coach" && (
                <select
                  value={rosterLocation}
                  onChange={(e) =>
                    setRosterLocation(e.target.value as Location)
                  }
                  className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
                >
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>
                      {locationLabel[loc]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {rosterRole !== "coach" && (
              <select
                value={rosterEntryYear}
                onChange={(e) => setRosterEntryYear(e.target.value)}
                className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
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
              className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white active:bg-neutral-700 disabled:opacity-50"
            >
              追加する
            </button>
          </form>

          <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3">
            <p className="text-xs font-semibold text-neutral-600">
              CSVから一括登録
            </p>
            <p className="text-[11px] text-neutral-400">
              1行目に見出し、2行目以降に「氏名, メールアドレス, 役職,
              拠点, 入学年」の順で入力したCSVファイルを選んでください。
              <br />
              メールアドレスはまだ分からなければ空欄でも登録できます(あとで一覧から個別に追加できます)。
              <br />
              役職は「主将・副主将・コーチ・役職なし」、拠点は「多摩・大塚」で入力できます(空欄は「役職なし」「多摩」として扱われます)。コーチの場合、拠点・入学年は空欄でかまいません。
              <br />
              例: <code>田中太郎,tanaka@example.com,役職なし,多摩,2024</code>
              <br />
              例(メール未定): <code>田中太郎,,役職なし,多摩,2024</code>
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <button
              onClick={handleImportCsv}
              disabled={!csvFile || importingCsv}
              className="self-start rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white active:bg-neutral-700 disabled:opacity-50"
            >
              {importingCsv ? "インポート中…" : "インポートする"}
            </button>
            {csvResult && (
              <p className="rounded bg-emerald-50 p-2 text-[11px] text-emerald-700">
                {csvResult}
              </p>
            )}
          </div>
        </section>

        <div className="border-t border-neutral-200 pt-4">
          <button
            onClick={signOut}
            className="w-full rounded-lg border border-neutral-300 py-3 text-sm font-medium text-neutral-600 active:bg-neutral-100"
          >
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}
