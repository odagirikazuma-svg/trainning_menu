"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "../../../lib/supabase/client";
import { useProfile } from "../../../components/shell/AppShell";
import AdminPendingTasks from "../../../components/AdminPendingTasks";
import DailyReport from "../../../components/DailyReport";
import TrainingInsights from "../../../components/TrainingInsights";
import type { Profile } from "../../../components/AuthGate";
import {
  currentGrade,
  isStaffRole,
  locationLabel,
  roleLabel,
  TitleColor,
  TrainingType,
} from "../../../lib/types";

/**
 * 部員の閲覧用マイページ（管理ページ・チームページから開く）。
 * 本人のマイページの「日報」と「振り返り」を、見るだけの形で切り替えて表示する。
 * 管理者・マネージャーは、日報にリアクション・コメントができ、未提出タスクも見られる。
 */

type InjuryInfo = {
  symptom_name: string;
  body_part: string;
  expected_recovery_date: string | null;
  mat_participation: "yes" | "no" | "conditional";
  mat_participation_detail: string | null;
};

const matParticipationLabel: Record<"yes" | "no" | "conditional", string> = {
  yes: "可",
  no: "非",
  conditional: "条件付きで可",
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const emptyTitleOptions: Record<TrainingType, string[]> = { running: [], weight: [], other: [] };

function MemberView({ memberId, initialDate }: { memberId: string; initialDate: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { profile: viewer } = useProfile();
  const isStaffViewer = isStaffRole(viewer.role);
  const [member, setMember] = useState<Profile | null | undefined>(undefined);
  const [nextMatch, setNextMatch] = useState<{ name: string; date: string } | null>(null);
  const [injuries, setInjuries] = useState<InjuryInfo[]>([]);
  const [goals, setGoals] = useState<{ term: string; content: string }[]>([]);
  const [weightClass, setWeightClass] = useState<number | null>(null);
  const [tab, setTab] = useState<"daily" | "review">("daily");
  const [date, setDate] = useState(initialDate);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const emptyTitleColors = useMemo<Record<TrainingType, Map<string, TitleColor>>>(
    () => ({ running: new Map(), weight: new Map(), other: new Map() }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const todayStr = toDateKey(new Date());
      const [memberRes, matchRes, injuryRes, goalRes, classRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, team_id, display_name, role, home_location, entry_year, show_task_list, icon_url, created_at"
          )
          .eq("id", memberId)
          .maybeSingle(),
        supabase
          .from("matches")
          .select("name, date")
          .eq("member_id", memberId)
          .gte("date", todayStr)
          .order("date", { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("injuries")
          .select(
            "symptom_name, body_part, expected_recovery_date, mat_participation, mat_participation_detail"
          )
          .eq("author_id", memberId)
          .eq("is_recovered", false)
          .order("created_at", { ascending: false }),
        supabase
          .from("member_goals")
          .select("term, content")
          .eq("author_id", memberId)
          .in("term", ["long", "short"]),
        // 階級（列がまだ無い環境ではエラーになるので、別に読んで無視する）
        supabase.from("profiles").select("weight_class").eq("id", memberId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (memberRes.error) setErrorMsg(memberRes.error.message);
      setMember((memberRes.data as Profile | null) ?? null);
      setNextMatch((matchRes.data as { name: string; date: string } | null) ?? null);
      setInjuries((injuryRes.data ?? []) as InjuryInfo[]);
      setGoals(
        ((goalRes.error ? [] : goalRes.data) ?? []) as { term: string; content: string }[]
      );
      setWeightClass(
        classRes.error
          ? null
          : ((classRes.data as { weight_class: number | null } | null)?.weight_class ?? null)
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  if (member === undefined) {
    return <p className="p-4 text-xs text-neutral-500">読み込み中…</p>;
  }
  if (member === null) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-neutral-500">部員が見つかりませんでした。</p>
        <button
          onClick={() => router.back()}
          className="self-start rounded border border-border-color px-3 py-1.5 text-xs"
        >
          戻る
        </button>
      </div>
    );
  }

  const isPlayer = !isStaffRole(member.role) && member.role !== "ob";
  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;
  const longGoal = goals.find((g) => g.term === "long")?.content;
  const shortGoal = goals.find((g) => g.term === "short")?.content;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-background text-foreground">
      <header
        className="sticky z-10 flex items-center justify-between gap-2 border-b border-border-color bg-surface/95 px-4 py-3 backdrop-blur"
        style={{ top: "var(--app-header-height, 0px)" }}
      >
        <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground sm:text-lg">
          <span className="inline-block h-4 w-1 shrink-0 rounded-full bg-red-600" />
          <span className="truncate">{member.display_name}のマイページ（閲覧）</span>
        </h1>
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/team"))}
          className="shrink-0 rounded border border-border-color px-2.5 py-1.5 text-[length:calc(11px+var(--fs-add))] text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          戻る
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-400">
            {errorMsg}
          </p>
        )}

        {/* 基本情報・目標・怪我 */}
        <div className="flex flex-col gap-2 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="rounded bg-surface-2 px-2 py-1">{roleLabel[member.role]}</span>
            {member.home_location && (
              <span className="rounded bg-surface-2 px-2 py-1">{locationLabel[member.home_location]}</span>
            )}
            {member.entry_year != null && (
              <span className="rounded bg-surface-2 px-2 py-1">{currentGrade(member.entry_year)}年</span>
            )}
            {weightClass != null && (
              <span className="rounded bg-surface-2 px-2 py-1">{weightClass}kg級</span>
            )}
            {nextMatch && matchDays != null && (
              <span className="rounded bg-amber-100 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                次の試合まであと{matchDays}日（{nextMatch.name}）
              </span>
            )}
          </div>
          {(longGoal || shortGoal) && (
            <div className="flex flex-col gap-1 text-sm">
              {longGoal && (
                <p>
                  <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    年間目標
                  </span>
                  {longGoal}
                </p>
              )}
              {shortGoal && (
                <p>
                  <span className="mr-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    月間目標
                  </span>
                  {shortGoal}
                </p>
              )}
            </div>
          )}
          {injuries.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs dark:border-red-900/50 dark:bg-red-950/20">
              <span className="font-bold text-red-700 dark:text-red-300">🩹 治療中の怪我</span>
              {injuries.map((inj, i) => (
                <span key={i} className="text-neutral-800 dark:text-neutral-200">
                  {inj.symptom_name}（{inj.body_part}）・マット参加：
                  {matParticipationLabel[inj.mat_participation]}
                  {inj.mat_participation === "conditional" && inj.mat_participation_detail
                    ? `（${inj.mat_participation_detail}）`
                    : ""}
                  {inj.expected_recovery_date
                    ? `・完治見込み ${formatMonthDay(inj.expected_recovery_date)}`
                    : ""}
                </span>
              ))}
            </div>
          )}
        </div>

        {isStaffViewer && isPlayer && (
          <AdminPendingTasks
            member={member}
            onSelectDate={(d) => {
              setTab("daily");
              setDate(d);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}

        {isPlayer && (
          <>
            {/* 日報／振り返り の切り替え */}
            <div className="flex gap-1 rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800">
              {(
                [
                  { v: "daily", label: "日報" },
                  { v: "review", label: "振り返り" },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setTab(t.v)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold ${
                    tab === t.v
                      ? "bg-red-600 text-white shadow"
                      : "text-neutral-600 dark:text-neutral-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "daily" ? (
              <DailyReport
                profile={member}
                date={date}
                onDateChange={setDate}
                readOnly
                viewer={viewer}
                titleOptions={emptyTitleOptions}
                titleColors={emptyTitleColors}
              />
            ) : (
              <TrainingInsights
                profile={member}
                viewerId={viewer.id}
                // 疲労度（今の体の状態）は本人と監督・コーチだけ
                showBodyState={viewer.role === "coach" || viewer.id === member.id}
              />
            )}
          </>
        )}

        <p className="border-t border-neutral-200 pt-3 text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:border-neutral-800">
          このページは閲覧専用です。記録の編集はご本人のマイページから行われます。
        </p>
      </div>
    </div>
  );
}

export default function TeamMemberRoute() {
  const params = useParams<{ memberId: string }>();
  const searchParams = useSearchParams();
  const memberId = Array.isArray(params.memberId) ? params.memberId[0] : params.memberId;
  const date = searchParams.get("date") ?? toDateKey(new Date());
  return memberId ? <MemberView memberId={memberId} initialDate={date} /> : null;
}
