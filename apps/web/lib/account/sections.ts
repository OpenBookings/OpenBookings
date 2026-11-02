import {
  CalendarDays,
  Heart,
  LifeBuoy,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type AccountSection = {
  id: "bookings" | "messages" | "likes" | "personal" | "security" | "privacy" | "help";
  title: string;
  href: string;
  icon: LucideIcon;
};

/** The account area's tabs, in the order the nav and the dropdown show them. */
export const ACCOUNT_SECTIONS: readonly AccountSection[] = [
  { id: "bookings", title: "Bookings", href: "/account/bookings", icon: CalendarDays },
  { id: "messages", title: "Messages", href: "/account/messages", icon: MessageSquare },
  { id: "likes", title: "Likes", href: "/account/likes", icon: Heart },
  { id: "personal", title: "Personal details", href: "/account/personal-details", icon: UserRound },
  { id: "security", title: "Sign-in & security", href: "/account/security", icon: ShieldCheck },
  { id: "privacy", title: "Privacy & data", href: "/account/privacy", icon: LockKeyhole },
  { id: "help", title: "Help & Support", href: "/account/help", icon: LifeBuoy },
];

/** The tab a path belongs to: the tab itself or one of its subpages. */
export function activeSection(pathname: string): AccountSection | null {
  return (
    ACCOUNT_SECTIONS.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? null
  );
}
