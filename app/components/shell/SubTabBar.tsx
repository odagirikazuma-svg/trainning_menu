"use client";

export type SubTabItem<T extends string> = {
  value: T;
  label: string;
};

/**
 * フッター上に出す小さいサブナビ（ページ内切り替え用）。
 * useSubNav() で AppShell に渡して使う。
 */
export default function SubTabBar<T extends string>({
  items,
  active,
  onChange,
}: {
  items: SubTabItem<T>[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1.5 border-t border-border-color bg-surface-2/95 p-2 shadow-[0_-2px_6px_rgba(0,0,0,0.08)] backdrop-blur dark:shadow-[0_-2px_8px_rgba(0,0,0,0.4)]">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`flex-1 rounded-lg py-2.5 text-[13px] font-semibold transition-colors ${
            active === item.value
              ? "bg-red-600 text-white shadow"
              : "bg-surface text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-700"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
