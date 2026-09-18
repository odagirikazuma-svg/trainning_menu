"use client";

import { createContext, useContext, useEffect, useState } from "react";
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

// ページ側が「フッターの上に小さいサブナビ」を出したいときに使うコンテキスト。
// ページ側の useEffect で setSubNav(<...タブUI...>) / クリーンアップで setSubNav(null) を呼ぶ。
const SubNavContext = createContext<{
  setSubNav: (node: React.ReactNode | null) => void;
} | null>(null);

/**
 * フッター上のサブナビを登録するフック。
 * node が null 以外の間、フッターのすぐ上に表示され続ける。
 * ページを離れる／条件が変わって不要になったら null を渡すこと。
 */
export function useSubNav(node: React.ReactNode | null) {
  const ctx = useContext(SubNavContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setSubNav(node);
    return () => ctx.setSubNav(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [subNav, setSubNav] = useState<React.ReactNode | null>(null);
  const hasSubNav = subNav != null;

  return (
    <ThemeProvider>
      <AuthGate>
        {(profile, signOut) => (
          <ProfileContext.Provider value={{ profile, signOut }}>
            <SubNavContext.Provider value={{ setSubNav }}>
              <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background text-foreground">
                <Header profile={profile} />
                <main
                  className="flex-1"
                  style={{
                    paddingTop: "calc(72px + env(safe-area-inset-top))",
                    paddingBottom: hasSubNav
                      ? "calc(136px + env(safe-area-inset-bottom))"
                      : "calc(88px + env(safe-area-inset-bottom))",
                  }}
                >
                  {children}
                </main>
                {subNav && (
                  <div
                    className="fixed inset-x-0 z-20"
                    style={{ bottom: "calc(88px + env(safe-area-inset-bottom))" }}
                  >
                    {subNav}
                  </div>
                )}
                <Footer profile={profile} />
              </div>
            </SubNavContext.Provider>
          </ProfileContext.Provider>
        )}
      </AuthGate>
    </ThemeProvider>
  );
}
