/**
 * The eight demo hotels: one per edge case the booking flow has to handle.
 * Each is plain data here; generate.ts turns it into rows. Every case holds
 * for any stay a guest can search, not just for some dates.
 */

export type DemoScenario =
  | "normal"
  | "last_room"
  | "sold_out"
  | "min_stay"
  | "no_arrival"
  | "non_refundable"
  | "weekend_prices"
  | "small_rooms";

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  "normal",
  "last_room",
  "sold_out",
  "min_stay",
  "no_arrival",
  "non_refundable",
  "weekend_prices",
  "small_rooms",
];

export type DemoRoomTemplate = {
  name: string;
  roomType: string;
  bedType: string;
  sizeSqm: readonly [min: number, max: number];
  maxAdults: number;
  maxChildren: number;
  baseOccupancy: number;
  /** Multiplies the hotel's base price. */
  priceFactor: number;
};

const DOUBLE: DemoRoomTemplate = {
  name: "Classic Double",
  roomType: "double",
  bedType: "Queen bed",
  sizeSqm: [16, 22],
  maxAdults: 2,
  maxChildren: 1,
  baseOccupancy: 2,
  priceFactor: 1,
};
const TWIN: DemoRoomTemplate = {
  name: "Superior Twin",
  roomType: "twin",
  bedType: "Two single beds",
  sizeSqm: [20, 26],
  maxAdults: 2,
  maxChildren: 0,
  baseOccupancy: 2,
  priceFactor: 1.15,
};
const FAMILY: DemoRoomTemplate = {
  name: "Family Suite",
  roomType: "suite",
  bedType: "King bed and sofa bed",
  sizeSqm: [32, 42],
  maxAdults: 3,
  maxChildren: 2,
  baseOccupancy: 2,
  priceFactor: 1.6,
};
const SINGLE: DemoRoomTemplate = {
  name: "Single Room",
  roomType: "single",
  bedType: "Single bed",
  sizeSqm: [10, 13],
  maxAdults: 1,
  maxChildren: 0,
  baseOccupancy: 1,
  priceFactor: 0.7,
};
const COMPACT_SINGLE: DemoRoomTemplate = {
  name: "Compact Single",
  roomType: "single",
  bedType: "Single bed",
  sizeSqm: [8, 10],
  maxAdults: 1,
  maxChildren: 0,
  baseOccupancy: 1,
  priceFactor: 0.6,
};

export type ScenarioSpec = {
  tier: "flex" | "standard";
  rooms: readonly DemoRoomTemplate[];
  /**
   * Units per room type: a fixed number, or a range drawn per room. Zero is
   * how sold out never ends: no dated stock rows that a committed demo hotel
   * would outlive, and search reports it as `sold_out`.
   */
  units: number | readonly [min: number, max: number];
  /** A non-refundable plan beside each refundable one. */
  nonRefundable: boolean;
  /** `rate_plans.min_stay` of every plan. */
  minStay: number;
  /** An open-ended closed-to-arrival restriction on every plan. */
  closedToArrival: boolean;
  /** Euros added on Friday and Saturday nights (JS `getDay` 5 and 6). */
  weekendSurcharge: number | null;
  /** Euros per person per night. */
  touristTax: number | null;
};

const BASE: Omit<ScenarioSpec, "tier" | "rooms"> = {
  units: [3, 6],
  nonRefundable: false,
  minStay: 1,
  closedToArrival: false,
  weekendSurcharge: null,
  touristTax: null,
};

export const SCENARIOS: Readonly<Record<DemoScenario, ScenarioSpec>> = {
  normal: { ...BASE, tier: "flex", rooms: [DOUBLE, TWIN, FAMILY], units: [6, 10], nonRefundable: true },
  last_room: { ...BASE, tier: "flex", rooms: [DOUBLE], units: 1 },
  sold_out: { ...BASE, tier: "standard", rooms: [DOUBLE, TWIN], units: 0 },
  min_stay: { ...BASE, tier: "standard", rooms: [DOUBLE, FAMILY], minStay: 5 },
  no_arrival: { ...BASE, tier: "standard", rooms: [DOUBLE, TWIN], closedToArrival: true },
  non_refundable: { ...BASE, tier: "standard", rooms: [DOUBLE, TWIN], nonRefundable: true },
  weekend_prices: { ...BASE, tier: "flex", rooms: [DOUBLE, FAMILY], weekendSurcharge: 40, touristTax: 3.5 },
  small_rooms: { ...BASE, tier: "flex", rooms: [SINGLE, COMPACT_SINGLE], units: 4 },
};

/**
 * The non-refundable bar for a refundable one: whole euros, 15% off, which
 * stays clear of Annex B B.4.3 (a non-refundable rate must be at least 10%
 * cheaper than the refundable rate beside it).
 */
export function nonRefundableBar(refundableBar: number): number {
  return Math.floor(refundableBar * 0.85);
}
