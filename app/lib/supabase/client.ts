import { createBrowserClient } from "@supabase/ssr";

/**
 * 同じデータの読み込み（GET）が短い間に何度も走ったときに、通信を1回にまとめる。
 * 例：ヘッダー・フッター・マイページが同時に同じ条件で読み込む場合など。
 * - まとめるのはデータベースの読み込み（/rest/v1 への GET）だけ
 * - 1.5秒以内の同じリクエストは、最初の結果を使い回す
 * - 書き込み（POST/PATCH/DELETE など）があったら、すぐに使い回しをやめる（古い結果を見せないため）
 */
const DEDUPE_MS = 1500;
type Cached = {
  at: number;
  promise: Promise<{ status: number; statusText: string; headers: [string, string][]; body: string }>;
};
const cache = new Map<string, Cached>();

function headerValue(init: RequestInit | undefined, name: string) {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return h.get(name) ?? "";
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
  const rec = h as Record<string, string>;
  const key = Object.keys(rec).find((k) => k.toLowerCase() === name);
  return key ? rec[key] : "";
}

const dedupedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || !url.includes("/rest/v1/")) {
    if (method !== "GET" && method !== "HEAD") cache.clear();
    return fetch(input, init);
  }
  // ログイン中のユーザーが違えば別のリクエストとして扱う
  const key = `${headerValue(init, "authorization")}|${headerValue(init, "accept")}|${url}`;
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > DEDUPE_MS) cache.delete(k);
  let hit = cache.get(key);
  if (!hit) {
    const promise = fetch(input, init).then(async (res) => ({
      status: res.status,
      statusText: res.statusText,
      headers: Array.from(res.headers.entries()),
      body: await res.text(),
    }));
    hit = { at: now, promise };
    cache.set(key, hit);
    promise.catch(() => cache.delete(key));
  }
  const r = await hit.promise;
  return new Response(r.status === 204 ? null : r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
  });
};

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: dedupedFetch } }
  );
}
