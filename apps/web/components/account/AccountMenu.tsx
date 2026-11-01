"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_SECTIONS } from "@/lib/account/sections";
import { signOutGuest } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

type Variant = "glass" | "console";

function initials(name: string): string {
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * The signed-in guest's menu: every account tab, then Sign out.
 *
 * `glass` sits over imagery on the browsing pages (DESIGN_SYSTEM.md §3.2,
 * dense-menu recipe); `console` is the account area's own top bar (§3.3).
 */
export function AccountMenu({
  user,
  variant,
}: {
  user: { name?: string | null; email: string; image?: string | null };
  variant: Variant;
}) {
  const router = useRouter();
  const name = user.name?.trim() || "";
  const glass = variant === "glass";

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className={cn(
          "rounded-full outline-none focus-visible:ring-[3px]",
          glass ? "focus-visible:ring-white/40" : "focus-visible:ring-ring/50",
        )}
        onClick={() => posthog.capture("account_menu_opened")}
      >
        <Avatar
          className={cn(
            "select-none",
            glass ? "size-8 border border-white/20 shadow sm:size-10 md:size-14" : "size-9 border",
          )}
        >
          <AvatarImage src={user.image || "/profile_avatar.png"} alt="" draggable={false} />
          <AvatarFallback className={glass ? "bg-black/60 text-white" : undefined}>{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          "w-64",
          glass
            ? "rounded-xl border-white/15 bg-black/90 p-1.5 text-white shadow-2xl backdrop-blur-sm"
            : "console rounded-lg",
        )}
      >
        <DropdownMenuLabel className="px-2 py-1.5 font-normal">
          <span className="block truncate text-sm font-medium">{name || "Your account"}</span>
          <span className={cn("block truncate text-xs", glass ? "text-white/60" : "text-muted-foreground")}>
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className={glass ? "bg-white/10" : undefined} />
        <DropdownMenuGroup>
          {ACCOUNT_SECTIONS.map((section) => (
            <DropdownMenuItem
              key={section.id}
              asChild
              className={glass ? "text-white/90 focus:bg-white/10 focus:text-white [&_svg]:text-white/60" : undefined}
            >
              <Link href={section.href}>
                <section.icon aria-hidden />
                {section.title}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className={glass ? "bg-white/10" : undefined} />
        <DropdownMenuItem
          className={glass ? "text-white/90 focus:bg-white/10 focus:text-white [&_svg]:text-white/60" : undefined}
          onSelect={() => void signOutGuest(router)}
        >
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
