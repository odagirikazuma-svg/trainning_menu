"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../components/shell/AppShell";
import CoachAdminPage from "../../components/CoachAdminPage";

export default function AdminRoute() {
  const { profile } = useProfile();
  const router = useRouter();

  useEffect(() => {
    if (profile.role !== "coach") {
      router.replace("/mypage");
    }
  }, [profile.role, router]);

  if (profile.role !== "coach") {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
        移動しています…
      </div>
    );
  }

  return <CoachAdminPage profile={profile} />;
}
