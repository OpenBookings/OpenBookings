/**
 * Cancellation tiers and refunds — Host Agreement Annex B (draft v1.3, 30 Oct 2026),
 * with one change decided on 2026-10-30: a no-show gets nothing back, tourist
 * tax included, on every tier.
 *
 * This is the only place a refund amount is worked out. It reads a policy
 * snapshot taken when the room was booked, never the property's current tier,
 * so a host changing tiers never alters a booking that already exists.
 *
 * Money is in major units (euros) like the rest of this package. The arithmetic
 * runs in whole cents, and a refund rounds UP to the cent: Annex B rounds in the
 * guest's favour.
 */

export const POLICY_VERSION = "annex-b-2026-10-30";

/** What a property picks. Non-refundable is a type of rate, not a property setting. */
export type PropertyCancellationTier = "flex" | "standard" | "limited";
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
  /** Full refund until here (24h after booking, if check-in is 7+ days away). */
  graceUntil: Date | null;
  fullRefundUntil: Date | null;
  /** Limited only: 50% refund until here. */
  partialRefundUntil: Date | null;
  policyVersion: string;
}

export type RefundEvent =
  | { kind: "guest_cancellation"; at: Date }
  | { kind: "early_departure"; lastNightStayed: string }
  | { kind: "no_show" }
  | { kind: "host_cancellation" | "property_unable" | "travel_restriction" };

export type RefundRule =
  | "grace_period"
  | "full_refund_window"
  | "partial_refund_window"
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
    : i.tier === "standard" ? before(5 * DAY)
    : i.tier === "limited" ? before(14 * DAY)
    : null;

  let graceUntil: Date | null = null;
  if (i.tier !== "non_refundable") {
    const end = Math.min(i.confirmedAt.getTime() + DAY, checkIn - 7 * DAY);
    if (end >= i.confirmedAt.getTime()) graceUntil = new Date(end);
  }

  return {
    tier: i.tier,
    confirmedAt: i.confirmedAt,
    checkInAt,
    graceUntil,
    fullRefundUntil,
    partialRefundUntil: i.tier === "limited" ? before(7 * DAY) : null,
    policyVersion: POLICY_VERSION,
  };
}

// ── Refunds ───────────────────────────────────────────────────────────────────

const toCents = (euros: number) => Math.round(euros * 100);
const toEuros = (cents: number) => cents / 100;
/** Round a refund up to the cent; the epsilon keeps float noise from adding one. */
const ceilCents = (cents: number) => Math.max(0, Math.ceil(cents - 1e-6));

/**
 * Shares of the night price refunded on a guest cancellation, by position in
 * the stay. `null` = everything (a full refund window).
 */
function cancellationShares(s: PolicySnapshot, count: number, at: number): { rule: RefundRule; shares: number[] } {
  const all = (share: number) => Array.from({ length: count }, () => share);
  const firstKept = (rest: number) => all(rest).map((share, i) => (i === 0 ? 0 : share));

  if (s.graceUntil && at <= s.graceUntil.getTime()) return { rule: "grace_period", shares: all(1) };
  if (s.fullRefundUntil && at <= s.fullRefundUntil.getTime()) return { rule: "full_refund_window", shares: all(1) };

  switch (s.tier) {
    case "flex":
      return { rule: "partial_refund_window", shares: firstKept(1) };
    case "standard":
      return { rule: "partial_refund_window", shares: firstKept(0.5) };
    case "limited":
      return s.partialRefundUntil && at <= s.partialRefundUntil.getTime()
        ? { rule: "partial_refund_window", shares: all(0.5) }
        : { rule: "no_refund_window", shares: all(0) };
    case "non_refundable":
      return { rule: "no_refund_window", shares: all(0) };
  }
}

/** Shares of each unused night's price refunded on an early departure. */
function earlyDepartureShares(tier: CancellationTier, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    switch (tier) {
      case "flex":
        return i === 0 ? 0 : 1;
      case "standard":
        return i === 0 ? 0 : 0.5;
      case "limited":
        return i < 7 ? 0 : 1;
      case "non_refundable":
        return 0;
    }
  });
}

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
      covered = nights;
      ({ rule, shares } = cancellationShares(s, nights.length, e.at.getTime()));
      // Nobody stayed, so no tourist tax is owed for any night.
      refundTax = true;
      break;
    }
    case "early_departure":
      rule = "early_departure";
      covered = nights.filter((n) => n.date > e.lastNightStayed);
      shares = earlyDepartureShares(s.tier, covered.length);
      refundTax = true;
      break;
  }

  const exactAccommodation = covered.reduce((sum, n, i) => sum + shares[i] * toCents(n.price), 0);
  const accommodationCents = Math.min(ceilCents(exactAccommodation), paidAccommodation);
  const taxCents = refundTax ? covered.reduce((sum, n) => sum + toCents(n.touristTax), 0) : 0;

  if (rule === "partial_refund_window" && accommodationCents === 0) rule = "no_refund_window";

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
