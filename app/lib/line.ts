// LINE Messaging API の最小限のヘルパー（サーバー側専用）。
// 鍵は環境変数 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN から読む。
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.line.me/v2/bot";

export type LineMessage =
  | { type: "text"; text: string }
  | Record<string, unknown>;

export function lineConfigured() {
  return !!process.env.LINE_CHANNEL_SECRET && !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
}

// Webhook の署名（x-line-signature）を検証する
export function verifyLineSignature(rawBody: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function call(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LINE API ${path} ${res.status}: ${text.slice(0, 200)}`);
  }
}

// 返信（通数にカウントされない）
export function lineReply(replyToken: string, messages: LineMessage[]) {
  return call("/message/reply", { replyToken, messages: messages.slice(0, 5) });
}

// こちらから送る（通数にカウントされる：送信回数 × 受け取る人数）
export function linePush(to: string, messages: LineMessage[]) {
  return call("/message/push", { to, messages: messages.slice(0, 5) });
}
