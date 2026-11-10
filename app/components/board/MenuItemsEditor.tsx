"use client";

import { useState } from "react";
import {
  amountMissing,
  amountTypeLabel,
  categoryLabel,
  describeAmount,
  emptyItem,
  formatLabel,
  defaultFormat,
  defaultAmountType,
  needsCheck,
  targetGroupLabel,
  type TargetGroup,
  type AmountType,
  type MenuCategory,
  type MenuFormat,
  type MenuItemDraft,
} from "../../lib/menuItems";

// メニュー項目（計算用）の入力欄。項目は親が持ち、変更は onChange で返す。
// 1行は普段は「名前・量」の要約で、押すと詳しい入力欄が開く。

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";
const smallLabel = "text-[length:calc(10px+var(--fs-add))] text-neutral-500";

function num(v: string): number | null {
  const n = Number(v.replace(/[^\d]/g, ""));
  return v.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
}

function MinSec({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (sec: number | null) => void;
}) {
  const m = value != null ? Math.floor(value / 60) : "";
  const s = value != null ? value % 60 : "";
  const set = (mm: string, ss: string) => {
    const total = (num(mm) ?? 0) * 60 + (num(ss) ?? 0);
    onChange(total > 0 ? total : null);
  };
  return (
    <label className="flex flex-col gap-0.5">
      <span className={smallLabel}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          inputMode="numeric"
          value={m === 0 && s !== "" ? "0" : String(m)}
          onChange={(e) => set(e.target.value, String(s))}
          onFocus={(e) => e.target.select()}
          className={`${inputCls} w-14 text-right`}
        />
        <span className="text-xs text-neutral-500">分</span>
        <input
          inputMode="numeric"
          value={s === 0 ? "" : String(s)}
          onChange={(e) => set(String(m), e.target.value)}
          onFocus={(e) => e.target.select()}
          className={`${inputCls} w-14 text-right`}
        />
        <span className="text-xs text-neutral-500">秒</span>
      </span>
    </label>
  );
}

function NumField({
  label,
  unit,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  unit: string;
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className={smallLabel}>{label}</span>
      <span className="flex items-center gap-1">
        <input
          inputMode="numeric"
          value={value ?? ""}
          placeholder={placeholder}
          onChange={(e) => onChange(num(e.target.value))}
          onFocus={(e) => e.target.select()}
          className={`${inputCls} w-16 text-right`}
        />
        <span className="text-xs text-neutral-500">{unit}</span>
      </span>
    </label>
  );
}

export default function MenuItemsEditor({
  items,
  onChange,
  canConfirm = false,
}: {
  items: MenuItemDraft[];
  onChange: (items: MenuItemDraft[]) => void;
  // 本数の数え方（全体／1人あたり）を決められるのは監督・管理者だけ
  canConfirm?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const update = (key: string, patch: Partial<MenuItemDraft>) =>
    onChange(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (key: string) => onChange(items.filter((it) => it.key !== key));
  const add = () => {
    const it = emptyItem("other");
    onChange([...items, it]);
    setOpenKey(it.key);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {items.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-300 p-3 text-xs text-neutral-500 dark:border-neutral-700">
          まだ項目がありません。テンプレートか前回のメニューを読み込むか、「項目を追加」から入れてください。
        </p>
      )}
      {items.map((it, i) => {
        const open = openKey === it.key;
        const missing = amountMissing(it);
        return (
          <div
            key={it.key}
            className={`rounded-lg border ${
              open ? "border-red-300 dark:border-red-900" : "border-neutral-200 dark:border-neutral-800"
            } bg-white dark:bg-neutral-950`}
          >
            <button
              type="button"
              onClick={() => setOpenKey(open ? null : it.key)}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
            >
              <span className="w-5 shrink-0 text-right text-xs text-neutral-400">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {it.name || "（名前未入力）"}
                </span>
                <span className="truncate text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                  {categoryLabel[it.category]}・{formatLabel[it.format]}
                  {describeAmount(it) ? `・${describeAmount(it)}` : ""}
                </span>
              </span>
              {!missing && needsCheck(it) && (
                <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[length:calc(9px+var(--fs-add))] font-bold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                  要確認
                </span>
              )}
              {missing && (
                <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[length:calc(9px+var(--fs-add))] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                  量が未入力
                </span>
              )}
              <span className="shrink-0 text-neutral-400">{open ? "▴" : "▾"}</span>
            </button>

            {open && (
              <div className="flex flex-col gap-2.5 border-t border-neutral-100 px-2.5 pb-2.5 pt-2 dark:border-neutral-800">
                <label className="flex flex-col gap-0.5">
                  <span className={smallLabel}>メニュー名</span>
                  <input
                    value={it.name}
                    maxLength={40}
                    placeholder="例：片足タックル、1分スパー"
                    onChange={(e) => update(it.key, { name: e.target.value })}
                    className={inputCls}
                  />
                </label>

                <div className="flex flex-col gap-1">
                  <span className={smallLabel}>種別</span>
                  <div className="flex flex-wrap gap-1">
                    {(Object.keys(categoryLabel) as MenuCategory[]).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          update(it.key, {
                            category: c,
                            // 形式・量の表し方をまだ触っていなければ、種別に合わせる
                            format: it.format === defaultFormat[it.category] ? defaultFormat[c] : it.format,
                            amount_type: amountMissing(it) ? defaultAmountType[c] : it.amount_type,
                            sets_basis:
                              it.sets_basis === "unknown" && c === "spar" ? "total" : it.sets_basis,
                          })
                        }
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          it.category === c
                            ? "bg-red-600 text-white"
                            : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {categoryLabel[c]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <span className={smallLabel}>実施形式</span>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 p-1 text-xs dark:bg-neutral-800">
                    {(Object.keys(formatLabel) as MenuFormat[]).map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => update(it.key, { format: f })}
                        className={`rounded-md py-1.5 font-medium ${
                          it.format === f ? "bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100" : "text-neutral-500"
                        }`}
                      >
                        {formatLabel[f]}
                      </button>
                    ))}
                  </div>
                  {it.format === "free" && (
                    <span className={smallLabel}>
                      自由参加の項目は、学生が日報で「どのくらい入ったか」をおおまかに答えます。
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <span className={smallLabel}>量の表し方</span>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 text-xs dark:bg-neutral-800">
                    {(Object.keys(amountTypeLabel) as AmountType[]).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => update(it.key, { amount_type: a })}
                        className={`rounded-md py-1.5 font-medium ${
                          it.amount_type === a ? "bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100" : "text-neutral-500"
                        }`}
                      >
                        {amountTypeLabel[a]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  {it.amount_type === "timed" && (
                    <>
                      <MinSec label="1本の時間" value={it.unit_seconds} onChange={(v) => update(it.key, { unit_seconds: v })} />
                      <NumField label="本数・セット数" unit="本" value={it.sets} onChange={(v) => update(it.key, { sets: v })} />
                      <div className="flex flex-col gap-0.5">
                        <span className={smallLabel}>本数の数え方</span>
                        {!canConfirm && it.category !== "spar" ? (
                          <span className="rounded-lg bg-neutral-100 px-2 py-1.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                            {it.sets_basis === "total" ? "全体で" : it.sets_basis === "per_person" ? "1人あたり" : "未確認（監督・管理者が確認します）"}
                          </span>
                        ) : (
                        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 text-xs dark:bg-neutral-800">
                          {(["total", "per_person", "unknown"] as const).map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => update(it.key, { sets_basis: b })}
                              className={`rounded-md px-2 py-1 ${
                                it.sets_basis === b ? "bg-white text-neutral-900 shadow dark:bg-neutral-950 dark:text-neutral-100" : "text-neutral-500"
                              }`}
                            >
                              {b === "total" ? "全体で" : b === "per_person" ? "1人あたり" : "未確認"}
                            </button>
                          ))}
                        </div>
                        )}
                      </div>
                    </>
                  )}
                  {it.amount_type === "total" && (
                    <MinSec label="全体の時間" value={it.total_seconds} onChange={(v) => update(it.key, { total_seconds: v })} />
                  )}
                  {it.amount_type === "distance" && (
                    <>
                      <NumField label="距離" unit="m" value={it.distance_m} onChange={(v) => update(it.key, { distance_m: v })} />
                      <NumField label="本数" unit="本" value={it.sets} onChange={(v) => update(it.key, { sets: v })} />
                    </>
                  )}
                  {it.amount_type === "reps" && (
                    <>
                      <NumField label="回数" unit="回" placeholder="MAX" value={it.reps} onChange={(v) => update(it.key, { reps: v })} />
                      <NumField label="セット数" unit="セット" value={it.sets} onChange={(v) => update(it.key, { sets: v })} />
                    </>
                  )}
                </div>
                {it.amount_type === "timed" && (
                  <span className={smallLabel}>
                    例：「3分スパー10本」は 1本3分×10本（全体30分）。「3分×2×10」とは数えません。「25秒×5セット」などで全体か個人か分からないときは「未確認」のままにしてください（監督・管理者が確認するまで、計算には入りません）。
                  </span>
                )}

                {it.format === "rotation" && (
                  <div className="flex flex-wrap items-end gap-3">
                    <NumField label="組の人数" unit="人組" value={it.group_size} onChange={(v) => update(it.key, { group_size: v })} />
                    <NumField
                      label="同時に実施する人数"
                      unit="人"
                      value={it.active_per_group}
                      onChange={(v) => update(it.key, { active_per_group: v })}
                    />
                    <span className={`${smallLabel} basis-full`}>
                      例：4人組で2人ずつ攻防 → 1人の実施時間は全体の約1/2として概算します（交代・説明の時間も含むため実測ではありません）。
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className={smallLabel}>対象</span>
                  <div className="flex gap-1">
                    {(Object.keys(targetGroupLabel) as TargetGroup[]).map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => update(it.key, { target_group: g })}
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          it.target_group === g
                            ? "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
                            : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                        }`}
                      >
                        {targetGroupLabel[g]}
                      </button>
                    ))}
                  </div>
                  {it.target_group !== "all" && (
                    <span className={smallLabel}>
                      例：ラン「通常5km」「重量級3km」は、2つの項目に分けて入れてください（誰が重量級にあたるかは、まだ自動では決めません）。
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <MinSec label="休息（任意）" value={it.rest_seconds} onChange={(v) => update(it.key, { rest_seconds: v })} />
                </div>

                <label className="flex flex-col gap-0.5">
                  <span className={smallLabel}>目的・注意点（任意）</span>
                  <input
                    value={it.note}
                    maxLength={100}
                    onChange={(e) => update(it.key, { note: e.target.value })}
                    className={inputCls}
                  />
                </label>

                <div className="flex gap-2">
                  <button type="button" onClick={() => move(i, -1)} className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} className="rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700">
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.key)}
                    className="ml-auto rounded border border-red-300 px-2 py-1 text-xs text-red-700 dark:border-red-900 dark:text-red-400"
                  >
                    この項目を消す
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="rounded-lg border border-dashed border-neutral-300 py-2 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      >
        ＋ 項目を追加
      </button>
    </div>
  );
}
