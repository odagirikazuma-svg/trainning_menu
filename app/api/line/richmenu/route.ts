import { NextRequest, NextResponse } from "next/server";
import { liffUrl } from "../../../lib/liffConfig";
import { createClient } from "@supabase/supabase-js";
import {
  coachLineUserIds,
  createRichMenu,
  deleteRichMenu,
  lineConfigured,
  linkRichMenu,
  listRichMenus,
  setDefaultRichMenu,
  type RichMenuAction,
} from "../../../lib/line";

export const dynamic = "force-dynamic";

// 管理者がアプリから押すと、部員用・監督用のリッチメニューを作り直す
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!token || !url || !anonKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (!me || me.role !== "coach") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!lineConfigured()) return NextResponse.json({ error: "LINEの鍵が設定されていません" }, { status: 500 });

  // LINEの中でアプリを開き、LINEでログインしてから各ページへ移動する
  const open = (path: string, hash = "") => liffUrl(path + hash);

  const memberActions: RichMenuAction[] = [
    { type: "uri", label: "日報を書く", uri: open("/mypage") },
    { type: "uri", label: "休み申請", uri: open("/mypage?absence=1") },
    { type: "uri", label: "振り返り", uri: open("/mypage?tab=review") },
  ];

  const coachActions: RichMenuAction[] = [
    { type: "postback", label: "承認待ち", data: "action=pending", displayText: "承認待ち" },
    { type: "postback", label: "今日のまとめ", data: "action=summary", displayText: "今日のまとめ" },
    { type: "postback", label: "提出状況", data: "action=status", displayText: "提出状況" },
    { type: "postback", label: "怪我の状況", data: "action=injuries", displayText: "怪我の状況" },
    { type: "uri", label: "練習予定表", uri: open("/board") },
    { type: "uri", label: "アプリを開く", uri: open("/admin") },
  ];


  try {
    const [memberImg, coachImg] = await Promise.all(
      ["member", "coach"].map(async (n) => {
        const res = await fetch(`${request.nextUrl.origin}/line/richmenu-${n}.png`);
        if (!res.ok) throw new Error(`画像を読み込めませんでした（${n}）`);
        return res.arrayBuffer();
      })
    );
    // 古いリッチメニューを消してから作り直す
    for (const m of await listRichMenus()) await deleteRichMenu(m.richMenuId);
    const memberId = await createRichMenu("部員用", "メニュー", memberActions, memberImg);
    const coachId = await createRichMenu("監督・コーチ用", "メニュー", coachActions, coachImg);
    await setDefaultRichMenu(memberId);
    // 環境変数の宛先＋アプリとLINE連携した監督・コーチ・マネージャー
    const coaches = new Set(coachLineUserIds());
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
      const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: staff } = await admin
        .from("profiles")
        .select("line_user_id")
        .in("role", ["coach", "manager"])
        .not("line_user_id", "is", null);
      for (const r of (staff ?? []) as { line_user_id: string }[]) coaches.add(r.line_user_id);
    }
    for (const u of coaches) await linkRichMenu(u, coachId);
    return NextResponse.json({ ok: true, member: memberId, coach: coachId, linkedCoaches: coaches.size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "失敗しました" }, { status: 502 });
  }
}
