"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../components/shell/AppShell";
import MemberHome from "../../components/MemberHome";

export default function MyPageRoute() {
  const { profile } = useProfile();
  const router = useRouter();

  useEffect(() => {
    // コーチはマイページを持たない（管理ページが対応する存在）
    if (profile.role === "coach") {
      router.replace("/admin");
    }
  }, [profile.role, router]);

  if (profile.role === "coach") {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-neutral-500">
        移動しています…
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full flex-col gap-4 p-4 sm:p-5">
      <MemberHome profile={profile} isManager={profile.role === "manager"} />
    </div>
  );
}
