// トレーニングの強度・負荷の計算（振り返りタブで使う）
//
// ■ 推定MAX（1RM）：Brzycki式 重量 × 36 ÷ (37 − 回数)。13回以上のセットは使わない
// ■ 相対強度：そのセットの重量 ÷ その時点の推定MAX（自己ベスト）
// ■ 練習負荷：メインセット（アップを除く）の「重量 × 回数」をセットごとに足したもの
//    （＝重量×回数×セット数）。例）80kg×8回×3セット → 1,920
//    MAX重量を1回×3セットのように合計回数が少ない日は、負荷も小さく出る
//    マット練習は、参加（実施報告）した日に一定の値（MAT_PRACTICE_LOAD）を足す
// ■ 負荷バランス（急性:慢性 負荷比）：直近7日の負荷 ÷ 直近28日の1週間あたり平均
//    0.8〜1.3 がちょうどよい範囲。1.5を超える急な増加はケガのリスクが上がるとされる

// マット練習1回分の練習負荷（ウェイトの「重量×回数」に換算した値）
export const MAT_PRACTICE_LOAD = 3000;

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

export type DayLoad = {
  date: string;
  load: number;
  // その日のメインセットの相対強度（0〜1）
  intensities: number[];
  // その日に自己ベスト（推定MAX）を更新した種目
  pbExerciseIds: string[];
};

/**
 * 日ごとの練習負荷を計算する。rows は1人分のセット記録（期間はできるだけ長く渡すと、
 * 推定MAXの基準が正確になる）。
 */
export function computeDailyLoad(rows: LoadSetRow[]): Map<string, DayLoad> {
  const byDate = new Map<string, LoadSetRow[]>();
  for (const r of rows) {
    const l = byDate.get(r.date) ?? [];
    l.push(r);
    byDate.set(r.date, l);
  }
  const dates = Array.from(byDate.keys()).sort();
  const bestSoFar = new Map<string, number>();
  const out = new Map<string, DayLoad>();

  for (const date of dates) {
    const day: DayLoad = { date, load: 0, intensities: [], pbExerciseIds: [] };
    const byExercise = new Map<string, LoadSetRow[]>();
    for (const r of byDate.get(date)!) {
      const l = byExercise.get(r.exercise_id) ?? [];
      l.push(r);
      byExercise.set(r.exercise_id, l);
    }
    for (const [exId, sets] of byExercise) {
      const weighted = sets.filter((s) => s.weight_kg != null && (s.reps ?? 0) > 0);
      if (weighted.length === 0) continue;
      const todayBest = Math.max(
        0,
        ...weighted.map((s) => e1rm(Number(s.weight_kg), s.reps!) ?? 0)
      );
      const prev = bestSoFar.get(exId) ?? 0;
      if (prev > 0 && todayBest > prev) day.pbExerciseIds.push(exId);
      const ref = Math.max(prev, todayBest);
      if (ref <= 0) continue;

      // アップの印が無い日は、その日の最高重量の70%未満をアップとみなす
      const marked = sets.some((s) => s.is_warmup);
      const topW = Math.max(...weighted.map((s) => Number(s.weight_kg)));
      const main = weighted.filter((s) =>
        marked ? !s.is_warmup : Number(s.weight_kg) >= topW * 0.7
      );
      for (const s of main) {
        const rel = Math.min(1, Number(s.weight_kg) / ref);
        day.load += Number(s.weight_kg) * s.reps!;
        day.intensities.push(rel);
      }
      if (todayBest > prev) bestSoFar.set(exId, todayBest);
    }
    out.set(date, day);
  }
  return out;
}

export type BalanceStatus = "low" | "good" | "high" | "danger";

export function loadBalance(
  acute7: number,
  chronic28: number
): { ratio: number | null; status: BalanceStatus | null } {
  const weeklyAvg = chronic28 / 4;
  if (weeklyAvg <= 0) return { ratio: null, status: null };
  const ratio = acute7 / weeklyAvg;
  const status: BalanceStatus =
    ratio < 0.8 ? "low" : ratio <= 1.3 ? "good" : ratio <= 1.5 ? "high" : "danger";
  return { ratio, status };
}

export const balanceLabel: Record<BalanceStatus, { label: string; note: string }> = {
  low: { label: "少なめ", note: "いつもより負荷が少ない週です。試合前の調整でなければ、少し上げてもよさそうです。" },
  good: { label: "ちょうどいい", note: "いつも通りの負荷で、無理なく積み上げられています。" },
  high: { label: "やや多め", note: "いつもより負荷が増えています。疲れや痛みに気をつけましょう。" },
  danger: { label: "急に増えすぎ", note: "負荷が急に増えています。ケガのリスクが上がるので、回復も意識しましょう。" },
};
