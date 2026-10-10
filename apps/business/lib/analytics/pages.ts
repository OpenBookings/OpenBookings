export const PAGE_IDS = ["revenue", "occupancy", "booking-patterns", "pricing", "guests"] as const;
export type PageId = (typeof PAGE_IDS)[number];

export interface PageMeta {
  title: string;
  description: string;
  path: string;
}

export const PAGES: Record<PageId, PageMeta> = {
  revenue: {
    title: "Revenue",
    description: "What you earned, and what OpenBookings takes.",
    path: "/dashboard/analytics/revenue",
  },
  occupancy: {
    title: "Occupancy",
    description: "How full you are, and what is still unsold.",
    path: "/dashboard/analytics/occupancy",
  },
  "booking-patterns": {
    title: "Booking patterns",
    description: "When guests book, how long they stay, and who cancels.",
    path: "/dashboard/analytics/booking-patterns",
  },
  pricing: {
    title: "Pricing",
    description: "Whether your rates are working.",
    path: "/dashboard/analytics/pricing",
  },
  guests: {
    title: "Guests",
    description: "Who is staying with you.",
    path: "/dashboard/analytics/guests",
  },
};

/** The filters that follow a host from one analytics page to the next. */
export const CARRIED_PARAMS = ["period", "from", "to", "compare", "demo"] as const;

/** `?period=…` with only the carried params, or an empty string. */
export function carryQuery(search: URLSearchParams): string {
  const kept = new URLSearchParams();
  for (const key of CARRIED_PARAMS) {
    const value = search.get(key);
    if (value !== null) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `?${query}` : "";
}
