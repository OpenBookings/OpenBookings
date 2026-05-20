"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Kbd } from "@/components/ui/kbd";
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
import { CommandMenu02 } from "@/components/dashboard/command-menu-02";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type React from "react";
import { useState } from "react";

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
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const pathname = usePathname();

  const isRouteActive = (route: Route) => {
    if (route.link !== "#" && pathname === route.link) return true;
    return route.subs?.some((s) => s.link !== "#" && pathname === s.link) ?? false;
  };

  const isSubActive = (link: string) => link !== "#" && pathname === link;

  return (
    <>
      <CommandMenu02 open={commandOpen} onOpenChange={setCommandOpen} />
      {!isCollapsed && (
        <div className="px-0 pb-2">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="border-input dark:bg-input/30 flex h-9 w-full items-center gap-2 rounded-md border px-3 shadow-xs transition-colors hover:bg-accent"
          >
            <Search className="size-4 text-muted-foreground" />
            <span className="flex-1 text-left text-sm text-muted-foreground">
              Search...
            </span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      )}
    <SidebarMenu>
      {routes.map((route) => {
        const isOpen = !isCollapsed && openCollapsible === route.id;
        const hasSubRoutes = !!route.subs?.length;
        const isActive = isRouteActive(route);

        return (
          <SidebarMenuItem key={route.id}>
            {hasSubRoutes ? (
              <Collapsible
                open={isOpen}
                onOpenChange={(open) =>
                  setOpenCollapsible(open ? route.id : null)
                }
                className="w-full"
              >
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    className={cn(
                      "flex w-full items-center rounded-lg px-2 transition-colors",
                      isOpen || isActive
                        ? "bg-sidebar-muted text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-muted hover:text-foreground",
                      isCollapsed && isActive && "bg-sidebar-muted text-foreground",
                      isCollapsed && "justify-center"
                    )}
                  >
                    {route.icon}
                    {!isCollapsed && (
                      <span className="ml-2 flex-1 text-sm font-medium">
                        {route.title}
                      </span>
                    )}
                    {!isCollapsed && hasSubRoutes && (
                      <span className="ml-auto">
                        {isOpen ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                      </span>
                    )}
                  </SidebarMenuButton>
                </CollapsibleTrigger>

                {!isCollapsed && (
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
                              className={cn(
                                "flex items-center rounded-md px-4 py-1.5 text-sm font-medium hover:bg-sidebar-muted hover:text-foreground",
                                isSubActive(subRoute.link)
                                  ? "bg-sidebar-muted text-foreground"
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
                )}
              </Collapsible>
            ) : (
              <SidebarMenuButton tooltip={route.title} asChild>
                <Link
                  href={route.link}
                  prefetch={true}
                  className={cn(
                    "flex items-center rounded-lg px-2 transition-colors hover:bg-sidebar-muted hover:text-foreground",
                    isActive
                      ? "bg-sidebar-muted text-foreground"
                      : "text-muted-foreground",
                    isCollapsed && "justify-center"
                  )}
                >
                  {route.icon}
                  {!isCollapsed && (
                    <span className="ml-2 text-sm font-medium">
                      {route.title}
                    </span>
                  )}
                </Link>
              </SidebarMenuButton>
            )}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
    </>
  );
}
