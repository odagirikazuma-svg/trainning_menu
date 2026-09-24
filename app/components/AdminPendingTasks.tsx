"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Location, SessionType } from "../lib/types";

/**
 * 管理者が部員のマイページ(閲覧)を開いたときに出す「未提出タスク」欄。
 *
 * 判定ルールは部員本人のマイページ（MemberHome / useMyTaskCount）と同じ：
 * - 対象期間：直近1か月（ただし部員の登録日より前は対象外）
 * - マット日報：所属拠点のメニュー（＋全体練習のメニュー）のうち、開始時刻を過ぎていて
 *   実施報告・未実施報告のどちらも出していないもの
 * - トレ報：所属拠点の時間割にマット以外（ラン・ウェイトなど）のセッションがある日で、
 *   トレーニングを提出していない日
 * - 怪我の経過報告：完治見込み日・次回通院日を過ぎていて、今日まだ経過を更新していないもの
 */

export type PendingTaskMember = {
  id: string;
  team_id: string;
  home_location: Location | null;
  created_at: string;
};

type PendingItem = {
  key: string;
  date: string | null; // タップで移動する日付（怪我は日付なし）
  sortDate: string;
  kind: "mat" | "self" | "injury";
  label: string;
};

type InjuryRow = {
  id: string;
  symptom_name: string;
  expected_recovery_date: string | null;
  next_hospital_date: string | null;
  is_recovered: boolean;
  progress_updated_at: string | null;
};

const kindLabel: Record<PendingItem["kind"], string> = {
  mat: "マット日報",
  self: "トレ報",
  injury: "怪我の経過",
};

const kindColor: Record<PendingItem["kind"], string> = {
  mat: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
  self: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400",
  injury:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
};

const COLLAPSED_COUNT = 5;

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthDayWeek(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${w})`;
}

function injuryNeedsProgressUpdate(inj: InjuryRow, todayStr: string): boolean {
  if (inj.is_recovered) return false;
  const triggerDates = [inj.expected_recovery_date, inj.next_hospital_date]
    .filter((d): d is string => !!d)
    .sort();
  if (triggerDates.length === 0) return false;
  if (triggerDates[0] > todayStr) return false;
  if (inj.progress_updated_at) {
    const updatedDateStr = toDateKey(new Date(inj.progress_updated_at));
    if (updatedDateStr >= todayStr) return false;
  }
  return true;
}

export default function AdminPendingTasks({
  member,
  onSelectDate,
}: {
  member: PendingTaskMember;
  onSelectDate: (date: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<PendingItem[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const now = new Date();
        const todayStr = toDateKey(now);
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        const joined = toDateKey(new Date(member.created_at));
        const rangeStart =
          toDateKey(oneMonthAgo) > joined ? toDateKey(oneMonthAgo) : joined;
        const loc = member.home_location;
        const result: PendingItem[] = [];

        if (loc) {
          // マット日報：所属拠点のメニュー＋全体練習のメニュー
          type MenuRow = {
            id: string;
            date: string;
            start_time: string | null;
            is_joint: boolean;
          };
          const [own, joint] = await Promise.all([
            supabase
              .from("menus")
              .select("id, date, start_time, is_joint")
              .eq("team_id", member.team_id)
              .eq("location", loc)
              .eq("is_off", false)
              .gte("date", rangeStart)
              .lte("date", todayStr),
            supabase
              .from("menus")
              .select("id, date, start_time, is_joint")
              .eq("team_id", member.team_id)
              .eq("is_joint", true)
              .eq("is_off", false)
              .gte("date", rangeStart)
              .lte("date", todayStr),
          ]);
          if (own.error) throw new Error(own.error.message);
          if (joint.error) throw new Error(joint.error.message);
          const menuMap = new Map<string, MenuRow>();
          for (const m of [
            ...((own.data ?? []) as MenuRow[]),
            ...((joint.data ?? []) as MenuRow[]),
          ])
            menuMap.set(m.id, m);
          const openMenus = Array.from(menuMap.values()).filter((m) =>
            !m.start_time ? true : now >= new Date(`${m.date}T${m.start_time}`)
          );

          if (openMenus.length > 0) {
            const { data: commentData, error: commentError } = await supabase
              .from("comments")
              .select("menu_id")
              .eq("author_id", member.id)
              .in(
                "menu_id",
                openMenus.map((m) => m.id)
              )
              .in("kind", ["report", "absent"]);
            if (commentError) throw new Error(commentError.message);
            const responded = new Set(
              ((commentData ?? []) as { menu_id: string }[]).map((c) => c.menu_id)
            );
            for (const m of openMenus) {
              if (responded.has(m.id)) continue;
              result.push({
                key: `mat-${m.id}`,
                date: m.date,
                sortDate: m.date,
                kind: "mat",
                label: `${formatMonthDayWeek(m.date)}${
                  m.start_time ? ` ${m.start_time.slice(0, 5)}〜` : ""
                }${m.is_joint ? "（全体練習）" : ""}`,
              });
            }
          }

          // トレ報：マット以外のセッションがある日
          const { data: scheduleData, error: scheduleError } = await supabase
            .from("schedule_days")
            .select("date, sessions:schedule_sessions(session_type)")
            .eq("team_id", member.team_id)
            .eq("location", loc)
            .eq("is_off", false)
            .gte("date", rangeStart)
            .lte("date", todayStr);
          if (scheduleError) throw new Error(scheduleError.message);
          const selfDates = (
            (scheduleData ?? []) as unknown as {
              date: string;
              sessions: { session_type: SessionType }[];
            }[]
          )
            .filter((row) => row.sessions.some((s) => s.session_type !== "mat"))
            .map((row) => row.date);

          if (selfDates.length > 0) {
            const { data: logData, error: logError } = await supabase
              .from("weight_logs")
              .select("date")
              .eq("author_id", member.id)
              .gte("date", rangeStart)
              .lte("date", todayStr);
            if (logError) throw new Error(logError.message);
            const logged = new Set(
              ((logData ?? []) as { date: string }[]).map((r) => r.date)
            );
            for (const d of selfDates) {
              if (logged.has(d)) continue;
              result.push({
                key: `self-${d}`,
                date: d,
                sortDate: d,
                kind: "self",
                label: formatMonthDayWeek(d),
              });
            }
          }
        }

        // 怪我の経過報告
        const { data: injuryData, error: injuryError } = await supabase
          .from("injuries")
          .select(
            "id, symptom_name, expected_recovery_date, next_hospital_date, is_recovered, progress_updated_at"
          )
          .eq("author_id", member.id)
          .eq("is_recovered", false);
        if (injuryError) throw new Error(injuryError.message);
        for (const inj of (injuryData ?? []) as InjuryRow[]) {
          if (!injuryNeedsProgressUpdate(inj, todayStr)) continue;
          result.push({
            key: `injury-${inj.id}`,
            date: null,
            sortDate: todayStr,
            kind: "injury",
            label: `${inj.symptom_name}（経過の更新待ち）`,
          });
        }

        result.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
        if (!cancelled) {
          setItems(result);
          setErrorMsg(null);
        }
      } catch (e) {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, member.id, member.team_id, member.home_location, member.created_at]);

  const count = items?.length ?? 0;
  const visible =
    items && !showAll ? items.slice(0, COLLAPSED_COUNT) : (items ?? []);

  return (
    <section
      className={`flex flex-col gap-2 rounded-lg border p-3 ${
        count > 0
          ? "border-red-300 bg-red-50 dark:border-red-900/70 dark:bg-red-950/20"
          : "border-border-color bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          未提出タスク
        </h2>
        {items &&
          (count > 0 ? (
            <span className="rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">
              {count}件
            </span>
          ) : (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              すべて提出済み
            </span>
          ))}
      </div>

      {errorMsg ? (
        <p className="text-xs text-red-500">{errorMsg}</p>
      ) : !items ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : count === 0 ? (
        <p className="text-xs text-neutral-500">
          直近1か月に未提出のタスクはありません。
        </p>
      ) : (
        <>
          <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
            直近1か月分。日付を押すと、その日の記録を下に表示します。
          </p>
          <ul className="flex flex-col gap-1">
            {visible.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  disabled={!i.date}
                  onClick={() => i.date && onSelectDate(i.date)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs active:bg-neutral-200 disabled:active:bg-transparent dark:active:bg-neutral-800"
                >
                  <span
                    className={`shrink-0 rounded px-1.5 py-px text-[length:calc(10px+var(--fs-add))] font-medium ${kindColor[i.kind]}`}
                  >
                    {kindLabel[i.kind]}
                  </span>
                  <span className="flex-1 text-foreground">{i.label}</span>
                  {i.date && <span className="text-neutral-400">›</span>}
                </button>
              </li>
            ))}
          </ul>
          {count > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="self-start text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
            >
              {showAll ? "閉じる" : `すべて表示（残り${count - COLLAPSED_COUNT}件）`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
