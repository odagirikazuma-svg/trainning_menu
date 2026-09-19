"use client";

import { useState } from "react";

/**
 * 設定ページなどで使う、タイトルだけを常に表示し、タップで中身を開閉する
 * アコーディオン型のセクション。
 */
export default function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left active:bg-surface-2"
      >
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
          {title}
        </h2>
        <span
          className={`shrink-0 text-neutral-400 transition-transform dark:text-neutral-500 ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}
