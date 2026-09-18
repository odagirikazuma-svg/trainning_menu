"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile } from "../AuthGate";
import { useMyTaskCount } from "./useMyTaskCount";

type TabItem = {
  href: string;
  label: string;
  icon: string;
  isPhotoIcon?: boolean; // 部員のマイページアイコンのように丸い写真として出す
  badge?: number;
};

function TabLink({ item, active }: { item: TabItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
        active ? "text-red-500" : "text-neutral-500 dark:text-neutral-400"
      }`}
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.icon}
          alt={item.label}
          className={`h-6 w-6 object-cover ${
            item.isPhotoIcon ? "rounded-full" : ""
          } ${active ? "opacity-100" : "opacity-70"}`}
        />
        {!!item.badge && item.badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
            {item.badge > 99 ? "99+" : item.badge}
          </span>
        )}
      </span>
      {item.label}
    </Link>
  );
}

export default function Footer({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const taskCount = useMyTaskCount(profile);
  const isCoach = profile.role === "coach";

  const items: TabItem[] = isCoach
    ? [
        { href: "/admin", label: "管理ページ", icon: "/icons/nav-admin.png" },
        { href: "/board", label: "マット掲示板", icon: "/icons/nav-board.png" },
        { href: "/events", label: "イベント", icon: "/icons/nav-events.png" },
        { href: "/settings", label: "設定", icon: "/icons/nav-settings.png" },
      ]
    : [
        {
          href: "/mypage",
          label: "マイページ",
          icon: profile.icon_url || "/icons/nav-default-avatar.png",
          isPhotoIcon: true,
          badge: taskCount,
        },
        { href: "/team", label: "チーム", icon: "/icons/nav-team.png" },
        { href: "/board", label: "マット掲示板", icon: "/icons/nav-board.png" },
        { href: "/events", label: "イベント", icon: "/icons/nav-events.png" },
        { href: "/settings", label: "設定", icon: "/icons/nav-settings.png" },
      ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border-color bg-surface/95 backdrop-blur">
      {items.map((item) => (
        <TabLink
          key={item.href}
          item={item}
          active={pathname === item.href || pathname.startsWith(item.href + "/")}
        />
      ))}
    </nav>
  );
}
