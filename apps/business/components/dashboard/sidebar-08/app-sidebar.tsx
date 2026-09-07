"use client";

import {
  Bell,
  BookOpen,
  CalendarDays,
  HandCoins,
  LayoutDashboard,
  LifeBuoy,
  PencilSparkles,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { NavMain, type NavItem } from "@/components/dashboard/sidebar-08/nav-main";
import {
  NavSecondary,
  type NavSecondaryItem,
} from "@/components/dashboard/sidebar-08/nav-secondary";
import { NavUser } from "@/components/dashboard/sidebar-08/nav-user";
import { NotificationsDialog } from "@/components/dashboard/sidebar-08/notifications-dialog";
import {
  type AttentionKey,
  useNavAttention,
} from "@/components/dashboard/sidebar-08/use-nav-attention";
import { WhatsNewDialog } from "@/components/dashboard/sidebar-08/whats-new-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const navMain: NavItem[] = [
  {
    title: "Overview",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Bookings",
    url: "#",
    icon: CalendarDays,
    items: [
      { title: "Reservations", url: "/dashboard/bookings/reservations" },
      { title: "Messages", url: "/dashboard/bookings/messages" },
      { title: "Reviews", url: "/dashboard/bookings/reviews" },
    ],
  },
  {
    title: "Property",
    url: "#",
    icon: PencilSparkles,
    items: [
      { title: "R&A", url: "/dashboard/listings/rates-availability" },
      { title: "Property", url: "/dashboard/listings/property" },
      { title: "Rooms", url: "/dashboard/listings/rooms" },
    ],
  },
  {
    title: "Finance",
    url: "/dashboard/finance",
    icon: HandCoins,
  },
  {
    title: "Analytics",
    url: "/dashboard/analytics",
    icon: TrendingUp,
  },
];

export function DashboardSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const { counts, markSeen } = useNavAttention();
  const [openDialog, setOpenDialog] = useState<AttentionKey | null>(null);

  const openAttentionDialog = (key: AttentionKey) => {
    markSeen(key);
    setOpenDialog(key);
  };

  const navSecondary: NavSecondaryItem[] = [
    {
      title: "Notifications",
      type: "dialog",
      icon: Bell,
      attention: counts.notifications > 0,
      onSelect: () => openAttentionDialog("notifications"),
    },
    {
      title: "What's New",
      type: "dialog",
      icon: Sparkles,
      attention: counts.whatsNew > 0,
      onSelect: () => openAttentionDialog("whatsNew"),
    },
    {
      title: "Support",
      url: "/support",
      icon: LifeBuoy,
      attention: counts.support > 0,
    },
    {
      title: "Documentation",
      type: "external",
      url: "https://docs.openbookings.co",
      icon: BookOpen,
    },
  ];

  return (
    <>
      <Sidebar variant="inset" collapsible="icon" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem className="flex items-center gap-1">
              <SidebarMenuButton
                size="lg"
                asChild
                className="group-data-[collapsible=icon]:hidden"
              >
                <a href="/dashboard">
                  <img
                    src="https://images.openbookings.co/44ca5796-7461-488a-9613-be71394d4aaa/logo.svg"
                    alt=""
                    className="pointer-events-none size-8 shrink-0 rounded-lg object-contain select-none"
                    draggable={false}
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">OpenBookings</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Property dashboard
                    </span>
                  </div>
                </a>
              </SidebarMenuButton>
              <SidebarTrigger className="shrink-0 group-data-[collapsible=icon]:mx-auto" />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavMain items={navMain} />
          <NavSecondary items={navSecondary} className="mt-auto" />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </Sidebar>
      <NotificationsDialog
        open={openDialog === "notifications"}
        onOpenChange={(open) => setOpenDialog(open ? "notifications" : null)}
      />
      <WhatsNewDialog
        open={openDialog === "whatsNew"}
        onOpenChange={(open) => setOpenDialog(open ? "whatsNew" : null)}
      />
    </>
  );
}
