/** Rows the guest is shown, and Stripe is charged, one for one. */
export type BookingLine = {
  name: string;
  /** What one unit costs, in minor units. */
  unitAmountCents: number;
  quantity: number;
};

export function toCents(majorUnits: number): number {
  return Math.round(majorUnits * 100);
}

/**
 * What the guest pays for a stay: the room, per night, and nothing else.
 *
 * Rates are tax-inclusive by contract with the host — every organisation
 * confirms it on record before it can set a price (see
 * `propertyRatesConfirmed`) — so the price entered is the total. Nothing is
 * added here for tourist tax or anything else; `properties.tax_rate` is not an
 * input on purpose. The unit price stays visible, so "€185 × 3" reconciles by
 * eye.
 */
export function buildBookingLines(stay: {
  roomName: string;
  roomType: string | null;
  pricePerNight: number;
  nights: number;
}): BookingLine[] {
  return [
    {
      name: `${stay.roomName}${stay.roomType ? ` ${stay.roomType}` : ''}`,
      unitAmountCents: toCents(stay.pricePerNight),
      quantity: stay.nights,
    },
  ];
}
