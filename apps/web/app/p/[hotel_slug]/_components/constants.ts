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
  /** Per extra guest per night, whole euros; null = not charged (0040). Absent on demo data. */
  extra_adult_fee?: number | null;
  extra_child_fee?: number | null;
  /** Cots and extra beds per unit (0 = not offered) and their fee per night, paid at the hotel. */
  cots_max?: number;
  cot_fee?: number | null;
  extra_beds_max?: number;
  extra_bed_fee?: number | null;
  /** False: one unit takes a cot or an extra bed, not both. */
  cot_and_extra_bed_together?: boolean;
  images: string[];
  rate_plans: DbRatePlan[];
  tags: string[];
};
