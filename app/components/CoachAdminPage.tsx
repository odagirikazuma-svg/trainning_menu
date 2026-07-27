"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { currentGrade, Location, locationLabel } from "../lib/types";
import type { Profile } from "./AuthGate";

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

  useEffect(() => {
    loadMembers();
    loadReports();
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
