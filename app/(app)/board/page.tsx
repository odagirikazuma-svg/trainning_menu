"use client";

import { useProfile } from "../../components/shell/AppShell";
import TrainingBoardSupabase from "../../components/TrainingBoardSupabase";

export default function BoardRoute() {
  const { profile } = useProfile();
  return <TrainingBoardSupabase profile={profile} />;
}
