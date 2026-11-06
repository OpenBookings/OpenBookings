/**
 * The booking intent being paid for, read from the database.
 *
 * Both the page and the Checkout Session route call `getBookingSummary`, so
 * what the guest reads and what Stripe charges are derived from the same rows.
 * The prices are the intent's own — fixed per night and per room when the
 * rooms were held — so nothing is re-priced here; the property and room rows
 * only supply what the page shows around them.
 *
 * Money: every amount in the schema is in MAJOR units — a night of 109 means
 * €109. Minor units exist only at the Stripe boundary, produced by the `*Cents`
 * fields below.
 */

import { getPool, loadIntent, type BookingIntentStatus, type Queryable } from '@openbookings/db';
import { RATES_TAX_INCLUSIVE_DOC_ID } from '@openbookings/authz/rates-doc';
import { isTestingMode } from '@openbookings/demo';
import { buildIntentLines, stayCents, type BookingLine } from './booking-lines';
import { applicationFeeCents } from '@openbookings/stripe';
import type { PropertyCancellationTier } from '@openbookings/pricing';
import { checkoutCancellationTerms, type CheckoutCancellationTerms } from './cancellation-terms';

export type { BookingLine } from './booking-lines';

/** One room of the intent, as checkout shows it. */
export type StayRoom = {
  /** The intent's own row for this room; a room type can be picked twice. */
  intentRoomId: string;
  roomId: string;
  roomName: string;
  /** "Suite", "Double" — the room's category, when the host set one. */
  roomType: string | null;
  bedType: string | null;
  sizeSqm: number | null;
  /** One room photo, to confirm the guest is buying the room they picked. */
  roomImageUrl: string;
  ratePlanName: string;
  isRefundable: boolean;
  adults: number;
  children: number;
  nights: number;
  /** Euros, the nights summed. */
  stayTotal: number;
  /** Tier, exact deadlines and whether the guest must confirm Non-refundable. */
  cancellation: CheckoutCancellationTerms;
};

export type StaySummary = {
  intentId: string;
  status: BookingIntentStatus;
  /** When the rooms stop being held. The checkout countdown runs to this. */
  holdExpiresAt: Date;
  /** The payment session already made for this intent, if any, and its account. */
  paymentSessionId: string | null;
  paymentAccountId: string | null;

  propertySlug: string;
  propertyName: string;
  /** The host's own one-liner, e.g. "A haven for regeneration and relaxation". */
  propertySubtitle: string | null;
  /** "Saturnia, Italy" — set only when the property gave us both parts. */
  locationLabel: string | null;

  /** In the order the guest picked them. */
  rooms: StayRoom[];

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

  lines: BookingLine[];
  /** Euros, every room's tourist tax; already in `lines`. */
  touristTaxTotal: number;
  platformFeeCents: number;
  currency: string;

  stripeAccountId: string;
  /**
   * Whether the property's organisation has confirmed, on record, that its
   * rates include tax. The price is sold as "incl. tax" on the strength of
   * that, so a booking without it is not chargeable.
   */
  ratesConfirmed: boolean;
};

/** Kept as the old name so callers reading a "booking summary" still find it. */
export type BookingSummary = StaySummary;

const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

type PropertyRow = {
  name: string;
  subtitle: string | null;
  city: string | null;
  country: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  timezone: string;
  cancellation_tier: PropertyCancellationTier;
  is_demo: boolean;
  rates_confirmed: boolean;
  commission_rate: string;
  stripe_account_id: string | null;
  hero_image_url: string | null;
  logo_url: string | null;
};

/**
 * The property around the intent. The image joins are lateral rather than
 * plain: a property has many gallery rows, and joining them normally would
 * multiply the row by however many photos the host uploaded.
 */
const PROPERTY_QUERY = `
  select
    p.name, p.subtitle, p.city, p.country, p.check_in_time, p.check_out_time,
    p.timezone, p.cancellation_tier, p.is_demo,
    exists (
      select 1 from org_consent oc
      where oc.organization_id = p.organization_id and oc.doc_id = $2
    )                   as rates_confirmed,
    p.commission_rate,
    p.stripe_account_id,
    hero.url            as hero_image_url,
    logo.url            as logo_url
  from properties p
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
  where p.id = $1
  limit 1
`;

type RoomRow = {
  room_id: string;
  rate_plan_id: string;
  room_name: string;
  room_type: string | null;
  bed_type: string | null;
  size_sqm: string | null;
  rate_plan_name: string;
  is_refundable: boolean;
  room_image_url: string | null;
};

/** What the page shows of each room and rate plan the intent holds. */
const ROOMS_QUERY = `
  select
    r.id as room_id, rp.id as rate_plan_id, r.name as room_name, r.room_type, r.bed_type, r.size_sqm,
    rp.name as rate_plan_name, rp.is_refundable, room_img.url as room_image_url
  from rate_plans rp
  join rooms r on r.id = rp.room_id
  left join lateral (
    select url from room_images
    where room_id = r.id
    order by sort_order limit 1
  ) room_img on true
  where rp.id = any($1::uuid[])
`;

/** An intent that cannot be rendered or charged. Surfaced as a checkout failure. */
export class BookingNotFoundError extends Error {
  /** Which link in the chain was missing. Carried for logs, not for callers. */
  readonly reason: string;

  constructor(intentId: string, reason: string) {
    super(`No bookable intent ${intentId}: ${reason}`);
    this.name = 'BookingNotFoundError';
    this.reason = reason;
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

/**
 * The commission on these lines. A rate that cannot be a commission (someone
 * typing `4.5` for 4.5%) must not take the checkout page down, and must not
 * be charged either: NaN makes the booking fail `assertChargeable` in the
 * route as a handled, non-retryable error.
 */
function commissionCents(lines: BookingLine[], rate: string): number {
  try {
    // The stay only. Tourist tax is the host's to pay to their town, and
    // OpenBookings never takes commission on it.
    return applicationFeeCents(stayCents(lines), Number(rate));
  } catch {
    return Number.NaN;
  }
}

/**
 * Whether the commission is taken as an application fee yet. Off by default,
 * so direct charges can be verified in test mode before any fee is live.
 */
function applicationFeeEnabled(): boolean {
  return process.env.STRIPE_APPLICATION_FEE_ENABLED === 'true';
}

/**
 * The guest's own intent, ready to show and to charge. Someone else's intent,
 * and a demo hotel's outside testing mode, read as not found.
 *
 * `testing` and `db` are for tests; the app uses the deployment's mode and pool.
 */
export async function getBookingSummary(
  i: { intentId: string; userId: string; testing?: boolean },
  db: Queryable = getPool(),
): Promise<StaySummary> {
  const intent = await loadIntent(db, { intentId: i.intentId, userId: i.userId });
  if (!intent) throw new BookingNotFoundError(i.intentId, 'no such intent for this guest');

  const [propertyResult, roomsResult] = await Promise.all([
    db.query(PROPERTY_QUERY, [intent.propertyId, RATES_TAX_INCLUSIVE_DOC_ID]),
    db.query(ROOMS_QUERY, [intent.rooms.map((r) => r.ratePlanId)]),
  ]);
  const property = propertyResult.rows[0] as PropertyRow | undefined;
  if (!property) throw new BookingNotFoundError(intent.id, 'intent references a property that does not exist');
  if (property.is_demo && !(i.testing ?? isTestingMode())) {
    throw new BookingNotFoundError(intent.id, 'demo property outside testing mode');
  }
  const plans = new Map((roomsResult.rows as RoomRow[]).map((r) => [r.rate_plan_id, r]));

  const now = new Date();
  const rooms = intent.rooms.map((room, index): StayRoom => {
    const plan = plans.get(room.ratePlanId);
    if (!plan) throw new BookingNotFoundError(intent.id, `rate plan ${room.ratePlanId} no longer exists`);
    // What the guest was shown when the rooms were held, when it lines up;
    // the rows otherwise. The two only differ if the host renamed something.
    const shown = intent.snapshot.rooms[index];
    const snap = shown?.roomId === room.roomId && shown.ratePlanId === room.ratePlanId ? shown : null;
    const isRefundable = snap?.isRefundable ?? plan.is_refundable;
    return {
      intentRoomId: room.id,
      roomId: room.roomId,
      roomName: snap?.roomName ?? plan.room_name,
      roomType: plan.room_type,
      bedType: plan.bed_type,
      sizeSqm: plan.size_sqm === null ? null : Number(plan.size_sqm),
      roomImageUrl: plan.room_image_url ?? '',
      ratePlanName: snap?.ratePlanName ?? plan.rate_plan_name,
      isRefundable,
      adults: room.adults,
      children: room.children,
      nights: room.nights.length,
      stayTotal: room.stayTotal,
      cancellation: checkoutCancellationTerms({
        propertyTier: property.cancellation_tier,
        isRefundable,
        timeZone: property.timezone,
        checkInTime: property.check_in_time,
        arrivalDate: intent.checkIn,
        now,
      }),
    };
  });

  const lines = buildIntentLines(
    intent.rooms.map((room, index) => ({
      roomName: rooms[index]!.roomName,
      roomType: rooms[index]!.roomType,
      nights: room.nights,
      touristTaxLines: room.touristTaxLines,
    })),
  );

  const checkIn = parseDate(intent.checkIn);
  const checkOut = parseDate(intent.checkOut);

  return {
    intentId: intent.id,
    status: intent.status,
    holdExpiresAt: intent.holdExpiresAt,
    paymentSessionId: intent.paymentSessionId,
    paymentAccountId: intent.paymentAccountId,

    propertySlug: intent.propertySlug,
    propertyName: property.name,
    propertySubtitle: property.subtitle,
    locationLabel: formatLocation(property.city, property.country),

    rooms,

    heroImageUrl: property.hero_image_url ?? '',
    logoUrl: property.logo_url ?? '',

    checkIn,
    checkOut,
    nights: Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_NIGHT),
    checkInTime: trimSeconds(property.check_in_time),
    checkOutTime: trimSeconds(property.check_out_time),

    lines,
    touristTaxTotal: intent.snapshot.touristTaxTotal,
    // OpenBookings' commission on the stay, excluding tourist tax, in the
    // units Stripe wants. Zero until the fee is switched on for this deployment.
    platformFeeCents: applicationFeeEnabled() ? commissionCents(lines, property.commission_rate) : 0,
    currency: intent.snapshot.currency.toLowerCase(),

    // The host's own connected account: the booking is charged on it. The env
    // fallback exists for the seeded and demo properties in development only —
    // in production a property without an account is not chargeable, and must
    // never be charged on somebody else's.
    stripeAccountId:
      property.stripe_account_id ??
      (process.env.NODE_ENV === 'production' ? '' : (process.env.STRIPE_CONNECT_ACCOUNT_ID ?? '')),
    ratesConfirmed: property.rates_confirmed === true,
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
