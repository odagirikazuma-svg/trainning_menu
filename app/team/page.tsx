"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGate from "../components/AuthGate";
import TeamPage from "../components/TeamPage";

function ObRedirect() {
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

export default function TeamRoute() {
  return (
    <AuthGate>
      {(profile) =>
        profile.role === "ob" ? <ObRedirect /> : <TeamPage profile={profile} />
      }
    </AuthGate>
  );
}
