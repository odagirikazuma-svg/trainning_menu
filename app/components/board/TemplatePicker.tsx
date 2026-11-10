"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { itemsToText, newKey, toDraft, type MenuItemDraft } from "../../lib/menuItems";

type Template = { id: string; name: string; purpose: string | null; items: Record<string, unknown>[] };

// メニュー作成・編集フォームの「テンプレートから入力」。
// 選ぶと、メニュー本文（自由記述）にテンプレートの内容を入れ、
// 保存したときにメニュー項目（予定）にも同じ項目を入れる。
export default function TemplatePicker({
  teamId,
  selected,
  onPick,
}: {
  teamId: string;
  selected: string | null;
  onPick: (t: { id: string; name: string; text: string; items: MenuItemDraft[] } | null) => void;
}) {
  const supabase = createClient();
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    supabase
      .from("menu_templates")
      .select("id, name, purpose, items")
      .eq("team_id", teamId)
      .order("name")
      .then(({ data, error }) => {
        if (!error) setTemplates((data ?? []) as Template[]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        テンプレートから入力
      </span>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (selected === t.id) return onPick(null);
              const items = (t.items ?? []).map((r) => ({ ...toDraft(r), key: newKey() }));
              onPick({ id: t.id, name: t.name, text: itemsToText(items), items });
            }}
            className={`rounded-full px-2.5 py-1 text-xs ${
              selected === t.id
                ? "bg-red-600 text-white"
                : "border border-neutral-300 text-neutral-800 dark:border-neutral-700 dark:text-neutral-200"
            }`}
          >
            📄 {t.name}
            {t.purpose && <span className={`ml-1 ${selected === t.id ? "text-white/80" : "text-neutral-400"}`}>{t.purpose}</span>}
          </button>
        ))}
      </div>
      {selected && (
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          本文は自由に書き足せます。保存すると、メニュー項目（予定）にもテンプレートの項目が入ります。
        </span>
      )}
    </div>
  );
}
