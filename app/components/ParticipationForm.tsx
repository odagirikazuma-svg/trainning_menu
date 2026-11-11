"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  describeAmount,
  freeAmountOptions,
  participatedKeys,
  participationProblems,
  scopeLabel,
  toDraft,
  type MenuItemDraft,
  type Participation,
  type ParticipationScope,
} from "../lib/menuItems";

// 日報（マット練習）の「参加範囲」と「自由参加スパーの参加量」。
// - ふだんは「全メニュー参加」のまま、自由参加の項目（1分スパー・3分スパーなど）にだけ答える
// - 途中まで／遅れて／一部だけ のときだけ、メニューを選ぶ
// - 選ぶとすぐ保存する。メニュー項目が無い練習では何も出さない
// - 参加量は概算（ほぼ全部100／4分の3＝75／半分50／4分の1＝25／入っていない0）。実測の本数ではない
export default function ParticipationForm({
  menuId,
  memberId,
  teamId,
  readOnly = false,
  onProblems,
}: {
  menuId: string;
  memberId: string;
  teamId: string;
  readOnly?: boolean;
  // 答えが足りないところ（日報の提出前チェックに使う）
  onProblems?: (menuId: string, problems: string[]) => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<MenuItemDraft[] | null>(null);
  const [p, setP] = useState<Participation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [itemsRes, pRes] = await Promise.all([
        supabase.from("menu_items").select("*").eq("menu_id", menuId).order("sort_order"),
        supabase
          .from("menu_participation")
          .select("scope, boundary_key, item_keys, free_amounts")
          .eq("menu_id", menuId)
          .eq("member_id", memberId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (itemsRes.error) {
        setItems([]);
        return;
      }
      const rows = (itemsRes.data ?? []) as Record<string, unknown>[];
      const actual = rows.filter((r) => r.phase === "actual");
      // 実施報告があれば実績、なければ予定のメニューで答える（item_key は共通）
      const list = (actual.length > 0 ? actual : rows.filter((r) => r.phase === "plan")).map(toDraft);
      setItems(list);
      const saved = (pRes.data as Participation | null) ?? null;
      if (saved || readOnly || list.length === 0) {
        setP(saved);
      } else {
        // まだ答えていなければ「全メニュー参加」として保存する（自由参加の量は未選択のまま）
        changeRef.current({ scope: "full", boundary_key: null, item_keys: [], free_amounts: {} });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId, memberId]);

  useEffect(() => {
    if (!items || readOnly) return;
    onProblems?.(menuId, participationProblems(items, p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, p]);

  const changeRef = useRef<(next: Participation) => void>(() => {});
  function change(next: Participation) {
    setP(next);
    if (readOnly) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setError(null);
      const { error } = await supabase.from("menu_participation").upsert(
        {
          team_id: teamId,
          menu_id: menuId,
          member_id: memberId,
          scope: next.scope,
          boundary_key: next.scope === "until" || next.scope === "from" ? next.boundary_key : null,
          item_keys: next.scope === "partial" ? next.item_keys : [],
          free_amounts: next.free_amounts,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "menu_id,member_id" }
      );
      if (error) setError(`保存できませんでした：${error.message}`);
      setSaving(false);
    }, 400);
  }

  changeRef.current = change;

  if (!items || items.length === 0) return null;

  const joined = p ? participatedKeys(items, p) : new Set<string>();
  const free = items.filter((i) => i.format === "free" && joined.has(i.key));
  const chip = (on: boolean) =>
    `rounded-full px-2.5 py-1 text-xs ${
      on ? "bg-red-600 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-700"
    }`;

  if (readOnly) {
    if (!p) return <p className="text-xs text-neutral-500">参加範囲：未回答</p>;
    return (
      <div className="flex flex-col gap-1 rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        <span>
          参加範囲：<b>{scopeLabel[p.scope]}</b>（{joined.size}/{items.length}項目）
        </span>
        {items
          .filter((i) => i.format === "free" && joined.has(i.key))
          .map((i) => {
            const v = p.free_amounts[i.key];
            const label = freeAmountOptions.find((o) => o.value === v)?.label;
            return (
              <span key={i.key}>
                ・{i.name}：{label ?? "未回答"}
                <span className="text-neutral-400">（概算）</span>
              </span>
            );
          })}
      </div>
    );
  }

  // 途中退出・中抜けは扱わない（参加範囲は「全メニュー参加」のみ）。聞くのは自由参加の量だけ
  if (free.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 dark:border-neutral-800 dark:bg-neutral-900/60">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">自由参加のメニュー</span>
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">{saving ? "保存中…" : "選ぶとすぐ保存されます"}</span>
      </div>
      {free.map((i) => (
        <div key={i.key} className="flex flex-col gap-1">
          <span className="text-xs text-neutral-800 dark:text-neutral-200">
            <b>{i.name}</b>（{describeAmount(i)}）に、どのくらい入りましたか？
          </span>
          <div className="flex flex-wrap gap-1">
            {freeAmountOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => change({ ...p!, free_amounts: { ...p!.free_amounts, [i.key]: o.value } })}
                className={chip(p!.free_amounts[i.key] === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {free.length > 0 && (
        <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          だいたいで大丈夫です（本数を数える必要はありません）。
        </span>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
