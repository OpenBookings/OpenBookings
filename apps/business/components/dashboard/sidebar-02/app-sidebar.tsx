"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { UserProfile } from "@/components/dashboard/sidebar-02/user-profile";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  Building2,
  CalendarDays,
  HandCoins,
  LayoutDashboard,
  MessageCircle,
  Tag,
  TrendingUp,
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
    id: "rates",
    title: "Rates & Availability",
    icon: <Tag className="size-4" />,
    link: "#",
    subs: [
      { title: "Calendar", link: "#"},
      { title: "Rate Plans", link: "#"},
      { title: "Restrictions", link: "#"},
    ],
  },
  {
    id: "reservations",
    title: "Reservations",
    icon: <CalendarDays className="size-4" />,
    link: "#",
    subs: [
      { title: "All Reservations", link: "#"},
      { title: "Cancellations", link: "#"},
    ],
  },
  {
    id: "property",
    title: "Property",
    icon: <Building2 className="size-4" />,
    link: "#",
    subs: [
      { title: "Details", link: "#"},
      { title: "Rooms", link: "#"},
      { title: "Policies", link: "#"},
      { title: "Integrations", link: "#"},
    ],
  },
  {
    id: "finance",
    title: "Finance",
    icon: <HandCoins className="size-4" />,
    link: "#",
    subs: [
      { title: "Payouts", link: "#"},
      { title: "Transactions", link: "#"},
      { title: "Statements", link: "#"},
      { title: "Disputes", link: "#"},
    ],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: <TrendingUp className="size-4" />,
    link: "#",
    subs: [
      { title: "Overview", link: "#", },
      { title: "Sources", link: "#", },
      { title: "Performance", link: "#"},
    ],
  },
  {
    id: "massages",
    title: "Messages",
    icon: <MessageCircle className="size-4" />,
    link: "#",
  },
];

export function DashboardSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader
        className={cn(
          "flex md:pt-3.5",
          isCollapsed
            ? "flex-row items-center justify-between gap-y-4 md:flex-col md:items-start md:justify-start"
            : "flex-row items-center justify-between"
        )}
      >
        <a href="/dashboard" className="flex items-center gap-2">
          {isCollapsed ? (
            <img
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-7 w-auto select-none pointer-events-none"
              draggable={false}
            />
          ) : (
            <img
              src="https://cdn.openbookings.co/Openbookings-logo-v2.png"
              alt="OpenBookings"
              className="h-7 w-auto select-none pointer-events-none"
              draggable={false}
            />
          )}
        </a>

        <motion.div
          key={isCollapsed ? "header-collapsed" : "header-expanded"}
          className={cn(
            "flex items-center gap-2",
            isCollapsed ? "flex-row md:flex-col-reverse" : "flex-row"
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
        >
          <SidebarTrigger />
        </motion.div>
      </SidebarHeader>
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
