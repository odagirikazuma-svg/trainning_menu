import type { SupabaseClient } from "@supabase/supabase-js";

// 時間割で「オフ」にした日（拠点ごと）。オフの日に残っている自拠点のメニューは、日報のタスクに数えない
export async function loadOffDates(
  supabase: SupabaseClient,
  teamId: string,
  location: string,
  from: string,
  to: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("schedule_days")
    .select("date")
    .eq("team_id", teamId)
    .eq("location", location)
    .eq("is_off", true)
    .gte("date", from)
    .lte("date", to);
  return new Set(((data ?? []) as { date: string }[]).map((r) => r.date));
}
