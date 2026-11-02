"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { ACCOUNT_SECTIONS, activeSection } from "@/lib/account/sections";
import { signOutGuest } from "@/lib/sign-out";
import { cn } from "@/lib/utils";

const ITEM =
  "flex h-9 shrink-0 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * The account tabs. A column beside the page from `lg` up; below that a single
 * row that scrolls sideways, so every tab stays one tap away on a phone.
 */
export function AccountNav() {
  const pathname = usePathname();
  const router = useRouter();
  const active = activeSection(pathname);

  return (
    <nav aria-label="Account" className="-mx-4 lg:mx-0 lg:w-56 lg:shrink-0">
      <ul className="flex gap-1 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:sticky lg:top-36 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ACCOUNT_SECTIONS.map((section) => {
          const current = active?.id === section.id;
          return (
            <li key={section.id}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  ITEM,
                  current
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <section.icon aria-hidden />
                {section.title}
              </Link>
            </li>
          );
        })}
        <li className="lg:mt-3 lg:border-t lg:pt-3">
          <button
            type="button"
            onClick={() => void signOutGuest(router)}
            className={cn(ITEM, "w-full text-muted-foreground hover:bg-accent hover:text-accent-foreground")}
          >
            <LogOut aria-hidden />
            Sign out
          </button>
        </li>
      </ul>
    </nav>
  );
}
