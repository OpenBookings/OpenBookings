/**
 * The booking being paid for, read from the database.
 *
 * There is still no booking-intent table, so checkout reads a `bookings` row in
 * `pending` — which is what a pre-payment intent is. `packages/db/seed/demo-booking.ts`
 * creates the one this page uses. When intents become real, the only change here
 * is where `CHECKOUT_BOOKING_ID` comes from.
 *
 * Both the page and the Checkout Session route call `getBookingSummary`, so
 * what the guest reads and what Stripe charges are derived from the same rows.
 *
 * Money: every `bigint` amount in the schema is in MAJOR units — `rate_plans.bar`
 * of 109 means €109, and `packages/pricing` rounds to two decimals rather than
 * working in cents. Minor units exist only at the Stripe boundary, produced by
 * the `*Cents` fields below.
 */

import { query } from '@openbookings/db';

/** The booking checkout is currently wired to. Seeded, fixed, idempotent. */
const CHECKOUT_BOOKING_ID = 'b0000000-0000-4000-8000-000000000001';

/** Rows the guest is shown, and Stripe is charged, one for one. */
export type BookingLine = {
  name: string;
  /** What one unit costs, in minor units. */
  unitAmountCents: number;
  quantity: number;
};

export type StaySummary = {
  intentId: string;
  roomId: string;

  propertyName: string;
  /** The host's own one-liner, e.g. "A haven for regeneration and relaxation". */
  propertySubtitle: string | null;
  /** "Saturnia, Italy" — set only when the property gave us both parts. */
  locationLabel: string | null;

  roomName: string;
  /** "Suite", "Double" — the room's category, when the host set one. */
  roomType: string | null;
  bedType: string | null;
  sizeSqm: number | null;
  /** One room photo, to confirm the guest is buying the room they picked. */
  roomImageUrl: string;

  /** Full-bleed background behind the whole checkout. Empty string = flat navy. */
  heroImageUrl: string;
  /** Host wordmark, shown beside ours. Empty string hides it. */
  logoUrl: string;

  checkIn: Date;
  checkOut: Date;
  nights: number;
  /** "14:00" / "10:00", from the property's own policy. Null if unset. */
  checkInTime: string | null;
  checkOutTime: string | null;

  adults: number;
  children: number;

  lines: BookingLine[];
  platformFeeCents: number;
  currency: string;

  /** Refundable plans get a real date; the sentence itself comes from the plan. */
  cancellationPolicy: string;
  freeCancellationUntil: Date | null;

  stripeAccountId: string;
  /** How long the room is held, in minutes, before the Session expires. */
  holdMinutes: number;
};

/** Kept as the old name so callers reading a "booking summary" still find it. */
export type BookingSummary = StaySummary;

const HOLD_MINUTES = 30;
/** Refundable plans in this schema all cancel free until this many days out. */
const FREE_CANCELLATION_DAYS = 7;
const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

type BookingRow = {
  booking_id: string;
  check_in_date: string;
  check_out_date: string;
  currency: string;
  property_name: string;
  property_subtitle: string | null;
  city: string | null;
  country: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  tax_rate: string;
  stripe_account_id: string | null;
  room_id: string;
  room_name: string;
  room_type: string | null;
  bed_type: string | null;
  size_sqm: string | null;
  adults: number;
  children: number;
  total_nights: number;
  price_per_night: string;
  rate_plan_name: string;
  is_refundable: boolean;
  cancellation_policy: string | null;
  hero_image_url: string | null;
  logo_url: string | null;
  room_image_url: string | null;
};

/**
 * One round trip for the whole page.
 *
 * The image joins are lateral rather than plain: a property has many gallery
 * rows, and joining them normally would multiply the booking row by however
 * many photos the host uploaded.
 */
const BOOKING_QUERY = `
  select
    b.id                as booking_id,
    -- Cast to text deliberately. node-postgres parses a date column into a Date
    -- at the *server's* local midnight, so 2026-10-14 comes back as 13 Oct
    -- 22:00 UTC in Amsterdam, and every guest west of Greenwich would then be
    -- shown the wrong arrival day. A date has no time zone; keep it that way.
    b.check_in_date::text  as check_in_date,
    b.check_out_date::text as check_out_date,
    b.currency,
    p.name              as property_name,
    p.subtitle          as property_subtitle,
    p.city,
    p.country,
    p.check_in_time,
    p.check_out_time,
    p.tax_rate,
    p.stripe_account_id,
    r.id                as room_id,
    r.name              as room_name,
    r.room_type,
    r.bed_type,
    r.size_sqm,
    res.adults,
    res.children,
    res.total_nights,
    res.price_per_night,
    rp.name             as rate_plan_name,
    rp.is_refundable,
    rp.cancellation_policy,
    hero.url            as hero_image_url,
    logo.url            as logo_url,
    room_img.url        as room_image_url
  from bookings b
  join properties   p   on p.id   = b.hotel_id
  join reservations res on res.booking_id = b.id
  join rooms        r   on r.id   = res.room_id
  join rate_plans   rp  on rp.id  = res.rate_plan_id
  left join lateral (
    select url from property_images
    where property_id = p.id and "group" = 'hero-image'
    order by sort_order limit 1
  ) hero on true
  left join lateral (
    select url from property_images
    where property_id = p.id and "group" = 'logo'
    order by sort_order limit 1
  ) logo on true
  left join lateral (
    select url from room_images
    where room_id = r.id
    order by sort_order limit 1
  ) room_img on true
  where b.id = $1
  limit 1
`;

/** A booking that cannot be rendered or charged. Surfaced as a checkout failure. */
export class BookingNotFoundError extends Error {
  constructor(bookingId: string) {
    super(`No bookable row for booking ${bookingId}`);
    this.name = 'BookingNotFoundError';
  }
}

/** Postgres `date` arrives as "2026-10-14"; parsed as UTC so the day never shifts. */
function parseDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

/** "14:00:00" → "14:00". Seconds are noise on an arrival time. */
function trimSeconds(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

function toCents(majorUnits: number): number {
  return Math.round(majorUnits * 100);
}

export async function getBookingSummary(): Promise<StaySummary> {
  const rows = await query<BookingRow>(BOOKING_QUERY, [CHECKOUT_BOOKING_ID]);
  const row = rows[0];
  if (!row) throw new BookingNotFoundError(CHECKOUT_BOOKING_ID);

  const checkIn = parseDate(row.check_in_date);
  const checkOut = parseDate(row.check_out_date);
  // Trusted over the date arithmetic: it is the number the reservation was
  // actually priced on, and a mismatch would mean charging for a different stay.
  const nights = row.total_nights;

  const pricePerNight = Number(row.price_per_night);
  const taxRate = Number(row.tax_rate);

  // One line per thing the guest is paying for, in the order they'd expect to
  // read them. The unit price stays visible, so "€185 × 3" reconciles by eye.
  const lines: BookingLine[] = [
    {
      name: `${row.room_name}${row.room_type ? ` ${row.room_type}` : ''}`,
      unitAmountCents: toCents(pricePerNight),
      quantity: nights,
    },
  ];

  // Only when the host actually charges one. A "€0.00 Tax" row is a question
  // the guest then has to answer for themselves.
  if (taxRate > 0) {
    const taxable = pricePerNight * nights;
    lines.push({
      name: 'Tourist tax',
      unitAmountCents: toCents(taxable * taxRate),
      quantity: 1,
    });
  }

  const freeCancellationUntil = row.is_refundable
    ? new Date(checkIn.getTime() - FREE_CANCELLATION_DAYS * MS_PER_NIGHT)
    : null;

  return {
    intentId: row.booking_id,
    roomId: row.room_id,

    propertyName: row.property_name,
    propertySubtitle: row.property_subtitle,
    locationLabel: formatLocation(row.city, row.country),

    roomName: row.room_name,
    roomType: row.room_type,
    bedType: row.bed_type,
    sizeSqm: row.size_sqm === null ? null : Number(row.size_sqm),
    roomImageUrl: row.room_image_url ?? '',

    heroImageUrl: row.hero_image_url ?? '',
    logoUrl: row.logo_url ?? '',

    checkIn,
    checkOut,
    nights,
    checkInTime: trimSeconds(row.check_in_time),
    checkOutTime: trimSeconds(row.check_out_time),

    adults: row.adults,
    children: row.children,

    lines,
    // The fee we would take on a Connect booking, in the units Stripe wants.
    platformFeeCents: 0,
    currency: row.currency.toLowerCase(),

    cancellationPolicy:
      row.cancellation_policy ??
      (row.is_refundable
        ? 'This reservation can be cancelled free of charge.'
        : 'This reservation is non-refundable.'),
    freeCancellationUntil,

    // Env still wins: the seeded property has no Connect account of its own.
    stripeAccountId: row.stripe_account_id ?? process.env.STRIPE_CONNECT_ACCOUNT_ID ?? '',
    holdMinutes: HOLD_MINUTES,
  };
}

/** Sum of every line, in minor units. The one place the total is derived. */
export function totalCents(lines: BookingLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitAmountCents * line.quantity, 0);
}

/** ISO 3166 alpha-2 → "Italy". Falls back to the code when the runtime can't. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

function formatLocation(city: string | null, country: string | null): string | null {
  if (!city) return country ? countryName(country) : null;
  return country ? `${city}, ${countryName(country)}` : city;
}

/**
 * Dates are formatted UTC because they were parsed UTC — a `date` column has no
 * time zone, and letting the server's zone apply would slide "14 Oct" to the
 * 13th anywhere west of Greenwich.
 */
const dateParts = (date: Date, options: Intl.DateTimeFormatOptions) =>
  date.toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });

/** "14" — the day on its own, for the display numerals. */
export function formatDayNumber(date: Date): string {
  return dateParts(date, { day: '2-digit' });
}

/**
 * "Wed, Oct" — the context under the numeral.
 *
 * Composed rather than asked for in one call: `{ weekday, month }` together
 * yield "Oct Wed" in en-GB, which reads as a mistake.
 */
export function formatWeekdayMonth(date: Date): string {
  const weekday = dateParts(date, { weekday: 'short' });
  const month = dateParts(date, { month: 'short' });
  return `${weekday}, ${month}`;
}

/** "Wed, 14 Oct" — the long form, for the cancellation deadline. */
export function formatShortDate(date: Date): string {
  return dateParts(date, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "2 adults · 1 child" — only naming what is actually there. */
export function formatGuests(adults: number, children = 0): string {
  const parts = [`${adults} ${adults === 1 ? 'adult' : 'adults'}`];
  if (children > 0) parts.push(`${children} ${children === 1 ? 'child' : 'children'}`);
  return parts.join(' · ');
}

/** "3 nights". */
export function formatNights(nights: number): string {
  return `${nights} ${nights === 1 ? 'night' : 'nights'}`;
}
