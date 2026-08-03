import {
  hasStayLengthDiscount,
  resolveNightlyRates,
  type Modifier,
} from "@openbookings/pricing";
import { applyLowestRates, deriveState, deriveStatus } from "./derive";
import { addDays, enumerateDates, toIsoDate } from "./ari-query";
import type {
  AriGridData,
  AvailabilityCell,
  RateCell,
  RatePlanRow,
  RestrictionRule,
  RoomTypeRow,
} from "./types";

/**
 * Placeholder ARI data, shaped like what `loadAriGrid` returns.
 *
 * Same idea as mock-reservations.ts: dates are relative to today so the screen
 * stays populated, and it is opt-in via `?demo=1` rather than a fallback — a
 * property with real-but-thin data should look thin, not quietly get invented
 * numbers.
 *
 * Prices are not hardcoded. The spec below carries real modifiers, and this
 * module runs them through the same resolver the live query uses, so demo
 * cells exercise the actual pricing pipeline instead of asserting a number.
 * The four cell states are likewise derived, not hand-placed.
 */

const DEMO_CURRENCY = "EUR";

/** Offsets are relative to the window start, so the demo lands wherever you scroll. */
interface ClosureSpec {
  planIndex: number;
  from: number;
  to: number;
  by: string;
  note?: string;
}

interface RestrictionSpec {
  planIndex: number;
  from: number;
  to: number;
  minStay?: number;
  maxStay?: number;
  cta?: boolean;
  ctd?: boolean;
  by: string;
  note?: string;
}

interface InventorySpec {
  from: number;
  to: number;
  booked?: number;
  blocked?: number;
  override?: number;
  note?: string;
  by?: string;
}

interface PlanSpec {
  name: string;
  bar: number;
  refundable: boolean;
  minStay?: number;
  maxStay?: number;
  policy?: string;
  modifiers?: Modifier[];
}

interface RoomSpec {
  name: string;
  units: number;
  baseOccupancy: number;
  /** Baseline bookings per date, cycled across the window. */
  bookingPattern: number[];
  plans: PlanSpec[];
  inventory?: InventorySpec[];
  closures?: ClosureSpec[];
  restrictions?: RestrictionSpec[];
}

// ─────────────────────────────────────────────
// Reusable modifiers
// ─────────────────────────────────────────────

const weekendUplift: Modifier = {
  type: "day_of_week",
  adjustment_type: "percent",
  adjustment_value: 15,
  trigger_condition: { days_of_week: [5, 6] },
  sort_order: 10,
};

const weekendFlat: Modifier = {
  type: "day_of_week",
  adjustment_type: "flat",
  adjustment_value: 25,
  trigger_condition: { days_of_week: [5, 6] },
  sort_order: 10,
};

const threeNightDiscount: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -12,
  trigger_condition: { min_nights: 3 },
  sort_order: 30,
};

const weekStayDiscount: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -18,
  trigger_condition: { min_nights: 7 },
  sort_order: 30,
};

const earlyBird: Modifier = {
  type: "early_bird",
  adjustment_type: "percent",
  adjustment_value: -8,
  trigger_condition: { days_before_arrival: 30 },
  sort_order: 40,
};

const lastMinute: Modifier = {
  type: "last_minute",
  adjustment_type: "percent",
  adjustment_value: -10,
  trigger_condition: { days_till_arrival: 3 },
  sort_order: 20,
};

const HOST = "Wouter van der Wal";
const MANAGER = "Sanne Vermeer";

// ─────────────────────────────────────────────
// The dataset
// ─────────────────────────────────────────────

const ROOM_SPECS: RoomSpec[] = [
  {
    name: "Single Rooms",
    units: 8,
    baseOccupancy: 1,
    bookingPattern: [3, 3, 5, 6, 4, 3, 2],
    plans: [
      {
        name: "Refundable",
        bar: 89,
        refundable: true,
        policy: "Free cancellation up to 24 hours before check-in.",
        modifiers: [weekendFlat],
      },
      {
        name: "Non-refundable",
        bar: 76,
        refundable: false,
        policy: "No refund after booking.",
        modifiers: [weekendFlat, threeNightDiscount],
      },
      {
        name: "Special Rate (Members)",
        bar: 99,
        refundable: true,
        modifiers: [weekendUplift, earlyBird],
      },
    ],
    closures: [
      { planIndex: 0, from: 1, to: 2, by: HOST, note: "Rate parity review with the OTA team." },
      { planIndex: 2, from: 8, to: 11, by: MANAGER, note: "Members promotion paused pending approval." },
    ],
    restrictions: [
      { planIndex: 1, from: 5, to: 6, minStay: 3, by: HOST, note: "Festival weekend — protecting the shoulder nights." },
    ],
  },
  {
    name: "Double Rooms",
    units: 12,
    baseOccupancy: 2,
    bookingPattern: [6, 7, 9, 11, 8, 6, 5],
    plans: [
      {
        name: "Refundable",
        bar: 129,
        refundable: true,
        policy: "Free cancellation up to 48 hours before check-in.",
        modifiers: [weekendUplift, earlyBird],
      },
      {
        name: "Non-refundable",
        bar: 112,
        refundable: false,
        modifiers: [weekendUplift, threeNightDiscount],
      },
      {
        name: "Breakfast Included",
        bar: 149,
        refundable: true,
        modifiers: [weekendUplift],
      },
      {
        name: "Last Minute",
        bar: 119,
        refundable: false,
        modifiers: [lastMinute],
      },
    ],
    inventory: [
      // A full house that cascades across all four plans.
      { from: 3, to: 4, booked: 12, note: "Conference block — fully committed.", by: MANAGER },
    ],
    restrictions: [
      { planIndex: 0, from: 3, to: 4, minStay: 2, cta: true, by: MANAGER, note: "Conference arrivals handled by the group desk." },
    ],
  },
  {
    name: "Twin Rooms",
    units: 6,
    baseOccupancy: 2,
    bookingPattern: [2, 3, 4, 4, 3, 2, 1],
    plans: [
      { name: "Refundable", bar: 119, refundable: true, modifiers: [weekendUplift] },
      { name: "Non-refundable", bar: 104, refundable: false, modifiers: [weekendUplift, threeNightDiscount] },
      { name: "Corporate", bar: 109, refundable: true, minStay: 2, modifiers: [] },
    ],
    inventory: [
      { from: 6, to: 8, blocked: 2, note: "Bathroom refit on two units.", by: HOST },
    ],
    restrictions: [
      // Deliberately above the plan's own min stay of 2 — a restriction that
      // merely restates the plan default is correctly *not* a restricted cell.
      { planIndex: 2, from: 2, to: 8, minStay: 3, by: MANAGER, note: "Corporate rate is midweek-oriented." },
    ],
  },
  {
    name: "Junior Suites",
    units: 4,
    baseOccupancy: 2,
    bookingPattern: [1, 2, 3, 3, 2, 1, 1],
    plans: [
      {
        name: "Refundable",
        bar: 219,
        refundable: true,
        policy: "Free cancellation up to 7 days before check-in.",
        modifiers: [weekendUplift, weekStayDiscount],
      },
      {
        name: "Non-refundable",
        bar: 189,
        refundable: false,
        modifiers: [weekendUplift, weekStayDiscount],
      },
      { name: "Spa Package", bar: 279, refundable: true, minStay: 2, modifiers: [weekendUplift] },
    ],
    closures: [
      { planIndex: 2, from: 0, to: 13, by: HOST, note: "Spa closed for the season — reopens in spring." },
    ],
  },
  {
    name: "Family Rooms",
    units: 5,
    baseOccupancy: 4,
    bookingPattern: [2, 2, 4, 5, 3, 2, 2],
    plans: [
      { name: "Refundable", bar: 199, refundable: true, modifiers: [weekendUplift, threeNightDiscount] },
      { name: "Non-refundable", bar: 174, refundable: false, modifiers: [weekendUplift] },
    ],
    inventory: [
      { from: 9, to: 10, override: 1, note: "Holding two rooms for a returning guest.", by: HOST },
    ],
    restrictions: [
      { planIndex: 0, from: 11, to: 12, minStay: 4, ctd: true, by: HOST, note: "School holiday changeover." },
    ],
  },
  {
    name: "Penthouse",
    units: 1,
    baseOccupancy: 2,
    bookingPattern: [0, 0, 1, 1, 0, 0, 0],
    plans: [
      {
        name: "Refundable",
        bar: 649,
        refundable: true,
        policy: "Free cancellation up to 14 days before check-in.",
        minStay: 2,
        modifiers: [weekendUplift, weekStayDiscount, earlyBird],
      },
      { name: "Non-refundable", bar: 549, refundable: false, minStay: 2, modifiers: [weekendUplift] },
    ],
  },
];

// ─────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────

function makeRule(
  id: string,
  startDate: string,
  endDate: string,
  by: string,
  overrides: Partial<RestrictionRule>,
): RestrictionRule {
  return {
    id,
    startDate,
    endDate,
    isClosed: false,
    minStay: null,
    maxStay: null,
    closedToArrival: false,
    closedToDeparture: false,
    note: null,
    createdBy: by,
    createdByName: by,
    // Backdated so the panel's "who and when" reads like a real audit trail.
    createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    ...overrides,
  };
}

function covers(spec: { from: number; to: number }, index: number): boolean {
  return index >= spec.from && index <= spec.to;
}

/**
 * Build a full grid payload for `windowDays` starting at `start`.
 *
 * Everything downstream of the spec — prices, cell states, status dots, the
 * collapsed lowest-rate row — is computed by the same functions the live path
 * uses, so the demo is a faithful rehearsal of the real screen rather than a
 * picture of one.
 */
export function buildMockAriGrid(
  start: string = toIsoDate(new Date()),
  windowDays = 14,
  stayLength = 1,
): AriGridData {
  const range = { start, end: addDays(start, windowDays - 1) };
  const dates = enumerateDates(range);
  const dateIndex = new Map(dates.map((d, i) => [d, i]));
  const today = toIsoDate(new Date());

  const rooms: RoomTypeRow[] = ROOM_SPECS.map((spec, roomOrdinal) => {
    const roomId = `demo-room-${roomOrdinal}`;

    // ── Availability, computed then overridden, exactly as the query does ──
    const availability: AvailabilityCell[] = dates.map((date, index) => {
      const inventorySpec = spec.inventory?.find((i) => covers(i, index));
      const booked =
        inventorySpec?.booked ??
        spec.bookingPattern[index % spec.bookingPattern.length];
      const blocked = inventorySpec?.blocked ?? 0;
      const override = inventorySpec?.override ?? null;
      const computed = Math.max(0, spec.units - booked - blocked);
      const effective = override ?? computed;

      return {
        date,
        totalUnits: spec.units,
        booked: Math.min(booked, spec.units),
        blocked,
        computed,
        override,
        effective,
        source: override === null ? "computed" : "override",
        note: inventorySpec?.note ?? null,
        updatedBy: inventorySpec?.by ?? null,
        updatedByName: inventorySpec?.by ?? null,
        updatedAt: inventorySpec
          ? new Date(Date.now() - 2 * 86_400_000).toISOString()
          : null,
      };
    });

    const ratePlans: RatePlanRow[] = spec.plans.map((planSpec, planIndex) => {
      const planId = `demo-plan-${roomOrdinal}-${planIndex}`;
      const modifiers = planSpec.modifiers ?? [];
      const planMinStay = planSpec.minStay ?? 1;

      // Overhang, same as the live query: a multi-night probe on the last
      // column has to price nights beyond the window.
      const probeDates = enumerateDates({
        start: range.start,
        end: addDays(range.end, stayLength - 1),
      });
      const resolved = resolveNightlyRates(
        probeDates.map((date) => ({
          date,
          base_price: planSpec.bar,
          has_override: false,
        })),
        modifiers,
        { baseOccupancy: spec.baseOccupancy, stayLength, today },
      );
      const resolvedByDate = new Map(resolved.map((r) => [r.date, r]));
      const planHasStayDiscount = hasStayLengthDiscount(modifiers);

      const cells: RateCell[] = dates.map((date, index) => {
        const closureSpec = spec.closures?.find(
          (c) => c.planIndex === planIndex && covers(c, index),
        );
        const restrictionSpec = spec.restrictions?.find(
          (r) => r.planIndex === planIndex && covers(r, index),
        );

        const closure = closureSpec
          ? makeRule(
              `demo-closure-${roomOrdinal}-${planIndex}-${closureSpec.from}`,
              dates[closureSpec.from] ?? date,
              dates[Math.min(closureSpec.to, dates.length - 1)] ?? date,
              closureSpec.by,
              { isClosed: true, note: closureSpec.note ?? null },
            )
          : null;

        const restriction = restrictionSpec
          ? makeRule(
              `demo-restriction-${roomOrdinal}-${planIndex}-${restrictionSpec.from}`,
              dates[restrictionSpec.from] ?? date,
              dates[Math.min(restrictionSpec.to, dates.length - 1)] ?? date,
              restrictionSpec.by,
              {
                minStay: restrictionSpec.minStay ?? null,
                maxStay: restrictionSpec.maxStay ?? null,
                closedToArrival: restrictionSpec.cta ?? false,
                closedToDeparture: restrictionSpec.ctd ?? false,
                note: restrictionSpec.note ?? null,
              },
            )
          : null;

        const available = availability[index].effective;
        const effectiveMinStay = restriction?.minStay ?? planMinStay;
        const state = deriveState(
          available,
          closure,
          restriction,
          effectiveMinStay,
          planMinStay,
        );
        const priced = resolvedByDate.get(date)!;

        return {
          date,
          state,
          price:
            state === "open" || state === "restricted" ? priced.price : null,
          basePrice: planSpec.bar,
          hasOverride: false,
          overrideLabel: null,
          appliedModifiers: priced.applied_modifiers,
          stayDiscountPending:
            planHasStayDiscount &&
            !priced.applied_modifiers.includes("length_of_stay"),
          minStay: effectiveMinStay,
          maxStay: restriction?.maxStay ?? planSpec.maxStay ?? null,
          closedToArrival: restriction?.closedToArrival ?? false,
          closedToDeparture: restriction?.closedToDeparture ?? false,
          rule: closure ?? restriction,
          available,
        };
      });

      return {
        id: planId,
        name: planSpec.name,
        currency: DEMO_CURRENCY,
        bar: planSpec.bar,
        isRefundable: planSpec.refundable,
        cancellationPolicy: planSpec.policy ?? null,
        minStay: planMinStay,
        maxStay: planSpec.maxStay ?? null,
        modifiers,
        hasStayDiscount: planHasStayDiscount,
        cells,
        status: deriveStatus(cells),
      };
    });

    return {
      id: roomId,
      name: spec.name,
      roomType: spec.name,
      baseOccupancy: spec.baseOccupancy,
      totalUnits: spec.units,
      availability,
      ratePlans,
      lowestRates: dates.map(() => null),
    };
  });

  applyLowestRates(rooms, dateIndex);

  return {
    propertyId: "demo-property",
    propertyName: "Demo Property",
    currency: DEMO_CURRENCY,
    dates,
    rooms,
    stayLength,
  };
}
