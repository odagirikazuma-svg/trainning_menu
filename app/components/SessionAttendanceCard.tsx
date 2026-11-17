"use client";

// 練習予定表：表示中の日・拠点の、セクションごとの参加人数
// 休みの申請（申請中・報告済み）と、授業の時間割（授業で休み／遅れて参加／早めに抜ける）から数える
// 休みの申請は理由を伏せた team_absences 関数で読む（部員が見ても同じ人数になる）

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { absenceCoversMat, sessionKey } from "../lib/absence";
import { classImpact, impactShort, loadClassLookup, periodsText, type ClassImpact } from "../lib/classSchedule";
import { currentGrade, locationLabel, type Location } from "../lib/types";

type Member = { id: string; display_name: string; home_location: Location | null; entry_year: number | null };
type Session = {
  session_no: number;
  session_type: "mat" | "running" | "weight";
  start_time: string | null;
  is_joint: boolean;
  joint_location: Location | null;
};
type Row = {
  loc: Location;
  s: Session;
  going: { m: Member; c?: ClassImpact }[];
  byClass: { m: Member; c: ClassImpact }[];
  byAbsence: Member[];
};

const typeLabel = { mat: "マット", running: "ラン", weight: "ウェイト" } as const;


export default function SessionAttendanceCard({
  teamId,
  date,
  location,
}: {
  teamId: string;
  date: string;
  // 表示中の拠点（合同練習はどちらの拠点でも出す）
  location: Location;
}) {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    (async () => {
      const [mRes, dRes, aRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, home_location, entry_year")
          .eq("team_id", teamId)
          .not("role", "in", "(coach,manager,ob)"),
        supabase
          .from("schedule_days")
          .select("location, is_off, sessions:schedule_sessions(session_no, session_type, start_time, is_joint, joint_location)")
          .eq("team_id", teamId)
          .eq("date", date),
        supabase.rpc("team_absences", { p_date: date }),
      ]);
      const members = ((mRes.data ?? []) as Member[]).sort(
        (a, b) => (a.entry_year ?? 9999) - (b.entry_year ?? 9999) || a.display_name.localeCompare(b.display_name, "ja")
      );
      const lookup = await loadClassLookup(supabase, teamId, members.map((m) => m.id), date, date);
      const absences = new Map(
        ((aRes.error ? [] : aRes.data ?? []) as { author_id: string; session_keys: string[] | null }[]).map((a) => [
          a.author_id,
          a.session_keys,
        ])
      );
      const out: Row[] = [];
      const jointSeen = new Set<string>();
      for (const d of (dRes.data ?? []) as unknown as { location: Location; is_off: boolean; sessions: Session[] }[]) {
        if (d.is_off) continue;
        for (const s of [...d.sessions].sort((a, b) => a.session_no - b.session_no)) {
          // 合同練習は両拠点の部員が対象（同じ合同練習は1回だけ出す）
          if (s.is_joint) {
            const jk = `${s.session_type}@${s.start_time}`;
            if (jointSeen.has(jk)) continue;
            jointSeen.add(jk);
          }
          const targets = s.is_joint ? members : members.filter((m) => m.home_location === d.location);
          const row: Row = { loc: s.is_joint ? s.joint_location ?? d.location : d.location, s, going: [], byClass: [], byAbsence: [] };
          for (const m of targets) {
            if (absences.has(m.id)) {
              const keys = absences.get(m.id);
              const covered =
                s.session_type === "mat"
                  ? absenceCoversMat(keys, s.start_time)
                  : !keys || keys.length === 0 || keys.includes(sessionKey(s.session_type, s.start_time));
              if (covered) {
                row.byAbsence.push(m);
                continue;
              }
            }
            const c = classImpact(s.session_type, s.start_time, lookup(m.id, date));
            if (c?.status === "absent") row.byClass.push({ m, c });
            else row.going.push({ m, c: c ?? undefined });
          }
          out.push(row);
        }
      }
      out.sort((a, b) => (a.s.start_time ?? "").localeCompare(b.s.start_time ?? ""));
      // 表示中の拠点の練習と、合同練習だけ
      if (!cancelled) setRows(out.filter((r) => r.s.is_joint || r.loc === location));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, date, location]);

  const grade = (m: Member) => (m.entry_year ? `${currentGrade(m.entry_year)}年` : "");
  const chip = "rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200";

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-color bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          セクションごとの参加人数
        </h2>
      </div>
      {!rows ? (
        <p className="text-xs text-neutral-500">集計中…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-neutral-500">この日の時間割（セクション）はありません。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const key = `${r.loc}-${r.s.session_no}`;
            const open = openKey === key;
            const lateEarly = r.going.filter((g) => g.c);
            return (
              <li key={key} className="rounded-lg border border-neutral-200 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : key)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold">
                    {r.s.is_joint ? "合同・" : ""}
                    {locationLabel[r.loc]}・{typeLabel[r.s.session_type]} {r.s.start_time?.slice(0, 5) ?? ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs">
                    <span className="font-bold text-emerald-700 dark:text-emerald-400">参加 {r.going.length}人</span>
                    {lateEarly.length > 0 && (
                      <span className="text-sky-700 dark:text-sky-400">（遅刻・早退 {lateEarly.length}）</span>
                    )}
                    <span className="font-bold text-sky-700 dark:text-sky-400">授業 {r.byClass.length}人</span>
                    <span className="font-bold text-red-700 dark:text-red-400">休み {r.byAbsence.length}人</span>
                    <span className="text-neutral-500">{open ? "▴" : "▾"}</span>
                  </span>
                </button>
                {open && (
                  <div className="flex flex-col gap-2 border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
                    <Group title={`授業で出られない（${r.byClass.length}人）`} cls="text-sky-700 dark:text-sky-400">
                      {r.byClass.map(({ m, c }) => (
                        <span key={m.id} className={chip}>
                          {m.display_name} <span className="text-neutral-500">{grade(m)}・{periodsText(c.periods)}</span>
                        </span>
                      ))}
                    </Group>
                    {lateEarly.length > 0 && (
                      <Group title={`遅れて参加・早めに抜ける（${lateEarly.length}人）`} cls="text-sky-700 dark:text-sky-400">
                        {lateEarly.map(({ m, c }) => (
                          <span key={m.id} className={chip}>
                            {m.display_name}{" "}
                            <span className="text-neutral-500">
                              {impactShort(c!)}・{periodsText(c!.periods)}
                            </span>
                          </span>
                        ))}
                      </Group>
                    )}
                    <Group title={`休みの申請（${r.byAbsence.length}人）`} cls="text-red-700 dark:text-red-400">
                      {r.byAbsence.map((m) => (
                        <span key={m.id} className={chip}>
                          {m.display_name} <span className="text-neutral-500">{grade(m)}</span>
                        </span>
                      ))}
                    </Group>
                    <Group title={`参加（${r.going.length}人）`} cls="text-emerald-700 dark:text-emerald-400">
                      {r.going.map(({ m }) => (
                        <span key={m.id} className={chip}>
                          {m.display_name} <span className="text-neutral-500">{grade(m)}</span>
                        </span>
                      ))}
                    </Group>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
        授業は部員が登録した時間割から自動で反映します（練習の半分以上が授業なら欠席、それ未満なら遅刻・早退）。練習の長さはマット2時間・ラン1時間・ウェイト1時間半で見ています。
      </p>
    </section>
  );
}

function Group({ title, cls, children }: { title: string; cls: string; children: React.ReactNode[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[length:calc(11px+var(--fs-add))] font-semibold ${cls}`}>{title}</span>
      {children.length === 0 ? (
        <span className="text-xs text-neutral-500">なし</span>
      ) : (
        <div className="flex flex-wrap gap-1.5">{children}</div>
      )}
    </div>
  );
}
