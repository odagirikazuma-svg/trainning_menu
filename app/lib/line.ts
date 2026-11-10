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

// ---------- リッチメニュー ----------
async function api(method: string, url: string, body?: unknown, contentType = "application/json") {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      ...(body !== undefined ? { "Content-Type": contentType } : {}),
    },
    body:
      body === undefined
        ? undefined
        : contentType === "application/json"
          ? JSON.stringify(body)
          : (body as BodyInit),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`LINE API ${method} ${url.replace(/^https:\/\/[^/]+/, "")} ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export type RichMenuAction =
  | { type: "uri"; label: string; uri: string }
  | { type: "postback"; label: string; data: string; displayText?: string };

// リッチメニューを作り、画像を載せて、IDを返す。
// 上の段にボタンを横に並べ（3つか4つ）、bottom があれば下の段に横長のボタンを置く。
// 高さ：上の段 843、下の段 300（2500×843 または 2500×1143）
export async function createRichMenu(
  name: string,
  chatBarText: string,
  top: RichMenuAction[],
  bottom: RichMenuAction | null,
  image: ArrayBuffer
) {
  const TOP = 843;
  const height = bottom ? TOP + 300 : TOP;
  const n = top.length;
  const xs = Array.from({ length: n + 1 }, (_, i) => Math.round((2500 * i) / n));
  const areas = top.map((action, i) => ({
    bounds: { x: xs[i], y: 0, width: xs[i + 1] - xs[i], height: TOP },
    action,
  }));
  if (bottom) areas.push({ bounds: { x: 0, y: TOP, width: 2500, height: height - TOP }, action: bottom });
  const created = (await api("POST", `${API}/richmenu`, {
    size: { width: 2500, height },
    selected: true,
    name,
    chatBarText,
    areas,
  })) as { richMenuId: string };
  await api("POST", `https://api-data.line.me/v2/bot/richmenu/${created.richMenuId}/content`, image, "image/png");
  return created.richMenuId;
}

export async function listRichMenus() {
  const r = (await api("GET", `${API}/richmenu/list`)) as { richmenus?: { richMenuId: string; name: string }[] };
  return r.richmenus ?? [];
}

export function deleteRichMenu(id: string) {
  return api("DELETE", `${API}/richmenu/${id}`);
}

export function setDefaultRichMenu(id: string) {
  return api("POST", `${API}/user/all/richmenu/${id}`);
}

export function linkRichMenu(userId: string, id: string) {
  return api("POST", `${API}/user/${userId}/richmenu/${id}`);
}

// 監督・コーチの LINE ユーザーID（LINE_COACH_USER_IDS、無ければ LINE_SUMMARY_TO のうち U で始まるもの）
export function coachLineUserIds() {
  const raw = process.env.LINE_COACH_USER_IDS || process.env.LINE_SUMMARY_TO || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("U"));
}

// ---------- LINEログイン ----------
// LIFF で取得した IDトークンを LINE に問い合わせて検証し、LINEのユーザーIDと表示名を返す
export async function verifyLineIdToken(idToken: string) {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID || "2012523269-UmgHPVzJ";
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID || liffId.split("-")[0];
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { sub?: string; name?: string };
  return j.sub ? { userId: j.sub, name: j.name ?? "" } : null;
}

// 監督・コーチなら、監督用のリッチメニューを表示する（失敗しても無視）
export async function linkCoachMenuIfCoach(lineUserId: string, role: string) {
  if (!lineConfigured()) return;
  try {
    const menus = await listRichMenus();
    const coach = menus.find((m) => m.name === "監督・コーチ用");
    const member = menus.find((m) => m.name === "部員用");
    if ((role === "coach" || role === "manager") && coach) await linkRichMenu(lineUserId, coach.richMenuId);
    else if (member) await linkRichMenu(lineUserId, member.richMenuId);
  } catch (e) {
    console.error("[line richmenu link]", e);
  }
}
