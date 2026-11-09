/**
 * Cancellation tiers and refunds — Host Agreement Annex B (draft v1.3, rev. 2,
 * 30 Oct 2026), with two calls Wouter made the same day: the tier is set once
 * per property (Non-refundable is a type of rate), and a no-show gets nothing
 * back on any tier, tourist tax included.
 *
 * Rev. 2 in short: free cancellation until a deadline (Flex 24h, Standard 7
 * days before check-in), nothing back on the room price after it; one
 * early-departure rule for every tier (the next 7 unused nights are kept).
 *
 * This is the only place a refund amount is worked out. It reads a policy
 * snapshot taken when the room was booked, never the property's current tier,
 * so a host changing tiers never alters a booking that already exists.
 *
 * Money is in major units (euros) like the rest of this package. The arithmetic
 * runs in whole cents, and a refund rounds UP to the cent: Annex B rounds in the
 * guest's favour.
 */

import { touristTaxByNight, type TouristTaxRule } from "./tourist-tax";

export const POLICY_VERSION = "annex-b-2026-10-30-rev2";

/** What a property picks. Non-refundable is a type of rate, not a property setting. */
export type PropertyCancellationTier = "flex" | "standard";
/** What a booked room carries. */
export type CancellationTier = PropertyCancellationTier | "non_refundable";

/** One booked night. `date` is the day the night starts (YYYY-MM-DD). */
export interface NightValue {
  date: string;
  price: number;
  touristTax: number;
}

export interface PolicySnapshot {
  tier: CancellationTier;
  confirmedAt: Date;
  checkInAt: Date;
  /** The cancellation deadline: free cancellation up to and including this instant. Null = Non-refundable. */
  fullRefundUntil: Date | null;
  policyVersion: string;
}

export type RefundEvent =
  | { kind: "guest_cancellation"; at: Date }
  | { kind: "early_departure"; lastNightStayed: string }
  | { kind: "no_show" }
  | { kind: "host_cancellation" | "property_unable" | "travel_restriction" };

export type RefundRule =
  | "full_refund_window"
  | "no_refund_window"
  | "early_departure"
  | "no_show"
  | "full_refund_carve_out";

export interface Amounts {
  accommodation: number;
  touristTax: number;
  total: number;
}

export interface RefundResult {
  rule: RefundRule;
  refund: Amounts;
  retained: Amounts;
  /** The nights the event covers, with the share of each night's price refunded (0..1). */
  nightsRefunded: { date: string; share: number }[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Annex B check-in time when the property states none. */
const DEFAULT_CHECK_IN_TIME = "15:00";

export function snapshotTier(propertyTier: PropertyCancellationTier, isRefundable: boolean): CancellationTier {
  return isRefundable ? propertyTier : "non_refundable";
}

// ── Time zones ────────────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant of a wall-clock `date` + `time` ("HH:MM" or "HH:MM:SS") in `timeZone`. */
export function localTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss = 0] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Guess with the offset at the wall time read as UTC, then correct once: the
  // two differ only when a DST change falls between them.
  let instant = wall - zoneOffset(wall, timeZone);
  const corrected = zoneOffset(instant, timeZone);
  if (wall - corrected !== instant) instant = wall - corrected;
  return new Date(instant);
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export function buildPolicySnapshot(i: {
  tier: CancellationTier;
  timeZone: string;
  checkInTime: string | null;
  arrivalDate: string;
  confirmedAt: Date;
}): PolicySnapshot {
  const checkInAt = localTimeToUtc(i.arrivalDate, i.checkInTime || DEFAULT_CHECK_IN_TIME, i.timeZone);
  const checkIn = checkInAt.getTime();
  const before = (ms: number) => new Date(checkIn - ms);

  const fullRefundUntil =
    i.tier === "flex" ? before(DAY)
    : i.tier === "standard" ? before(7 * DAY)
    : null;

  return {
    tier: i.tier,
    confirmedAt: i.confirmedAt,
    checkInAt,
    fullRefundUntil,
    policyVersion: POLICY_VERSION,
  };
}

// ── Refunds ───────────────────────────────────────────────────────────────────

const toCents = (euros: number) => Math.round(euros * 100);
const toEuros = (cents: number) => cents / 100;
/** Round a refund up to the cent; the epsilon keeps float noise from adding one. */
const ceilCents = (cents: number) => Math.max(0, Math.ceil(cents - 1e-6));

/** Annex B B.5.2: whatever the tier, the next 7 unused nights are kept, any after that refunded. */
const EARLY_DEPARTURE_KEPT_NIGHTS = 7;

function amounts(accommodationCents: number, touristTaxCents: number): Amounts {
  return {
    accommodation: toEuros(accommodationCents),
    touristTax: toEuros(touristTaxCents),
    total: toEuros(accommodationCents + touristTaxCents),
  };
}

export function calculateRefund(s: PolicySnapshot, nights: NightValue[], e: RefundEvent): RefundResult {
  const paidAccommodation = nights.reduce((sum, n) => sum + toCents(n.price), 0);
  const paidTax = nights.reduce((sum, n) => sum + toCents(n.touristTax), 0);

  let rule: RefundRule;
  let covered: NightValue[];
  let shares: number[];
  let refundTax: boolean;

  switch (e.kind) {
    case "host_cancellation":
    case "property_unable":
    case "travel_restriction":
      rule = "full_refund_carve_out";
      covered = nights;
      shares = nights.map(() => 1);
      refundTax = true;
      break;
    case "no_show":
      rule = "no_show";
      covered = nights;
      shares = nights.map(() => 0);
      refundTax = false;
      break;
    case "guest_cancellation": {
      const free = s.fullRefundUntil !== null && e.at.getTime() <= s.fullRefundUntil.getTime();
      rule = free ? "full_refund_window" : "no_refund_window";
      covered = nights;
      shares = nights.map(() => (free ? 1 : 0));
      // Nobody stayed, so no tourist tax is owed for any night.
      refundTax = true;
      break;
    }
    case "early_departure":
      rule = "early_departure";
      covered = nights.filter((n) => n.date > e.lastNightStayed);
      shares = covered.map((_, idx) => (idx < EARLY_DEPARTURE_KEPT_NIGHTS ? 0 : 1));
      refundTax = true;
      break;
  }

  const exactAccommodation = covered.reduce((sum, n, i) => sum + shares[i] * toCents(n.price), 0);
  const accommodationCents = Math.min(ceilCents(exactAccommodation), paidAccommodation);
  const taxCents = refundTax ? covered.reduce((sum, n) => sum + toCents(n.touristTax), 0) : 0;

  return {
    rule,
    refund: amounts(accommodationCents, taxCents),
    retained: amounts(paidAccommodation - accommodationCents, paidTax - taxCents),
    nightsRefunded: covered.map((n, i) => ({ date: n.date, share: shares[i] })),
  };
}

/**
 * Annex B B.4.2: a Non-refundable rate must be at least 10% cheaper than a
 * refundable rate it sits next to. Compared in cents so 90.00 vs 100 is exact.
 */
export function nonRefundableQualifies(nonRefundableTotal: number, refundableTotals: number[]): boolean {
  const nr = toCents(nonRefundableTotal);
  return refundableTotals.some((r) => nr * 10 <= toCents(r) * 9);
}

// ── What can happen to a booking now ──────────────────────────────────────────

export type BookingStatus = "pending" | "confirmed" | "checked_in" | "cancelled" | "completed" | "no_show";
export type BookingAction =
  | "cancel"
  | "mark_checked_in"
  | "mark_no_show"
  | "record_early_departure"
  | "goodwill_refund";

/**
 * When the arrival window closes: the property's `check_in_until` on the
 * arrival day, or midnight after it when the property states no cut-off.
 * A guest who hasn't arrived by then can be marked a no-show.
 */
export function checkInClosesAt(i: {
  arrivalDate: string;
  checkInUntil: string | null;
  timeZone: string;
  /** The property's check-in time. A cut-off at or before it (e.g. 01:00) is the next day. */
  checkInTime?: string | null;
}): Date {
  const next = new Date(Date.parse(`${i.arrivalDate}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  if (!i.checkInUntil) return localTimeToUtc(next, "00:00", i.timeZone);
  const hhmm = (t: string) => t.slice(0, 5);
  const afterMidnight = i.checkInTime != null && hhmm(i.checkInUntil) <= hhmm(i.checkInTime);
  return localTimeToUtc(afterMidnight ? next : i.arrivalDate, i.checkInUntil, i.timeZone);
}

/**
 * The actions a host or guest may take on a booking right now, in display
 * order. A guest may only cancel, and only before check-in time: after that a
 * guest who hasn't arrived is a no-show (nothing back), and one who has is
 * staying. A host keeps the wider set.
 */
export function allowedActions(i: {
  status: BookingStatus;
  checkInAt: Date;
  checkInClosesAt: Date;
  checkOutDate: string;
  timeZone: string;
  now: Date;
  actor?: "guest" | "host";
  /**
   * Until when a host may mark a no-show: `hostNoShowDeadline` (check-out +
   * 24h, when the review opens). Left out = no limit; an admin can always
   * correct a status by hand.
   */
  noShowUntil?: Date;
}): BookingAction[] {
  if (i.actor === "guest") {
    return i.status === "confirmed" && i.now.getTime() < i.checkInAt.getTime() ? ["cancel"] : [];
  }
  const now = i.now.getTime();
  const checkIn = i.checkInAt.getTime();
  const stayOver = now >= localTimeToUtc(i.checkOutDate, "00:00", i.timeZone).getTime();
  const actions: BookingAction[] = [];

  switch (i.status) {
    case "confirmed":
      if (!stayOver) actions.push("cancel");
      if (!stayOver && now >= checkIn - DAY) actions.push("mark_checked_in");
      if (now >= i.checkInClosesAt.getTime() && (!i.noShowUntil || now < i.noShowUntil.getTime())) {
        actions.push("mark_no_show");
      }
      if (!stayOver && now >= checkIn) actions.push("record_early_departure");
      actions.push("goodwill_refund");
      break;
    case "checked_in":
      if (!stayOver) actions.push("record_early_departure");
      actions.push("goodwill_refund");
      break;
    case "completed":
    // A late cancellation or a no-show is exactly when a host may want to be generous.
    case "cancelled":
    case "no_show":
      actions.push("goodwill_refund");
      break;
  }
  return actions;
}

/**
 * For a stay being browsed or booked right now: until when it could still be
 * cancelled for free, or null when it can't (Non-refundable, or the free
 * window for these dates has already passed).
 */
export function freeCancellationUntil(i: {
  tier: CancellationTier;
  timeZone: string;
  checkInTime: string | null;
  arrivalDate: string;
  now: Date;
}): Date | null {
  const s = buildPolicySnapshot({ ...i, confirmedAt: i.now });
  return s.fullRefundUntil && s.fullRefundUntil.getTime() > i.now.getTime() ? s.fullRefundUntil : null;
}

/**
 * Everything a reserved room stores when its booking is confirmed: the policy
 * snapshot, and each night's price and tourist tax. Refunds read only this.
 */
export function reservationPolicy(i: {
  propertyTier: PropertyCancellationTier;
  isRefundable: boolean;
  timeZone: string;
  checkInTime: string | null;
  arrivalDate: string;
  confirmedAt: Date;
  nightPrices: { date: string; price: number }[];
  touristTaxRules: TouristTaxRule[];
  adults: number;
  children: number;
}): { snapshot: PolicySnapshot; nights: NightValue[] } {
  const snapshot = buildPolicySnapshot({
    tier: snapshotTier(i.propertyTier, i.isRefundable),
    timeZone: i.timeZone,
    checkInTime: i.checkInTime,
    arrivalDate: i.arrivalDate,
    confirmedAt: i.confirmedAt,
  });
  const tax = touristTaxByNight(i.touristTaxRules, {
    nights: i.nightPrices,
    adults: i.adults,
    children: i.children,
    // A reservation is one room.
    rooms: 1,
  });
  return { snapshot, nights: i.nightPrices.map((n, idx) => ({ ...n, touristTax: tax[idx] })) };
}
