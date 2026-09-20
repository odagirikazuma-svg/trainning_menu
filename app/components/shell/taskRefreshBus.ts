"use client";

import { useEffect, useState } from "react";

// マイページ／イベントの「未提出タスク」件数は、フッターのアイコンバッジと
// ヘッダー右上のバッジ、マイページ本体の一覧など、複数の場所で独立に計算している。
// 提出・キャンセル・経過報告などでタスクが増減しても、他の場所のバッジがそれを
// 知る手段がなく、画面を開き直すまで古い件数のまま表示され続けてしまっていた。
// このイベントバスを使うと、タスク件数に影響しうる操作の後にnotifyTasksChanged()を
// 呼ぶだけで、useMyTaskCount / useMyEventTaskCountなど購読側が再計算される。
const EVENT_NAME = "app:tasks-changed";

export function notifyTasksChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
}

// 呼び出すたびに1ずつ増える値を返す。useEffectの依存配列に含めることで、
// notifyTasksChanged()が呼ばれるたびに再計算をトリガーできる。
export function useTasksChangedSignal(): number {
  const [signal, setSignal] = useState(0);

  useEffect(() => {
    function handler() {
      setSignal((s) => s + 1);
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") handler();
    }
    window.addEventListener(EVENT_NAME, handler);
    // タブを再び開いた時（時間経過で新しいタスクが発生している可能性がある）にも
    // 念のため再計算する
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handler);
    };
  }, []);

  return signal;
}
