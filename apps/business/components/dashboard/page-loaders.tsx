"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LoaderHold } from "@/components/dashboard/loader-hold";
import { LoaderStage, PageLoader } from "@/components/dashboard/page-loader";
import { SiteHeader } from "@/components/dashboard/site-header";

/**
 * What each dashboard page is working out while it loads, in the order the
 * page shows it. The last line stays. Analytics keeps its own lines next to
 * its period control (analytics-loader.tsx).
 */
const LOADERS = {
  overview: {
    label: "Overview",
    lines: ["Gathering today's arrivals", "Counting departures and stays", "Putting your day together"],
  },
  reservations: {
    label: "Reservations",
    lines: ["Gathering your reservations", "Sorting arrivals and departures", "Checking what is coming up"],
  },
  messages: {
    label: "Messages",
    lines: ["Opening your conversations", "Counting unread messages", "Putting the newest first"],
  },
  reviews: {
    label: "Reviews",
    lines: ["Gathering your reviews", "Finding the ones waiting for a reply", "Working out your scores"],
  },
  property: {
    label: "Property",
    lines: ["Opening your property", "Loading amenities and policies", "Checking what is ready to publish"],
  },
  rooms: {
    label: "Rooms",
    lines: ["Gathering your rooms", "Lining up rate plans"],
  },
  room: {
    label: "Room",
    lines: ["Opening this room", "Loading its beds, photos and rates"],
  },
  rates: {
    label: "Rates & availability",
    lines: ["Lining up your calendar", "Filling in rates and availability", "Checking restrictions"],
  },
  team: {
    label: "Team",
    lines: ["Gathering your team", "Looking up everyone's role"],
  },
  payouts: {
    label: "Payouts",
    lines: ["Checking your Stripe account", "Looking at your payouts", "Seeing what Stripe still needs"],
  },
  billing: {
    label: "Billing",
    lines: [
      "Gathering your invoices",
      "Working out the next invoice",
      "Checking your billing details",
      "Checking each property is ready",
    ],
  },
  support: {
    label: "Support",
    lines: ["Gathering your tickets", "Checking for new replies"],
  },
} as const satisfies Record<string, { label: string; lines: readonly string[] }>;

export type LoaderId = keyof typeof LOADERS;

/** Longest prefix first, so a room's page is not taken for the rooms list. */
const BY_PATH: ReadonlyArray<readonly [string, LoaderId]> = [
  ["/dashboard/bookings/messages", "messages"],
  ["/dashboard/bookings/reviews", "reviews"],
  ["/dashboard/bookings", "reservations"],
  ["/dashboard/listings/rates-availability", "rates"],
  ["/dashboard/listings/rooms/", "room"],
  ["/dashboard/listings/rooms", "rooms"],
  ["/dashboard/listings", "property"],
  ["/dashboard/finance/billing", "billing"],
  ["/dashboard/finance", "payouts"],
  ["/dashboard/team", "team"],
];

/** Which loader a loading.tsx shared by several pages shows, from where the host is going. */
export function loaderIdForPath(pathname: string): LoaderId {
  return BY_PATH.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "overview";
}

/**
 * What a loading.tsx or a page's Suspense fallback shows: the logo loader in
 * the empty content area. `id` defaults to the page being opened. `title`
 * adds the header bar, for pages whose header is not in a layout.
 */
export function PageLoading({ id, title }: { id?: LoaderId; title?: string }) {
  const pathname = usePathname();
  const { label, lines } = LOADERS[id ?? loaderIdForPath(pathname)];
  const loader = (
    <LoaderStage>
      <PageLoader label={label} lines={lines} track />
    </LoaderStage>
  );
  if (!title) return loader;
  return (
    <>
      <SiteHeader title={title} />
      <div className="flex min-h-0 flex-1 flex-col py-4 md:py-6">{loader}</div>
    </>
  );
}

/**
 * Covers the whole console while it switches hotel, so nothing of the old
 * hotel stays on screen: "Switching to <hotel>", then the lines of the page
 * the switch lands on (`to`).
 */
export function SwitchingLoader({ hotelName, to }: { hotelName: string; to: string }) {
  const { label, lines } = LOADERS[loaderIdForPath(to)];
  return (
    <div className="fixed inset-0 z-50 bg-background">
      <LoaderStage>
        <PageLoader label={label} lines={lines} lead={`Switching to ${hotelName}`} />
      </LoaderStage>
    </div>
  );
}

/**
 * The page content, held under the loader until it has been up for a full
 * second so it never flashes. `fill` for content that stretches to the
 * bottom of the pane (editors, grids, message threads).
 */
export function PageHold({ id, fill, children }: { id: LoaderId; fill?: boolean; children: ReactNode }) {
  const { label, lines } = LOADERS[id];
  return (
    <LoaderHold page={id} label={label} lines={lines} fill={fill}>
      {children}
    </LoaderHold>
  );
}
