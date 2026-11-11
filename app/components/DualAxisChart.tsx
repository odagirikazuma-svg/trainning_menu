"use client";

import { useState } from "react";

// 左右2本の目盛りを持つグラフ（SVG）。
// 例：左＝重量（kg）の折れ線、右＝練習量の棒。列を押すと、その列の値を下に出す。
export type DualSeries = {
  label: string;
  axis: "left" | "right";
  kind: "line" | "bar" | "dashed" | "point";
  color: string;
  values: (number | null)[];
};

export default function DualAxisChart({
  labels,
  series,
  leftLabel,
  rightLabel,
  formatLeft = (v) => String(Math.round(v)),
  formatRight = (v) => String(Math.round(v)),
  leftDomain,
  rightDomain,
  highlight,
  detail,
  height = 150,
}: {
  // 列ごとの表示名（日付など）
  labels: string[];
  series: DualSeries[];
  leftLabel: string;
  rightLabel: string;
  formatLeft?: (v: number) => string;
  formatRight?: (v: number) => string;
  leftDomain?: [number, number];
  rightDomain?: [number, number];
  // 強調する列（例：自己ベストの日）
  highlight?: (i: number) => boolean;
  // 押した列の説明（なければ各系列の値を並べる）
  detail?: (i: number) => React.ReactNode;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = labels.length;
  const W = 320;
  const padL = 30;
  const padR = 34;
  // 上に軸の名前を置くので、グラフは少し下から始める
  const top = 16;
  const H = height;
  const plotH = H - top - 4;
  const plotW = W - padL - padR;
  const slot = plotW / Math.max(n, 1);
  const cx = (i: number) => padL + slot * i + slot / 2;

  const domainOf = (axis: "left" | "right", given?: [number, number]): [number, number] => {
    if (given) return given;
    const vals = series.filter((s) => s.axis === axis).flatMap((s) => s.values.filter((v): v is number => v != null));
    if (vals.length === 0) return [0, 1];
    const hasBar = series.some((s) => s.axis === axis && s.kind === "bar");
    const min = hasBar ? 0 : Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.12 || Math.max(1, max * 0.1);
    // 棒の軸は上に余白を多めにとり、棒が折れ線にかぶりすぎないようにする
    return [hasBar ? 0 : Math.max(0, min - pad), hasBar ? max * 1.35 : max + pad];
  };
  const [l0, l1] = domainOf("left", leftDomain);
  const [r0, r1] = domainOf("right", rightDomain);
  const y = (axis: "left" | "right", v: number) => {
    const [a, b] = axis === "left" ? [l0, l1] : [r0, r1];
    return top + (1 - (v - a) / (b - a || 1)) * plotH;
  };
  const ticks = [0, 0.5, 1];
  const bars = series.filter((s) => s.kind === "bar");
  const barW = Math.max(3, Math.min(16, (slot * 0.6) / Math.max(bars.length, 1)));

  const pathOf = (s: DualSeries) => {
    let d = "";
    let started = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        started = false;
        return;
      }
      d += `${started ? "L" : "M"}${cx(i)},${y(s.axis, v)} `;
      started = true;
    });
    return d.trim();
  };

  return (
    <div className="flex flex-col gap-1">
      {/* 凡例と軸の名前 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[length:calc(10px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            {s.kind === "bar" ? (
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color, opacity: 0.35 }} />
            ) : s.kind === "point" ? (
              <span className="inline-block h-2.5 w-2.5 rotate-45" style={{ background: s.color }} />
            ) : (
              <span
                className="inline-block w-4"
                style={{ borderTop: `2px ${s.kind === "dashed" ? "dashed" : "solid"} ${s.color}` }}
              />
            )}
            {s.label}
            <span className="text-neutral-400">（{s.axis === "left" ? "左" : "右"}）</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${leftLabel}と${rightLabel}の推移`}>
        {/* 目盛り（左右） */}
        {ticks.map((t) => {
          const yy = top + (1 - t) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} className="stroke-neutral-200 dark:stroke-neutral-700" strokeWidth={0.5} />
              <text x={padL - 3} y={yy + 2.5} fontSize={7} textAnchor="end" fill="#737373">
                {formatLeft(l0 + (l1 - l0) * t)}
              </text>
              <text x={W - padR + 3} y={yy + 2.5} fontSize={7} textAnchor="start" fill="#737373">
                {formatRight(r0 + (r1 - r0) * t)}
              </text>
            </g>
          );
        })}
        <text x={2} y={6} fontSize={6.5} fill="#a3a3a3">
          {leftLabel}
        </text>
        <text x={W - 2} y={6} fontSize={6.5} textAnchor="end" fill="#a3a3a3">
          {rightLabel}
        </text>

        {/* 押した列・強調する列 */}
        {labels.map((_, i) =>
          i === active || highlight?.(i) ? (
            <rect
              key={`hl-${i}`}
              x={padL + slot * i}
              y={top}
              width={slot}
              height={plotH}
              className={i === active ? "fill-neutral-900 dark:fill-white" : "fill-amber-400"}
              opacity={i === active ? 0.07 : 0.12}
            />
          ) : null
        )}

        {/* 棒 */}
        {bars.map((s, bi) =>
          s.values.map((v, i) =>
            v != null && v > 0 ? (
              <rect
                key={`${s.label}-${i}`}
                x={cx(i) - (barW * bars.length) / 2 + bi * barW}
                y={y(s.axis, v)}
                width={barW}
                height={Math.max(1, top + plotH - y(s.axis, v))}
                rx={1.5}
                fill={s.color}
                opacity={0.28}
              />
            ) : null
          )
        )}

        {/* 折れ線・点 */}
        {series
          .filter((s) => s.kind === "line" || s.kind === "dashed")
          .map((s) => (
            <g key={s.label}>
              <path
                d={pathOf(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.kind === "dashed" ? 1.25 : 2}
                strokeDasharray={s.kind === "dashed" ? "3 3" : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.kind === "line" &&
                s.values.map((v, i) =>
                  v != null ? (
                    <circle key={i} cx={cx(i)} cy={y(s.axis, v)} r={2.2} fill={s.color} className="stroke-white dark:stroke-neutral-900" strokeWidth={0.8} />
                  ) : null
                )}
            </g>
          ))}
        {series
          .filter((s) => s.kind === "point")
          .map((s) =>
            s.values.map((v, i) =>
              v != null ? (
                <rect
                  key={`${s.label}-${i}`}
                  x={cx(i) - 3.5}
                  y={y(s.axis, v) - 3.5}
                  width={7}
                  height={7}
                  transform={`rotate(45 ${cx(i)} ${y(s.axis, v)})`}
                  fill={s.color}
                  className="stroke-white dark:stroke-neutral-900"
                  strokeWidth={0.8}
                />
              ) : null
            )
          )}

        {/* 押せる範囲 */}
        {labels.map((l, i) => (
          <rect
            key={`hit-${i}`}
            x={padL + slot * i}
            y={0}
            width={slot}
            height={H}
            fill="transparent"
            className="cursor-pointer"
            onClick={() => setActive(i === active ? null : i)}
          >
            <title>{l}</title>
          </rect>
        ))}
      </svg>
      <div className="flex justify-between pl-[9%] pr-[10%] text-[length:calc(9px+var(--fs-add))] text-neutral-500">
        <span>{labels[0]}</span>
        <span>列を押すとその日の値</span>
        <span>{labels[n - 1]}</span>
      </div>
      {active != null && (
        <div className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
          {detail ? (
            detail(active)
          ) : (
            <>
              {labels[active]}：
              {series
                .map((s) => {
                  const v = s.values[active];
                  return `${s.label} ${v == null ? "—" : s.axis === "left" ? formatLeft(v) : formatRight(v)}`;
                })
                .join("・")}
            </>
          )}
        </div>
      )}
    </div>
  );
}
