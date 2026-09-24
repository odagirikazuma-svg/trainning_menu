"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../components/shell/AppShell";
import CoachAdminPage from "../../components/CoachAdminPage";
import { isStaffRole } from "../../lib/types";

export default function AdminRoute() {
  const { profile } = useProfile();
  const router = useRouter();

  useEffect(() => {
    // 管理ページは管理者とマネージャー（閲覧のみ）が使う
    if (!isStaffRole(profile.role)) {
      router.replace("/mypage");
    }
  }, [profile.role, router]);

  if (!isStaffRole(profile.role)) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
        移動しています…
      </div>
    );
  }

  return <CoachAdminPage profile={profile} />;
}
