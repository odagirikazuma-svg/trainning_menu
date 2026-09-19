"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { Location, locationLabel, locations } from "../../lib/types";
import type { Profile } from "../AuthGate";

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

type MemberRow = { id: string; role: string; home_location: Location | null };

// member_rosterテーブルのroleカラムに入り得る値（coach/manager/obは除外対象なので合わせて絞る）
type RosterRoleForHeader = "captain" | "vice_captain" | "coach" | "member";

async function countSubmission(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  loc: Location,
  dateStr: string,
  members: MemberRow[]
): Promise<{ submitted: number; total: number } | null> {
  const requiredMembers = members.filter(
    (m) =>
      m.role !== "coach" &&
      m.role !== "manager" &&
      m.role !== "ob" &&
      (m.home_location === loc || (loc === "tama" && m.home_location == null))
  );
  const total = requiredMembers.length;
  if (total === 0) return null;

  const { data: scheduleRows } = await supabase
    .from("schedule_days")
    .select("is_off, sessions:schedule_sessions(session_type)")
    .eq("team_id", teamId)
    .eq("location", loc)
    .eq("date", dateStr)
    .maybeSingle();

  if (!scheduleRows || scheduleRows.is_off) return null;
  const sessions = (scheduleRows as unknown as {
    sessions: { session_type: string }[];
  }).sessions;
  const hasMat = sessions.some((s) => s.session_type === "mat");
  const hasNonMat = sessions.some((s) => s.session_type !== "mat");
  if (!hasMat && !hasNonMat) return null;

  const ids = requiredMembers.map((m) => m.id);

  let submittedMatIds = new Set<string>();
  if (hasMat) {
    const { data: menuRows } = await supabase
      .from("menus")
      .select("id")
      .eq("team_id", teamId)
      .eq("is_off", false)
      .eq("date", dateStr)
      .or(`location.eq.${loc},is_joint.eq.true`);
    const menuIds = ((menuRows ?? []) as { id: string }[]).map((m) => m.id);
    if (menuIds.length > 0) {
      const { data: commentRows } = await supabase
        .from("comments")
        .select("author_id")
        .in("menu_id", menuIds)
        .in("kind", ["report", "absent"])
        .in("author_id", ids);
      submittedMatIds = new Set(
        ((commentRows ?? []) as { author_id: string }[]).map(
          (r) => r.author_id
        )
      );
    }
  }

  let submittedSelfIds = new Set<string>();
  if (hasNonMat) {
    const { data: logRows } = await supabase
      .from("weight_logs")
      .select("author_id")
      .eq("date", dateStr)
      .in("author_id", ids);
    submittedSelfIds = new Set(
      ((logRows ?? []) as { author_id: string }[]).map((r) => r.author_id)
    );
  }

  const submitted = ids.filter((id) => {
    const matOk = !hasMat || submittedMatIds.has(id);
    const selfOk = !hasNonMat || submittedSelfIds.has(id);
    return matOk && selfOk;
  }).length;

  return { submitted, total };
}

function MemberHeaderInfo({ profile }: { profile: Profile }) {
  const [nextMatch, setNextMatch] = useState<{
    name: string;
    date: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data } = await supabase
        .from("matches")
        .select("name, date")
        .eq("team_id", profile.team_id)
        .eq("member_id", profile.id)
        .gte("date", toDateKey(new Date()))
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setNextMatch((data as { name: string; date: string } | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.team_id, profile.id]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">
        {profile.display_name}
      </span>
      {nextMatch ? (
        <div className="flex min-w-0 items-center gap-2 rounded-lg bg-red-600 px-2.5 py-1.5 shadow-sm">
          <span className="shrink-0 text-[10px] font-semibold leading-none text-red-100">
            次の試合まで
          </span>
          <span className="shrink-0 text-2xl font-extrabold leading-none text-white">
            あと{daysUntil(nextMatch.date)}日
          </span>
          <span className="min-w-0 truncate text-xs font-semibold leading-none text-red-100">
            【{nextMatch.name}】
          </span>
        </div>
      ) : (
        <span className="text-[11px] text-neutral-500 dark:text-neutral-400">
          次の試合の予定はまだありません
        </span>
      )}
    </div>
  );
}

type SubmissionStats = {
  today: Record<Location, { submitted: number; total: number } | null>;
  yesterday: Record<Location, { submitted: number; total: number } | null>;
};

function CoachHeaderInfo({ profile }: { profile: Profile }) {
  const [stats, setStats] = useState<SubmissionStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const { data: memberData } = await supabase
        .from("profiles")
        .select("id, role, home_location")
        .eq("team_id", profile.team_id);
      const realMembers = (memberData ?? []) as MemberRow[];

      // まだ本人がサインアップ（メアド登録）していない部員も、
      // 母数（total）にはカウントする
      const { data: rosterData } = await supabase
        .from("member_roster")
        .select("id, role, home_location")
        .eq("team_id", profile.team_id)
        .is("claimed_by", null);
      const pendingMembers: MemberRow[] = (
        (rosterData ?? []) as {
          id: string;
          role: RosterRoleForHeader;
          home_location: Location | null;
        }[]
      ).map((r) => ({
        id: `pending:${r.id}`,
        role: r.role === "vice_captain" ? "vice_leader" : r.role,
        home_location: r.home_location,
      }));

      const members = [...realMembers, ...pendingMembers];

      const today = toDateKey(new Date());
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yesterday = toDateKey(y);

      const [todayTama, todayOtsuka, yesterdayTama, yesterdayOtsuka] =
        await Promise.all([
          countSubmission(supabase, profile.team_id, "tama", today, members),
          countSubmission(supabase, profile.team_id, "otsuka", today, members),
          countSubmission(
            supabase,
            profile.team_id,
            "tama",
            yesterday,
            members
          ),
          countSubmission(
            supabase,
            profile.team_id,
            "otsuka",
            yesterday,
            members
          ),
        ]);

      if (!cancelled) {
        setStats({
          today: { tama: todayTama, otsuka: todayOtsuka },
          yesterday: { tama: yesterdayTama, otsuka: yesterdayOtsuka },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile.team_id]);

  const todayStr = toDateKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterdayStr = toDateKey(y);

  function line(label: string, dateStr: string, s: SubmissionStats | null) {
    return (
      <span className="block truncate">
        {label}（{formatMonthDay(dateStr)}）：
        {locations
          .map((loc) => {
            const v = s ? (dateStr === todayStr ? s.today[loc] : s.yesterday[loc]) : null;
            return `${locationLabel[loc]}：${v ? `${v.submitted}人/${v.total}人提出` : "―"}`;
          })
          .join("　")}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-sm font-semibold text-foreground">
        {profile.display_name}
      </span>
      <span className="text-[10px] leading-tight text-neutral-500 dark:text-neutral-400">
        {line("昨日の提出状況", yesterdayStr, stats)}
        {line("今日の提出状況", todayStr, stats)}
      </span>
    </div>
  );
}

export default function Header({
  profile,
  onHeightChange,
}: {
  profile: Profile;
  // ヘッダーの実際の高さをAppShellに伝える（内容量に応じてヘッダーの高さが
  // 変わっても、本文側のpaddingTopがズレて内容が隠れないようにするため）
  onHeightChange?: (height: number) => void;
}) {
  const headerRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <header
      ref={headerRef}
      className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-border-color bg-surface/95 px-4 py-2.5 shadow-[0_4px_10px_rgba(0,0,0,0.12)] backdrop-blur dark:shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
      style={{ paddingTop: "calc(1.5rem + env(safe-area-inset-top))" }}
    >
      <span className="inline-block h-6 w-1 shrink-0 rounded-full bg-red-600" />
      {profile.role === "coach" ? (
        <CoachHeaderInfo profile={profile} />
      ) : (
        <MemberHeaderInfo profile={profile} />
      )}
    </header>
  );
}
