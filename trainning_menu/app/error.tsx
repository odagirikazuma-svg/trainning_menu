"use client";

import { useEffect } from "react";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-950 p-4 text-center text-neutral-200">
      <p className="text-sm text-neutral-400">
        読み込み中に問題が発生しました。
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white active:bg-red-700"
        >
          再読み込み
        </button>
        <button
          onClick={() => {
            if (typeof window !== "undefined") {
              window.location.href = "/";
            }
          }}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300"
        >
          トップに戻る
        </button>
      </div>
    </div>
  );
}
