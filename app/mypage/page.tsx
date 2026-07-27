"use client";

import AuthGate from "../components/AuthGate";
import MyPage from "../components/MyPage";
import CoachAdminPage from "../components/CoachAdminPage";

export default function MyPageRoute() {
  return (
    <AuthGate>
      {(profile, signOut) =>
        profile.role === "coach" ? (
          <CoachAdminPage profile={profile} signOut={signOut} />
        ) : (
          <MyPage profile={profile} signOut={signOut} />
        )
      }
    </AuthGate>
  );
}
