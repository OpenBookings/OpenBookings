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
 * What the guest pays for a booking intent: per room, one line for the whole
 * stay (its nights summed exactly, then rounded once to cents), followed by
 * that room's tourist tax. The nights are the intent's own prices, fixed when
 * the rooms were held, so nothing is re-priced here.
 *
 * Rates include VAT and every mandatory fee by contract with the host — every
 * organisation confirms it on record before it can set a price (see
 * `propertyRatesConfirmed`). Tourist tax is the one thing added on top, and it
 * is shown as its own lines so the guest can see the all-in total build up,
 * and so it never carries VAT. `properties.tax_rate` is not an input on purpose.
 */
export function buildIntentLines(
  rooms: {
    roomName: string;
    roomType: string | null;
    nights: { date: string; price: number }[];
    touristTaxLines: TouristTaxLine[];
  }[],
): BookingLine[] {
  return rooms.flatMap((room): BookingLine[] => {
    const n = room.nights.length;
    return [
      {
        name: `${room.roomName}${room.roomType ? ` ${room.roomType}` : ''} · ${n} ${n === 1 ? 'night' : 'nights'}`,
        unitAmountCents: toCents(room.nights.reduce((sum, night) => sum + night.price, 0)),
        quantity: 1,
        kind: 'stay',
      },
      ...taxLines(room.touristTaxLines),
    ];
  });
}

function taxLines(lines: TouristTaxLine[]): BookingLine[] {
  return lines.map((line) => ({
    name: `Tourist tax · ${line.label}`,
    unitAmountCents: toCents(line.amount),
    quantity: 1,
    kind: 'tourist_tax',
  }));
}

/** The room lines alone, in minor units: what commission is taken on. */
export function stayCents(lines: BookingLine[]): number {
  return lines
    .filter((line) => line.kind === 'stay')
    .reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0);
}
