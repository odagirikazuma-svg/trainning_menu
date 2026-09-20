"use client";

import { createContext, useContext, useEffect, useState } from "react";

// マイページのカレンダーのマス目に小さく表示する項目。
// マス目のスペースが限られているため、最大2つ（スロット1・スロット2）まで選べる。
export type CalendarSlotOption =
  | "none"
  | "training_time"
  | "actual_type"
  | "training_content"
  | "memo_mark";

export const calendarSlotOptionLabel: Record<CalendarSlotOption, string> = {
  none: "表示しない",
  training_time: "開始時刻・種目（予定。ラン/ウェイト）",
  actual_type: "実際に行った種目（ラン/ウェイト/その他）",
  training_content: "メニューのタイトル",
  memo_mark: "一言メモの内容（先頭数文字）",
};

export const calendarSlotOptions: CalendarSlotOption[] = [
  "none",
  "training_time",
  "actual_type",
  "training_content",
  "memo_mark",
];

export type CalendarDisplayPref = {
  slot1: CalendarSlotOption;
  slot2: CalendarSlotOption;
  // 試合日のマス目を赤枠・「試合」バッジで強調表示するかどうか
  highlightMatch: boolean;
};

const DEFAULT_PREF: CalendarDisplayPref = {
  // 「予定」ではなく「実際に何をやったか」が分かるようにデフォルトはactual_type・タイトルにする
  slot1: "training_content",
  slot2: "actual_type",
  highlightMatch: true,
};

const STORAGE_KEY = "calendar-display-pref";

const CalendarDisplayPrefContext = createContext<{
  pref: CalendarDisplayPref;
  setPref: (next: CalendarDisplayPref) => void;
}>({
  pref: DEFAULT_PREF,
  setPref: () => {},
});

export function useCalendarDisplayPref() {
  return useContext(CalendarDisplayPrefContext);
}

function isValidSlot(v: unknown): v is CalendarSlotOption {
  return (
    typeof v === "string" &&
    (calendarSlotOptions as string[]).includes(v)
  );
}

export default function CalendarDisplayPrefProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pref, setPrefState] = useState<CalendarDisplayPref>(DEFAULT_PREF);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<CalendarDisplayPref>;
        setPrefState({
          slot1: isValidSlot(parsed.slot1) ? parsed.slot1 : DEFAULT_PREF.slot1,
          slot2: isValidSlot(parsed.slot2) ? parsed.slot2 : DEFAULT_PREF.slot2,
          highlightMatch:
            typeof parsed.highlightMatch === "boolean"
              ? parsed.highlightMatch
              : DEFAULT_PREF.highlightMatch,
        });
      }
    } catch {
      // localStorageが使えない/壊れている場合はデフォルトのまま
    }
  }, []);

  function setPref(next: CalendarDisplayPref) {
    setPrefState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 保存できなくても動作には影響しない
    }
  }

  return (
    <CalendarDisplayPrefContext.Provider value={{ pref, setPref }}>
      {children}
    </CalendarDisplayPrefContext.Provider>
  );
}
