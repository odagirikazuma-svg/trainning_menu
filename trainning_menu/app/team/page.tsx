"use client";

import AuthGate from "../components/AuthGate";
import TeamPage from "../components/TeamPage";

export default function TeamRoute() {
  return (
    <AuthGate>
      {(profile) => <TeamPage profile={profile} />}
    </AuthGate>
  );
}
