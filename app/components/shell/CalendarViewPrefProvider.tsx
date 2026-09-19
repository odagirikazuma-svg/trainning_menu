"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type CalendarViewPref = "month" | "week";

const STORAGE_KEY = "calendar-view-pref";

const CalendarViewPrefContext = createContext<{
  defaultCalendarView: CalendarViewPref;
  setDefaultCalendarView: (v: CalendarViewPref) => void;
}>({
  defaultCalendarView: "month",
  setDefaultCalendarView: () => {},
});

export function useCalendarViewPref() {
  return useContext(CalendarViewPrefContext);
}

export default function CalendarViewPrefProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // デフォルトは「月表示」
  const [defaultCalendarView, setDefaultCalendarViewState] =
    useState<CalendarViewPref>("month");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(
        STORAGE_KEY
      ) as CalendarViewPref | null;
      if (saved === "month" || saved === "week") {
        setDefaultCalendarViewState(saved);
      }
    } catch {
      // localStorageが使えない場合はデフォルト(月表示)のまま
    }
  }, []);

  function setDefaultCalendarView(v: CalendarViewPref) {
    setDefaultCalendarViewState(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v);
    } catch {
      // 保存できなくても動作には影響しない
    }
  }

  return (
    <CalendarViewPrefContext.Provider
      value={{ defaultCalendarView, setDefaultCalendarView }}
    >
      {children}
    </CalendarViewPrefContext.Provider>
  );
}
