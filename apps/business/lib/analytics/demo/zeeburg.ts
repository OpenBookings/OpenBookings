import type { IsoDate } from "../types";

export interface DemoRoomType {
  id: string;
  name: string;
  units: number;
}

export interface DemoRatePlan {
  id: string;
  roomId: string;
  name: string;
  /** Standing nightly rate before weekend uplift and discounts. */
  barCents: number;
  refundable: boolean;
  /** This plan's share of the demand for its room type. */
  share: number;
}

export interface DemoHotel {
  seed: string;
  openedOn: IsoDate;
  /** Baseline share of inventory that sells on an ordinary midweek night. */
  demand: number;
  roomTypes: DemoRoomType[];
  ratePlans: DemoRatePlan[];
}

/** The one demo hotel. Twelve rooms in Amsterdam, trading since June 2024. */
export const ZEEBURG: DemoHotel = {
  seed: "zeeburg-grand",
  openedOn: "2024-06-01",
  demand: 0.62,
  roomTypes: [
    { id: "zb-standard", name: "Standard Double", units: 6 },
    { id: "zb-canal", name: "Canal View Double", units: 4 },
    { id: "zb-suite", name: "Junior Suite", units: 2 },
  ],
  ratePlans: [
    { id: "zb-flex", roomId: "zb-standard", name: "Flexible", barCents: 13_900, refundable: true, share: 0.6 },
    { id: "zb-saver", roomId: "zb-standard", name: "Non-refundable Saver", barCents: 12_500, refundable: false, share: 0.4 },
    { id: "zb-canal-flex", roomId: "zb-canal", name: "Canal Flexible", barCents: 16_900, refundable: true, share: 1 },
    { id: "zb-suite-flex", roomId: "zb-suite", name: "Suite Flexible", barCents: 26_500, refundable: true, share: 1 },
  ],
};
