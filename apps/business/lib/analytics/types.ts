import type { ModifierType } from "@openbookings/pricing";

/** Calendar date, `YYYY-MM-DD`. Every date in this module is one of these. */
export type IsoDate = string;

/** ISO 8601 instant. Booking creation and cancellation carry a time. */
export type IsoInstant = string;

// ─────────────────────────────────────────────
// Facts — the seam. See the spec's "The seam" table for the real source of
// every field. Change these only alongside that table.
// ─────────────────────────────────────────────

/** One room type's trading on one date. The grain everything derives from. */
export interface NightFact {
  date: IsoDate;
  propertyId: string;
  /** A `rooms` row IS the room type. */
  roomId: string;
  ratePlanId: string;
  /** rooms.total_units, less blocked and closed units. */
  unitsAvailable: number;
  unitsSold: number;
  /** Net room revenue: ex VAT, ex tourist tax, ex fees, after discounts. */
  netRevenueCents: number;
  /** Rate plan BAR before modifiers, multiplied by unitsSold. */
  basePriceCents: number;
  modifiers: { type: ModifierType; impactCents: number }[];
}

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export interface BookingFact {
  id: string;
  propertyId: string;
  /** Drives lead time and "bookings created in period". */
  createdAt: IsoInstant;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: number;
  status: BookingStatus;
  cancelledAt: IsoInstant | null;
  adults: number;
  children: number;
  /** Stands in for bookings.user_id. */
  guestKey: string;
  /** ISO-3166-1 alpha-2. No database source exists yet — see the spec. */
  guestCountry: string;
  netRevenueCents: number;
  roomId: string;
  ratePlanId: string;
}

export interface Facts {
  nights: NightFact[];
  bookings: BookingFact[];
  roomTypeNames: Record<string, string>;
  ratePlanNames: Record<string, string>;
}

// ─────────────────────────────────────────────
// View model
// ─────────────────────────────────────────────

export interface PropertySummary {
  id: string;
  name: string;
}

/**
 * One widget's outcome. A derivation that throws is contained here rather than
 * taking the page down with it; today that is defensive, and when one aggregate
 * query can fail while its neighbours succeed it becomes load-bearing.
 */
export type Widget<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * `pct` is null when there is nothing to compare against, which renders "—".
 * `label` is the text beside the arrow, because colour and glyph alone are not
 * enough. `goodDirection` inverts for Cancellations and Average discount.
 */
export interface Delta {
  pct: number | null;
  direction: "up" | "down" | "flat";
  label: string;
  goodDirection: "up" | "down";
}

/** One point on a time series. `label` is pre-formatted for axis and tooltip. */
export interface Point {
  bucket: IsoDate;
  label: string;
  value: number;
}

/** One bar in a ranked chart or list. */
export interface Category {
  key: string;
  label: string;
  value: number;
  /** Populated where a list shows a second figure, e.g. times a modifier fired. */
  count?: number;
}

export type Granularity = "day" | "week" | "month";

export interface KpiWithDelta {
  value: number | null;
  delta: Delta;
}

export interface KpiWithSpark {
  value: number | null;
  spark: Point[];
}

export interface RevenueSection {
  yearToDateCents: Widget<KpiWithDelta>;
  periodCents: Widget<KpiWithDelta>;
  adrCents: Widget<KpiWithSpark>;
  revparCents: Widget<KpiWithSpark>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Category[]>;
  byRatePlan: Widget<Category[]>;
  commissionCents: Widget<number>;
}

/** One cell of the busiest-days table. `pct` is null where no inventory existed. */
export interface HeatCell {
  weekStart: IsoDate;
  weekday: number; // 1 = Monday ... 7 = Sunday
  pct: number | null;
  nightsSold: number;
  nightsAvailable: number;
}

export interface Heatmap {
  weeks: { start: IsoDate; label: string }[];
  cells: HeatCell[];
}

export interface SellThroughSection {
  pct: Widget<KpiWithDelta>;
  roomsSold: Widget<number>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Category[]>;
  busiestDays: Widget<Heatmap>;
}

export interface UpcomingWindow {
  window: 30 | 60 | 90;
  label: string;
  nightsSold: number;
  nightsAvailable: number;
}

export interface BookingsSection {
  count: Widget<KpiWithDelta>;
  averageLengthOfStay: Widget<number | null>;
  cancellations: Widget<KpiWithDelta & { count: number }>;
  leadTime: Widget<Category[]>;
  upcoming: Widget<UpcomingWindow[]>;
}

export interface PricingSection {
  averageDiscountPct: Widget<number | null>;
  priceOverTime: Widget<{ base: Point[]; achieved: Point[] }>;
  topModifiers: Widget<Category[]>;
}

export interface GuestsSection {
  averagePartySize: Widget<number | null>;
  repeatGuestPct: Widget<number | null>;
  countries: Widget<Category[]>;
}

export interface AnalyticsData {
  property: PropertySummary;
  properties: PropertySummary[];
  range: { from: IsoDate; to: IsoDate };
  granularity: Granularity;
  /** False only for a property that has never had a booking. Drives the Alert. */
  hasAnyBookings: boolean;
  /** Gates the widgets that need at least 5 bookings to be safe or meaningful. */
  bookingsInPeriod: number;
  /** True when this data was generated rather than queried. Drives the banner. */
  isDemo: boolean;
  revenue: RevenueSection;
  sellThrough: SellThroughSection;
  bookings: BookingsSection;
  pricing: PricingSection;
  guests: GuestsSection;
}

/** Widgets that refuse to render below five bookings, named so the UI and the
 * "not enough data" tests cannot disagree about which they are. */
export const MIN_BOOKINGS_FOR_DETAIL = 5;
