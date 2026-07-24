"use client";

import AuthGate from "../components/AuthGate";
import MyPage from "../components/MyPage";

export default function MyPageRoute() {
  return (
    <AuthGate>
      {(profile, signOut) => <MyPage profile={profile} signOut={signOut} />}
    </AuthGate>
  );
}
