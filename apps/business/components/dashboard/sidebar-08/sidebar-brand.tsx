"use client";

import Image from "next/image";

import { SidebarMenuButton } from "@/components/ui/sidebar";

const OPENBOOKINGS_MARK = "https://cdn.openbookings.co/Public/Openbookings-logo-v2.png";

/** The hotel the header names: the current one. */
export type BrandHotel = { propertyName: string; organizationName: string };

/**
 * The sidebar header's contents, one design for everyone: the OpenBookings
 * mark, then the current hotel's name with its company underneath. No hotel
 * logo: hotel logos are wide wordmarks that are hard to tell apart at a
 * glance, and a hotel without one would have nothing to show. With no hotel
 * yet it is the mark beside "OpenBookings".
 */
export function BrandLockup({ hotel }: { hotel: BrandHotel | null }) {
  return (
    <>
      <Image
        src={OPENBOOKINGS_MARK}
        width={96}
        height={72}
        // Decorative: the text beside it says whose dashboard this is.
        alt=""
        // Height pinned, width left to the 4:3 aspect ratio. Beside a hotel
        // name it yields a size, so the name stays the thing you read.
        className={`pointer-events-none w-auto shrink-0 rounded-lg object-contain select-none ${hotel ? "h-6" : "h-8"}`}
        draggable={false}
      />
      {hotel ? <span aria-hidden className="h-6 w-px shrink-0 bg-sidebar-border" /> : null}
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{hotel ? hotel.propertyName : "OpenBookings"}</span>
        <span className="truncate text-xs text-muted-foreground">
          {hotel ? hotel.organizationName : "Property dashboard"}
        </span>
      </div>
    </>
  );
}

/** The header as a link home, for anyone with nothing to switch between (one hotel, or none yet). */
export function SidebarBrand({ hotel }: { hotel: BrandHotel | null }) {
  return (
    <SidebarMenuButton size="lg" asChild className="group-data-[collapsible=icon]:hidden">
      <a href="/dashboard">
        <BrandLockup hotel={hotel} />
      </a>
    </SidebarMenuButton>
  );
}
