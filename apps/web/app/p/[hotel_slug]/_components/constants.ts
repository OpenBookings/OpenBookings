import type { CancellationTier } from "@openbookings/pricing";

export const NAV_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "rooms",    label: "Rooms" },
  { id: "policies", label: "Policies" },
  { id: "location", label: "Location" },
  { id: "book",     label: "Footnote" },
] as const;

export type NavSectionId = typeof NAV_SECTIONS[number]["id"];

export const AMENITIES_PREVIEW = 10;
export const PILLS_PER_ROW = 5;

// ── DB-backed types ────────────────────────────────────────────────────────────

export type DbAmenityItem = { label: string; icon: string };
export type DbAmenityCategory = { label: string; items: DbAmenityItem[] };

export type DbRatePlan = {
  id: string;
  name: string;
  bar: number;
  currency: string;
  /** true = follows the property's cancellation tier; false = Non-refundable. */
  is_refundable: boolean;
  meal_plan: string | null;
  /** Set at render time by withCancellationTerms. */
  cancellation_tier?: CancellationTier;
  /** Non-refundable only: how much less a night costs than the cheapest refundable rate. */
  saving_vs_refundable?: number;
  /**
   * What the guest pays for one night, all-in: `bar` plus tourist tax. Set at
   * render time by withAllInPrices; absent on demo data.
   */
  price_per_night?: number;
};

export type DbRoom = {
  id: string;
  name: string;
  description: string | null;
  room_type: string | null;
  bed_type: string | null;
  size_sqm: number | null;
  max_occupancy: number | null;
  /** Guests the base rate is for. The listing's all-in price is quoted at this. */
  base_occupancy?: number;
  images: string[];
  rate_plans: DbRatePlan[];
  tags: string[];
};
