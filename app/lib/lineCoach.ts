// 監督・コーチ用リッチメニューのボタンへの返信（サーバー側専用・返信なので通数0）
import type { SupabaseClient } from "@supabase/supabase-js";
import { absencePlanLabel, absenceReasonText, absenceSessionsText, absenceStateText, type AbsenceRequest } from "./absence";
import { buildDailySummary, jstDateKey } from "./dailySummary";
import { coachLineUserIds, type LineMessage } from "./line";
import { appButton, liffUrl } from "./liffConfig";

const LOC_LABEL: Record<string, string> = { tama: "多摩", otsuka: "大塚" };
const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function md(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}（${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

function cut(s: string, max: number) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export type Staff = { profileId: string | null; role: "coach" | "manager" };

// LINEのユーザーIDから、監督・コーチ（またはマネージャー）かどうかを調べる
export async function findStaff(admin: SupabaseClient, lineUserId: string | undefined): Promise<Staff | null> {
  if (!lineUserId) return null;
  const { data } = await admin
    .from("profiles")
    .select("id, role")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  const p = data as { id: string; role: string } | null;
  if (p && (p.role === "coach" || p.role === "manager")) {
    return { profileId: p.id, role: p.role };
  }
  // アプリと未連携でも、環境変数に登録された監督・コーチは使える
  if (coachLineUserIds().includes(lineUserId)) return { profileId: p?.id ?? null, role: "coach" };
  return null;
}

// 今日のまとめから、指定した見出しのブロックだけを取り出す
async function summarySections(admin: SupabaseClient, teamId: string, heads: string[]) {
  const text = await buildDailySummary(admin, teamId, "");
  const blocks = text.split("\n\n");
  const picked = blocks.filter((b) => heads.some((h) => b.startsWith(h)));
  return [blocks[0], ...picked].join("\n\n");
}

// 「提出状況」：今日の日報（拠点別）と疲労度
export async function replyStatus(admin: SupabaseClient, teamId: string): Promise<LineMessage[]> {
  const text = await summarySections(admin, teamId, ["▪️今日の日報", "▪️疲労度"]);
  return [{ type: "text", text }, appButton("/admin")];
}

// 「怪我の状況」：まだ治っていない怪我
export async function replyInjuries(admin: SupabaseClient, teamId: string): Promise<LineMessage[]> {
  const { data } = await admin
    .from("injuries")
    .select(
      "author_id, symptom_name, body_part, mat_participation, expected_recovery_date, created_at, author:profiles!injuries_author_id_fkey(display_name, home_location)"
    )
    .eq("team_id", teamId)
    .eq("is_recovered", false)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as {
    symptom_name: string;
    body_part: string;
    mat_participation: string;
    expected_recovery_date: string | null;
    created_at: string;
    author: { display_name: string; home_location: string | null } | null;
  }[];
  const part: Record<string, string> = { yes: "参加可", no: "参加不可", conditional: "条件付き" };
  const today = jstDateKey(0);
  const lines = [`🩹 怪我の状況（${md(today)}時点）：${rows.length}人`];
  if (rows.length === 0) lines.push("治療中の怪我はありません。");
  for (const loc of ["tama", "otsuka", null] as const) {
    const list = rows.filter((r) => (r.author?.home_location ?? null) === loc);
    if (list.length === 0) continue;
    lines.push("");
    lines.push(`▪️${loc ? LOC_LABEL[loc] : "拠点未設定"}：${list.length}人`);
    for (const r of list.slice(0, 20)) {
      const isNew = r.created_at.slice(0, 10) >= jstDateKey(-2) ? "🆕" : "";
      const back = r.expected_recovery_date ? `／復帰予定 ${md(r.expected_recovery_date)}` : "";
      lines.push(
        `${isNew}${r.author?.display_name ?? "?"}：${r.body_part}・${r.symptom_name}／${part[r.mat_participation] ?? ""}${back}`
      );
    }
  }
  return [{ type: "text", text: lines.join("\n") }, appButton("/admin?tab=condition")];
}

type PendingRow = AbsenceRequest & { author: { display_name: string; home_location: string | null } | null };

async function pendingRequests(admin: SupabaseClient, teamId: string) {
  const { data } = await admin
    .from("absence_requests")
    .select("*, author:profiles!absence_requests_author_id_fkey(display_name, home_location)")
    .eq("team_id", teamId)
    .eq("status", "pending")
    .gte("date", jstDateKey(0))
    .order("date", { ascending: true })
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as PendingRow[];
}

// 「承認待ち」：一覧と、その場で承認できるボタン
export async function replyPending(admin: SupabaseClient, teamId: string, staff: Staff): Promise<LineMessage[]> {
  const rows = await pendingRequests(admin, teamId);
  if (rows.length === 0) {
    // 今日と明日の休みの報告を、日付・拠点別に見せる（それより先はアプリで見る）
    const { data } = await admin
      .from("absence_requests")
      .select(
        "date, reason_type, reason, approval_method, status, session_keys, author:profiles!absence_requests_author_id_fkey(display_name, home_location), permitter:profiles!absence_requests_permitted_by_fkey(display_name)"
      )
      .eq("team_id", teamId)
      .eq("status", "approved")
      .gte("date", jstDateKey(0))
      .lte("date", jstDateKey(1))
      .order("date", { ascending: true });
    const list = (data ?? []) as unknown as (Pick<AbsenceRequest, "date" | "reason_type" | "reason" | "approval_method" | "status" | "session_keys"> & {
      author: { display_name: string; home_location: string | null } | null;
      permitter: { display_name: string } | null;
    })[];
    const lines = ["🙋 休みの報告（今日・明日）"];
    if (list.length === 0) lines.push("", "報告はありません。");
    for (const d of Array.from(new Set(list.map((r) => r.date)))) {
      const day = list.filter((r) => r.date === d);
      lines.push("", `▪️${md(d)} ${day.length}人`);
      for (const l of ["tama", "otsuka"]) {
        const inLoc = day.filter((r) => r.author?.home_location === l);
        if (inLoc.length === 0) continue;
        lines.push(`${LOC_LABEL[l]}：`);
        for (const r of inLoc) {
          lines.push(
            `・${r.author?.display_name ?? "?"}${r.session_keys && r.session_keys.length > 0 ? `［${absenceSessionsText(r.session_keys)}］` : ""}：${absenceReasonText(r)}／${absenceStateText(r, r.permitter?.display_name)}`
          );
        }
      }
    }
    lines.push("", "1週間先までの休みは、アプリの「報告」タブで見られます。身に覚えのない「直接許可済み」もそこから取り消せます。");
    return [{ type: "text", text: lines.join("\n") }, appButton("/admin#absence")];
  }
  const canApprove = staff.role === "coach";
  const header: LineMessage = {
    type: "text",
    text:
      `🙋 休みの報告　承認待ち：${rows.length}件` +
      (canApprove ? "\n下のカードの「承認」で、その場で承認できます。差し戻しはアプリからできます。" : ""),
    ...(canApprove && rows.length > 1
      ? {
          quickReply: {
            items: [
              {
                type: "action",
                action: {
                  type: "postback",
                  label: `${rows.length}件まとめて承認`,
                  data: "action=approve_all",
                  displayText: "承認待ちをまとめて承認",
                },
              },
            ],
          },
        }
      : {}),
  };
  const shown = rows.slice(0, 10);
  const columns = shown.map((r) => {
    const loc = r.author?.home_location ? LOC_LABEL[r.author.home_location] : "";
    const actions = [
      canApprove
        ? {
            type: "postback",
            label: "承認",
            data: `action=approve&id=${r.id}`,
            displayText: `${r.author?.display_name ?? ""}さんの休み（${md(r.date)}）を承認`,
          }
        : { type: "uri", label: "アプリで見る", uri: liffUrl("/admin#absence") },
      { type: "uri", label: "アプリで差し戻す", uri: liffUrl("/admin#absence") },
    ];
    return {
      title: cut(`${md(r.date)} ${r.author?.display_name ?? "?"}${loc ? `（${loc}）` : ""}`, 40),
      text: cut(`${absenceReasonText(r)}\n代替：${absencePlanLabel[r.plan_type]}${r.plan ? `（${r.plan}）` : ""}`, 60),
      actions,
    };
  });
  const carousel: LineMessage = {
    type: "template",
    altText: `承認待ちの休み申請 ${rows.length}件`,
    template: { type: "carousel", columns },
  };
  const out: LineMessage[] = [header, carousel];
  out.push(
    appButton(
      "/admin#absence",
      rows.length > shown.length
        ? `ほか${rows.length - shown.length}件と差し戻しは、アプリで確認できます`
        : "差し戻しや過去の申請は、アプリで確認できます"
    )
  );
  return out;
}

// 承認ボタン
export async function approve(
  admin: SupabaseClient,
  teamId: string,
  staff: Staff,
  id: string | null
): Promise<LineMessage[]> {
  if (staff.role !== "coach") return [{ type: "text", text: "承認できるのは監督・コーチだけです。" }];
  const target = id ? (await pendingRequests(admin, teamId)).filter((r) => r.id === id) : await pendingRequests(admin, teamId);
  if (target.length === 0) {
    return [{ type: "text", text: id ? "この申請は、すでに承認・差し戻し・取り消しされています。" : "承認待ちの申請はありません。" }];
  }
  const { error } = await admin
    .from("absence_requests")
    .update({
      status: "approved",
      reviewed_by: staff.profileId,
      reviewed_at: new Date().toISOString(),
    })
    .in(
      "id",
      target.map((r) => r.id)
    )
    .eq("status", "pending");
  if (error) return [{ type: "text", text: `承認できませんでした：${error.message}` }];
  const names = target.map((r) => `${md(r.date)} ${r.author?.display_name ?? "?"}`);
  return [
    { type: "text", text: `✅ 承認しました（${target.length}件）\n${names.join("\n")}` },
    appButton("/admin#absence", "ほかの申請はアプリで確認できます"),
  ];
}
