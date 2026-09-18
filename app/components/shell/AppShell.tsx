"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
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

function AppShellInner({
  profile,
  signOut,
  children,
}: {
  profile: Profile;
  signOut: () => void;
  children: React.ReactNode;
}) {
  const [subNav, setSubNav] = useState<React.ReactNode | null>(null);
  const hasSubNav = subNav != null;

  // value をメモ化しないと、AppShellInner が再レンダーするたびに
  // ProfileContext / SubNavContext の value が新しいオブジェクトになり、
  // useProfile() / useSubNav() を呼んでいるページ側（マイページ／イベントなど）が
  // 無関係な再レンダーのたびに巻き込まれて再レンダーされてしまう。
  // それが「サブナビの登録（setSubNav呼び出し）→AppShell再レンダー→ページ側も再レンダー
  // →サブナビを再登録→…」という無限ループを引き起こし、スマホでタップに反応しなくなる
  // 不具合の原因になっていた。
  const profileValue = useMemo(
    () => ({ profile, signOut }),
    [profile, signOut]
  );
  const subNavValue = useMemo(() => ({ setSubNav }), []);

  return (
    <ProfileContext.Provider value={profileValue}>
      <SubNavContext.Provider value={subNavValue}>
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
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthGate>
        {(profile, signOut) => (
          <AppShellInner profile={profile} signOut={signOut}>
            {children}
          </AppShellInner>
        )}
      </AuthGate>
    </ThemeProvider>
  );
}
