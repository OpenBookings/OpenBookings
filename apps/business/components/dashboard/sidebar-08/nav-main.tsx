"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  items?: {
    title: string;
    url: string;
  }[];
};

export function NavMain({ items }: { items: NavItem[] }) {
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const pathname = usePathname();

  // Longest matching link wins, so nested pages (/dashboard/bookings/reservations/123)
  // highlight their section without "/dashboard" claiming every subpage.
  const activeLink = useMemo(() => {
    const matchesPath = (url: string) =>
      url !== "#" && (pathname === url || pathname.startsWith(`${url}/`));
    return (
      items
        .flatMap((item) => [item.url, ...(item.items?.map((s) => s.url) ?? [])])
        .filter(matchesPath)
        .sort((a, b) => b.length - a.length)[0] ?? null
    );
  }, [pathname, items]);

  const activeGroupTitle =
    items.find((item) => item.items?.some((s) => s.url === activeLink))?.title ??
    null;

  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupTitle);
  const [lastActiveGroup, setLastActiveGroup] = useState(activeGroupTitle);
  if (activeGroupTitle !== lastActiveGroup) {
    setLastActiveGroup(activeGroupTitle);
    if (activeGroupTitle) setOpenGroup(activeGroupTitle);
  }

  // Only the page itself lights up. A group stays unhighlighted while one of its
  // pages is active, except on the icon rail where the submenu isn't visible.
  const isItemActive = (item: NavItem) =>
    item.url === activeLink ||
    (isCollapsed && (item.items?.some((s) => s.url === activeLink) ?? false));

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const hasSubItems = !!item.items?.length;
          const isOpen = !isCollapsed && openGroup === item.title;

          if (!hasSubItems) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={isItemActive(item)}
                >
                  <Link href={item.url} prefetch={true}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }

          return (
            <Collapsible
              key={item.title}
              asChild
              open={isOpen}
              onOpenChange={(open) => setOpenGroup(open ? item.title : null)}
            >
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isItemActive(item)}
                  onClick={() => {
                    // The icon rail has no room for the submenu — expand first.
                    if (isCollapsed) setOpen(true);
                    setOpenGroup(isOpen ? null : item.title);
                  }}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
                <CollapsibleTrigger asChild>
                  <SidebarMenuAction className="data-[state=open]:rotate-90">
                    <ChevronRight />
                    <span className="sr-only">Toggle {item.title}</span>
                  </SidebarMenuAction>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={subItem.url === activeLink}
                        >
                          <Link href={subItem.url} prefetch={true}>
                            <span>{subItem.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
