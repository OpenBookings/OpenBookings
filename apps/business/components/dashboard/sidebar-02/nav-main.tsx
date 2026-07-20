"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuItem as SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

export type Route = {
  id: string;
  title: string;
  icon?: React.ReactNode;
  link: string;
  subs?: {
    title: string;
    link: string;
  }[];
};

export default function DashboardNavigation({ routes }: { routes: Route[] }) {
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const pathname = usePathname();

  // Longest matching link wins, so nested pages (/dashboard/bookings/reservations/123)
  // highlight their section without "/dashboard" claiming every subpage.
  const activeLink = useMemo(() => {
    const matchesPath = (link: string) =>
      link !== "#" && (pathname === link || pathname.startsWith(`${link}/`));
    return (
      routes
        .flatMap((route) => [route.link, ...(route.subs?.map((s) => s.link) ?? [])])
        .filter(matchesPath)
        .sort((a, b) => b.length - a.length)[0] ?? null
    );
  }, [pathname, routes]);

  const activeGroupId =
    routes.find((route) => route.subs?.some((s) => s.link === activeLink))?.id ?? null;

  const [openCollapsible, setOpenCollapsible] = useState<string | null>(activeGroupId);

  useEffect(() => {
    if (activeGroupId) setOpenCollapsible(activeGroupId);
  }, [activeGroupId]);

  const isRouteActive = (route: Route) =>
    route.link === activeLink ||
    (route.subs?.some((s) => s.link === activeLink) ?? false);

  const isSubActive = (link: string) => link === activeLink;

  return (
    <>
    <SidebarMenu className="mt-2 group-data-[collapsible=icon]:items-center">
      {routes.map((route) => {
        const isOpen = !isCollapsed && openCollapsible === route.id;
        const hasSubRoutes = !!route.subs?.length;
        const isActive = isRouteActive(route);

        if (!hasSubRoutes) {
          return (
            <SidebarMenuItem key={route.id}>
              <SidebarMenuButton tooltip={route.title} asChild>
                <Link
                  href={route.link}
                  prefetch={true}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-lg px-2 transition-colors hover:bg-sidebar-accent hover:text-foreground",
                    isActive
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {route.icon}
                  <span className="overflow-hidden text-sm font-medium whitespace-nowrap transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
                    {route.title}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        return (
          <SidebarMenuItem key={route.id}>
            <Collapsible
              open={isOpen}
              onOpenChange={(open) =>
                setOpenCollapsible(open ? route.id : null)
              }
              className="w-full"
            >
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  tooltip={route.title}
                  onClick={(event) => {
                    if (isCollapsed) {
                      event.preventDefault();
                      setOpen(true);
                      setOpenCollapsible(route.id);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center rounded-lg px-2 transition-colors",
                    isOpen || isActive
                      ? "bg-sidebar-accent text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                  )}
                >
                  {route.icon}
                  <span className="flex items-center overflow-hidden whitespace-nowrap text-sm font-medium transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:opacity-0">
                    {route.title}
                  </span>
                  <span className="shrink-0 overflow-hidden transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
                    {isOpen ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </span>
                </SidebarMenuButton>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <SidebarMenuSub className="my-1 ml-3.5 ">
                  {route.subs?.map((subRoute) => (
                    <SidebarMenuSubItem
                      key={`${route.id}-${subRoute.title}`}
                      className="h-auto"
                    >
                      <SidebarMenuSubButton asChild>
                        <Link
                          href={subRoute.link}
                          prefetch={true}
                          aria-current={isSubActive(subRoute.link) ? "page" : undefined}
                          className={cn(
                            "flex items-center rounded-md px-4 py-1.5 text-sm font-medium hover:bg-sidebar-accent hover:text-foreground",
                            isSubActive(subRoute.link)
                              ? "bg-sidebar-accent text-foreground"
                              : "text-muted-foreground"
                          )}
                        >
                          {subRoute.title}
                        </Link>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </Collapsible>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
    </>
  );
}
