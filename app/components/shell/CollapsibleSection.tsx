"use client";

import { useState } from "react";

/**
 * 設定ページなどで使う、タイトルだけを常に表示し、タップで中身を開閉する
 * アコーディオン型のセクション。
 * 枠線と背景色をつけて1項目ずつをカード状に区切ることで、項目同士の境目が
 * 分かりやすくなるようにしている。
 */
export default function CollapsibleSection({
  title,
  defaultOpen = false,
  badge = 0,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  // タイトル横の赤丸の数字（未設定の項目数など）
  badge?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-lg border border-border-color bg-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left active:bg-background/60"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          {title}
          {badge > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {badge}
            </span>
          )}
        </h2>
        <span
          className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border-color px-3 pb-3 pt-2.5">
          {children}
        </div>
      )}
    </section>
  );
}
