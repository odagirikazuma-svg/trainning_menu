"use client";

import AuthGate from "./components/AuthGate";
import TrainingBoardSupabase from "./components/TrainingBoardSupabase";
import ObHome from "./components/ObHome";

export default function Home() {
  return (
    <AuthGate>
      {(profile, signOut) =>
        profile.role === "ob" ? (
          <ObHome profile={profile} signOut={signOut} />
        ) : (
          <TrainingBoardSupabase profile={profile} signOut={signOut} />
        )
      }
    </AuthGate>
  );
}
