// ウェイトの記録から出す数値（振り返りタブで使う）
//
// ■ 推定MAX（1RM）：Brzycki式 重量 × 36 ÷ (37 − 回数)。13回以上のセットは使わない
// ■ 自己ベスト更新：その日の推定MAXが、それまでの最高を超えた種目

export function e1rm(w: number, r: number): number | null {
  if (r <= 0 || r > 12) return null;
  return (w * 36) / (37 - r);
}

export type LoadSetRow = {
  date: string;
  exercise_id: string;
  set_no: number;
  weight_kg: number | null;
  reps: number | null;
  is_warmup?: boolean | null;
};

/**
 * 日ごとに、自己ベスト（推定MAX）を更新した種目を出す。rows は1人分のセット記録
 * （期間はできるだけ長く渡すと、それまでの最高が正確になる）。
 */
export function pbExercisesByDate(rows: LoadSetRow[]): Map<string, string[]> {
  const byDate = new Map<string, LoadSetRow[]>();
  for (const r of rows) {
    const l = byDate.get(r.date) ?? [];
    l.push(r);
    byDate.set(r.date, l);
  }
  const bestSoFar = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const date of Array.from(byDate.keys()).sort()) {
    const pbs: string[] = [];
    const todayBest = new Map<string, number>();
    for (const s of byDate.get(date)!) {
      if (s.weight_kg == null || !(s.reps && s.reps > 0)) continue;
      const v = e1rm(Number(s.weight_kg), s.reps) ?? 0;
      if (v > (todayBest.get(s.exercise_id) ?? 0)) todayBest.set(s.exercise_id, v);
    }
    for (const [exId, v] of todayBest) {
      const prev = bestSoFar.get(exId) ?? 0;
      if (prev > 0 && v > prev) pbs.push(exId);
      if (v > prev) bestSoFar.set(exId, v);
    }
    out.set(date, pbs);
  }
  return out;
}
