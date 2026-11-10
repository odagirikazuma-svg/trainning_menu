import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  coachLineUserIds,
  lineConfigured,
  lineReply,
  verifyLineSignature,
} from "../../../lib/line";
import { buildDailySummary, buildTomorrowMenuText } from "../../../lib/dailySummary";

// アプリのデータを読む（サービスロール。無い環境では null）
async function adminContext() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from("teams").select("id").limit(1).maybeSingle();
  if (!data) return null;
  return { admin, teamId: (data as { id: string }).id };
}

const NOT_READY = "準備中です（アプリ側の設定がまだ終わっていません）。";

async function handleAction(action: string, userId: string | undefined, origin: string) {
  if (action === "menu_tomorrow") {
    const ctx = await adminContext();
    if (!ctx) return NOT_READY;
    return buildTomorrowMenuText(ctx.admin, ctx.teamId);
  }
  if (action === "summary") {
    if (!userId || !coachLineUserIds().includes(userId)) {
      return "このボタンは監督・コーチ専用です。";
    }
    const ctx = await adminContext();
    if (!ctx) return NOT_READY;
    return buildDailySummary(ctx.admin, ctx.teamId, process.env.APP_URL || origin);
  }
  return null;
}

export const dynamic = "force-dynamic";

type LineSource = { type: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
type LineEvent = {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type: string; text?: string };
  postback?: { data: string };
};

// 接続確認用：鍵が設定されているかだけを返す（値は返さない）
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: lineConfigured(),
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    summaryTo: !!process.env.LINE_SUMMARY_TO,
  });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  await Promise.all(
    events.map(async (ev) => {
      if (!ev.replyToken) return;
      try {
        // リッチメニューのボタン（返信なので通数にカウントされない）
        const action =
          ev.type === "postback"
            ? new URLSearchParams(ev.postback?.data ?? "").get("action")
            : ev.type === "message" && ev.message?.text?.trim() === "明日のメニュー"
              ? "menu_tomorrow"
              : ev.type === "message" && ev.message?.text?.trim() === "今日のまとめ"
                ? "summary"
                : null;
        if (action) {
          const text = await handleAction(action, ev.source?.userId, request.nextUrl.origin);
          if (text) await lineReply(ev.replyToken, [{ type: "text", text }]);
          return;
        }
        if (ev.type === "join") {
          // グループに招待されたとき
          await lineReply(ev.replyToken, [
            {
              type: "text",
              text:
                "練習ノートの公式LINEです。このグループに毎日のまとめ通知を送れるよう準備しています。\n" +
                `（グループID: ${ev.source?.groupId ?? ev.source?.roomId ?? "不明"}）`,
            },
          ]);
        } else if (ev.type === "follow") {
          // 友だち追加されたとき
          await lineReply(ev.replyToken, [
            {
              type: "text",
              text: "練習ノートの公式LINEです。友だち追加ありがとうございます。アプリとの連携は準備中です。",
            },
          ]);
        } else if (ev.type === "message" && ev.message?.type === "text") {
          const text = (ev.message.text ?? "").trim();
          if (text === "ID" || text === "id") {
            const s = ev.source;
            await lineReply(ev.replyToken, [
              {
                type: "text",
                text: `種類: ${s?.type}\nユーザーID: ${s?.userId ?? "-"}\nグループID: ${s?.groupId ?? "-"}`,
              },
            ]);
          } else if (text === "テスト") {
            await lineReply(ev.replyToken, [
              { type: "text", text: "✅ アプリとの接続はOKです（staging）。" },
            ]);
          }
        }
      } catch (e) {
        console.error("[line webhook]", e);
      }
    })
  );

  // LINE には常に 200 を返す（返さないと再送される）
  return NextResponse.json({ ok: true });
}
