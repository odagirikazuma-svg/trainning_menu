"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../components/shell/AppShell";
import { isStaffRole } from "../lib/types";

export default function RootRedirect() {
  const { profile } = useProfile();
  const router = useRouter();

  useEffect(() => {
    router.replace(isStaffRole(profile.role) ? "/admin" : "/mypage");
  }, [profile.role, router]);

  return (
    <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
      読み込み中…
    </div>
  );
}
