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
  is_refundable: boolean;
  cancellation_policy: string | null;
  meal_plan: string | null;
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
