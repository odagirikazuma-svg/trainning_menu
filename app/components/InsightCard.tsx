"use client";

/**
 * 振り返りタブの各ブロック（まとめ・種目ごとの記録・自己ベストなど）を囲むカード。
 * 見出しにアイコンと補足を付け、ブロックごとの区切りをはっきりさせる。
 */
export default function InsightCard({
  id,
  icon,
  title,
  subtitle,
  right,
  children,
}: {
  id?: string;
  icon: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex scroll-mt-44 flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/70 dark:shadow-none"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-base dark:bg-red-950/40">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {subtitle && (
            <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">{subtitle}</span>
          )}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** 振り返りタブの上に出す、各ブロックへのジャンプ用のチップ */
export function InsightJumpBar({ items }: { items: { id: string; label: string }[] }) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() =>
            document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="shrink-0 rounded-full border border-neutral-300 bg-white px-3 py-1 text-[length:calc(11px+var(--fs-add))] font-medium text-neutral-700 active:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:active:bg-neutral-800"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
