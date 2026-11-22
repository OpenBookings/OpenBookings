"use client";

import type { AccessLevel, NavKey } from "@openbookings/authz/nav-access";
import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type * as React from "react";
import { useMemo, useState } from "react";

import { carryQuery } from "@/lib/analytics/pages";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** The page's row in the access table; greyed out when the role can't open it. */
  navKey?: NavKey;
  items?: {
    title: string;
    url: string;
    navKey?: NavKey;
    /** A count beside the link, e.g. reviews waiting for a reply. Hidden at 0. */
    badge?: number;
  }[];
};

const ANALYTICS_ROOT = "/dashboard/analytics/";

export function cantOpenReason(hotelName: string, page: string): string {
  return `Your role at ${hotelName} can't open ${page}.`;
}

/**
 * A greyed-out item: muted, but still hoverable and focusable so its tooltip
 * can say why. The sidebar buttons switch pointer events off for
 * aria-disabled; that is turned back on here, and the hover fill off. It has
 * no href, so a click or Enter goes nowhere; a bookmark to the page still
 * gets the page's no-access state.
 */
const GREYED =
  "cursor-default aria-disabled:pointer-events-auto hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground";

function GreyedLink(props: React.ComponentProps<"a">) {
  return <a role="link" aria-disabled="true" tabIndex={0} {...props} />;
}

/**
 * Between two analytics pages the period, comparison and demo flag come along.
 * Every other link is untouched. Props and ref pass straight through, because
 * the sidebar button renders this as its child.
 */
function CarriedLink({ href, ...props }: Omit<React.ComponentProps<typeof Link>, "href"> & { href: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const carried =
    href.startsWith(ANALYTICS_ROOT) && pathname.startsWith(ANALYTICS_ROOT)
      ? carryQuery(new URLSearchParams(searchParams.toString()))
      : "";
  return <Link href={`${href}${carried}`} {...props} />;
}

export function NavMain({
  items,
  access,
  hotelName,
}: {
  items: NavItem[];
  /** What the role at the current hotel may open (lib/page-access.ts). */
  access: Record<NavKey, AccessLevel>;
  /** The current hotel, for the greyed-out tooltip. */
  hotelName: string | null;
}) {
  const { state, setOpen } = useSidebar();
  const isGreyed = (key: NavKey | undefined) => key !== undefined && access[key] === "none";
  const reason = (page: string) => cantOpenReason(hotelName ?? "this hotel", page);
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

          if (!hasSubItems && isGreyed(item.navKey)) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  // Shown expanded too, not only on the icon rail.
                  tooltip={{ children: reason(item.title), hidden: false }}
                  isActive={isItemActive(item)}
                  className={GREYED}
                >
                  <GreyedLink>
                    <item.icon />
                    <span>{item.title}</span>
                  </GreyedLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }

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

          // Every page in it greyed: the header is muted too, but still opens.
          const muted = item.items?.every((sub) => isGreyed(sub.navKey)) || undefined;

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
                  data-muted={muted}
                  className="data-muted:opacity-50"
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
                  <SidebarMenuAction data-muted={muted} className="data-muted:opacity-50 data-[state=open]:rotate-90">
                    <ChevronRight />
                    <span className="sr-only">Toggle {item.title}</span>
                  </SidebarMenuAction>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) =>
                      isGreyed(subItem.navKey) ? (
                        <SidebarMenuSubItem key={subItem.title}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SidebarMenuSubButton asChild isActive={subItem.url === activeLink} className={GREYED}>
                                <GreyedLink>
                                  <span>{subItem.title}</span>
                                </GreyedLink>
                              </SidebarMenuSubButton>
                            </TooltipTrigger>
                            <TooltipContent side="right">{reason(subItem.title)}</TooltipContent>
                          </Tooltip>
                        </SidebarMenuSubItem>
                      ) : (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={subItem.url === activeLink}
                          >
                            <CarriedLink href={subItem.url} prefetch={!subItem.url.startsWith(ANALYTICS_ROOT)}>
                              <span>{subItem.title}</span>
                              {subItem.badge ? (
                                <span className="ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-medium text-primary-foreground tabular-nums">
                                  {subItem.badge}
                                </span>
                              ) : null}
                            </CarriedLink>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ),
                    )}
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
