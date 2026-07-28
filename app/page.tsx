"use client";

import AuthGate from "./components/AuthGate";
import TrainingBoardSupabase from "./components/TrainingBoardSupabase";

export default function Home() {
  return (
    <AuthGate>
      {(profile) => <TrainingBoardSupabase profile={profile} />}
    </AuthGate>
  );
}
