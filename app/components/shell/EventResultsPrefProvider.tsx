"use client";

import { createContext, useContext, useEffect, useState } from "react";

// イベント（ウェイトMAX・体組成）の詳細を開いた時に、自分の数値だけを見るか、
// チーム全員の数値を見られるようにするかの表示設定。
export type EventResultsViewMode = "self" | "all";

export type EventResultsPref = {
  viewMode: EventResultsViewMode;
  // 全員表示のとき、学年ごとに折りたたんで表示するかどうか
  collapseByGrade: boolean;
};

const DEFAULT_PREF: EventResultsPref = {
  viewMode: "self",
  collapseByGrade: false,
};

const STORAGE_KEY = "event-results-pref";

const EventResultsPrefContext = createContext<{
  pref: EventResultsPref;
  setPref: (next: EventResultsPref) => void;
}>({
  pref: DEFAULT_PREF,
  setPref: () => {},
});

export function useEventResultsPref() {
  return useContext(EventResultsPrefContext);
}

function isValidViewMode(v: unknown): v is EventResultsViewMode {
  return v === "self" || v === "all";
}

export default function EventResultsPrefProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pref, setPrefState] = useState<EventResultsPref>(DEFAULT_PREF);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<EventResultsPref>;
        setPrefState({
          viewMode: isValidViewMode(parsed.viewMode)
            ? parsed.viewMode
            : DEFAULT_PREF.viewMode,
          collapseByGrade:
            typeof parsed.collapseByGrade === "boolean"
              ? parsed.collapseByGrade
              : DEFAULT_PREF.collapseByGrade,
        });
      }
    } catch {
      // localStorageが使えない/壊れている場合はデフォルトのまま
    }
  }, []);

  function setPref(next: EventResultsPref) {
    setPrefState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても動作には影響しない
    }
  }

  return (
    <EventResultsPrefContext.Provider value={{ pref, setPref }}>
      {children}
    </EventResultsPrefContext.Provider>
  );
}
