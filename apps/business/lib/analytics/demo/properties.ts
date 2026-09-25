import type { Modifier } from "@openbookings/pricing";
import type { IsoDate } from "../types";

export interface DemoRoomType {
  id: string;
  name: string;
  /** Physical units, mirroring rooms.total_units. */
  units: number;
}

export interface DemoRatePlan {
  id: string;
  roomId: string;
  name: string;
  /** Whole euros, as rate_plans.bar is stored. Converted to cents in generate.ts. */
  barEuros: number;
  modifiers: Modifier[];
}

export interface DemoProperty {
  id: string;
  name: string;
  seed: string;
  roomTypes: DemoRoomType[];
  ratePlans: DemoRatePlan[];
  /** Null means this property has never taken a booking. */
  openedOn: IsoDate | null;
  /** Baseline share of inventory that sells on an ordinary midweek night. */
  demand: number;
}

/**
 * `trigger_condition` keys are the ones `isModifierEligible` in
 * @openbookings/pricing actually reads — the same spelling the ARI grid's
 * mock uses. A modifier keyed on anything else silently never fires, and
 * `day_of_week` keyed wrongly throws on an undefined array.
 * `days_of_week` is JavaScript's getDay(): 0 = Sunday, 5 = Friday, 6 = Saturday.
 */
const weekendUplift: Modifier = {
  type: "day_of_week",
  adjustment_type: "percent",
  adjustment_value: 15,
  trigger_condition: { days_of_week: [5, 6] },
  sort_order: 1,
};

const weeklyDiscount: Modifier = {
  type: "length_of_stay",
  adjustment_type: "percent",
  adjustment_value: -10,
  trigger_condition: { min_nights: 7 },
  sort_order: 2,
};

const earlyBird: Modifier = {
  type: "early_bird",
  adjustment_type: "percent",
  adjustment_value: -8,
  trigger_condition: { days_before_arrival: 60 },
  sort_order: 3,
};

const lastMinute: Modifier = {
  type: "last_minute",
  adjustment_type: "percent",
  adjustment_value: -12,
  trigger_condition: { days_till_arrival: 3 },
  sort_order: 4,
};

/**
 * Three properties, chosen so every row of the spec's States table is reachable
 * by selecting one and picking a period — not by a flag that only a developer
 * knows about.
 */
export const DEMO_PROPERTIES: DemoProperty[] = [
  {
    id: "demo-zeeburg",
    name: "Zeeburg Grand",
    seed: "zeeburg-grand",
    openedOn: "2025-03-01",
    demand: 0.62,
    roomTypes: [
      { id: "zb-standard", name: "Standard Double", units: 6 },
      { id: "zb-canal", name: "Canal View Double", units: 4 },
      { id: "zb-suite", name: "Junior Suite", units: 2 },
    ],
    ratePlans: [
      { id: "zb-flex", roomId: "zb-standard", name: "Flexible", barEuros: 139, modifiers: [weekendUplift, lastMinute] },
      { id: "zb-saver", roomId: "zb-canal", name: "Non-refundable Saver", barEuros: 169, modifiers: [weekendUplift, earlyBird, weeklyDiscount] },
      { id: "zb-suite-flex", roomId: "zb-suite", name: "Suite Flexible", barEuros: 265, modifiers: [weekendUplift] },
    ],
  },
  {
    id: "demo-vlierhof",
    name: "De Vlierhof",
    seed: "de-vlierhof",
    openedOn: "2025-06-15",
    // A four-room B&B trading lightly: few enough bookings in a short period to
    // put the histogram, the heatmap and the country list below their threshold.
    demand: 0.28,
    roomTypes: [{ id: "vh-double", name: "Double Room", units: 4 }],
    ratePlans: [
      { id: "vh-bb", roomId: "vh-double", name: "Bed & Breakfast", barEuros: 95, modifiers: [weekendUplift] },
    ],
  },
  {
    id: "demo-nieuwehaven",
    name: "Nieuwehaven Rooms",
    seed: "nieuwehaven",
    openedOn: null,
    demand: 0,
    roomTypes: [{ id: "nh-double", name: "Double Room", units: 3 }],
    ratePlans: [
      { id: "nh-standard", roomId: "nh-double", name: "Standard", barEuros: 110, modifiers: [] },
    ],
  },
];

export function findDemoProperty(id: string | undefined): DemoProperty {
  return DEMO_PROPERTIES.find((p) => p.id === id) ?? DEMO_PROPERTIES[0];
}
