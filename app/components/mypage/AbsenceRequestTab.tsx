"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import type { Profile } from "../AuthGate";
import AbsenceRequestPanel from "../AbsenceRequestPanel";
import { absenceReasonLabel, absenceStatusCls, type AbsenceRequest } from "../../lib/absence";

// マイページ「申請」タブの上半分：休みの申請。
// 日付を選んで申請・確認する。下に、前後2週間の自分の休みの一覧（病院の報告がまだのものも分かる）
function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function md(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { m, d, w: "日月火水木金土"[new Date(y, m - 1, d).getDay()] };
}

export default function AbsenceRequestTab({
  profile,
  date,
  onDateChange,
  todayStr,
  onChanged,
}: {
  profile: Profile;
  date: string;
  onDateChange: (d: string) => void;
  todayStr: string;
  onChanged?: () => void;
}) {
  const supabase = createClient();
  const [list, setList] = useState<AbsenceRequest[]>([]);
  const [listKey, setListKey] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: 29 }, (_, i) => addDays(todayStr, i - 14));

  useEffect(() => {
    supabase
      .from("absence_requests")
      .select("*")
      .eq("author_id", profile.id)
      .gte("date", addDays(todayStr, -14))
      .lte("date", addDays(todayStr, 30))
      .order("date")
      .then(({ data }) => setList((data ?? []) as AbsenceRequest[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // 選んでいる日が見えるように横スクロール
  useEffect(() => {
    stripRef.current?.querySelector(`[data-date="${date}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [date]);

  const byDate = new Map(list.map((r) => [r.date, r]));

  return (
    <section className="flex flex-col gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-800">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        休みの申請
      </h2>
      <div ref={stripRef} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const { m, d: day, w } = md(d);
          const r = byDate.get(d);
          const active = d === date;
          return (
            <button
              key={d}
              data-date={d}
              type="button"
              onClick={() => onDateChange(d)}
              className={`flex w-11 shrink-0 flex-col items-center rounded-lg border py-1 text-xs ${
                active
                  ? "border-red-600 bg-red-600 text-white"
                  : d === todayStr
                    ? "border-blue-400 bg-blue-50 text-neutral-900 dark:bg-blue-950/30 dark:text-neutral-100"
                    : "border-neutral-200 bg-white text-neutral-800 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
              }`}
            >
              <span className={`text-[length:calc(9px+var(--fs-add))] ${active ? "text-white/80" : "text-neutral-500"}`}>
                {day === 1 || d === days[0] ? `${m}/` : ""}
                {w}
              </span>
              <span className="font-bold">{day}</span>
              <span
                className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                  r && r.status !== "rejected" ? (active ? "bg-white" : "bg-amber-500") : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <AbsenceRequestPanel
        key={date}
        profile={profile}
        memberId={profile.id}
        teamId={profile.team_id}
        date={date}
        todayStr={todayStr}
        onChange={() => {
          setListKey((k) => k + 1);
          onChanged?.();
        }}
      />

      {list.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-neutral-500">前後の休み</span>
          {list.map((r) => {
            const { m, d, w } = md(r.date);
            const needHospital = r.reason_type === "sick" && r.status !== "rejected" && !r.hospital_name && !r.hospital_result;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onDateChange(r.date)}
                className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-left text-xs dark:bg-neutral-900"
              >
                <span className="text-neutral-800 dark:text-neutral-200">
                  {m}/{d}（{w}） {absenceReasonLabel[r.reason_type]}
                </span>
                <span className="flex items-center gap-1.5">
                  {needHospital && (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                      病院の報告まだ
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold ${absenceStatusCls[r.status]}`}>
                    {r.status === "rejected" ? "取り消し" : "報告済み"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
