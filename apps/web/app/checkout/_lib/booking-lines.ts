import type { TouristTaxLine } from '@openbookings/pricing';

/** Rows the guest is shown, and Stripe is charged, one for one. */
export type BookingLine = {
  name: string;
  /** What one unit costs, in minor units. */
  unitAmountCents: number;
  quantity: number;
  /**
   * `stay` is the room, which OpenBookings takes commission on. `tourist_tax`
   * passes through to the host for their town and is never commissioned.
   */
  kind: 'stay' | 'tourist_tax';
};

export function toCents(majorUnits: number): number {
  return Math.round(majorUnits * 100);
}

/**
 * What the guest pays for a stay: the room, per night, plus the tourist tax
 * worked out from the property's own rules, one line per charge.
 *
 * Rates include VAT and every mandatory fee by contract with the host — every
 * organisation confirms it on record before it can set a price (see
 * `propertyRatesConfirmed`). Tourist tax is the one thing added on top, and it
 * is shown as its own lines so the guest can see the all-in total build up,
 * and so it never carries VAT. The unit price stays visible, so "€185 × 3"
 * reconciles by eye. `properties.tax_rate` is not an input on purpose.
 */
export function buildBookingLines(stay: {
  roomName: string;
  roomType: string | null;
  pricePerNight: number;
  nights: number;
  touristTax?: TouristTaxLine[];
}): BookingLine[] {
  return [
    {
      name: `${stay.roomName}${stay.roomType ? ` ${stay.roomType}` : ''}`,
      unitAmountCents: toCents(stay.pricePerNight),
      quantity: stay.nights,
      kind: 'stay',
    },
    ...(stay.touristTax ?? []).map(
      (line): BookingLine => ({
        name: `Tourist tax · ${line.label}`,
        unitAmountCents: toCents(line.amount),
        quantity: 1,
        kind: 'tourist_tax',
      }),
    ),
  ];
}

/** The room lines alone, in minor units: what commission is taken on. */
export function stayCents(lines: BookingLine[]): number {
  return lines
    .filter((line) => line.kind === 'stay')
    .reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0);
}
