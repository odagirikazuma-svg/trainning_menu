import { NextRequest, NextResponse } from "next/server";
import { lineConfigured, lineReply, verifyLineSignature } from "../../../lib/line";

export const dynamic = "force-dynamic";

type LineSource = { type: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
type LineEvent = {
  type: string;
  replyToken?: string;
  source?: LineSource;
  message?: { type: string; text?: string };
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
