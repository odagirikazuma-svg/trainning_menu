"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { isStaffRole, Location, locationLabel, locations } from "../../lib/types";
import { GOALS_CHANGED_EVENT, goalTerms, type GoalTerm } from "../../lib/goals";
import type { Profile } from "../AuthGate";
import { isExemptOn, loadExemptions } from "../../lib/exemptions";

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

type DayCount = { submitted: number; total: number } | null;

/**
 * 指定した日（昨日・今日）× 拠点（多摩・大塚）ごとの「日報を出し終えた人数／対象人数」を、
 * まとめて数える。以前は日×拠点ごとに5回ずつ読み込んでいたが、全部で5回にまとめた。
 * 判定：その日のマットメニュー（拠点＋全体練習）すべてに報告し、
 *       ラン・ウェイト等がある日はトレ報も出していれば「提出済み」
 */
async function countSubmissions(
  supabase: ReturnType<typeof createClient>,
  teamId: string,
  dates: string[],
  members: MemberRow[]
): Promise<Map<string, DayCount>> {
  const from = dates.slice().sort()[0];
  const to = dates.slice().sort()[dates.length - 1];
  const [exemptions, schedRes, menuRes, logRes] = await Promise.all([
    loadExemptions(supabase, teamId, from, to),
    supabase
      .from("schedule_days")
      .select("date, location, is_off, sessions:schedule_sessions(session_type)")
      .eq("team_id", teamId)
      .in("date", dates),
    supabase
      .from("menus")
      .select("id, date, location, is_joint")
      .eq("team_id", teamId)
      .eq("is_off", false)
      .in("date", dates),
    supabase
      .from("weight_logs")
      .select("author_id, date")
      .eq("team_id", teamId)
      .in("date", dates),
  ]);
  const menus = (menuRes.data ?? []) as {
    id: string;
    date: string;
    location: Location;
    is_joint: boolean;
  }[];
  const reportRes =
    menus.length > 0
      ? await supabase
          .from("comments")
          .select("author_id, menu_id")
          .in(
            "menu_id",
            menus.map((m) => m.id)
          )
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
      : { data: [] };
  const reported = new Set(
    ((reportRes.data ?? []) as { author_id: string; menu_id: string }[]).map(
      (r) => `${r.author_id}:${r.menu_id}`
    )
  );
  const logged = new Set(
    ((logRes.data ?? []) as { author_id: string; date: string }[]).map(
      (r) => `${r.author_id}:${r.date}`
    )
  );
  const schedule = (schedRes.data ?? []) as unknown as {
    date: string;
    location: Location;
    is_off: boolean;
    sessions: { session_type: string }[];
  }[];

  const out = new Map<string, DayCount>();
  for (const date of dates) {
    for (const loc of locations) {
      const key = `${date}:${loc}`;
      const day = schedule.find((d) => d.date === date && d.location === loc);
      if (!day || day.is_off) {
        out.set(key, null);
        continue;
      }
      const hasMat = day.sessions.some((x) => x.session_type === "mat");
      const hasNonMat = day.sessions.some((x) => x.session_type !== "mat");
      if (!hasMat && !hasNonMat) {
        out.set(key, null);
        continue;
      }
      const required = members.filter(
        (m) =>
          m.role !== "coach" &&
          m.role !== "manager" &&
          m.role !== "ob" &&
          (m.home_location === loc || (loc === "tama" && m.home_location == null)) &&
          !isExemptOn(exemptions, m.id, date)
      );
      if (required.length === 0) {
        out.set(key, null);
        continue;
      }
      const dayMenus = hasMat
        ? menus.filter((mm) => mm.date === date && (mm.location === loc || mm.is_joint))
        : [];
      const submitted = required.filter((m) => {
        const matOk =
          !hasMat || (dayMenus.length > 0 && dayMenus.some((mm) => reported.has(`${m.id}:${mm.id}`)));
        const selfOk = !hasNonMat || logged.has(`${m.id}:${date}`);
        return matOk && selfOk;
      }).length;
      out.set(key, { submitted, total: required.length });
    }
  }
  return out;
}

/**
 * ヘッダーの目標表示。年間目標と月間目標を5秒ごとにふわっと切り替える。
 * 目標は設定タブで編集し、保存されたら GOALS_CHANGED_EVENT で読み直す。
 */
function GoalTicker({ profile }: { profile: Profile }) {
  const [goals, setGoals] = useState<{ term: GoalTerm; content: string }[] | null>(null);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    async function load() {
      const { data, error } = await supabase
        .from("member_goals")
        .select("term, content, updated_at")
        .eq("author_id", profile.id)
        .in("term", ["long", "short"]);
      if (cancelled) return;
      if (error) {
        setGoals([]);
        return;
      }
      const rows = (data ?? []) as { term: GoalTerm; content: string }[];
      // 年間 → 月間の順に並べ、空のものは出さない
      setGoals(
        goalTerms
          .map(({ term }) => rows.find((r) => r.term === term))
          .filter((r): r is { term: GoalTerm; content: string } => !!r && r.content.trim() !== "")
      );
      setIndex(0);
      setVisible(true);
    }
    load();
    window.addEventListener(GOALS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(GOALS_CHANGED_EVENT, load);
    };
  }, [profile.id]);

  useEffect(() => {
    if (!goals || goals.length < 2) return;
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setVisible(false);
      fadeTimer = setTimeout(() => {
        setIndex((i) => (i + 1) % goals.length);
        setVisible(true);
      }, 300);
    }, 5000);
    return () => {
      clearInterval(timer);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [goals]);

  if (goals === null) return null;
  if (goals.length === 0) {
    return (
      <span className="text-[length:calc(10px+var(--fs-add))] text-white/60">
        設定タブから年間目標・月間目標を登録しよう
      </span>
    );
  }
  const g = goals[index % goals.length];
  const label = goalTerms.find((t) => t.term === g.term)?.label ?? "";
  return (
    <span
      className={`flex min-w-0 items-baseline gap-1.5 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="shrink-0 rounded bg-white/20 px-1 text-[length:calc(9px+var(--fs-add))] font-bold leading-tight text-white">
        {label}
      </span>
      <span className="min-w-0 truncate text-xs font-semibold text-white/90">{g.content}</span>
    </span>
  );
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
        .select("id, name, date, member_id")
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
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-sm font-semibold text-white">
        {profile.display_name}
      </span>
      <GoalTicker profile={profile} />
      {nextMatch ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="shrink-0 text-[length:calc(10px+var(--fs-add))] font-semibold leading-none text-white/70">
            次の試合まで
          </span>
          <span className="shrink-0 text-2xl font-extrabold leading-none text-white">
            あと{daysUntil(nextMatch.date)}日
          </span>
          <span className="min-w-0 truncate text-xs font-semibold leading-none text-white/85">
            【{nextMatch.name}】
          </span>
        </div>
      ) : (
        <span className="text-[length:calc(11px+var(--fs-add))] text-white/70">
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
      // まだ本人がサインアップ（メアド登録）していない部員も、
      // 母数（total）にはカウントする
      const [{ data: memberData }, { data: rosterData }] = await Promise.all([
        supabase.from("profiles").select("id, role, home_location").eq("team_id", profile.team_id),
        supabase
          .from("member_roster")
          .select("id, role, home_location")
          .eq("team_id", profile.team_id)
          .is("claimed_by", null),
      ]);
      const realMembers = (memberData ?? []) as MemberRow[];
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

      const counts = await countSubmissions(
        supabase,
        profile.team_id,
        [yesterday, today],
        members
      );
      const get = (d: string, loc: Location) => counts.get(`${d}:${loc}`) ?? null;
      const [todayTama, todayOtsuka, yesterdayTama, yesterdayOtsuka] = [
        get(today, "tama"),
        get(today, "otsuka"),
        get(yesterday, "tama"),
        get(yesterday, "otsuka"),
      ];

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
      <span className="text-sm font-semibold text-white">
        {profile.display_name}
      </span>
      <span className="text-[length:calc(10px+var(--fs-add))] leading-tight text-white/80">
        {line("昨日の提出状況", yesterdayStr, stats)}
        {line("今日の提出状況", todayStr, stats)}
      </span>
    </div>
  );
}

export default function Header({
  profile,
  onHeightChange,
  extra,
}: {
  profile: Profile;
  // ヘッダーの実際の高さをAppShellに伝える（内容量に応じてヘッダーの高さが
  // 変わっても、本文側のpaddingTopがズレて内容が隠れないようにするため）
  onHeightChange?: (height: number) => void;
  // ヘッダー右端の小さいバッジ枠（未提出タスク数など。useHeaderExtraで登録される）
  extra?: React.ReactNode;
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
      // 試合カウントダウンなどを目立たせつつ、ボタン類で多用している赤とは
      // 被らないよう、ヘッダー全体を指定色（マット・グレイッシュな紫）で統一する
      className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 border-b border-black/20 bg-[#7c6c77]/95 px-4 py-2.5 shadow-[0_4px_10px_rgba(0,0,0,0.25)] backdrop-blur dark:border-black/40 dark:bg-[#5c4f57]/95"
      style={{ paddingTop: "calc(1.5rem + env(safe-area-inset-top))" }}
    >
      <span className="inline-block h-6 w-1 shrink-0 rounded-full bg-white/50" />
      {isStaffRole(profile.role) ? (
        <CoachHeaderInfo profile={profile} />
      ) : (
        <MemberHeaderInfo profile={profile} />
      )}
      {extra && <div className="ml-auto shrink-0">{extra}</div>}
    </header>
  );
}
