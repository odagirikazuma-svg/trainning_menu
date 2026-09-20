"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import AuthGate, { type Profile } from "../AuthGate";
import ThemeProvider from "./ThemeProvider";
import CalendarViewPrefProvider from "./CalendarViewPrefProvider";
import CalendarDisplayPrefProvider from "./CalendarDisplayPrefProvider";
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

// ページ側が「ヘッダーの右上に小さいバッジ」を出したいときに使うコンテキスト。
// 未提出タスクの件数バッジなど、邪魔にならない位置に常時表示したいものに使う。
const HeaderExtraContext = createContext<{
  setHeaderExtra: (node: React.ReactNode | null) => void;
} | null>(null);

/**
 * ヘッダー右上のバッジを登録するフック。
 * node が null 以外の間、ヘッダーの右端に表示され続ける。
 * 不要になったら null を渡すこと。
 */
export function useHeaderExtra(node: React.ReactNode | null) {
  const ctx = useContext(HeaderExtraContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.setHeaderExtra(node);
    return () => ctx.setHeaderExtra(null);
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
  // ヘッダーの実際の高さ（試合カウントダウンの有無などで変わりうるため、
  // 決め打ちの数値ではなくHeaderからの実測値を使う。初期値は旧来の72px相当）
  const [headerHeight, setHeaderHeight] = useState(72);
  const [headerExtra, setHeaderExtra] = useState<React.ReactNode | null>(null);

  // ヘッダーの実測高さをCSS変数としても公開しておく。ページ側で独自に
  // sticky（追従）表示したい要素があるとき、top-0だとヘッダー（position: fixed）の
  // 裏に隠れてしまうため、top: var(--app-header-height) を指定して逃がせるようにする。
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-header-height",
      `${headerHeight}px`
    );
  }, [headerHeight]);

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
  const headerExtraValue = useMemo(() => ({ setHeaderExtra }), []);

  return (
    <ProfileContext.Provider value={profileValue}>
      <SubNavContext.Provider value={subNavValue}>
        <HeaderExtraContext.Provider value={headerExtraValue}>
        <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-background text-foreground">
          <Header
            profile={profile}
            onHeightChange={setHeaderHeight}
            extra={headerExtra}
          />
          <main
            className="flex-1"
            style={{
              paddingTop: `${headerHeight}px`,
              paddingBottom: hasSubNav
                ? "calc(136px + env(safe-area-inset-bottom))"
                : "calc(88px + env(safe-area-inset-bottom))",
            }}
          >
            {children}
          </main>
          <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col shadow-[0_-4px_10px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.5)]">
            {subNav}
            <Footer profile={profile} />
          </div>
        </div>
        </HeaderExtraContext.Provider>
      </SubNavContext.Provider>
    </ProfileContext.Provider>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CalendarViewPrefProvider>
        <CalendarDisplayPrefProvider>
          <AuthGate>
            {(profile, signOut) => (
              <AppShellInner profile={profile} signOut={signOut}>
                {children}
              </AppShellInner>
            )}
          </AuthGate>
        </CalendarDisplayPrefProvider>
      </CalendarViewPrefProvider>
    </ThemeProvider>
  );
}
