"use client";

import { ArrowUpRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export type NavSecondaryItem = {
  title: string;
  icon: LucideIcon;
  /** Shows an unread dot on the icon. */
  attention?: boolean;
} & (
  | { type?: "link"; url: string }
  | { type: "external"; url: string }
  // Dialogs are opened from the sidebar; the dialog itself is wired up later.
  | { type: "dialog"; onSelect?: () => void }
);

export function NavSecondary({
  items,
  ...props
}: {
  items: NavSecondaryItem[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname();

  // Riding on the icon keeps the dot visible on the collapsed icon rail, where
  // a trailing badge would be clipped away.
  const renderIcon = (item: NavSecondaryItem) => (
    // The wrapper makes the icon a grandchild of the menu button, out of reach
    // of its `[&>svg]:size-4` rule — so restate the sizing here.
    <span className="relative flex size-4 shrink-0 items-center justify-center [&>svg]:size-4 [&>svg]:shrink-0">
      <item.icon />
      {item.attention ? (
        <>
          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive ring-2 ring-sidebar" />
          <span className="sr-only">unread</span>
        </>
      ) : null}
    </span>
  );

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.type === "dialog" ? (
                <SidebarMenuButton
                  size="sm"
                  tooltip={item.title}
                  onClick={item.onSelect}
                >
                  {renderIcon(item)}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  asChild
                  size="sm"
                  tooltip={item.title}
                  isActive={
                    item.type !== "external" &&
                    (pathname === item.url ||
                      pathname.startsWith(`${item.url}/`))
                  }
                >
                  {item.type === "external" ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {renderIcon(item)}
                      <span className="truncate">{item.title}</span>
                      <ArrowUpRight className="ml-auto size-3.5! opacity-60 group-data-[collapsible=icon]:hidden" />
                    </a>
                  ) : (
                    <Link href={item.url} prefetch={true}>
                      {renderIcon(item)}
                      <span>{item.title}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
