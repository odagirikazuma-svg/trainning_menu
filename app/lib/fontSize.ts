// 文字サイズ設定（3段階）。端末ごとにlocalStorageへ保存し、<html data-font-size="..."> に反映する。
// 実際の拡大率は globals.css の --fs（標準1 / 大きめ1.15 / 特大1.3）で決まる。

export type FontSizePref = "normal" | "large" | "xlarge";

export const FONT_SIZE_STORAGE_KEY = "font-size-pref";

export const fontSizeOptions: { value: FontSizePref; label: string }[] = [
  { value: "normal", label: "標準" },
  { value: "large", label: "大きめ" },
  { value: "xlarge", label: "特大" },
];

export function readFontSizePref(): FontSizePref {
  try {
    const v = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    if (v === "normal" || v === "large" || v === "xlarge") return v;
  } catch {
    // localStorageが使えない場合は標準
  }
  return "normal";
}

export function applyFontSizePref(pref: FontSizePref) {
  if (typeof document === "undefined") return;
  if (pref === "normal") {
    document.documentElement.removeAttribute("data-font-size");
  } else {
    document.documentElement.setAttribute("data-font-size", pref);
  }
}

export function saveFontSizePref(pref: FontSizePref) {
  applyFontSizePref(pref);
  try {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, pref);
  } catch {
    // 保存できなくても、今開いている画面には反映される
  }
}
