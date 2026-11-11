"use client";

import { absenceCoversMat } from "../../lib/absence";
import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { currentGrade, locationLabel, type Location } from "../../lib/types";

// 練習予定表：メニューの下に出す「参加予定者／参加者・欠席者」。
// - 練習前：その拠点の部員（全体練習は全員）が参加予定。休み申請（申請中・承認済み）を出した人は欠席
// - 練習後：日報の実施報告を出した人が参加、未実施報告・承認済みの休みは欠席、どちらもない人は未報告
// 休み申請は理由を伏せて、状態（申請中・承認済み）だけを見せる（team_absences 関数）

type Member = { id: string; display_name: string; home_location: Location | null; entry_year: number | null };
type Absence = { author_id: string; status: "pending" | "approved"; session_keys?: string[] | null };

export default function ParticipantsPanel({
  menuId,
  teamId,
  date,
  location,
  isJoint,
  started,
  isStaff,
  startTime,
}: {
  menuId: string;
  teamId: string;
  date: string;
  location: Location;
  isJoint: boolean;
  started: boolean;
  isStaff: boolean;
  // この練習の開始時刻（休むセクションにこの練習が入っているかを見る）
  startTime?: string | null;
}) {
  const supabase = createClient();
  const [data, setData] = useState<{
    members: Member[];
    absences: Absence[];
    reports: { author_id: string; kind: string }[];
  } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    (async () => {
      const [mRes, aRes, cRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, home_location, entry_year")
          .eq("team_id", teamId)
          .not("role", "in", "(coach,manager,ob)"),
        supabase.rpc("team_absences", { p_date: date }),
        started
          ? supabase
              .from("comments")
              .select("author_id, kind")
              .eq("menu_id", menuId)
              .in("kind", ["report", "absent"])
              .is("parent_id", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      // 関数がまだ無いDBでは、管理者だけ表から直接読む
      let absences = (aRes.error ? [] : aRes.data ?? []) as Absence[];
      if (aRes.error && isStaff) {
        const { data: rows } = await supabase
          .from("absence_requests")
          .select("author_id, status, session_keys")
          .eq("date", date)
          .in("status", ["pending", "approved"]);
        absences = (rows ?? []) as Absence[];
      }
      if (cancelled) return;
      setData({
        members: (mRes.data ?? []) as Member[],
        absences,
        reports: (cRes.data ?? []) as { author_id: string; kind: string }[],
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, date, started]);

  if (!data) {
    return <p className="text-xs text-neutral-500">参加者を集計中…</p>;
  }

  const targets = data.members
    .filter((m) => isJoint || m.home_location === location)
    .sort(
      (a, b) =>
        (a.entry_year ?? 9999) - (b.entry_year ?? 9999) ||
        a.display_name.localeCompare(b.display_name, "ja")
    );
  const absenceOf = new Map(
    data.absences.filter((a) => absenceCoversMat(a.session_keys, startTime)).map((a) => [a.author_id, a.status])
  );
  const reportOf = new Map(data.reports.map((r) => [r.author_id, r.kind]));

  type Absent = { m: Member; badge: "approved" | "pending" | "report" };
  const going: Member[] = [];
  const absent: Absent[] = [];
  const unknown: Member[] = [];
  for (const m of targets) {
    const a = absenceOf.get(m.id);
    if (!started) {
      if (a) absent.push({ m, badge: a });
      else going.push(m);
    } else {
      const r = reportOf.get(m.id);
      if (r === "report") going.push(m);
      else if (r === "absent" || a) absent.push({ m, badge: a ?? "report" });
      else unknown.push(m);
    }
  }

  const badge: Record<Absent["badge"], { text: string; cls: string }> = {
    approved: { text: "報告済み", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
    pending: { text: "申請中", cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
    report: { text: "申請なし", cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  };
  const grade = (m: Member) => (m.entry_year ? `${currentGrade(m.entry_year)}年` : "");
  const chip = "rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200";
  const scope = isJoint ? "全体（合同）" : locationLabel[location];

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
          👥 {started ? "参加者" : "参加予定者"}（{scope}）
        </span>
        <span className="flex items-center gap-2 text-xs">
          <span className="font-bold text-emerald-700 dark:text-emerald-400">
            {started ? "参加" : "参加予定"} {going.length}人
          </span>
          <span className="font-bold text-red-700 dark:text-red-400">欠席 {absent.length}人</span>
          {started && unknown.length > 0 && (
            <span className="text-neutral-500">未報告 {unknown.length}人</span>
          )}
          <span className="text-neutral-500">{open ? "▴" : "▾"}</span>
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-neutral-100 pt-2 dark:border-neutral-800">
          <div className="flex flex-col gap-1.5">
            <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-emerald-700 dark:text-emerald-400">
              {started ? "参加" : "参加予定"}（{going.length}人）
            </span>
            {going.length === 0 ? (
              <span className="text-xs text-neutral-500">なし</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {going.map((m) => (
                  <span key={m.id} className={chip}>
                    {m.display_name}
                    <span className="ml-1 text-[length:calc(10px+var(--fs-add))] text-neutral-500">{grade(m)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-red-700 dark:text-red-400">
              欠席（{absent.length}人）
            </span>
            {absent.length === 0 ? (
              <span className="text-xs text-neutral-500">なし</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {absent.map(({ m, badge: b }) => (
                  <span key={m.id} className={`${chip} flex items-center gap-1`}>
                    {m.display_name}
                    <span className={`rounded-full px-1.5 py-0.5 text-[length:calc(9px+var(--fs-add))] font-bold ${badge[b].cls}`}>
                      {badge[b].text}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {started && unknown.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-600 dark:text-neutral-400">
                未報告（{unknown.length}人）
              </span>
              <div className="flex flex-wrap gap-1.5">
                {unknown.map((m) => (
                  <span key={m.id} className={`${chip} opacity-70`}>
                    {m.display_name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!started && (
            <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
              {scope}の部員は、休み申請を出していなければ参加予定です。練習が始まると、日報の報告をもとに参加・欠席を表示します。
            </p>
          )}
        </div>
      )}
    </section>
  );
}
