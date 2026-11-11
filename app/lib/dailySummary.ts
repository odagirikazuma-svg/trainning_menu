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
type Loc = "tama" | "otsuka";
const LOCS: Loc[] = ["tama", "otsuka"];
const LOC_LABEL: Record<Loc, string> = { tama: "多摩", otsuka: "大塚" };

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

function diffText(now: number, prev: number | null, digits = 1) {
  if (prev === null) return "";
  const d = now - prev;
  const p = prev.toFixed(digits);
  if (Math.abs(d) < 0.05) return `（前回${p} →）`;
  return `（前回${p} ${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(digits)}）`;
}

function oneLine(s: string, max: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type Member = { id: string; display_name: string; home_location: Loc | null };
type MenuRow = {
  title: string | null;
  content: string | null;
  location: Loc;
  start_time: string | null;
  is_joint: boolean;
};

export async function buildDailySummary(
  supabase: SupabaseClient,
  teamId: string,
  appUrl: string
): Promise<string> {
  const today = jstDateKey(0);
  const tomorrow = jstDateKey(1);
  const weekAgo = jstDateKey(-7);

  const [
    membersRes,
    schedRes,
    commentsRes,
    logsRes,
    fatigueRes,
    absTodayRes,
    absTomorrowRes,
    menusRes,
    schedTomorrowRes,
    injuryRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, home_location, role")
      .eq("team_id", teamId)
      .not("role", "in", "(coach,manager,ob)"),
    supabase.from("schedule_days").select("location, is_off").eq("team_id", teamId).eq("date", today),
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
      .select("author_id, date, fatigue")
      .eq("team_id", teamId)
      .gte("date", weekAgo)
      .lte("date", today),
    supabase.from("absence_requests").select("author_id, status, plan_type").eq("team_id", teamId).eq("date", today),
    supabase
      .from("absence_requests")
      .select("*")
      .eq("team_id", teamId)
      .eq("date", tomorrow)
      .order("created_at", { ascending: true }),
    supabase
      .from("menus")
      .select("title, content, location, start_time, is_joint")
      .eq("team_id", teamId)
      .eq("date", tomorrow)
      .eq("is_off", false)
      .order("start_time", { ascending: true }),
    supabase.from("schedule_days").select("location, is_off").eq("team_id", teamId).eq("date", tomorrow),
    supabase
      .from("injuries")
      .select("author_id, symptom_name, body_part, mat_participation")
      .eq("team_id", teamId)
      .gte("created_at", `${today}T00:00:00+09:00`)
      .order("created_at", { ascending: true }),
  ]);

  const members = (membersRes.data ?? []) as Member[];
  const { data: coachRows } = await supabase
    .from("profiles")
    .select("id, display_name")
    .eq("team_id", teamId)
    .eq("role", "coach");
  const coachName = new Map(
    ((coachRows ?? []) as { id: string; display_name: string }[]).map((c) => [c.id, c.display_name])
  );
  const memberById = new Map(members.map((m) => [m.id, m]));
  const nameOf = (id: string) => memberById.get(id)?.display_name ?? "?";
  const locOf = (id: string) => memberById.get(id)?.home_location ?? null;

  const lines: string[] = [];
  lines.push(`📋 ${mdw(today)} のまとめ`);

  // ---------- 1) 今日の日報（拠点別） ----------
  const practiceToday = new Set(
    ((schedRes.data ?? []) as { location: Loc; is_off: boolean }[])
      .filter((r) => !r.is_off)
      .map((r) => r.location)
  );
  const submitted = new Set<string>();
  for (const r of (commentsRes.data ?? []) as { author_id: string }[]) submitted.add(r.author_id);
  const trainingLogged = new Set<string>();
  for (const r of (logsRes.data ?? []) as { author_id: string }[]) {
    submitted.add(r.author_id);
    trainingLogged.add(r.author_id);
  }
  // 承認済みの休みで、代替メニュー（安静以外）の実績がまだの人
  const altMissing = new Set(
    ((absTodayRes.error ? [] : absTodayRes.data) ?? [])
      .filter(
        (r: { status: string; plan_type: string; author_id: string }) =>
          r.status === "approved" && r.plan_type !== "none" && !trainingLogged.has(r.author_id)
      )
      .map((r: { author_id: string }) => r.author_id)
  );
  const approvedToday = new Set(
    ((absTodayRes.error ? [] : absTodayRes.data) ?? [])
      .filter((r: { status: string }) => r.status === "approved")
      .map((r: { author_id: string }) => r.author_id)
  );

  lines.push("");
  lines.push("▪️今日の日報");
  for (const loc of LOCS) {
    if (!practiceToday.has(loc)) {
      lines.push(`${LOC_LABEL[loc]}：練習なし（オフ）`);
      continue;
    }
    const required = members.filter((m) => m.home_location === loc);
    const missing = required.filter((m) => !submitted.has(m.id));
    const rest = required.filter((m) => approvedToday.has(m.id)).length;
    lines.push(
      `${LOC_LABEL[loc]}：${required.length - missing.length}/${required.length}人 提出` +
        (rest > 0 ? `（うち休み${rest}人）` : "")
    );
    lines.push(`未提出者：${missing.length === 0 ? "なし 🎉" : joinNames(missing.map((m) => m.display_name), 15)}`);
    const alt = required.filter((m) => altMissing.has(m.id) && submitted.has(m.id));
    if (alt.length > 0) {
      lines.push(`代替メニュー未報告：${joinNames(alt.map((m) => m.display_name), 15)}`);
    }
  }

  // ---------- 2) 疲労度（拠点別・前回との比較） ----------
  const fatigueRows = ((fatigueRes.error ? [] : fatigueRes.data) ?? []) as {
    author_id: string;
    date: string;
    fatigue: number;
  }[];
  const todayRows = fatigueRows.filter((r) => r.date === today);
  if (todayRows.length > 0) {
    lines.push("");
    lines.push("▪️疲労度（自己評価）");
    const avg = (rows: { fatigue: number }[]) =>
      rows.length ? rows.reduce((s, r) => s + r.fatigue, 0) / rows.length : null;
    for (const loc of LOCS) {
      const t = todayRows.filter((r) => locOf(r.author_id) === loc);
      const a = avg(t);
      if (a === null) continue;
      // 前回 ＝ 今日より前で、その拠点に入力があった直近の日
      const prevDates = fatigueRows
        .filter((r) => r.date < today && locOf(r.author_id) === loc)
        .map((r) => r.date)
        .sort();
      const prevDate = prevDates[prevDates.length - 1];
      const prevAvg = prevDate
        ? avg(fatigueRows.filter((r) => r.date === prevDate && locOf(r.author_id) === loc))
        : null;
      lines.push(`${LOC_LABEL[loc]}：平均${a.toFixed(1)}${diffText(a, prevAvg)}／${t.length}人入力`);
    }
    const high = todayRows
      .filter((r) => r.fatigue >= 7)
      .sort((x, y) => y.fatigue - x.fatigue)
      .map((r) => {
        const prev = fatigueRows
          .filter((p) => p.author_id === r.author_id && p.date < today)
          .sort((x, y) => (x.date < y.date ? 1 : -1))[0];
        return `${nameOf(r.author_id)} ${r.fatigue}${prev ? diffText(r.fatigue, prev.fatigue, 0) : ""}`;
      });
    if (high.length > 0) lines.push(`高い人（7以上）：${joinNames(high, 8)}`);
  }

  // ---------- 3) 新しい怪我 ----------
  const injuries = ((injuryRes.error ? [] : injuryRes.data) ?? []) as {
    author_id: string;
    symptom_name: string;
    body_part: string;
    mat_participation: string;
  }[];
  if (injuries.length > 0) {
    const part: Record<string, string> = { yes: "練習参加可", no: "練習不可", conditional: "条件付きで参加" };
    lines.push("");
    lines.push(`▪️新しい怪我の報告：${injuries.length}人`);
    for (const i of injuries) {
      const loc = locOf(i.author_id);
      lines.push(
        `🩹${nameOf(i.author_id)}${loc ? `（${LOC_LABEL[loc]}）` : ""}：${i.body_part}・${i.symptom_name}／${part[i.mat_participation] ?? ""}`
      );
    }
  }

  // ---------- 3-2) 体調不良の病院の報告（今日届いたもの・まだの人） ----------
  {
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86400_000).toISOString().slice(0, 10);
    const { data: sick, error: sickErr } = await supabase
      .from("absence_requests")
      .select("author_id, date, hospital_name, hospital_result, hospital_reported_at")
      .eq("team_id", teamId)
      .eq("reason_type", "sick")
      .neq("status", "rejected")
      .gte("date", since)
      .lte("date", today);
    const list = (sickErr ? [] : sick ?? []) as {
      author_id: string;
      date: string;
      hospital_name: string | null;
      hospital_result: string | null;
      hospital_reported_at: string | null;
    }[];
    const reportedToday = list.filter(
      (r) => r.hospital_reported_at && new Date(Date.parse(r.hospital_reported_at) + 9 * 3600_000).toISOString().slice(0, 10) === today
    );
    const notYet = list.filter((r) => !r.hospital_name && !r.hospital_result);
    if (reportedToday.length > 0 || notYet.length > 0) {
      lines.push("");
      lines.push("▪️体調不良の病院の報告");
      for (const r of reportedToday) lines.push(`🏥${nameOf(r.author_id)}：${r.hospital_name ?? ""}／${(r.hospital_result ?? "").slice(0, 60)}`);
      if (notYet.length > 0) lines.push(`まだ：${joinNames([...new Set(notYet.map((r) => nameOf(r.author_id)))], 10)}`);
    }
  }

  // ---------- 4) 明日の休み（拠点別） ----------
  const tomorrowReqs = ((absTomorrowRes.error ? [] : absTomorrowRes.data) ?? []) as AbsenceRequest[];
  lines.push("");
  lines.push(`▪️明日 ${mdw(tomorrow)} の休み`);
  if (tomorrowReqs.length === 0) {
    lines.push("申請なし");
  } else {
    const pending = tomorrowReqs.filter((r) => r.status === "pending").length;
    if (pending > 0) lines.push(`⚠️ 承認待ち ${pending}人`);
    lines.push("📝届け出（授業）　✅直接許可済み　↩️取り消し");
    const groups: { label: string; rows: AbsenceRequest[] }[] = [
      ...LOCS.map((loc) => ({
        label: LOC_LABEL[loc],
        rows: tomorrowReqs.filter((r) => locOf(r.author_id) === loc),
      })),
      { label: "拠点未設定", rows: tomorrowReqs.filter((r) => !locOf(r.author_id)) },
    ];
    for (const g of groups) {
      if (g.rows.length === 0) {
        if (g.label !== "拠点未設定") lines.push(`${g.label}：なし`);
        continue;
      }
      lines.push(`${g.label}：${g.rows.length}人`);
      for (const r of g.rows.slice(0, 15)) {
        const mark = r.status === "pending" ? "⏳" : r.status === "rejected" ? "↩️" : r.reason_type === "school" ? "📝" : "✅";
        const permit =
          r.status === "approved" && r.reason_type !== "school"
            ? `（許可：${coachName.get(r.permitted_by ?? "") ?? "?"}${r.approval_method ? "・" + (r.approval_method === "line" ? "LINE" : "電話") : ""}）`
            : "";
        lines.push(`${mark}${nameOf(r.author_id)}：${absenceReasonText(r)}${permit}／代替 ${absencePlanLabel[r.plan_type]}`);
      }
      if (g.rows.length > 15) lines.push(`ほか${g.rows.length - 15}人`);
    }
  }

  // ---------- 5) 明日の練習メニュー（拠点別） ----------
  lines.push("");
  lines.push(
    menuLines(
      (menusRes.data ?? []) as MenuRow[],
      (schedTomorrowRes.data ?? []) as { location: Loc; is_off: boolean }[],
      tomorrow
    )
  );

  void appUrl;

  const text = lines.join("\n");
  return text.length > 4900 ? `${text.slice(0, 4890)}\n…（続きはアプリで）` : text;
}

function menuLines(
  menus: MenuRow[],
  sched: { location: Loc; is_off: boolean }[],
  date: string,
  maxContent = 120
) {
  const out: string[] = [];
  const offs = new Set(sched.filter((r) => r.is_off).map((r) => r.location));
  const menuLine = (m: MenuRow) => {
    const head = `・${m.start_time ? m.start_time.slice(0, 5) + " " : ""}${m.title?.trim() || "マット練習"}`;
    const body = m.content?.trim() ? `\n　${oneLine(m.content, maxContent)}` : "";
    return head + body;
  };
  out.push(`▪️明日 ${mdw(date)} の練習メニュー`);
  const joint = menus.filter((m) => m.is_joint);
  if (joint.length > 0) {
    out.push("合同：");
    for (const m of joint) out.push(menuLine(m));
  }
  for (const loc of LOCS) {
    const own = menus.filter((m) => !m.is_joint && m.location === loc);
    if (own.length > 0) {
      out.push(`${LOC_LABEL[loc]}：`);
      for (const m of own) out.push(menuLine(m));
    } else if (offs.has(loc)) {
      out.push(`${LOC_LABEL[loc]}：オフ`);
    } else if (joint.length === 0) {
      out.push(`${LOC_LABEL[loc]}：まだ登録されていません`);
    }
  }
  return out.join("\n");
}

// リッチメニュー「明日のメニュー」への返信
export async function buildTomorrowMenuText(supabase: SupabaseClient, teamId: string) {
  const tomorrow = jstDateKey(1);
  const [menusRes, schedRes] = await Promise.all([
    supabase
      .from("menus")
      .select("title, content, location, start_time, is_joint")
      .eq("team_id", teamId)
      .eq("date", tomorrow)
      .eq("is_off", false)
      .order("start_time", { ascending: true }),
    supabase.from("schedule_days").select("location, is_off").eq("team_id", teamId).eq("date", tomorrow),
  ]);
  return menuLines(
    (menusRes.data ?? []) as MenuRow[],
    (schedRes.data ?? []) as { location: Loc; is_off: boolean }[],
    tomorrow,
    400
  );
}

// 部員のリッチメニュー「練習メニュー」への返信：今日と明日の練習メニュー
// loc を渡すと、その拠点と合同練習だけにしぼる
export async function buildPracticeMenuText(
  supabase: SupabaseClient,
  teamId: string,
  loc: Loc | null
) {
  const days = [jstDateKey(0), jstDateKey(1)];
  const [menusRes, schedRes] = await Promise.all([
    supabase
      .from("menus")
      .select("date, title, content, location, start_time, is_joint")
      .eq("team_id", teamId)
      .in("date", days)
      .eq("is_off", false)
      .order("start_time", { ascending: true }),
    supabase.from("schedule_days").select("date, location, is_off").eq("team_id", teamId).in("date", days),
  ]);
  const menus = (menusRes.data ?? []) as (MenuRow & { date: string })[];
  const sched = (schedRes.data ?? []) as { date: string; location: Loc; is_off: boolean }[];
  const out: string[] = [`🥋 練習メニュー${loc ? `（${LOC_LABEL[loc]}）` : ""}`];
  days.forEach((d, i) => {
    out.push("", `▪️${i === 0 ? "今日" : "明日"} ${mdw(d)}`);
    const list = menus.filter((m) => m.date === d && (!loc || m.is_joint || m.location === loc));
    if (list.length === 0) {
      const off = sched.some((s) => s.date === d && s.is_off && (!loc || s.location === loc));
      out.push(off ? "オフ" : "まだ登録されていません");
      return;
    }
    for (const m of list) {
      const where = m.is_joint ? "合同" : loc ? "" : LOC_LABEL[m.location];
      out.push(
        `・${m.start_time ? m.start_time.slice(0, 5) + " " : ""}${m.title?.trim() || "マット練習"}${where ? `（${where}）` : ""}`
      );
      if (m.content?.trim()) out.push(m.content.trim().slice(0, 600));
    }
  });
  return out.join("\n");
}
