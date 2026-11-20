"use client";

import { PageLoader, type PageLoaderProps } from "@/components/dashboard/page-loader";
import { PAGES, type PageId } from "@/lib/analytics/pages";

export { LoaderStage } from "@/components/dashboard/page-loader";

/** What each page is working out, in the order the page shows it. The last line stays. */
const LINES: Record<PageId, readonly string[]> = {
  revenue: [
    "Adding up what you earned",
    "Setting aside the commission",
    "Working out ADR and RevPAR",
    "Drawing revenue over time",
  ],
  occupancy: [
    "Counting the nights you sold",
    "Finding the nights still unsold",
    "Looking ahead 90 days",
    "Sorting occupancy by weekday",
  ],
  "booking-patterns": [
    "Looking at when guests book",
    "Measuring how long they stay",
    "Counting cancellations",
    "Grouping by rate plan",
  ],
  pricing: [
    "Lining up your rates",
    "Working out your ADR",
    "Adding up discounts given",
    "Comparing weekdays",
  ],
  guests: [
    "Getting to know your guests",
    "Counting returning guests",
    "Finding where bookers come from",
    "Grouping by party size",
  ],
};

/** The shared logo loader, with what this analytics page is working out. */
export function AnalyticsLoader({ page, ...rest }: { page: PageId } & Omit<PageLoaderProps, "label" | "lines">) {
  return <PageLoader label={PAGES[page].title} lines={LINES[page]} {...rest} />;
}
