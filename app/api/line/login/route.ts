import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { linkCoachMenuIfCoach, verifyLineIdToken } from "../../../lib/line";

export const dynamic = "force-dynamic";

// LINEログイン
// body: { idToken, action: "login" | "link" | "register", rosterId? }
// - login    : LINEに紐付いたアカウントがあれば、ログイン用のトークンを返す。無ければ名簿（未登録の人）を返す
// - link     : 今ログインしているアプリのアカウントに、このLINEを紐付ける（Authorization: Bearer <アプリのトークン>）
// - register : 名簿から自分の名前を選んで、新しくアカウントを作る

type Body = { idToken?: string; action?: string; rosterId?: string };

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// メールアドレスで「ログイン用のワンタイムトークン」を作る（メールは送られない）
async function sessionToken(admin: SupabaseClient, userId: string) {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = u.user?.email;
  if (!email) throw new Error("アカウントのメールアドレスが見つかりません");
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(error?.message ?? "ログインに失敗しました");
  return data.properties.hashed_token;
}

async function unclaimedRoster(admin: SupabaseClient) {
  const { data } = await admin
    .from("member_roster")
    .select("id, display_name, role, home_location, entry_year")
    .is("claimed_by", null)
    .order("entry_year", { ascending: true })
    .order("display_name", { ascending: true });
  return data ?? [];
}

export async function POST(request: NextRequest) {
  const admin = adminClient();
  if (!admin) {
    return NextResponse.json({ error: "サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が足りません" }, { status: 500 });
  }
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!body.idToken) return NextResponse.json({ error: "idToken がありません" }, { status: 400 });
  const line = await verifyLineIdToken(body.idToken);
  if (!line) return NextResponse.json({ error: "LINEの認証を確認できませんでした" }, { status: 401 });

  const { data: linked } = await admin
    .from("profiles")
    .select("id, role")
    .eq("line_user_id", line.userId)
    .maybeSingle();

  try {
    // ---------- 既存アカウントに紐付ける ----------
    if (body.action === "link") {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const { data: me } = token ? await admin.auth.getUser(token) : { data: { user: null } };
      if (!me.user) return NextResponse.json({ error: "アプリにログインしていません" }, { status: 401 });
      if (linked && linked.id !== me.user.id) {
        return NextResponse.json(
          { error: "このLINEは、すでに別のアカウントに連携されています。管理者に相談してください。" },
          { status: 409 }
        );
      }
      const { data: prof, error } = await admin
        .from("profiles")
        .update({ line_user_id: line.userId, line_display_name: line.name })
        .eq("id", me.user.id)
        .select("role")
        .single();
      if (error) throw new Error(error.message);
      await linkCoachMenuIfCoach(line.userId, (prof as { role: string }).role);
      return NextResponse.json({ status: "linked" });
    }

    // ---------- ログイン ----------
    if (body.action === "login" || !body.action) {
      if (linked) {
        await linkCoachMenuIfCoach(line.userId, linked.role as string);
        return NextResponse.json({ status: "ok", tokenHash: await sessionToken(admin, linked.id) });
      }
      return NextResponse.json({
        status: "unlinked",
        lineName: line.name,
        roster: await unclaimedRoster(admin),
      });
    }

    // ---------- 名簿から新規登録 ----------
    if (body.action === "register") {
      if (linked) {
        return NextResponse.json({ status: "ok", tokenHash: await sessionToken(admin, linked.id) });
      }
      if (!body.rosterId) return NextResponse.json({ error: "名前を選んでください" }, { status: 400 });
      const { data: r } = await admin
        .from("member_roster")
        .select("id, team_id, display_name, role, home_location, entry_year, claimed_by")
        .eq("id", body.rosterId)
        .maybeSingle();
      const roster = r as {
        id: string;
        team_id: string;
        display_name: string;
        role: string;
        home_location: string | null;
        entry_year: number | null;
        claimed_by: string | null;
      } | null;
      if (!roster || roster.claimed_by) {
        return NextResponse.json({ error: "この名前はすでに登録されています" }, { status: 409 });
      }
      // LINEでログインする人用の（実際には使わない）メールアドレス
      const email = `line-${line.userId.toLowerCase()}@line-login.local`;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: roster.display_name, via: "line" },
      });
      if (createErr || !created.user) throw new Error(createErr?.message ?? "アカウントを作れませんでした");
      const role = roster.role;
      const { error: profErr } = await admin.from("profiles").insert({
        id: created.user.id,
        team_id: roster.team_id,
        display_name: roster.display_name,
        role,
        home_location: roster.home_location,
        entry_year: roster.entry_year,
        line_user_id: line.userId,
        line_display_name: line.name,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        throw new Error(profErr.message);
      }
      await admin.from("member_roster").update({ claimed_by: created.user.id }).eq("id", roster.id);
      await linkCoachMenuIfCoach(line.userId, role);
      return NextResponse.json({ status: "ok", tokenHash: await sessionToken(admin, created.user.id) });
    }

    return NextResponse.json({ error: "不明な操作です" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "失敗しました" }, { status: 500 });
  }
}
