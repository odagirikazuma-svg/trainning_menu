"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "../components/AuthGate";
import CoachAdminPage from "../components/CoachAdminPage";

function RedirectToHome() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
      移動しています…
    </div>
  );
}

export default function MyPageRoute() {
  return (
    <AuthGate>
      {(profile, signOut) =>
        profile.role === "coach" ? (
          <CoachAdminPage profile={profile} signOut={signOut} />
        ) : (
          <RedirectToHome />
        )
      }
    </AuthGate>
  );
}
