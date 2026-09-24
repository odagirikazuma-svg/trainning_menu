"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile } from "../AuthGate";
import { isStaffRole } from "../../lib/types";
import { useMyTaskCount } from "./useMyTaskCount";
import { useMyEventTaskCount } from "./useMyEventTaskCount";

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
      className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[length:calc(10px*var(--fs))] transition-colors ${
        active
          ? "font-semibold text-red-600 dark:text-red-400"
          : "font-medium text-neutral-500 dark:text-neutral-400"
      }`}
    >
      {active && (
        <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-red-600 dark:bg-red-400" />
      )}
      <span
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          active ? "bg-red-600/10 dark:bg-red-400/15" : ""
        }`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.icon}
          alt={item.label}
          className={`h-6 w-6 object-cover ${
            item.isPhotoIcon ? "rounded-full" : ""
          } ${active ? "opacity-100" : "opacity-60"}`}
        />
        {!!item.badge && item.badge > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[length:calc(9px*var(--fs))] font-bold text-white">
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
  const eventTaskCount = useMyEventTaskCount(profile);
  // 管理者・マネージャーは管理者用のタブ構成（マネージャーは閲覧のみ）
  const isStaff = isStaffRole(profile.role);

  const items: TabItem[] = isStaff
    ? [
        { href: "/admin", label: "管理ページ", icon: "/icons/nav-admin.png" },
        { href: "/board", label: "練習予定表", icon: "/icons/nav-board.png" },
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
        { href: "/team", label: "チーム", icon: "/icons/nav-team-chuo.png" },
        { href: "/board", label: "練習予定表", icon: "/icons/nav-board.png" },
        {
          href: "/events",
          label: "イベント",
          icon: "/icons/nav-events.png",
          badge: eventTaskCount,
        },
        { href: "/settings", label: "設定", icon: "/icons/nav-settings.png" },
      ];

  return (
    <nav
      className="flex border-t border-border-color bg-surface/95 backdrop-blur"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
    >
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
