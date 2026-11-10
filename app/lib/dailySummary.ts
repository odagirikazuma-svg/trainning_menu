// 監督・コーチに毎晩送る「今日のまとめ」の文面を作る（サーバー側専用）。
// 管理者のトークンで作った Supabase クライアント（RLS で同じチームが見える）か、
// サービスロールのクライアントのどちらでも動く。
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  absencePlanLabel,
  absenceReasonText,
  type AbsenceRequest,
} from "./absence";

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

// 日本時間の YYYY-MM-DD
export function jstDateKey(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

function mdw(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${w}）`;
}

function joinNames(names: string[], max: number) {
  if (names.length <= max) return names.join("、");
  return `${names.slice(0, max).join("、")} ほか${names.length - max}人`;
}

export async function buildDailySummary(
  supabase: SupabaseClient,
  teamId: string,
  appUrl: string
): Promise<string> {
  const today = jstDateKey(0);
  const tomorrow = jstDateKey(1);

  const [membersRes, schedRes, commentsRes, logsRes, fatigueRes, absTodayRes, absTomorrowRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, home_location, role")
        .eq("team_id", teamId)
        .not("role", "in", "(coach,manager,ob)"),
      supabase
        .from("schedule_days")
        .select("location, is_off")
        .eq("team_id", teamId)
        .eq("date", today),
      supabase
        .from("comments")
        .select("author_id, menu:menus!inner(date, team_id)")
        .in("kind", ["report", "absent"])
        .is("parent_id", null)
        .eq("menu.date", today)
        .eq("menu.team_id", teamId),
      supabase.from("weight_logs").select("author_id").eq("team_id", teamId).eq("date", today),
      supabase
        .from("daily_conditions")
        .select("author_id, fatigue")
        .eq("team_id", teamId)
        .eq("date", today),
      supabase
        .from("absence_requests")
        .select("author_id, status")
        .eq("team_id", teamId)
        .eq("date", today),
      supabase
        .from("absence_requests")
        .select("*")
        .eq("team_id", teamId)
        .eq("date", tomorrow)
        .order("created_at", { ascending: true }),
    ]);

  const members = (membersRes.data ?? []) as {
    id: string;
    display_name: string;
    home_location: "tama" | "otsuka" | null;
  }[];
  const nameOf = new Map(members.map((m) => [m.id, m.display_name]));

  // 今日、練習（オフ以外）がある拠点
  const practiceLocs = new Set(
    ((schedRes.data ?? []) as { location: string; is_off: boolean }[])
      .filter((r) => !r.is_off)
      .map((r) => r.location)
  );
  const required = members.filter((m) => m.home_location && practiceLocs.has(m.home_location));

  const submitted = new Set<string>();
  for (const r of (commentsRes.data ?? []) as { author_id: string }[]) submitted.add(r.author_id);
  for (const r of (logsRes.data ?? []) as { author_id: string }[]) submitted.add(r.author_id);

  const lines: string[] = [];
  lines.push(`📋 ${mdw(today)} のまとめ`);

  // 1) 日報
  lines.push("");
  if (required.length === 0) {
    lines.push("■ 今日の日報：練習なし（オフ）");
  } else {
    const approvedToday = new Set(
      ((absTodayRes.data ?? []) as { author_id: string; status: string }[])
        .filter((r) => r.status === "approved")
        .map((r) => r.author_id)
    );
    const done = required.filter((m) => submitted.has(m.id));
    const missing = required.filter((m) => !submitted.has(m.id));
    lines.push(`■ 今日の日報：${done.length}/${required.length}人 提出`);
    if (missing.length > 0) {
      lines.push(`未提出：${joinNames(missing.map((m) => m.display_name), 15)}`);
    }
    if (approvedToday.size > 0) {
      lines.push(`（承認済みの休み ${approvedToday.size}人）`);
    }
  }

  // 2) 疲労度（自己評価）
  const fatigue = ((fatigueRes.error ? [] : fatigueRes.data) ?? []) as {
    author_id: string;
    fatigue: number;
  }[];
  if (fatigue.length > 0) {
    const avg = fatigue.reduce((s, r) => s + r.fatigue, 0) / fatigue.length;
    const high = fatigue
      .filter((r) => r.fatigue >= 7)
      .sort((a, b) => b.fatigue - a.fatigue)
      .map((r) => `${nameOf.get(r.author_id) ?? "?"} ${r.fatigue}`);
    lines.push("");
    lines.push(`■ 疲労度（自己評価）：平均 ${avg.toFixed(1)}（${fatigue.length}人入力）`);
    if (high.length > 0) lines.push(`高い人：${joinNames(high, 8)}`);
  }

  // 3) 明日の休み
  const tomorrowReqs = ((absTomorrowRes.error ? [] : absTomorrowRes.data) ?? []) as AbsenceRequest[];
  lines.push("");
  if (tomorrowReqs.length === 0) {
    lines.push(`■ 明日 ${mdw(tomorrow)} の休み申請：なし`);
  } else {
    const pending = tomorrowReqs.filter((r) => r.status === "pending").length;
    lines.push(`■ 明日 ${mdw(tomorrow)} の休み：${tomorrowReqs.length}人`);
    if (pending > 0) lines.push(`⚠️ 承認待ち ${pending}人`);
    const shown = tomorrowReqs.slice(0, 20);
    for (const r of shown) {
      const mark = r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "↩️";
      lines.push(
        `${mark}${nameOf.get(r.author_id) ?? "?"}：${absenceReasonText(r)}／代替 ${absencePlanLabel[r.plan_type]}`
      );
    }
    if (tomorrowReqs.length > shown.length) {
      lines.push(`ほか${tomorrowReqs.length - shown.length}人`);
    }
  }

  lines.push("");
  lines.push(`▶ アプリで確認・承認：${appUrl}/admin`);
  return lines.join("\n");
}
