import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const memberId = body?.memberId as string | undefined;
  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  // トークンから呼び出し元のユーザーを確認する
  const authClient = createClient(supabaseUrl, anonKey);
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 呼び出し元がコーチであることを確認する
  const { data: callerProfile, error: callerError } = await adminClient
    .from("profiles")
    .select("role, team_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (callerError || !callerProfile || callerProfile.role !== "coach") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 削除対象が同じチームであることを確認する
  const { data: targetProfile, error: targetError } = await adminClient
    .from("profiles")
    .select("team_id")
    .eq("id", memberId)
    .maybeSingle();
  if (
    targetError ||
    !targetProfile ||
    targetProfile.team_id !== callerProfile.team_id
  ) {
    return NextResponse.json({ error: "member not found" }, { status: 404 });
  }

  // auth.usersを削除すると、profilesほか関連テーブルもcascadeで削除される
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(memberId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
