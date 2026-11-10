import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { lineConfigured, lineReply, verifyLineSignature, type LineMessage } from "../../../lib/line";
import { approve, findStaff, replyInjuries, replyPending, replyStatus } from "../../../lib/lineCoach";
import { buildDailySummary, buildPracticeMenuText, buildTomorrowMenuText } from "../../../lib/dailySummary";
import { appButton } from "../../../lib/liffConfig";

// アプリのデータを読む（サービスロール。無い環境では null）
// 同じサーバーが温まっている間は、クライアントとチームIDを使い回す（問い合わせを減らす）
let cached: { admin: SupabaseClient; teamId: string } | null = null;
async function adminContext() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from("teams").select("id").limit(1).maybeSingle();
  if (!data) return null;
  cached = { admin, teamId: (data as { id: string }).id };
  return cached;
}

const NOT_READY = "準備中です（アプリ側の設定がまだ終わっていません）。";
const STAFF_ONLY = "このボタンは監督・コーチ専用です。設定の「LINE連携」で、アプリのアカウントとLINEを連携してください。";

async function handleAction(
  data: URLSearchParams,
  userId: string | undefined,
  origin: string
): Promise<LineMessage[] | null> {
  const action = data.get("action");
  if (!action) return null;
  const ctx = await adminContext();
  if (!ctx) return [{ type: "text", text: NOT_READY }];
  const { admin, teamId } = ctx;

  if (action === "menu") {
    // LINE連携した部員なら、その拠点のメニューだけ
    const { data: me } = userId
      ? await admin.from("profiles").select("home_location").eq("line_user_id", userId).maybeSingle()
      : { data: null };
    const loc = ((me as { home_location: "tama" | "otsuka" | null } | null)?.home_location ?? null);
    return [
      { type: "text", text: await buildPracticeMenuText(admin, teamId, loc) },
      appButton("/board", "練習予定表はアプリで確認できます"),
    ];
  }
  if (action === "menu_tomorrow") {
    return [{ type: "text", text: await buildTomorrowMenuText(admin, teamId) }, appButton("/board", "練習予定表はアプリで確認できます")];
  }

  // ここから下は監督・コーチ用
  const staff = await findStaff(admin, userId);
  if (!staff) return [{ type: "text", text: STAFF_ONLY }];
  switch (action) {
    case "summary":
      return [
        { type: "text", text: await buildDailySummary(admin, teamId, process.env.APP_URL || origin) },
        appButton("/admin#absence"),
      ];
    case "pending":
      return replyPending(admin, teamId, staff);
    case "approve":
      return approve(admin, teamId, staff, data.get("id"));
    case "approve_all":
      return approve(admin, teamId, staff, null);
    case "status":
      return replyStatus(admin, teamId);
    case "injuries":
      return replyInjuries(admin, teamId);
  }
  return null;
}

// トークに直接打った言葉でも同じ返事をする
const KEYWORDS: Record<string, string> = {
  明日のメニュー: "menu_tomorrow",
  練習メニュー: "menu",
  今日のまとめ: "summary",
  承認待ち: "pending",
  休みの報告: "pending",
  提出状況: "status",
  怪我の状況: "injuries",
};

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
        const params =
          ev.type === "postback"
            ? new URLSearchParams(ev.postback?.data ?? "")
            : ev.type === "message" && KEYWORDS[ev.message?.text?.trim() ?? ""]
              ? new URLSearchParams({ action: KEYWORDS[ev.message!.text!.trim()] })
              : null;
        if (params) {
          const messages = await handleAction(params, ev.source?.userId, request.nextUrl.origin);
          if (messages) await lineReply(ev.replyToken, messages);
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
