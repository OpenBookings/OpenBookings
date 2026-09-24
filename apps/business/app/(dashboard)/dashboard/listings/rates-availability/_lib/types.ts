import type { Modifier, ModifierType, PriceStep } from "@openbookings/pricing";

/**
 * Shapes the ARI grid renders. Deliberately flat and serialisable: the page is
 * a server component that resolves everything up front and hands plain data to
 * the client grid.
 */

export type CellState =
  | "open"
  | "room_closed"
  | "closed"
  | "sold_out"
  | "restricted";

/**
 * Why a cell is not plainly open.
 *
 * One vocabulary for every non-open fact on the grid, so a cell, a bar and the
 * detail panel all name the same thing the same way. `ROOM_CLOSED` is set on
 * the room type and inherited by its rate plans; `STOP_SELL` is one plan
 * closed on its own; `SOLD_OUT` is derived from the availability numbers and
 * is never stored.
 */
export type ReasonCode =
  | "ROOM_CLOSED"
  | "SOLD_OUT"
  | "STOP_SELL"
  | "CLOSED_TO_ARRIVAL"
  | "CLOSED_TO_DEPARTURE"
  | "MIN_STAY"
  | "MAX_STAY";

/**
 * Who is answerable for a reason.
 *
 * `system` is for facts nobody chose — sold out is arithmetic over bookings.
 * Everything else has a person behind it, and the panel names them: "closed by
 * X on Y" is the difference between an explanation and a shrug. The name may
 * still be null when the user record is gone; the id is kept regardless.
 */
export type ReasonSource =
  | { kind: "system" }
  | {
      kind: "host";
      userId: string | null;
      userName: string | null;
      at: string;
      note: string | null;
    };

export interface Reason {
  code: ReasonCode;
  source: ReasonSource;
  /** Nights, on MIN_STAY and MAX_STAY. */
  value?: number;
  /** Set on the room type and inherited by every rate plan under it. */
  inherited: boolean;
  /**
   * The underlying rule's own dates — which are not the cell's. A bar reports
   * the rule's range so a host sees the whole decision, not the slice of it
   * that happens to be on screen.
   */
  range: { start: string; end: string } | null;
  /** Identity of the rule behind it. Runs merge on this, so two adjacent
   * closures from different rows stay two bars. Null for derived reasons. */
  ruleId: string | null;
}

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

/** A room-type closure as stored — one row of room_closures. */
export interface RoomClosureRule {
  id: string;
  startDate: string;
  endDate: string;
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
  /**
   * The room type is closed outright on this date. Separate from `effective`
   * reaching 0: a closed room type may still have units standing empty, and
   * telling a host "sold out" when nobody booked anything sends them hunting
   * for a reservation that does not exist.
   */
  closure: RoomClosureRule | null;
}

/** One rate plan on one date, after price resolution and rule precedence. */
export interface RateCell {
  date: string;
  state: CellState;
  /**
   * The sellable price: the resolved rate, or null when nothing can be sold on
   * this date. The collapsed-row summary and the lowest-rate pass read this,
   * so null has to mean "no price a guest could pay".
   */
  price: number | null;
  /**
   * The resolved rate regardless of whether it can be sold. A closed or
   * sold-out date still has a rate underneath it, and the cell shows it struck
   * through — hiding it would leave a host unable to see what they are about
   * to reopen at.
   */
  indicativePrice: number;
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
  /**
   * The reason that decides the cell's appearance — the first match in the
   * precedence order. Null when the cell is plainly open.
   */
  primary: ReasonCode | null;
  /**
   * Every reason that applies, in precedence order. A date can be sold out
   * *and* min-stay constrained; the cell shows one, the panel shows all, and
   * lifting the closure must not surprise the host with a rule they were never
   * told about.
   */
  reasons: Reason[];
  /** Whether a guest could book this date, restrictions notwithstanding. */
  bookable: boolean;
  /** Ordered build-up of the probe stay's total. Empty when no price resolved. */
  trace: PriceStep[];
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
  /**
   * Fingerprint of the host-set rules this window was built from. Publishing
   * sends it back, and a publish against a stale one is refused rather than
   * overwriting somebody else's edit.
   */
  version: string;
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

/**
 * A run of columns picked out on one rate plan row, for editing together.
 *
 * Bounded to a single row on purpose. A rectangular selection across rate
 * plans reads well and edits badly: the plans underneath a room type have
 * different prices and different rules, so one "set price" over the block
 * would flatten distinctions the host set deliberately.
 */
export interface RangeSelection {
  room: RoomTypeRow;
  plan: RatePlanRow;
  /** Inclusive column indices into `AriGridData.dates`. */
  startIndex: number;
  endIndex: number;
}

/** Prefill handed to a toolbar modal when opened from the detail panel. */
export interface EditPrefill {
  roomId?: string;
  ratePlanId?: string;
  startDate?: string;
  endDate?: string;
}
