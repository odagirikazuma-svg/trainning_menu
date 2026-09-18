import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const dynamic = "force-dynamic";

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isReportOpen(dateStr: string, startTime: string | null): boolean {
  if (!startTime) return true;
  const threshold = new Date(`${dateStr}T${startTime}`);
  return new Date() >= threshold;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return NextResponse.json(
      { error: "missing required environment variables" },
      { status: 500 }
    );
  }

  webpush.setVapidDetails(
    "mailto:admin@example.com",
    vapidPublicKey,
    vapidPrivateKey
  );

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const todayStr = toDateKey(new Date());
  const rangeStartDate = new Date();
  rangeStartDate.setDate(rangeStartDate.getDate() - 14);
  const rangeStart = toDateKey(rangeStartDate);

  // 対象になりうる部員（コーチ・マネージャーは対象外）
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, team_id, home_location, role, created_at")
    .not("role", "in", "(coach,manager,ob)");

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const members = (profileRows ?? []) as {
    id: string;
    team_id: string;
    home_location: "tama" | "otsuka" | null;
    role: string;
    created_at: string;
  }[];

  if (members.length === 0) {
    return NextResponse.json({ notified: 0, checked: 0 });
  }

  const memberIds = members.map((m) => m.id);
  const teamIds = Array.from(new Set(members.map((m) => m.team_id)));

  // --- 1) 実施報告・未実施報告が必要なメニュー ---
  const { data: menuRows, error: menuError } = await supabase
    .from("menus")
    .select("id, date, location, start_time, is_off, is_joint, team_id")
    .in("team_id", teamIds)
    .eq("is_off", false)
    .gte("date", rangeStart)
    .lte("date", todayStr);

  if (menuError) {
    return NextResponse.json({ error: menuError.message }, { status: 500 });
  }

  const menus = (menuRows ?? []) as {
    id: string;
    date: string;
    location: "tama" | "otsuka";
    start_time: string | null;
    is_off: boolean;
    is_joint: boolean;
    team_id: string;
  }[];

  const openMenuIds = menus
    .filter((m) => isReportOpen(m.date, m.start_time))
    .map((m) => m.id);

  const respondedKeys = new Set<string>();
  if (openMenuIds.length > 0) {
    const { data: commentRows, error: commentError } = await supabase
      .from("comments")
      .select("menu_id, author_id, kind")
      .in("menu_id", openMenuIds)
      .in("kind", ["report", "absent"])
      .is("parent_id", null);

    if (commentError) {
      return NextResponse.json({ error: commentError.message }, { status: 500 });
    }
    for (const row of (commentRows ?? []) as {
      menu_id: string;
      author_id: string | null;
    }[]) {
      if (row.author_id) respondedKeys.add(`${row.author_id}:${row.menu_id}`);
    }
  }

  // --- 2) ウェイトMAX集計（締切前でも対象。未提出なら通知対象） ---
  const { data: eventRows, error: eventError } = await supabase
    .from("weight_max_events")
    .select("id, team_id, created_at")
    .in("team_id", teamIds)
    .is("closed_at", null);

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  const activeEventByTeam = new Map<string, { id: string }>();
  for (const row of (eventRows ?? []) as {
    id: string;
    team_id: string;
    created_at: string;
  }[]) {
    const existing = activeEventByTeam.get(row.team_id);
    if (!existing) {
      activeEventByTeam.set(row.team_id, { id: row.id });
    }
  }

  const activeEventIds = Array.from(activeEventByTeam.values()).map(
    (e) => e.id
  );
  const submittedMaxKeys = new Set<string>();
  if (activeEventIds.length > 0) {
    const { data: maxRows, error: maxError } = await supabase
      .from("weight_maxes")
      .select("author_id, event_id")
      .in("event_id", activeEventIds);
    if (maxError) {
      return NextResponse.json({ error: maxError.message }, { status: 500 });
    }
    for (const row of (maxRows ?? []) as {
      author_id: string;
      event_id: string;
    }[]) {
      submittedMaxKeys.add(`${row.author_id}:${row.event_id}`);
    }
  }

  // ウェイトMAXの対象者限定（行が無いイベントは全員が対象）
  const weightMaxTargetsByEvent = new Map<string, Set<string>>();
  if (activeEventIds.length > 0) {
    const { data: wmTargetRows, error: wmTargetError } = await supabase
      .from("weight_max_event_targets")
      .select("event_id, member_id")
      .in("event_id", activeEventIds);
    if (wmTargetError) {
      return NextResponse.json(
        { error: wmTargetError.message },
        { status: 500 }
      );
    }
    for (const row of (wmTargetRows ?? []) as {
      event_id: string;
      member_id: string;
    }[]) {
      const set = weightMaxTargetsByEvent.get(row.event_id) ?? new Set();
      set.add(row.member_id);
      weightMaxTargetsByEvent.set(row.event_id, set);
    }
  }

  // --- 2b) 試合の振り返り・体組成の提出イベント ---
  const { data: teamEventRows, error: teamEventError } = await supabase
    .from("team_events")
    .select("id, team_id")
    .in("team_id", teamIds)
    .is("closed_at", null);

  if (teamEventError) {
    return NextResponse.json({ error: teamEventError.message }, { status: 500 });
  }

  const activeTeamEvents = (teamEventRows ?? []) as {
    id: string;
    team_id: string;
  }[];
  const activeTeamEventIds = activeTeamEvents.map((e) => e.id);

  const submittedTeamEventKeys = new Set<string>();
  const teamEventTargets = new Map<string, Set<string>>();
  if (activeTeamEventIds.length > 0) {
    const { data: teamSubRows, error: teamSubError } = await supabase
      .from("team_event_submissions")
      .select("author_id, event_id")
      .in("event_id", activeTeamEventIds);
    if (teamSubError) {
      return NextResponse.json(
        { error: teamSubError.message },
        { status: 500 }
      );
    }
    for (const row of (teamSubRows ?? []) as {
      author_id: string;
      event_id: string;
    }[]) {
      submittedTeamEventKeys.add(`${row.author_id}:${row.event_id}`);
    }

    const { data: teamTargetRows, error: teamTargetError } = await supabase
      .from("team_event_targets")
      .select("event_id, member_id")
      .in("event_id", activeTeamEventIds);
    if (teamTargetError) {
      return NextResponse.json(
        { error: teamTargetError.message },
        { status: 500 }
      );
    }
    for (const row of (teamTargetRows ?? []) as {
      event_id: string;
      member_id: string;
    }[]) {
      const set = teamEventTargets.get(row.event_id) ?? new Set();
      set.add(row.member_id);
      teamEventTargets.set(row.event_id, set);
    }
  }

  // --- 3) トレ報（マット以外のセッションがある日の自主トレ記録） ---
  const { data: scheduleRows, error: scheduleError } = await supabase
    .from("schedule_days")
    .select(
      "date, location, team_id, is_off, sessions:schedule_sessions(session_type)"
    )
    .in("team_id", teamIds)
    .eq("is_off", false)
    .gte("date", rangeStart)
    .lte("date", todayStr);

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 500 });
  }

  // team_id:location:date -> マット以外のセッションがあるか
  const nonMatDatesByTeamLocation = new Set<string>();
  for (const row of (scheduleRows ?? []) as {
    date: string;
    location: "tama" | "otsuka";
    team_id: string;
    is_off: boolean;
    sessions: { session_type: string }[];
  }[]) {
    if (row.sessions.some((s) => s.session_type !== "mat")) {
      nonMatDatesByTeamLocation.add(
        `${row.team_id}:${row.location}:${row.date}`
      );
    }
  }

  const { data: logRows, error: logError } = await supabase
    .from("weight_logs")
    .select("author_id, date")
    .in("author_id", memberIds)
    .gte("date", rangeStart)
    .lte("date", todayStr);

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  const loggedKeys = new Set(
    ((logRows ?? []) as { author_id: string; date: string }[]).map(
      (r) => `${r.author_id}:${r.date}`
    )
  );

  // --- 4) 怪我の経過報告 ---
  const { data: injuryRows, error: injuryError } = await supabase
    .from("injuries")
    .select(
      "author_id, expected_recovery_date, next_hospital_date, is_recovered, progress_updated_at"
    )
    .in("author_id", memberIds)
    .eq("is_recovered", false);

  if (injuryError) {
    return NextResponse.json({ error: injuryError.message }, { status: 500 });
  }

  function injuryNeedsProgressUpdate(inj: {
    expected_recovery_date: string | null;
    next_hospital_date: string | null;
    progress_updated_at: string | null;
  }): boolean {
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

  const membersWithIncompleteInjury = new Set<string>();
  for (const inj of (injuryRows ?? []) as {
    author_id: string;
    expected_recovery_date: string | null;
    next_hospital_date: string | null;
    is_recovered: boolean;
    progress_updated_at: string | null;
  }[]) {
    if (injuryNeedsProgressUpdate(inj)) {
      membersWithIncompleteInjury.add(inj.author_id);
    }
  }

  // --- 各部員の未完了タスクの有無を判定 ---
  const membersNeedingNotification: string[] = [];

  for (const m of members) {
    let hasIncomplete = false;

    if (m.home_location) {
      const joinedDate = toDateKey(new Date(m.created_at));
      const applicableMenus = menus.filter(
        (menu) =>
          menu.team_id === m.team_id &&
          (menu.location === m.home_location || menu.is_joint) &&
          menu.date >= joinedDate &&
          isReportOpen(menu.date, menu.start_time)
      );
      const hasUnrespondedMenu = applicableMenus.some(
        (menu) => !respondedKeys.has(`${m.id}:${menu.id}`)
      );
      if (hasUnrespondedMenu) hasIncomplete = true;
    }

    if (!hasIncomplete && m.home_location) {
      const joinedDate = toDateKey(new Date(m.created_at));
      const memberRangeStart = joinedDate > rangeStart ? joinedDate : rangeStart;
      const cursor = new Date(`${memberRangeStart}T00:00:00`);
      const end = new Date(`${todayStr}T00:00:00`);
      while (cursor <= end && !hasIncomplete) {
        const dateStr = toDateKey(cursor);
        const key = `${m.team_id}:${m.home_location}:${dateStr}`;
        if (
          nonMatDatesByTeamLocation.has(key) &&
          !loggedKeys.has(`${m.id}:${dateStr}`)
        ) {
          hasIncomplete = true;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (!hasIncomplete) {
      const activeEvent = activeEventByTeam.get(m.team_id);
      if (activeEvent) {
        const targets = weightMaxTargetsByEvent.get(activeEvent.id);
        const isTargeted = !targets || targets.size === 0 || targets.has(m.id);
        if (isTargeted && !submittedMaxKeys.has(`${m.id}:${activeEvent.id}`)) {
          hasIncomplete = true;
        }
      }
    }

    if (!hasIncomplete) {
      for (const event of activeTeamEvents) {
        if (event.team_id !== m.team_id) continue;
        const targets = teamEventTargets.get(event.id);
        const isTargeted = !targets || targets.size === 0 || targets.has(m.id);
        if (
          isTargeted &&
          !submittedTeamEventKeys.has(`${m.id}:${event.id}`)
        ) {
          hasIncomplete = true;
          break;
        }
      }
    }

    if (!hasIncomplete && membersWithIncompleteInjury.has(m.id)) {
      hasIncomplete = true;
    }

    if (hasIncomplete) membersNeedingNotification.push(m.id);
  }

  if (membersNeedingNotification.length === 0) {
    return NextResponse.json({ notified: 0, checked: members.length });
  }

  const { data: subRows, error: subError } = await supabase
    .from("push_subscriptions")
    .select("id, author_id, endpoint, p256dh, auth")
    .in("author_id", membersNeedingNotification);

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  const payload = JSON.stringify({
    title: "練習ノート",
    body: "完了していないタスクがあります",
    url: "/",
  });

  let notified = 0;
  const staleSubIds: string[] = [];

  await Promise.all(
    ((subRows ?? []) as {
      id: string;
      author_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        notified++;
      } catch (err: unknown) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (statusCode === 404 || statusCode === 410) {
          staleSubIds.push(sub.id);
        }
      }
    })
  );

  if (staleSubIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", staleSubIds);
  }

  return NextResponse.json({
    checked: members.length,
    targeted: membersNeedingNotification.length,
    notified,
  });
}
