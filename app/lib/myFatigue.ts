// 本人（または監督が見ている部員）の「今の体の状態」：
// 自己評価の疲労度（日報の1〜10）と、練習量から出した疲労度（負荷の試算・監督の画面と同じ計算）
import type { SupabaseClient } from "@supabase/supabase-js";
import { toDraft, type MenuItemDraft } from "./menuItems";
import { absenceCoversMat } from "./absence";
import {
  addDays,
  dateRange,
  fatigueState,
  memberDailyLoads,
  type Coefficients,
  type LoadMenu,
  type Participation,
} from "./loadEstimate";

export type MyFatigue = {
  // 係数が設定されていない（まだ試算できない）
  noSettings: boolean;
  days: string[]; // 直近28日（古い順）
  // 練習量からの疲労度：蓄積の値と、本人の直近28日平均を100としたときの値
  accByDate: Map<string, number>;
  avg: number;
  ratio: number | null;
  short: boolean;
  yesterdayRatio: number | null;
  // 自己評価（日付→1〜10）
  selfByDate: Map<string, number>;
};

export async function loadMyFatigue(
  supabase: SupabaseClient,
  member: { id: string; team_id: string; home_location: string | null },
  base: string
): Promise<MyFatigue> {
  const from = addDays(base, -55);
  const [setRes, profRes, menuRes, absRes, setsRes, condRes] = await Promise.all([
    supabase.from("load_settings").select("coefficients, retention").eq("team_id", member.team_id).maybeSingle(),
    supabase.from("profiles").select("weight_class").eq("id", member.id).maybeSingle(),
    member.home_location
      ? supabase
          .from("menus")
          .select("id, date, start_time, location, is_joint")
          .eq("team_id", member.team_id)
          .eq("is_off", false)
          .gte("date", from)
          .lte("date", base)
          .or(`location.eq.${member.home_location},is_joint.eq.true`)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("absence_requests")
      .select("date, session_keys")
      .eq("author_id", member.id)
      .eq("status", "approved")
      .gte("date", from)
      .lte("date", base),
    supabase
      .from("training_sets")
      .select("date, weight_kg, reps, is_warmup")
      .eq("author_id", member.id)
      .gte("date", from)
      .lte("date", base)
      .limit(5000),
    supabase
      .from("daily_conditions")
      .select("date, fatigue")
      .eq("author_id", member.id)
      .gte("date", addDays(base, -27))
      .lte("date", base),
  ]);
  const days = dateRange(addDays(base, -27), base);
  const selfByDate = new Map(((condRes.data ?? []) as { date: string; fatigue: number }[]).map((r) => [r.date, r.fatigue]));
  const settings = setRes.data as { coefficients: Coefficients; retention: number } | null;
  const coef = settings?.coefficients ?? {};
  const noSettings = !Object.values(coef).some((v) => typeof v === "number");
  const empty: MyFatigue = { noSettings, days, accByDate: new Map(), avg: 0, ratio: null, short: true, yesterdayRatio: null, selfByDate };
  if (noSettings) return empty;

  const menus = (menuRes.data ?? []) as LoadMenu[];
  const ids = menus.map((m) => m.id);
  const items = new Map<string, { plan: MenuItemDraft[]; actual: MenuItemDraft[] }>();
  let reported = new Set<string>();
  const diffKind = new Map<string, string>();
  const participation = new Map<string, Participation>();
  if (ids.length > 0) {
    const [itRes, repRes, dfRes, ptRes] = await Promise.all([
      supabase.from("menu_items").select("*").in("menu_id", ids).order("sort_order"),
      supabase.from("menu_reports").select("menu_id").in("menu_id", ids),
      supabase.from("menu_attendance_diffs").select("menu_id, kind").in("menu_id", ids).eq("member_id", member.id),
      supabase
        .from("menu_participation")
        .select("menu_id, scope, boundary_key, item_keys, free_amounts")
        .in("menu_id", ids)
        .eq("member_id", member.id),
    ]);
    for (const r of (itRes.data ?? []) as Record<string, unknown>[]) {
      const id = r.menu_id as string;
      const e = items.get(id) ?? { plan: [], actual: [] };
      (r.phase === "actual" ? e.actual : e.plan).push(toDraft(r));
      items.set(id, e);
    }
    reported = new Set(((repRes.data ?? []) as { menu_id: string }[]).map((r) => r.menu_id));
    for (const r of (dfRes.data ?? []) as { menu_id: string; kind: string }[]) if (r.kind !== "left_early") diffKind.set(r.menu_id, r.kind);
    for (const r of (ptRes.data ?? []) as (Participation & { menu_id: string })[]) participation.set(r.menu_id, r);
  }
  const absences = (absRes.data ?? []) as { date: string; session_keys: string[] | null }[];
  const { daily } = memberDailyLoads(
    {
      menus,
      items,
      reported,
      diffKind,
      participation,
      isAbsent: (m) => absences.some((a) => a.date === m.date && absenceCoversMat(a.session_keys, m.start_time)),
      sets: (setsRes.data ?? []) as { date: string; weight_kg: number | null; reps: number | null; is_warmup: boolean | null }[],
      weightClass: (profRes.data as { weight_class: number | null } | null)?.weight_class ?? null,
      homeLocation: member.home_location,
    },
    coef
  );
  const retention = Number(settings?.retention ?? 0.7);
  const st = fatigueState(daily, base, retention);
  const yst = fatigueState(daily, addDays(base, -1), retention);
  return {
    noSettings,
    days,
    accByDate: st.acc,
    avg: st.avg,
    ratio: st.ratio,
    short: st.short,
    yesterdayRatio: yst.ratio,
    selfByDate,
  };
}
