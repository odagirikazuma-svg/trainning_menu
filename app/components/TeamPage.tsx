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

const locationDotColor: Record<Location, string> = {
  tama: "bg-blue-500",
  otsuka: "bg-orange-500",
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  }, [calendarCursor]);

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
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setMonthMenus((data ?? []) as MonthMenuRow[]);
    }
    setLoadingMonthMenus(false);
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
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-neutral-200">
              <ul className="divide-y divide-neutral-100">
                {members.map((m) => {
                  const gradeLabel =
                    m.entry_year != null
                      ? `${currentGrade(m.entry_year)}年`
                      : null;
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
                          {gradeLabel && (
                            <span className="shrink-0 text-neutral-400">
                              {gradeLabel}
                            </span>
                          )}
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
          )}
        </section>

        {/* 月間の練習スケジュール */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-neutral-700">
            月間の練習スケジュール
          </h2>
          <MonthlyCalendar
            cursor={calendarCursor}
            onCursorChange={setCalendarCursor}
            menus={monthMenus}
            loading={loadingMonthMenus}
          />
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
            <div className="max-h-[70vh] overflow-y-auto overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-neutral-500">
                    <th className="px-3 py-2 text-left font-medium">氏名</th>
                    <th className="px-3 py-2 text-right font-medium">
                      ベンチ
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      スクワット
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      デッドリフト
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {members.map((m, idx) => {
                    const max = maxByAuthor.get(m.id);
                    const fmt = (v: number | null | undefined) =>
                      v != null ? `${v}kg` : "未登録";
                    return (
                      <tr
                        key={m.id}
                        className={idx % 2 === 1 ? "bg-neutral-50/60" : undefined}
                      >
                        <td className="px-3 py-1.5 font-medium text-neutral-800">
                          {m.display_name}
                        </td>
                        <td className="px-3 py-1.5 text-right text-neutral-600">
                          {fmt(max?.bench)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-neutral-600">
                          {fmt(max?.squat)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-neutral-600">
                          {fmt(max?.deadlift)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  menus: MonthMenuRow[];
  loading: boolean;
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
              const activeLocations = Array.from(
                new Set(
                  rows.filter((r) => !r.is_off).map((r) => r.location)
                )
              );
              return (
                <div
                  key={i}
                  className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs text-neutral-600"
                >
                  <span>{date.getDate()}</span>
                  {activeLocations.length > 0 && (
                    <span className="flex flex-wrap justify-center gap-0.5">
                      {activeLocations.map((loc) => (
                        <span
                          key={loc}
                          className={`inline-block h-1.5 w-1.5 rounded-full ${locationDotColor[loc]}`}
                        />
                      ))}
                    </span>
                  )}
                  {hasOff && activeLocations.length === 0 && (
                    <span className="text-[9px] text-neutral-300">off</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
            {locations.map((loc) => (
              <span key={loc} className="flex items-center gap-1">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${locationDotColor[loc]}`}
                />
                {locationLabel[loc]}
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  );
}
