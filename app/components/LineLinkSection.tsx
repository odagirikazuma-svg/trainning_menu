"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useProfile } from "./shell/AppShell";

// 設定：LINEとの連携（連携するとLINEだけでログインできる）
export default function LineLinkSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [lineName, setLineName] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("line_user_id, line_display_name")
      .eq("id", profile.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setLineName(undefined);
        const d = data as { line_user_id: string | null; line_display_name: string | null } | null;
        setLineName(d?.line_user_id ? d.line_display_name || "連携済み" : null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  if (lineName === undefined) {
    return <p className="text-xs text-neutral-500">読み込み中…</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {lineName ? (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          ✓ LINE（{lineName}）と連携しています。公式LINEのメニューから、ログインなしでアプリを開けます。
        </p>
      ) : (
        <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
          LINEと連携すると、次からはメールアドレスとパスワードなしで、LINEだけでログインできます。
        </p>
      )}
      <button
        type="button"
        onClick={() => (window.location.href = "/liff?link=1&to=%2Fsettings")}
        className="rounded-xl bg-[#06C755] py-2.5 text-sm font-bold text-white active:opacity-80"
      >
        {lineName ? "別のLINEで連携し直す" : "LINEと連携する"}
      </button>
    </div>
  );
}
