"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import {
  canCreateMenu,
  currentGrade,
  Location,
  locationLabel,
  roleLabel,
  TrainingType,
  trainingTypeDotColor,
  trainingTypeLabel,
} from "../lib/types";
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

type MatchRow = {
  id: string;
  name: string;
  date: string;
};

type WeightLogRow = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
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

// "YYYY-MM-DD" -> "2026年7月24日"
function formatFullDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
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
  const todayStr = toDateKey(new Date());

  const [todoMenus, setTodoMenus] = useState<MenuRow[]>([]);
  const [loadingTodo, setLoadingTodo] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);
  const [showMatchForm, setShowMatchForm] = useState(false);
  const [newMatchName, setNewMatchName] = useState("");
  const [newMatchDate, setNewMatchDate] = useState("");

  const [todayLog, setTodayLog] = useState<WeightLogRow | null>(null);
  const [todayLogText, setTodayLogText] = useState("");
  const [todayLogType, setTodayLogType] = useState<TrainingType>("weight");
  const [loadingLog, setLoadingLog] = useState(true);
  const [savingLog, setSavingLog] = useState(false);

  const [recentLogs, setRecentLogs] = useState<WeightLogRow[]>([]);
  const [loadingRecentLogs, setLoadingRecentLogs] = useState(true);

  // カレンダー用
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calendarWeightLogs, setCalendarWeightLogs] = useState<
    { date: string; type: TrainingType }[]
  >([]);
  const [calendarAbsentLogs, setCalendarAbsentLogs] = useState<
    { date: string; type: TrainingType }[]
  >([]);

  useEffect(() => {
    if (profile.home_location) loadTodo();
    else setLoadingTodo(false);
    loadNextMatch();
    loadTodayLog();
    loadRecentLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendarData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarCursor]);

  async function loadTodo() {
    setLoadingTodo(true);
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
      setLoadingTodo(false);
      return;
    }

    const menus = (menuData ?? []) as unknown as MenuRow[];
    const openMenus = menus.filter((m) => isReportOpen(m));

    if (openMenus.length === 0) {
      setTodoMenus([]);
      setLoadingTodo(false);
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
      setLoadingTodo(false);
      return;
    }

    const respondedIds = new Set(
      ((commentData ?? []) as { menu_id: string }[]).map((c) => c.menu_id)
    );
    setTodoMenus(openMenus.filter((m) => !respondedIds.has(m.id)));
    setLoadingTodo(false);
  }

  async function loadNextMatch() {
    setLoadingMatch(true);
    const { data, error } = await supabase
      .from("matches")
      .select("id, name, date")
      .eq("team_id", profile.team_id)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
    } else {
      setNextMatch((data as MatchRow | null) ?? null);
    }
    setLoadingMatch(false);
  }

  async function handleAddMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newMatchName.trim() || !newMatchDate) return;
    const { error } = await supabase.from("matches").insert({
      team_id: profile.team_id,
      name: newMatchName.trim(),
      date: newMatchDate,
      created_by: profile.id,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewMatchName("");
    setNewMatchDate("");
    setShowMatchForm(false);
    await loadNextMatch();
  }

  async function loadTodayLog() {
    setLoadingLog(true);
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id, date, content, type")
      .eq("author_id", profile.id)
      .eq("date", todayStr)
      .maybeSingle();

    if (error) {
      setErrorMsg(error.message);
    } else if (data) {
      const row = data as WeightLogRow;
      setTodayLog(row);
      setTodayLogText(row.content);
      setTodayLogType(row.type);
    }
    setLoadingLog(false);
  }

  async function loadRecentLogs() {
    setLoadingRecentLogs(true);
    const { data, error } = await supabase
      .from("weight_logs")
      .select("id, date, content, type")
      .eq("author_id", profile.id)
      .lt("date", todayStr)
      .order("date", { ascending: false })
      .limit(3);

    if (error) {
      setErrorMsg(error.message);
    } else {
      setRecentLogs((data ?? []) as WeightLogRow[]);
    }
    setLoadingRecentLogs(false);
  }

  async function handleSaveLog() {
    setSavingLog(true);
    const { data, error } = await supabase
      .from("weight_logs")
      .upsert(
        {
          id: todayLog?.id,
          team_id: profile.team_id,
          author_id: profile.id,
          date: todayStr,
          content: todayLogText,
          type: todayLogType,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "author_id,date" }
      )
      .select("id, date, content, type")
      .single();

    if (error) {
      setErrorMsg(error.message);
    } else {
      setTodayLog(data as WeightLogRow);
    }
    setSavingLog(false);
  }

  async function loadCalendarData() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    const rangeStart = toDateKey(new Date(year, month, 1));
    const rangeEnd = toDateKey(new Date(year, month + 1, 0));

    const { data: weightData, error: weightError } = await supabase
      .from("weight_logs")
      .select("date, type")
      .eq("author_id", profile.id)
      .gte("date", rangeStart)
      .lte("date", rangeEnd);

    if (weightError) {
      setErrorMsg(weightError.message);
    } else {
      setCalendarWeightLogs(
        (weightData ?? []) as { date: string; type: TrainingType }[]
      );
    }

    const { data: absentData, error: absentError } = await supabase
      .from("comments")
      .select("alt_type, menu:menus!comments_menu_id_fkey(date)")
      .eq("author_id", profile.id)
      .eq("kind", "absent")
      .not("alt_type", "is", null);

    if (absentError) {
      setErrorMsg(absentError.message);
    } else {
      const rows = (absentData ?? []) as unknown as {
        alt_type: TrainingType;
        menu: { date: string } | null;
      }[];
      const filtered = rows
        .filter(
          (r) =>
            r.menu &&
            r.menu.date >= rangeStart &&
            r.menu.date <= rangeEnd
        )
        .map((r) => ({ date: r.menu!.date, type: r.alt_type }));
      setCalendarAbsentLogs(filtered);
    }
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

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;
  const gradeLabel =
    profile.entry_year != null ? `${currentGrade(profile.entry_year)}年` : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col text-neutral-900">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <h1 className="text-base font-bold sm:text-lg">マイページ</h1>
        <div className="flex items-center gap-2 text-[11px] text-neutral-500">
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

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-600">
            {errorMsg}
          </p>
        )}

        {/* 日誌タイトル */}
        <section className="rounded-lg border border-neutral-200 p-4">
          <p className="text-xs text-neutral-400">{formatFullDate(todayStr)}</p>
          <p className="text-lg font-bold">
            {profile.display_name}
            {gradeLabel && ` ${gradeLabel}`}（{roleLabel[profile.role]}）
          </p>
        </section>

        {/* 次の試合まで */}
        <section className="flex flex-col gap-2">
          {loadingMatch ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : nextMatch ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
              <p className="text-xs text-blue-600">次の試合【{nextMatch.name}】まで</p>
              <p className="text-3xl font-bold text-blue-700">
                あと{matchDays}日
              </p>
              <p className="text-[11px] text-blue-500">
                {formatMonthDay(nextMatch.date)}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-400">
              次の試合はまだ登録されていません。
            </p>
          )}

          {canCreateMenu(profile.role) && (
            <>
              <button
                onClick={() => setShowMatchForm((v) => !v)}
                className="self-start text-[11px] font-medium text-blue-700 active:text-blue-900"
              >
                {showMatchForm ? "キャンセル" : "＋ 試合を登録する"}
              </button>
              {showMatchForm && (
                <form
                  onSubmit={handleAddMatch}
                  className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
                >
                  <input
                    type="text"
                    placeholder="試合名（例：全日本学生選手権）"
                    value={newMatchName}
                    onChange={(e) => setNewMatchName(e.target.value)}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    required
                  />
                  <input
                    type="date"
                    value={newMatchDate}
                    onChange={(e) => setNewMatchDate(e.target.value)}
                    className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                    required
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-blue-600 py-2 text-sm font-medium text-white active:bg-blue-700"
                  >
                    登録する
                  </button>
                </form>
              )}
            </>
          )}
        </section>

        {/* やることリスト */}
        <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            やることリスト
          </h2>

          {!profile.home_location ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              所属拠点(多摩/大塚)がまだ設定されていません。設定されると、未報告の練習メニューがここに表示されます。
            </p>
          ) : loadingTodo ? (
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

        {/* 本日のトレーニングメニュー */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            本日のトレーニングメニュー
          </h2>
          {loadingLog ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1 rounded-lg bg-neutral-200 p-1 text-xs">
                {(
                  Object.keys(trainingTypeLabel) as TrainingType[]
                ).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTodayLogType(t)}
                    className={`flex-1 rounded-md py-2 font-medium ${
                      todayLogType === t
                        ? "bg-white text-neutral-900 shadow"
                        : "text-neutral-500"
                    }`}
                  >
                    {trainingTypeLabel[t]}
                  </button>
                ))}
              </div>
              <textarea
                value={todayLogText}
                onChange={(e) => setTodayLogText(e.target.value)}
                placeholder={
                  "例：\nBP\n60・80・90・100\n110kg×7、3\n\nトレーニングしながら、その場でメモしていってOKです"
                }
                rows={10}
                className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
              />
              <button
                onClick={handleSaveLog}
                disabled={savingLog}
                className="self-start rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white active:bg-emerald-700 disabled:opacity-50"
              >
                {todayLog ? "更新する" : "保存する"}
              </button>
            </div>
          )}
        </section>

        {/* 直近のトレーニング記録 */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            直近のトレーニング記録
          </h2>
          {loadingRecentLogs ? (
            <p className="text-xs text-neutral-400">読み込み中…</p>
          ) : recentLogs.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-400">
              まだ記録がありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentLogs.map((log) => (
                <details
                  key={log.id}
                  className="rounded-lg border border-neutral-200 p-3"
                >
                  <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-neutral-500">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${trainingTypeDotColor[log.type]}`}
                    />
                    {formatMonthDay(log.date)}・{trainingTypeLabel[log.type]}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                    {log.content || "(記録なし)"}
                  </p>
                </details>
              ))}
            </div>
          )}
        </section>

        {/* トレーニングカレンダー */}
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold text-neutral-700">
            トレーニングカレンダー
          </h2>
          <TrainingCalendar
            cursor={calendarCursor}
            onCursorChange={setCalendarCursor}
            weightLogs={calendarWeightLogs}
            absentLogs={calendarAbsentLogs}
          />
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

function TrainingCalendar({
  cursor,
  onCursorChange,
  weightLogs,
  absentLogs,
}: {
  cursor: Date;
  onCursorChange: (d: Date) => void;
  weightLogs: { date: string; type: TrainingType }[];
  absentLogs: { date: string; type: TrainingType }[];
}) {
  const dotsByDate = new Map<string, TrainingType[]>();
  for (const row of [...weightLogs, ...absentLogs]) {
    const list = dotsByDate.get(row.date) ?? [];
    list.push(row.type);
    dotsByDate.set(row.date, list);
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
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-neutral-400">
        {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const key = toDateKey(date);
          const dots = dotsByDate.get(key) ?? [];
          return (
            <div
              key={i}
              className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs text-neutral-600"
            >
              <span>{date.getDate()}</span>
              {dots.length > 0 && (
                <span className="flex flex-wrap justify-center gap-0.5">
                  {dots.map((t, idx) => (
                    <span
                      key={idx}
                      className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[t]}`}
                    />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-neutral-400">
        {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[t]}`}
            />
            {trainingTypeLabel[t]}
          </span>
        ))}
      </p>
    </div>
  );
}
