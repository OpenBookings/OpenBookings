import type { Modifier, ModifierType } from "@openbookings/pricing";

/**
 * Shapes the ARI grid renders. Deliberately flat and serialisable: the page is
 * a server component that resolves everything up front and hands plain data to
 * the client grid.
 */

export type CellState = "open" | "closed" | "sold_out" | "restricted";

/** A restriction rule as stored — one row of rate_plan_restrictions. */
export interface RestrictionRule {
  id: string;
  startDate: string;
  endDate: string;
  isClosed: boolean;
  minStay: number | null;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Effective availability for one room type on one date, both layers exposed. */
export interface AvailabilityCell {
  date: string;
  /** COALESCE(room_inventory.total_rooms, rooms.total_units) */
  totalUnits: number;
  /** Units consumed by reservations on confirmed/completed bookings. */
  booked: number;
  /** Units withheld by the host (maintenance, owner use). */
  blocked: number;
  /** totalUnits - booked - blocked, floored at 0. */
  computed: number;
  /** Host's explicit number, when set. */
  override: number | null;
  /** override ?? computed — the number the grid shows. */
  effective: number;
  /** Which layer produced `effective`. Drives the detail panel's explanation. */
  source: "computed" | "override";
  note: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
}

/** One rate plan on one date, after price resolution and rule precedence. */
export interface RateCell {
  date: string;
  state: CellState;
  /** Resolved one-night price at base occupancy. Null when not open. */
  price: number | null;
  /** Price before modifiers — the override, or the plan's BAR. */
  basePrice: number;
  /** True when a rate_overrides row supplied basePrice rather than the BAR. */
  hasOverride: boolean;
  overrideLabel: string | null;
  /** Modifiers that actually fired for this date, in application order. */
  appliedModifiers: ModifierType[];
  /**
   * The plan carries a stay-length discount that did not fire at the current
   * stay length. Drives the `*` marker — the shown rate is real, but a longer
   * booking would get less.
   */
  stayDiscountPending: boolean;
  /** Effective min stay for this date — restriction row, else the plan default. */
  minStay: number;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  /** The rule that produced a `closed` or `restricted` state. */
  rule: RestrictionRule | null;
  /** Room-type availability on this date, repeated for cheap cell rendering. */
  available: number;
}

/** Status dot on a rate plan row label, summarising the visible range. */
export type RatePlanStatus = "healthy" | "attention" | "inactive";

export interface RatePlanRow {
  id: string;
  name: string;
  currency: string;
  bar: number;
  isRefundable: boolean;
  cancellationPolicy: string | null;
  minStay: number;
  maxStay: number | null;
  /** All active modifiers on the plan — the detail panel lists them in order. */
  modifiers: Modifier[];
  /** The plan has a length-of-stay discount somewhere in its modifiers. */
  hasStayDiscount: boolean;
  cells: RateCell[];
  status: RatePlanStatus;
}

export interface RoomTypeRow {
  id: string;
  name: string;
  roomType: string | null;
  baseOccupancy: number;
  totalUnits: number;
  availability: AvailabilityCell[];
  ratePlans: RatePlanRow[];
  /** Lowest open price per date across the plans — the collapsed-row summary. */
  lowestRates: (number | null)[];
}

export interface AriGridData {
  propertyId: string;
  propertyName: string;
  currency: string;
  dates: string[];
  rooms: RoomTypeRow[];
  /** Nights each cell was priced over. 1 = the extranet default. */
  stayLength: number;
}

/** Stay lengths offered by the toolbar's rate probe. */
export const STAY_LENGTHS = [1, 3, 7] as const;
export type StayLength = (typeof STAY_LENGTHS)[number];

/** A run of consecutive dates sharing one non-open state, rendered as one bar. */
export interface CellRun {
  state: CellState;
  startIndex: number;
  /** Exclusive. */
  endIndex: number;
  cells: RateCell[];
}

/** What the detail panel is currently inspecting. */
export type AriSelection =
  | { kind: "availability"; room: RoomTypeRow; cell: AvailabilityCell }
  | { kind: "rate"; room: RoomTypeRow; plan: RatePlanRow; run: CellRun };

/** Prefill handed to a toolbar modal when opened from the detail panel. */
export interface EditPrefill {
  roomId?: string;
  ratePlanId?: string;
  startDate?: string;
  endDate?: string;
}
