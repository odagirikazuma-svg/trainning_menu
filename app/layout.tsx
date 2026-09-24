import type { Metadata, Viewport } from "next";
import "./globals.css";

// 本番以外（テスト環境のプレビューデプロイなど）かどうか。
// Vercelが自動で設定するVERCEL_ENVを使う（ローカル開発時はundefinedなのでこちらもテスト扱い）
const isNonProduction = process.env.VERCEL_ENV !== "production";

export const metadata: Metadata = {
  title: isNonProduction ? "【テスト】練習ノート" : "練習ノート",
  description: "レスリング部 練習メニュー掲示板",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

// 初回描画より前に、保存されたテーマ設定（ライト/ダーク/端末設定に合わせる）を
// <html>のclassへ反映させておく（画面がちらつくのを防ぐため、ここで同期的に実行する）
const themeInitScript = `
(function () {
  try {
    var pref = window.localStorage.getItem("theme-pref");
    var isDark =
      pref === "dark" ||
      (pref !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {isNonProduction && (
          <div className="sticky top-0 z-50 bg-amber-500 px-2 py-1 text-center text-[11px] font-bold text-black">
            ここはテスト環境です（本番データではありません）
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
