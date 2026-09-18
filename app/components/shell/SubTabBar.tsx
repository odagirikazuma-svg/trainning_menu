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
    <div className="flex gap-1 border-t border-border-color bg-surface/95 p-1.5 backdrop-blur">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`flex-1 rounded-md py-2 text-xs font-medium ${
            active === item.value
              ? "bg-red-600 text-white shadow"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
