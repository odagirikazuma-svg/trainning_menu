import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// パソコンなどからメールアドレスでログインできるように、自分のアカウントにメールアドレスとパスワードを設定する
// （LINEで作ったアカウントは、仮のメールアドレスのままなので）
// body: { email, password }   Authorization: Bearer <アプリのトークン>
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "サーバーの設定が足りません" }, { status: 500 });
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });
  const { data: me } = await admin.auth.getUser(token);
  if (!me.user) return NextResponse.json({ error: "ログインしていません" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith("@line-login.local")) {
    return NextResponse.json({ error: "メールアドレスの形が正しくありません" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "パスワードは6文字以上にしてください" }, { status: 400 });
  }

  const { error } = await admin.auth.admin.updateUserById(me.user.id, {
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message)
      ? "このメールアドレスは、ほかのアカウントで使われています"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  // パスワードを変えると今のログインが切れることがあるので、そのまま続けて使えるように
  // ログイン用のワンタイムトークンを返す（画面側で verifyOtp してログインし直す）
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  return NextResponse.json({ ok: true, tokenHash: link?.properties?.hashed_token ?? null });
}
