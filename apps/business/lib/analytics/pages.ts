export const PAGE_IDS = ["revenue", "occupancy", "booking-patterns", "pricing", "guests"] as const;
export type PageId = (typeof PAGE_IDS)[number];

/** One dashed placeholder in the never-booked state. */
export interface GhostFrame {
  title: string;
  /** One line saying what the widget will show. */
  caption: string;
  kind: "line" | "bars" | "table" | "strip";
}

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  ghost: { stats: string[]; frames: GhostFrame[] };
}

export const PAGES: Record<PageId, PageMeta> = {
  revenue: {
    title: "Revenue",
    description: "What you earned, and what OpenBookings takes.",
    path: "/dashboard/analytics/revenue",
    ghost: {
      stats: ["Revenue", "Year to date", "ADR", "RevPAR", "Commission (4.5%)"],
      frames: [
        { title: "Revenue over time", caption: "Your revenue week by week, against the period before.", kind: "line" },
        { title: "Revenue by room type", caption: "Which rooms and rate plans bring in the most.", kind: "bars" },
      ],
    },
  },
  occupancy: {
    title: "Occupancy",
    description: "How full you are, and what is still unsold.",
    path: "/dashboard/analytics/occupancy",
    ghost: {
      stats: ["Occupancy", "Nights sold", "Nights available", "Unsold, next 30 days"],
      frames: [
        { title: "Occupancy over time", caption: "The share of your available nights that sold.", kind: "line" },
        { title: "Next 90 days", caption: "Sold against available, day by day, so unsold weekends stand out.", kind: "strip" },
        { title: "Occupancy by weekday", caption: "Which nights of the week fill and which do not.", kind: "bars" },
      ],
    },
  },
  "booking-patterns": {
    title: "Booking patterns",
    description: "When guests book, how long they stay, and who cancels.",
    path: "/dashboard/analytics/booking-patterns",
    ghost: {
      stats: ["Bookings", "Median lead time", "Median stay length", "Cancellation rate"],
      frames: [
        { title: "Lead time", caption: "How far ahead guests book.", kind: "bars" },
        { title: "Stay length", caption: "How many nights guests stay.", kind: "bars" },
        { title: "Cancellations by rate plan", caption: "Which rate plans get cancelled, and the fees you kept.", kind: "table" },
      ],
    },
  },
  pricing: {
    title: "Pricing",
    description: "Whether your rates are working.",
    path: "/dashboard/analytics/pricing",
    ghost: {
      stats: ["ADR", "Discounts given", "Average discount depth"],
      frames: [
        { title: "ADR over time", caption: "Your average nightly rate, against the period before.", kind: "line" },
        { title: "By rate plan", caption: "Bookings, nights, ADR and revenue for each rate plan.", kind: "table" },
        { title: "By weekday", caption: "Occupancy and ADR side by side for each night of the week.", kind: "table" },
      ],
    },
  },
  guests: {
    title: "Guests",
    description: "Who is staying with you.",
    path: "/dashboard/analytics/guests",
    ghost: {
      stats: ["Returning guests", "Median party size"],
      frames: [
        { title: "Booker country", caption: "Where your guests book from.", kind: "bars" },
        { title: "Group type", caption: "Solo travellers, couples, families and groups.", kind: "bars" },
      ],
    },
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
