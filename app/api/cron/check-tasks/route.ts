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
    .select("id, team_id, home_location, role")
    .not("role", "in", "(coach,manager)");

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const members = (profileRows ?? []) as {
    id: string;
    team_id: string;
    home_location: "tama" | "otsuka" | null;
    role: string;
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

  // --- 3) 怪我の経過報告 ---
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
      const applicableMenus = menus.filter(
        (menu) =>
          menu.team_id === m.team_id &&
          (menu.location === m.home_location || menu.is_joint) &&
          isReportOpen(menu.date, menu.start_time)
      );
      const hasUnrespondedMenu = applicableMenus.some(
        (menu) => !respondedKeys.has(`${m.id}:${menu.id}`)
      );
      if (hasUnrespondedMenu) hasIncomplete = true;
    }

    if (!hasIncomplete) {
      const activeEvent = activeEventByTeam.get(m.team_id);
      if (
        activeEvent &&
        !submittedMaxKeys.has(`${m.id}:${activeEvent.id}`)
      ) {
        hasIncomplete = true;
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
