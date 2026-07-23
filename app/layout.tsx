import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "練習ノート",
  description: "レスリング部 練習メニュー掲示板",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50">{children}</body>
    </html>
  );
}
