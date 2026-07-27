"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  locations,
  Role,
} from "../lib/types";
import type { Profile } from "./AuthGate";

type MemberRow = {
  id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  entry_year: number | null;
};

type MonthMenuRow = {
  id: string;
  date: string;
  location: Location;
  is_off: boolean;
  is_joint: boolean;
};

type ScheduleDetailRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_off: boolean;
  creator: { display_name: string } | null;
};

type WeightMaxRow = {
  author_id: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

type PastMenuRow = {
  id: string;
  date: string;
  location: Location;
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

function groupMembersByGrade(
  members: MemberRow[]
): { label: string; members: MemberRow[] }[] {
  const groups = new Map<number | null, MemberRow[]>();
  for (const m of members) {
    const grade = m.entry_year != null ? currentGrade(m.entry_year) : null;
    const list = groups.get(grade) ?? [];
    list.push(m);
    groups.set(grade, list);
  }

  const knownGrades = Array.from(groups.keys())
    .filter((g): g is number => g !== null)
    .sort((a, b) => a - b);

  const result = knownGrades.map((grade) => ({
    label: `${grade}年`,
    members: groups.get(grade)!,
  }));

  if (groups.has(null)) {
    result.push({ label: "学年未設定", members: groups.get(null)! });
  }

  return result;
}

export default function TeamPage({
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

  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [monthMenus, setMonthMenus] = useState<MonthMenuRow[]>([]);
  const [loadingMonthMenus, setLoadingMonthMenus] = useState(true);
  const [scheduleLocation, setScheduleLocation] = useState<Location>(
    profile.home_location ?? "tama"
  );
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<
    string | null
  >(null);
  const [scheduleDetail, setScheduleDetail] = useState<
    ScheduleDetailRow | null | undefined
  >(undefined);
  const [loadingScheduleDetail, setLoadingScheduleDetail] = useState(false);

  const canEditSchedule =
    profile.role === "captain" ||
    profile.role === "leader" ||
    profile.role === "vice_leader" ||
    profile.role === "coach";

  const [weightMaxes, setWeightMaxes] = useState<WeightMaxRow[]>([]);
  const [loadingMaxes, setLoadingMaxes] = useState(true);

  const [pastMenus, setPastMenus] = useState<PastMenuRow[]>([]);
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());
  const [loadingCompliance, setLoadingCompliance] = useState(true);

  useEffect(() => {
    loadMembers();
    loadWeightMaxes();
    loadCompliance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadMonthMenus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor, scheduleLocation]);

  async function loadMembers() {
    setLoadingMembers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, role, home_location, entry_year")
      .eq("team_id", profile.team_id)
      .order("display_name", { ascending: true });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setMembers((data ?? []) as MemberRow[]);
    }
    setLoadingMembers(false);
  }

  async function loadMonthMenus() {
    setLoadingMonthMenus(true);
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const { data, error } = await supabase
      .from("menus")
      .select("id, date, location, is_off, is_joint")
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMonthMenus((data ?? []) as MonthMenuRow[]);
    }
    setLoadingMonthMenus(false);
  }

  async function loadScheduleDetail(dateStr: string) {
    setLoadingScheduleDetail(true);
    const { data, error } = await supabase
      .from("menus")
      .select(
        "id, date, title, content, location, start_time, is_off, creator:profiles!menus_created_by_fkey(display_name)"
      )
      .eq("team_id", profile.team_id)
      .eq("location", scheduleLocation)
      .eq("date", dateStr)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
      setScheduleDetail(null);
    } else {
      setScheduleDetail((data as unknown as ScheduleDetailRow | null) ?? null);
    }
    setLoadingScheduleDetail(false);
  }

  function handleSelectScheduleDate(dateStr: string) {
    setSelectedScheduleDate(dateStr);
    loadScheduleDetail(dateStr);
  }

  function handleCloseScheduleDetail() {
    setSelectedScheduleDate(null);
    setScheduleDetail(undefined);
  }

  function handleEditSchedule() {
    if (!selectedScheduleDate) return;
    try {
      sessionStorage.setItem(
        "jumpTo",
        JSON.stringify({ location: scheduleLocation, date: selectedScheduleDate })
      );
    } catch {
      // sessionStorageが使えない環境では何もしない
    }
    router.push("/");
  }

  async function loadWeightMaxes() {
    setLoadingMaxes(true);
    const { data, error } = await supabase
      .from("weight_maxes")
      .select("author_id, bench, squat, deadlift")
      .eq("team_id", profile.team_id);
    if (error) {
      setErrorMsg(error.message);
    } else {
      setWeightMaxes((data ?? []) as WeightMaxRow[]);
    }
    setLoadingMaxes(false);
  }

  // 直近60日の「オフではない練習」のうち、実施報告・未実施報告が
  // まだ提出されていないものがあるかどうかを部員ごとに調べる
  async function loadCompliance() {
    setLoadingCompliance(true);
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 60);
    const rangeStart = toDateKey(lookbackStart);
    const todayStr = toDateKey(new Date());

    const { data: menuData, error: menuError } = await supabase
      .from("menus")
      .select("id, date, location")
      .eq("team_id", profile.team_id)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr);

    if (menuError) {
      setErrorMsg(menuError.message);
      setLoadingCompliance(false);
      return;
    }

    const menuRows = (menuData ?? []) as PastMenuRow[];
    setPastMenus(menuRows);

    if (menuRows.length === 0) {
      setSubmittedKeys(new Set());
      setLoadingCompliance(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, author_id, kind")
      .in(
        "menu_id",
        menuRows.map((m) => m.id)
      )
      .in("kind", ["report", "absent"])
      .is("parent_id", null);

    if (commentError) {
      setErrorMsg(commentError.message);
      setLoadingCompliance(false);
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
    setLoadingCompliance(false);
  }

  const maxByAuthor = new Map(weightMaxes.map((w) => [w.author_id, w]));

  function hasMissingSubmission(memberId: string, homeLocation: Location | null) {
    if (!homeLocation) return false;
    return pastMenus.some(
      (m) =>
        m.location === homeLocation &&
        !submittedKeys.has(`${memberId}:${m.id}`)
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">チームページ</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <button
            onClick={() => router.push("/mypage")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            マイページ
          </button>
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            掲示板に戻る
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        {/* 部員一覧 */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">部員一覧</h2>
          <p className="text-[11px] text-neutral-400">
            タップするとその部員のマイページを閲覧できます。「未提出あり」は直近60日で実施報告・未実施報告のどちらも提出されていない練習日があることを示します。
          </p>
          {loadingMembers ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              部員が登録されていません。
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groupMembersByGrade(members).map((group) => (
                <div key={group.label} className="flex flex-col gap-1.5">
                  <h3 className="text-[11px] font-semibold text-neutral-400">
                    {group.label}（{group.members.length}人）
                  </h3>
                  <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-neutral-200">
                    <ul className="divide-y divide-neutral-100">
                      {group.members.map((m) => {
                        const missing = loadingCompliance
                          ? null
                          : hasMissingSubmission(m.id, m.home_location);
                        return (
                          <li key={m.id}>
                            <button
                              onClick={() => router.push(`/team/${m.id}`)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs active:bg-neutral-50"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium text-neutral-800">
                                  {m.display_name}
                                </span>
                                {m.home_location && (
                                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                                    {locationLabel[m.home_location]}
                                  </span>
                                )}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                {missing === null ? (
                                  <span className="text-[10px] text-neutral-300">
                                    確認中…
                                  </span>
                                ) : missing ? (
                                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">
                                    未提出あり
                                  </span>
                                ) : (
                                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                                    提出OK
                                  </span>
                                )}
                                <span className="text-neutral-300">›</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 月間の練習スケジュール */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            月間の練習スケジュール
          </h2>
          <div className="flex gap-2">
            {locations.map((loc) => (
              <button
                key={loc}
                onClick={() => setScheduleLocation(loc)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
                  scheduleLocation === loc
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-300 text-neutral-500 active:bg-neutral-100"
                }`}
              >
                {locationLabel[loc]}
              </button>
            ))}
          </div>
          <div className="relative">
            <MonthlyCalendar
              cursor={calendarCursor}
              onCursorChange={setCalendarCursor}
              menus={monthMenus}
              loading={loadingMonthMenus}
              onSelectDate={handleSelectScheduleDate}
              highlightDate={selectedScheduleDate}
            />
            {selectedScheduleDate && (
              <div className="absolute inset-0 z-20 flex items-center justify-center p-2">
                <div className="relative w-full max-w-sm rounded-lg border border-neutral-300 bg-white p-4 shadow-lg">
                  <button
                    onClick={handleCloseScheduleDetail}
                    aria-label="閉じる"
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 active:bg-neutral-100"
                  >
                    ✕
                  </button>

                  {loadingScheduleDetail ? (
                    <p className="py-6 text-center text-xs text-neutral-400">
                      読み込み中…
                    </p>
                  ) : scheduleDetail === null ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                      <p className="text-xs text-neutral-400">
                        {locationLabel[scheduleLocation]}の
                        {formatMonthDay(selectedScheduleDate)}
                        はまだ作成されていません
                      </p>
                      {canEditSchedule && (
                        <button
                          onClick={handleEditSchedule}
                          className="rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white active:bg-neutral-700"
                        >
                          掲示板で作成する
                        </button>
                      )}
                    </div>
                  ) : scheduleDetail ? (
                    <div className="pr-4">
                      <div className="mb-1 text-xs text-neutral-400">
                        {locationLabel[scheduleDetail.location]}・
                        {scheduleDetail.date}
                        {scheduleDetail.start_time &&
                          `・${scheduleDetail.start_time.slice(0, 5)}〜`}
                        ・作成者:{" "}
                        {scheduleDetail.creator?.display_name ?? "不明"}
                      </div>
                      <h3 className="mb-2 text-base font-bold">
                        {scheduleDetail.is_off
                          ? "オフ"
                          : scheduleDetail.title ||
                            formatMonthDay(scheduleDetail.date)}
                      </h3>
                      {!scheduleDetail.is_off && (
                        <p className="whitespace-pre-wrap text-sm text-neutral-800">
                          {scheduleDetail.content}
                        </p>
                      )}
                      {canEditSchedule && (
                        <button
                          onClick={handleEditSchedule}
                          className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-100"
                        >
                          掲示板で編集する
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 全員のウェイトMAX */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            ウェイトMAX一覧
          </h2>
          <p className="text-[11px] text-neutral-400">
            コーチが計測イベントを作成すると、部員が提出した記録がここに反映される予定です（準備中）。
          </p>
          {loadingMembers || loadingMaxes ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : members.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              部員が登録されていません。
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-neutral-200">
              <ul className="divide-y divide-neutral-100">
                {members.map((m) => {
                  const max = maxByAuthor.get(m.id);
                  const fmt = (v: number | null | undefined) =>
                    v != null ? `${v}kg` : "未登録";
                  return (
                    <li
                      key={m.id}
                      className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                    >
                      <span className="font-medium text-neutral-800">
                        {m.display_name}
                      </span>
                      <span className="grid grid-cols-3 gap-2 text-center">
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            ベンチ
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.bench)}
                          </span>
                        </span>
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            スクワット
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.squat)}
                          </span>
                        </span>
                        <span className="flex flex-col gap-0.5 rounded bg-neutral-50 px-1.5 py-1.5">
                          <span className="text-[10px] text-neutral-400">
                            デッドリフト
                          </span>
                          <span className="font-semibold text-neutral-700">
                            {fmt(max?.deadlift)}
                          </span>
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MonthlyCalendar({
  cursor,
  onCursorChange,
  menus,
  loading,
  onSelectDate,
  highlightDate,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  menus: MonthMenuRow[];
  loading: boolean;
  onSelectDate: (dateStr: string) => void;
  highlightDate?: string | null;
}) {
  const byDate = new Map<string, MonthMenuRow[]>();
  for (const m of menus) {
    const list = byDate.get(m.date) ?? [];
    list.push(m);
    byDate.set(m.date, list);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => onCursorChange(new Date(year, month - 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100"
        >
          ＜
        </button>
        <span className="text-sm font-semibold">
          {year}年{month + 1}月
        </span>
        <button
          onClick={() => onCursorChange(new Date(year, month + 1, 1))}
          className="rounded px-2 py-1 text-xs text-neutral-500 active:bg-neutral-100"
        >
          ＞
        </button>
      </div>
      {loading ? (
        <p className="text-xs text-neutral-400">読み込み中…</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={i} />;
              const key = toDateKey(date);
              const rows = byDate.get(key) ?? [];
              const hasOff = rows.some((r) => r.is_off);
              const hasMenu = rows.some((r) => !r.is_off);
              const isHighlighted = key === highlightDate;
              return (
                <button
                  key={i}
                  onClick={() => onSelectDate(key)}
                  className={`flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs active:bg-neutral-100 ${
                    isHighlighted
                      ? "bg-amber-50 font-bold text-amber-700 ring-2 ring-amber-400"
                      : "text-neutral-600"
                  }`}
                >
                  <span>{date.getDate()}</span>
                  {hasMenu && (
                    <span
                      className={`inline-block rounded-full bg-neutral-700 ${
                        isHighlighted ? "h-2.5 w-2.5" : "h-1.5 w-1.5"
                      }`}
                    />
                  )}
                  {hasOff && !hasMenu && (
                    <span className="text-[9px] text-neutral-300">off</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
