"use client";

import { useProfile } from "../../components/shell/AppShell";
import TeamPage from "../../components/TeamPage";

export default function TeamRoute() {
  const { profile } = useProfile();
  return <TeamPage profile={profile} />;
}
