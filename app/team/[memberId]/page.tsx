"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import AuthGate from "../../components/AuthGate";
import { createClient } from "../../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  Role,
  roleLabel,
  trainingTypeDotColor,
  trainingTypeLabel,
  TrainingType,
} from "../../lib/types";

type MemberInfo = {
  id: string;
  team_id: string;
  display_name: string;
  role: Role;
  home_location: Location | null;
  entry_year: number | null;
};

type NextMatchInfo = {
  name: string;
  date: string;
};

type MenuInfo = {
  title: string;
  content: string;
  start_time: string | null;
};

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

type DetailState = {
  menu: MenuInfo | null;
  matStatus: "not_required" | "report" | "absent" | "missing";
  matText: string | null;
  selfStatus: "not_required" | "done" | "missing";
  selfText: string | null;
  selfType: TrainingType | null;
  selfTitle: string | null;
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function MemberDayView({ memberId, date }: { memberId: string; date: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [member, setMember] = useState<MemberInfo | null | undefined>(undefined);
  const [nextMatch, setNextMatch] = useState<NextMatchInfo | null>(null);
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [injuries, setInjuries] = useState<InjuryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, date]);

  async function load() {
    setLoading(true);
    const { data: memberData, error: memberError } = await supabase
      .from("profiles")
      .select("id, team_id, display_name, role, home_location, entry_year")
      .eq("id", memberId)
      .maybeSingle();

    if (memberError) {
      setErrorMsg(memberError.message);
      setLoading(false);
      return;
    }
    const memberRow = memberData as MemberInfo | null;
    setMember(memberRow);
    if (!memberRow) {
      setLoading(false);
      return;
    }

    // 次の試合
    const todayStr = toDateKey(new Date());
    const { data: matchData } = await supabase
      .from("matches")
      .select("name, date")
      .eq("team_id", memberRow.team_id)
      .eq("member_id", memberId)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    setNextMatch((matchData as NextMatchInfo | null) ?? null);

    // 現在の怪我情報
    const { data: injuryData } = await supabase
      .from("injuries")
      .select(
        "symptom_name, body_part, expected_recovery_date, mat_participation, mat_participation_detail"
      )
      .eq("author_id", memberId)
      .eq("is_recovered", false)
      .order("created_at", { ascending: false });
    setInjuries((injuryData ?? []) as InjuryInfo[]);

    // その日のスケジュール（マット・マット以外の有無）
    const { data: dayData } = await supabase
      .from("schedule_days")
      .select("is_off, sessions:schedule_sessions(session_type, start_time)")
      .eq("team_id", memberRow.team_id)
      .eq("location", memberRow.home_location ?? "tama")
      .eq("date", date)
      .maybeSingle();

    const scheduleRow = dayData as unknown as {
      is_off: boolean;
      sessions: { session_type: string; start_time: string }[];
    } | null;
    const matSession = scheduleRow?.sessions.find(
      (s) => s.session_type === "mat"
    );
    const hasMat = !scheduleRow?.is_off && !!matSession;
    const hasNonMat =
      !scheduleRow?.is_off &&
      !!scheduleRow?.sessions.some((s) => s.session_type !== "mat");

    let matStatus: DetailState["matStatus"] = "not_required";
    let matText: string | null = null;
    let menu: MenuInfo | null = null;
    if (hasMat) {
      const { data: ownMenus } = await supabase
        .from("menus")
        .select("id, title, content, start_time")
        .eq("team_id", memberRow.team_id)
        .eq("location", memberRow.home_location ?? "tama")
        .eq("date", date)
        .eq("is_off", false);
      const { data: jointMenus } = await supabase
        .from("menus")
        .select("id, title, content, start_time")
        .eq("team_id", memberRow.team_id)
        .eq("is_joint", true)
        .eq("date", date)
        .eq("is_off", false);
      const menuRows = [
        ...((ownMenus ?? []) as {
          id: string;
          title: string;
          content: string;
          start_time: string | null;
        }[]),
        ...((jointMenus ?? []) as {
          id: string;
          title: string;
          content: string;
          start_time: string | null;
        }[]),
      ];
      if (menuRows.length > 0) {
        menu = {
          title: menuRows[0].title,
          content: menuRows[0].content,
          start_time: menuRows[0].start_time ?? matSession?.start_time ?? null,
        };
        const menuIds = menuRows.map((m) => m.id);
        const { data: commentData } = await supabase
          .from("comments")
          .select("kind, text")
          .in("menu_id", menuIds)
          .eq("author_id", memberId)
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
          .maybeSingle();
        const comment = commentData as { kind: string; text: string } | null;
        if (comment) {
          matStatus = comment.kind === "absent" ? "absent" : "report";
          matText = comment.text;
        } else {
          matStatus = "missing";
        }
      } else {
        menu = matSession
          ? { title: "", content: "", start_time: matSession.start_time }
          : null;
        matStatus = "missing";
      }
    }

    let selfStatus: DetailState["selfStatus"] = "not_required";
    let selfText: string | null = null;
    let selfType: TrainingType | null = null;
    let selfTitle: string | null = null;
    if (hasNonMat) {
      const { data: logData } = await supabase
        .from("weight_logs")
        .select("content, type, title")
        .eq("author_id", memberId)
        .eq("date", date)
        .maybeSingle();
      const log = logData as
        | { content: string; type: TrainingType; title: string | null }
        | null;
      if (log) {
        selfStatus = "done";
        selfText = log.content;
        selfType = log.type;
        selfTitle = log.title;
      } else {
        selfStatus = "missing";
      }
    }

    setDetail({
      menu,
      matStatus,
      matText,
      selfStatus,
      selfText,
      selfType,
      selfTitle,
    });
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        読み込み中…
      </div>
    );
  }

  if (member === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-500">
        部員が見つかりませんでした。
      </div>
    );
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col bg-neutral-950 text-neutral-200">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-neutral-800 bg-neutral-900/95 px-4 py-3 backdrop-blur">
        <h1 className="flex items-center gap-2 text-base font-bold text-white sm:text-lg">
          <span className="inline-block h-4 w-1 rounded-full bg-red-600" />
          {member?.display_name}のマイページ(閲覧)
        </h1>
        <button
          onClick={() => router.push("/team")}
          className="rounded border border-neutral-700 px-2.5 py-1.5 text-[11px] text-neutral-400 active:bg-neutral-800"
        >
          チームページに戻る
        </button>
      </header>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {errorMsg && (
          <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
            {errorMsg}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className="rounded bg-neutral-800 px-2 py-1">
            {member?.role ? roleLabel[member.role] : ""}
          </span>
          {member?.home_location && (
            <span className="rounded bg-neutral-800 px-2 py-1">
              {locationLabel[member.home_location]}
            </span>
          )}
          {member?.entry_year != null && (
            <span className="rounded bg-neutral-800 px-2 py-1">
              {currentGrade(member.entry_year)}年
            </span>
          )}
          <span className="ml-auto rounded bg-neutral-800 px-2 py-1 font-semibold text-neutral-300">
            {formatMonthDay(date)}
          </span>
        </div>

        {/* 次の試合 */}
        <section className="flex flex-col gap-2">
          {nextMatch ? (
            <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-center">
              <p className="text-xs text-red-400">
                次の試合【{nextMatch.name}】まで
              </p>
              <p className="text-2xl font-bold text-red-500">
                あと{matchDays}日
              </p>
              <p className="text-[11px] text-red-500">
                {formatMonthDay(nextMatch.date)}
              </p>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-700 p-3 text-center text-xs text-neutral-500">
              次の試合は登録されていません。
            </p>
          )}
        </section>

        {/* マット（セッション時間・メニュー詳細・実施/未実施報告） */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            マット
          </h2>
          {detail?.matStatus === "not_required" ? (
            <p className="text-xs text-neutral-500">
              この日はマットのセッションはありません。
            </p>
          ) : (
            <>
              {detail?.menu && (
                <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  {detail.menu.start_time && (
                    <p className="text-[11px] text-neutral-500">
                      {detail.menu.start_time.slice(0, 5)}〜
                    </p>
                  )}
                  {detail.menu.title && (
                    <p className="font-medium text-neutral-100">
                      {detail.menu.title}
                    </p>
                  )}
                  {detail.menu.content && (
                    <p className="whitespace-pre-wrap text-sm text-neutral-300">
                      {detail.menu.content}
                    </p>
                  )}
                </div>
              )}
              {detail?.matStatus === "missing" ? (
                <p className="rounded-lg bg-red-950/40 p-3 text-xs text-red-400">
                  実施報告・未実施報告ともに未提出です。
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
                  <span className="self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {detail?.matStatus === "absent" ? "未実施報告" : "実施報告"}
                  </span>
                  <p className="whitespace-pre-wrap text-sm text-neutral-100">
                    {detail?.matText}
                  </p>
                </div>
              )}
            </>
          )}
        </section>

        {/* マット以外のセッション（自主トレ） */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            マット以外のセッション(自主トレ)
          </h2>
          {detail?.selfStatus === "not_required" ? (
            <p className="text-xs text-neutral-500">
              この日はマット以外のセッションはありません。
            </p>
          ) : detail?.selfStatus === "missing" ? (
            <p className="rounded-lg bg-red-950/40 p-3 text-xs text-red-400">
              未提出です。
            </p>
          ) : (
            <div className="flex flex-col gap-1 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-3">
              <span className="flex items-center gap-1.5 self-start rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                {detail?.selfType && (
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${trainingTypeDotColor[detail.selfType]}`}
                  />
                )}
                {detail?.selfType ? trainingTypeLabel[detail.selfType] : ""}
                {detail?.selfTitle && `・${detail.selfTitle}`}
              </span>
              <p className="whitespace-pre-wrap text-sm text-neutral-100">
                {detail?.selfText}
              </p>
            </div>
          )}
        </section>

        {/* 現状の怪我情報 */}
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
            現在の怪我情報
          </h2>
          {injuries.length === 0 ? (
            <p className="text-xs text-neutral-500">
              報告されている怪我はありません。
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {injuries.map((inj, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm"
                >
                  <p className="font-medium text-neutral-100">
                    {inj.symptom_name}（{inj.body_part}）
                  </p>
                  <p className="text-[11px] text-neutral-500">
                    マット参加：{matParticipationLabel[inj.mat_participation]}
                    {inj.mat_participation === "conditional" &&
                      inj.mat_participation_detail &&
                      `（${inj.mat_participation_detail}）`}
                  </p>
                  {inj.expected_recovery_date && (
                    <p className="text-[11px] text-neutral-500">
                      完治見込み：{formatMonthDay(inj.expected_recovery_date)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="border-t border-neutral-800 pt-3 text-[11px] text-neutral-600">
          このページは閲覧専用です。編集はご本人のマイページから行われます。
        </p>
      </div>
    </div>
  );
}

export default function TeamMemberRoute() {
  const params = useParams<{ memberId: string }>();
  const searchParams = useSearchParams();
  const memberId = Array.isArray(params.memberId)
    ? params.memberId[0]
    : params.memberId;
  const date = searchParams.get("date") ?? toDateKey(new Date());

  return (
    <AuthGate>
      {() => (memberId ? <MemberDayView memberId={memberId} date={date} /> : null)}
    </AuthGate>
  );
}
