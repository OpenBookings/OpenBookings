"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserProfile } from "@/components/dashboard/sidebar-02/user-profile";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  HandCoins,
  LayoutDashboard,
  TrendingUp,
  PencilSparkles
} from "lucide-react";
import type { Route } from "./nav-main";
import DashboardNavigation from "@/components/dashboard/sidebar-02/nav-main";
import { StatusBar } from "../status-bar";

const dashboardRoutes: Route[] = [
  {
    id: "overview",
    title: "Overview",
    icon: <LayoutDashboard className="size-4" />,
    link: "/dashboard",
  },
  {
    id: "bookings",
    title: "Bookings",
    icon: <CalendarDays className="size-4" />,
    link: "#",
    subs: [
      { title: "Reservations", link: "/dashboard/bookings/reservations" },
      { title: "Messages", link: "/dashboard/bookings/messages" },
      { title: "Reviews", link: "/dashboard/bookings/reviews" },
    ],
  },
  {
    id: "Property",
    title: "Property",
    icon: <PencilSparkles className="size-4" />,
    link: "#",
    subs: [
      { title: "R&A", link: "/dashboard/listings/rates-availability" },
      { title: "Property", link: "/dashboard/listings/property" },
      { title: "Rooms", link: "/dashboard/listings/rooms" },
    ],
  },
  {
    id: "finance",
    title: "Finance",
    icon: <HandCoins className="size-4" />,
    link: "/dashboard/finance",
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: <TrendingUp className="size-4" />,
    link: "/dashboard/analytics",
  }
];

export function DashboardSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader
        className={cn(
          "relative flex h-(--header-height)",
          isCollapsed
            ? "flex-row items-center justify-between gap-2 md:flex-col md:items-center md:justify-center"
            : "flex-row items-center justify-center"
        )}
      >
        <a
          href="/dashboard"
          className={cn(
            "relative flex h-7 items-center overflow-hidden",
            isCollapsed
              ? "md:justify-center"
              : "absolute left-1/2 -translate-x-1/2"
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            {isCollapsed ? (
              <></>
            ) : (
              <motion.div
                key="logo-expanded"
                className="flex items-center gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeInOut" }}
              >
                <img
                  src="https://images.openbookings.co/44ca5796-7461-488a-9613-be71394d4aaa/logo.svg"
                  alt=""
                  className="h-7 w-auto select-none pointer-events-none"
                  draggable={false}
                />
                <span className="text-muted-foreground select-none">&times;</span>
                <img
                  src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
                  alt="OpenBookings"
                  className="h-7 w-auto select-none pointer-events-none"
                  draggable={false}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </a>

        <motion.div
          key={isCollapsed ? "header-collapsed" : "header-expanded"}
          className={cn(
            "flex items-center gap-2",
            isCollapsed
              ? "flex-row md:flex-col-reverse"
              : "flex-row absolute right-0"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <SidebarTrigger />
        </motion.div>
      </SidebarHeader>
      <Separator />
      <SidebarContent className="gap-4 px-2 py-4">
        <DashboardNavigation routes={dashboardRoutes} />
      </SidebarContent>
      <StatusBar />
      <SidebarFooter className="px-2 pb-3">
        <UserProfile />
      </SidebarFooter>
    </Sidebar>
  );
}
