import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildDailySummary } from "../../../lib/dailySummary";
import { lineConfigured, linePush } from "../../../lib/line";

export const dynamic = "force-dynamic";

// 送り先（LINEのユーザーIDまたはグループID。カンマ区切りで複数可）
function targets() {
  return (process.env.LINE_SUMMARY_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function appUrl(request: NextRequest) {
  return process.env.APP_URL || request.nextUrl.origin;
}

// 毎晩の定期実行（Vercel Cron）。全チーム分を作って送る
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !lineConfigured()) {
    return NextResponse.json({ error: "missing env" }, { status: 500 });
  }
  const to = targets();
  if (to.length === 0) return NextResponse.json({ sent: 0, reason: "no LINE_SUMMARY_TO" });

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: teams } = await admin.from("teams").select("id");
  let sent = 0;
  for (const t of (teams ?? []) as { id: string }[]) {
    const text = await buildDailySummary(admin, t.id, appUrl(request));
    for (const dest of to) {
      await linePush(dest, [{ type: "text", text }]);
      sent++;
    }
  }
  return NextResponse.json({ sent });
}

// 管理者がアプリから「プレビュー」「今すぐ送る」を押したとき
// body: { send?: boolean }
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!url || !anonKey) return NextResponse.json({ error: "server misconfigured" }, { status: 500 });

  // 呼び出した本人の権限で読む（RLS で自分のチームだけ見える）
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("role, team_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (!me || me.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { send?: boolean };
  const text = await buildDailySummary(supabase, me.team_id as string, appUrl(request));

  if (!body.send) return NextResponse.json({ text, targets: targets().length });

  if (!lineConfigured()) {
    return NextResponse.json({ text, error: "LINEの鍵が設定されていません" }, { status: 500 });
  }
  const to = targets();
  if (to.length === 0) {
    return NextResponse.json(
      { text, error: "送り先（LINE_SUMMARY_TO）が設定されていません" },
      { status: 400 }
    );
  }
  try {
    for (const dest of to) await linePush(dest, [{ type: "text", text }]);
  } catch (e) {
    return NextResponse.json(
      { text, error: e instanceof Error ? e.message : "送信に失敗しました" },
      { status: 502 }
    );
  }
  return NextResponse.json({ text, sent: to.length });
}
