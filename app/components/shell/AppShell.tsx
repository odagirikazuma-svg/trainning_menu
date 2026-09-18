"use client";

import { createContext, useContext } from "react";
import AuthGate, { type Profile } from "../AuthGate";
import ThemeProvider from "./ThemeProvider";
import Header from "./Header";
import Footer from "./Footer";

const ProfileContext = createContext<{
  profile: Profile;
  signOut: () => void;
} | null>(null);

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error("useProfile must be used within AppShell");
  }
  return ctx;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthGate>
        {(profile, signOut) => (
          <ProfileContext.Provider value={{ profile, signOut }}>
            <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background text-foreground">
              <Header profile={profile} />
              <main className="flex-1 pb-20 pt-14">{children}</main>
              <Footer profile={profile} />
            </div>
          </ProfileContext.Provider>
        )}
      </AuthGate>
    </ThemeProvider>
  );
}
