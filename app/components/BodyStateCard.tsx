"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import InsightCard from "./InsightCard";
import DualAxisChart from "./DualAxisChart";
import { loadMyFatigue, type MyFatigue } from "../lib/myFatigue";

// 振り返り「今のあなたの体の状態」（本人と監督・コーチだけが見る）
// 自分で感じている疲れ（日報の自己評価）と、練習量から出した疲れの目安を並べて、ずれに気づけるようにする
function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function md(s: string) {
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
}
function levelOf(ratio: number) {
  if (ratio >= 1.3) return { text: "いつもより高め", cls: "text-red-600 dark:text-red-400" };
  if (ratio <= 0.7) return { text: "いつもより軽め", cls: "text-sky-600 dark:text-sky-400" };
  return { text: "いつもどおり", cls: "text-emerald-600 dark:text-emerald-400" };
}

export default function BodyStateCard({
  member,
  isSelf,
  refreshKey = 0,
}: {
  member: { id: string; team_id: string; home_location: string | null };
  isSelf: boolean;
  refreshKey?: number;
}) {
  const supabase = createClient();
  const [data, setData] = useState<MyFatigue | null>(null);
  const today = toDateKey(new Date());

  useEffect(() => {
    loadMyFatigue(supabase, member, today).then(setData).catch(() => setData(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member.id, refreshKey]);

  const you = isSelf ? "あなた" : "この部員";
  if (!data) {
    return (
      <InsightCard id="ins-body" icon="🫀" title={`今の${you}の体の状態`} subtitle="感じている疲れと、練習量からの目安">
        <p className="text-xs text-neutral-500">集計中…</p>
      </InsightCard>
    );
  }

  // 自己評価：いちばん新しい記録と、その前の記録
  const selfDates = data.days.filter((d) => data.selfByDate.has(d));
  const lastSelfDate = selfDates[selfDates.length - 1];
  const lastSelf = lastSelfDate ? data.selfByDate.get(lastSelfDate)! : null;
  const prevSelf = selfDates.length > 1 ? data.selfByDate.get(selfDates[selfDates.length - 2])! : null;
  const selfAvg = selfDates.length > 0 ? selfDates.reduce((a, d) => a + data.selfByDate.get(d)!, 0) / selfDates.length : null;

  // 練習量から：本人の直近28日の平均を100としたときの今日の値
  const pct = data.ratio != null ? Math.round(data.ratio * 100) : null;
  const yPct = data.yesterdayRatio != null ? Math.round(data.yesterdayRatio * 100) : null;
  const level = data.ratio != null ? levelOf(data.ratio) : null;

  // 気持ちと練習量のずれ
  let gap: string | null = null;
  if (lastSelf != null && lastSelfDate && data.ratio != null && lastSelfDate >= toDateKey(new Date(Date.now() - 2 * 86400_000))) {
    if (lastSelf <= 4 && data.ratio >= 1.3)
      gap = "疲れはあまり感じていなくても、練習量としてはいつもより多めです。睡眠と休養を意識しましょう。";
    else if (lastSelf >= 7 && data.ratio <= 1.0)
      gap = "練習量はいつも並みなのに、疲れを強く感じています。睡眠・食事・体調も振り返ってみましょう。";
  }

  const avg = data.avg || 1;
  const accPct = data.days.map((d) => (data.short || !data.accByDate.has(d) ? null : Math.round(((data.accByDate.get(d) ?? 0) / avg) * 100)));
  const selfSeries = data.days.map((d) => data.selfByDate.get(d) ?? null);
  const hasChart = selfSeries.some((v) => v != null) || accPct.some((v) => v != null);

  const box = "flex flex-col gap-1 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50";
  const small = "text-[length:calc(10px+var(--fs-add))] leading-snug text-neutral-500";

  return (
    <InsightCard id="ins-body" icon="🫀" title={`今の${you}の体の状態`} subtitle="感じている疲れと、練習量からの目安">
      <div className="grid grid-cols-2 gap-2">
        <div className={box}>
          <span className="text-[length:calc(10px+var(--fs-add))] font-medium text-neutral-500">😮‍💨 自己評価の疲労度</span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold leading-none text-foreground">{lastSelf ?? "—"}</span>
            {lastSelf != null && <span className="text-xs text-neutral-500">/10</span>}
            {lastSelf != null && prevSelf != null && lastSelf !== prevSelf && (
              <span className={`text-[length:calc(10px+var(--fs-add))] font-bold ${lastSelf > prevSelf ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {lastSelf > prevSelf ? "▲" : "▼"} {Math.abs(lastSelf - prevSelf)}
              </span>
            )}
          </span>
          <span className={small}>
            {lastSelfDate ? `${md(lastSelfDate)}の日報` : "日報で1〜10を入れると出ます"}
            {selfAvg != null && `・4週平均 ${selfAvg.toFixed(1)}`}
          </span>
        </div>
        <div className={box}>
          <span className="text-[length:calc(10px+var(--fs-add))] font-medium text-neutral-500">📈 練習量からの疲労度</span>
          {data.noSettings ? (
            <span className={small}>監督が係数を設定すると出ます</span>
          ) : pct == null ? (
            <>
              <span className="text-lg font-extrabold leading-none text-neutral-400">記録不足</span>
              <span className={small}>練習の記録が2週間分たまると出ます</span>
            </>
          ) : (
            <>
              <span className="flex items-baseline gap-1.5">
                <span className="text-2xl font-extrabold leading-none text-foreground">{pct}</span>
                <span className="text-xs text-neutral-500">%</span>
                {yPct != null && yPct !== pct && (
                  <span className={`text-[length:calc(10px+var(--fs-add))] font-bold ${pct > yPct ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {pct > yPct ? "▲" : "▼"} {Math.abs(pct - yPct)}（前日比）
                  </span>
                )}
              </span>
              <span className={`text-[length:calc(11px+var(--fs-add))] font-bold ${level!.cls}`}>{level!.text}</span>
              <span className={small}>直近4週の平均を100としたときの今日の値</span>
            </>
          )}
        </div>
      </div>

      {gap && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          💡 {gap}
        </p>
      )}

      {hasChart && (
        <div className="rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/50">
          <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">疲労度の推移（28日）</span>
          <DualAxisChart
            labels={data.days.map(md)}
            leftLabel="自己評価"
            rightLabel="練習量（平均=100）"
            leftDomain={[0, 10]}
            formatLeft={(v) => String(Math.round(v))}
            formatRight={(v) => String(Math.round(v))}
            series={[
              { label: "練習量からの疲労度", axis: "right", kind: "bar", color: "#dc2626", values: accPct },
              { label: "自己評価", axis: "left", kind: "line", color: "#f59e0b", values: selfSeries },
            ]}
            highlight={(i) => data.days[i] === today}
          />
        </div>
      )}
      <p className={small}>
        練習量からの疲労度は、練習予定表のメニュー（実施報告）とウェイトの記録から出した目安です。実際の体の状態とは違うこともあるので、自己評価と見比べて使ってください。
      </p>
    </InsightCard>
  );
}
