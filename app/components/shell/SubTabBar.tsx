"use client";

export type SubTabItem<T extends string> = {
  value: T;
  label: string;
  // 未提出タスク数などを示す小さな数字バッジ（0または未指定なら非表示）
  badge?: number;
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
    <div className="flex gap-1.5 border-t border-border-color bg-surface-2 p-2">
      {items.map((item) => {
        const isActive = active === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`relative flex-1 rounded-lg py-2.5 text-[length:calc(13px+var(--fs-add))] font-semibold transition-colors ${
              isActive
                ? "bg-accent text-white"
                : "bg-surface text-neutral-500 active:bg-neutral-200 dark:text-neutral-400 dark:active:bg-neutral-700"
            }`}
          >
            {item.label}
            {!!item.badge && item.badge > 0 && (
              <span
                className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[length:calc(9px+var(--fs-add-mini))] font-bold ${
                  isActive
                    ? "bg-white text-red-600"
                    : "bg-red-600 text-white"
                }`}
              >
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
