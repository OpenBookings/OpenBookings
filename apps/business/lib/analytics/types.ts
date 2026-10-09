import type { PageId } from "./pages";
import type { CompareMode, DateRange, Period } from "./period";

/** Calendar date, `YYYY-MM-DD`. Every date in this module is one of these. */
export type IsoDate = string;

/** ISO 8601 instant. Booking creation and cancellation carry a time. */
export type IsoInstant = string;

// ─────────────────────────────────────────────
// Facts — the seam. Real queries will return exactly these shapes.
// ─────────────────────────────────────────────

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";

export interface BookingFact {
  id: string;
  /** The booking date: drives every booking-date widget and lead time. */
  createdAt: IsoInstant;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: number;
  status: BookingStatus;
  /** Null until the booking is cancelled. */
  cancelledAt: IsoInstant | null;
  adults: number;
  children: number;
  guestKey: string;
  /** ISO-3166-1 alpha-2. */
  guestCountry: string;
  roomId: string;
  ratePlanId: string;
  /** Net room revenue per night, one entry per night. Sums to netRevenueCents. */
  nightlyNetCents: number[];
  /** Net room revenue: ex VAT, ex tourist tax, ex fees, after discounts. */
  netRevenueCents: number;
  /** The rate before discounts. basePriceCents − discountCents = netRevenueCents. */
  basePriceCents: number;
  discountCents: number;
  /** What the host kept when a cancelled booking's tier charged a fee. */
  cancellationFeeCents: number;
}

/** One room type's capacity on one date. */
export interface InventoryFact {
  date: IsoDate;
  roomId: string;
  unitsTotal: number;
  unitsOutOfOrder: number;
}

/** One unit sold for one night. Always expanded from a booking, never invented. */
export interface SoldNight {
  date: IsoDate;
  roomId: string;
  ratePlanId: string;
  bookingId: string;
  revenueCents: number;
}

export interface Facts {
  bookings: BookingFact[];
  inventory: InventoryFact[];
  nights: SoldNight[];
  roomTypeNames: Record<string, string>;
  ratePlanNames: Record<string, string>;
}

// ─────────────────────────────────────────────
// View model primitives
// ─────────────────────────────────────────────

export type Basis = "booking" | "stay";

/**
 * One widget's outcome. `sample` is counted on the widget's own basis: nights
 * sold for stay-date widgets, bookings for booking-date widgets.
 */
export type Widget<T> =
  | { ok: true; value: T; basis: Basis; sample: number }
  | { ok: false; reason: "below-minimum"; basis: Basis; needed: number; have: number }
  | { ok: false; reason: "error"; message: string };

/** Exists only when there is a comparison and the rounded change is non-zero. */
export interface Delta {
  pct: number;
  direction: "up" | "down";
  label: string;
  /** `neutral` for metrics where a rise is not good news. */
  tone: "directional" | "neutral";
}

export interface StatValue {
  value: number | null;
  delta: Delta | null;
}

export type Granularity = "day" | "week" | "month";

export interface Point {
  bucket: IsoDate;
  label: string;
  /** Null where the question had no answer, e.g. occupancy with nothing available. */
  value: number | null;
  /** The comparison period's value for the same position, or null. */
  compare: number | null;
  /** True when the bucket is still in progress or clipped by the range end. */
  incomplete: boolean;
}

export interface Share {
  key: string;
  label: string;
  value: number;
  sharePct: number;
}

export interface Bar {
  key: string;
  label: string;
  value: number;
}

export interface DayCell {
  date: IsoDate;
  sold: number;
  available: number;
  weekend: boolean;
}

export interface CancellationRow {
  key: string;
  label: string;
  bookings: number;
  cancelled: number;
  ratePct: number | null;
  feesRetainedCents: number;
}

export interface RatePlanRow {
  key: string;
  label: string;
  bookings: number;
  nights: number;
  adrCents: number | null;
  revenueCents: number;
}

export interface WeekdayRow {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  label: string;
  occupancyPct: number | null;
  adrCents: number | null;
  /** True when the weekday sells out below the period's average rate. */
  hint: boolean;
}

export type GroupType = "solo" | "couple" | "family" | "group";

// ─────────────────────────────────────────────
// Page view models
// ─────────────────────────────────────────────

export interface RevenueView {
  revenue: Widget<StatValue>;
  yearToDate: Widget<StatValue>;
  adr: Widget<StatValue>;
  revpar: Widget<StatValue>;
  commission: Widget<StatValue>;
  overTime: Widget<Point[]>;
  byRoomType: Widget<Share[]>;
  byRatePlan: Widget<Share[]>;
}

export interface OccupancyView {
  occupancy: Widget<StatValue>;
  nightsSold: Widget<StatValue>;
  nightsAvailable: Widget<StatValue>;
  unsoldNext30: Widget<StatValue>;
  overTime: Widget<Point[]>;
  overTimeGranularity: Granularity;
  next90: Widget<DayCell[]>;
  /** Null until twelve months of history exist. */
  pace: Widget<Point[]> | null;
  byWeekday: Widget<Bar[]>;
}

export interface BookingPatternsView {
  bookings: Widget<StatValue>;
  medianLeadDays: Widget<StatValue>;
  medianStayNights: Widget<StatValue>;
  cancellationRate: Widget<StatValue>;
  leadTime: Widget<Bar[]>;
  stayLength: Widget<Bar[]>;
  cancellationsByDaysBefore: Widget<Bar[]>;
  byRatePlan: Widget<CancellationRow[]>;
}

export interface PricingView {
  adr: Widget<StatValue>;
  discounts: Widget<StatValue & { shareOfBookingsPct: number | null }>;
  discountDepth: Widget<StatValue>;
  adrOverTime: Widget<Point[]>;
  byRatePlan: Widget<RatePlanRow[]>;
  byWeekday: Widget<WeekdayRow[]>;
}

export interface GuestsView {
  returning: Widget<StatValue>;
  medianPartySize: Widget<StatValue>;
  countries: Widget<Share[]>;
  groupTypes: Widget<Share[]>;
}

// ─────────────────────────────────────────────
// Derivation context and page payload
// ─────────────────────────────────────────────

/** Everything a page derivation needs. Note what is absent: any property. */
export interface DeriveContext {
  facts: Facts;
  period: Period;
  /** Null when no comparison was asked for or none is possible. */
  comparison: DateRange | null;
  today: IsoDate;
  granularity: Granularity;
}

export interface PageViews {
  revenue: RevenueView;
  occupancy: OccupancyView;
  "booking-patterns": BookingPatternsView;
  pricing: PricingView;
  guests: GuestsView;
}

export interface PageData<P extends PageId = PageId> {
  page: P;
  /** True when the facts were generated. Drives the banner and the export button only. */
  isDemo: boolean;
  /** False only for a host who has never had a booking. */
  hasAnyBookings: boolean;
  /** False when no booking was made in the period and none stays in it. */
  periodHasBookings: boolean;
  range: DateRange;
  comparison: DateRange | null;
  /** The comparison actually applied, after any fallback. */
  compare: CompareMode;
  canCompareLastYear: boolean;
  granularity: Granularity;
  view: PageViews[P];
}

/** Discriminated on `page`, so a switch narrows `view`. */
export type AnyPageData = { [P in PageId]: PageData<P> }[PageId];
