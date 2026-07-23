"use client";

import AuthGate from "./components/AuthGate";
import TrainingBoardSupabase from "./components/TrainingBoardSupabase";

export default function Home() {
  return (
    <AuthGate>
      {(profile, signOut) => (
        <TrainingBoardSupabase profile={profile} signOut={signOut} />
      )}
    </AuthGate>
  );
}
