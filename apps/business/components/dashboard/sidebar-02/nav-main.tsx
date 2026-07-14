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
  const { state, setOpen } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [openCollapsible, setOpenCollapsible] = useState<string | null>(null);
  const pathname = usePathname();

  const isRouteActive = (route: Route) => {
    if (route.link !== "#" && pathname === route.link) return true;
    return route.subs?.some((s) => s.link !== "#" && pathname === s.link) ?? false;
  };

  const isSubActive = (link: string) => link !== "#" && pathname === link;

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
                  className={cn(
                    "flex items-center rounded-lg px-2 transition-colors hover:bg-sidebar-muted hover:text-foreground",
                    isActive
                      ? "bg-sidebar-muted text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {route.icon}
                  <span className="ml-2 overflow-hidden text-sm font-medium whitespace-nowrap transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
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
                      ? "bg-sidebar-muted text-foreground"
                      : "text-muted-foreground hover:bg-sidebar-muted hover:text-foreground"
                  )}
                >
                  {route.icon}
                  <span className="ml-2 flex flex-1 items-center overflow-hidden whitespace-nowrap text-sm font-medium transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:opacity-0">
                    {route.title}
                  </span>
                  <span className="ml-auto shrink-0 overflow-hidden transition-[opacity,margin,width] duration-300 ease-in-out group-data-[collapsible=icon]:ml-0 group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
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
            </Collapsible>
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
    </>
  );
}
