import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "練習ノート",
  description: "レスリング部 練習メニュー掲示板",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased" style={{ colorScheme: "dark" }}>
      <body className="min-h-full flex flex-col bg-neutral-950">{children}</body>
    </html>
  );
}
