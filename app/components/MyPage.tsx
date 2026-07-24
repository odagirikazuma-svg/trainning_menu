"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { Location, locationLabel, roleLabel } from "../lib/types";
import type { Profile } from "./AuthGate";

type MenuRow = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_off: boolean;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// メニューの開始時刻を過ぎているか（開始時刻未設定なら常に対象）
function isReportOpen(menu: MenuRow): boolean {
  if (!menu.start_time) return true;
  const threshold = new Date(`${menu.date}T${menu.start_time}`);
  return new Date() >= threshold;
}

// "YYYY-MM-DD" + "HH:MM" -> "7月24日 10時10分〜"
function formatShortDateTime(dateStr: string, startTime: string | null) {
  const [, m, d] = dateStr.split("-").map(Number);
  const base = `${m}月${d}日`;
  if (!startTime) return base;
  const [h, min] = startTime.split(":").map(Number);
  return `${base} ${h}時${String(min).padStart(2, "0")}分〜`;
}

export default function MyPage({
  profile,
  signOut,
}: {
  profile: Profile;
  signOut: () => void;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [todoMenus, setTodoMenus] = useState<MenuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (profile.home_location) loadTodo();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.home_location]);

  async function loadTodo() {
    setLoading(true);
    const todayStr = toDateKey(new Date());
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const rangeStart = toDateKey(twoWeeksAgo);

    const { data: menuData, error: menuError } = await supabase
      .from("menus")
      .select("id, date, title, content, location, start_time, is_off")
      .eq("team_id", profile.team_id)
      .eq("location", profile.home_location)
      .eq("is_off", false)
      .gte("date", rangeStart)
      .lte("date", todayStr)
      .order("date", { ascending: false });

    if (menuError) {
      setErrorMsg(menuError.message);
      setLoading(false);
      return;
    }

    const menus = (menuData ?? []) as unknown as MenuRow[];
    const openMenus = menus.filter((m) => isReportOpen(m));

    if (openMenus.length === 0) {
      setTodoMenus([]);
      setLoading(false);
      return;
    }

    const { data: commentData, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, kind")
      .eq("author_id", profile.id)
      .in(
        "menu_id",
        openMenus.map((m) => m.id)
      )
      .in("kind", ["report", "absent"]);

    if (commentError) {
      setErrorMsg(commentError.message);
      setLoading(false);
      return;
    }

    const respondedIds = new Set(
      ((commentData ?? []) as { menu_id: string }[]).map((c) => c.menu_id)
    );
    setTodoMenus(openMenus.filter((m) => !respondedIds.has(m.id)));
    setLoading(false);
  }

  function goToMenu(m: MenuRow) {
    try {
      sessionStorage.setItem(
        "jumpTo",
        JSON.stringify({ location: m.location, date: m.date })
      );
    } catch {
      // sessionStorageが使えない環境では何もしない
    }
    router.push("/");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">マイページ</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
          <span className="hidden sm:inline">
            {profile.display_name}（{roleLabel[profile.role]}）
          </span>
          <button
            onClick={() => router.push("/")}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            掲示板に戻る
          </button>
          <button
            onClick={signOut}
            className="rounded border border-neutral-300 px-2.5 py-1.5 active:bg-neutral-100"
          >
            ログアウト
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">
            今日のやることリスト
          </h2>

          {!profile.home_location ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              所属拠点(多摩/大塚)がまだ設定されていません。設定されると、未報告の練習メニューがここに表示されます。
            </p>
          ) : loading ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : todoMenus.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              未報告の練習メニューはありません。
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {todoMenus.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => goToMenu(m)}
                    className="flex w-full flex-col rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-sm active:bg-amber-100"
                  >
                    <span className="text-[11px] text-amber-600">
                      {locationLabel[m.location]}・実施報告 未提出
                    </span>
                    <span className="font-medium text-neutral-800">
                      {m.title || formatShortDateTime(m.date, m.start_time)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            今日のウェイトメニュー
          </h2>
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
            準備中です。ウェイトトレーニング機能の実装後、ここに表示されます。
          </p>
        </section>

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            次の試合日程
          </h2>
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
            準備中です。
          </p>
        </section>

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">目標</h2>
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
            準備中です。
          </p>
        </section>

        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            怪我の記録・復帰計画
          </h2>
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
            準備中です。
          </p>
        </section>
      </div>
    </div>
  );
}
