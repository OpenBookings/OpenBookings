import type { TouristTaxLine } from "@openbookings/pricing";

/**
 * One room of a guest's selection, priced on the server for its own party.
 * Amounts are euros (major units); `nights` sum to `stayTotal`.
 */
export type IntentRoomInput = {
  roomId: string;
  ratePlanId: string;
  adults: number;
  children: number;
  nights: { date: string; price: number }[];
  stayTotal: number;
  touristTax: number;
  touristTaxLines: TouristTaxLine[];
};

/**
 * What the guest was shown when the intent was made. `commissionCents` is on
 * `roomsTotal` only (never the tourist tax), and 0 while the application fee
 * is switched off.
 */
export type IntentSnapshot = {
  roomsTotal: number;
  touristTaxTotal: number;
  total: number;
  commissionCents: number;
  currency: "EUR";
  rooms: {
    roomId: string;
    ratePlanId: string;
    roomName: string;
    ratePlanName: string;
    isRefundable: boolean;
    freeCancellationUntil: string | null;
  }[];
};
