"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "theme-pref";

const ThemeContext = createContext<{
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}>({
  theme: "system",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function resolveIsDark(pref: ThemePref): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const isDark = resolveIsDark(pref);
  document.documentElement.classList.toggle("dark", isDark);
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // デフォルトは「端末設定に合わせる」
  const [theme, setThemeState] = useState<ThemePref>("system");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as ThemePref | null;
      if (saved === "light" || saved === "dark" || saved === "system") {
        setThemeState(saved);
        applyTheme(saved);
        return;
      }
    } catch {
      // localStorageが使えない場合はデフォルト(system)のまま
    }
    applyTheme("system");
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme("system");
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [theme]);

  function setTheme(t: ThemePref) {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // 保存できなくても動作には影響しない
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
