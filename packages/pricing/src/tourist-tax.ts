/**
 * Tourist tax, worked out from a property's own rules.
 *
 * Every town sets tourist tax its own way, so a rule here is a list of charges
 * the host combines: a percentage of the room price, or a fixed amount that is
 * multiplied by any of person, room and night. A fixed amount with none of
 * those is charged once per booking.
 *
 * Tourist tax is added on top of the room price. The guest sees one all-in
 * price; OpenBookings' commission is taken on the room price only.
 *
 * Every amount is an integer number of cents. A percentage is taken per night
 * and rounded half up to a whole cent (taking VAT out first is a step of its
 * own, rounded the same way), so lines and nights are whole cents and always
 * add up exactly to the total a host or guest is shown.
 */

import { formatCents, percentOfCents, roundHalfUp } from "./money";

/** The `per` flags: shared by both kinds of charge, as stored. */
interface TouristTaxChargeFlags {
  /** `fixed` only. The `per` flags multiply; none of them = once per booking. */
  perPerson: boolean;
  perNight: boolean;
  perRoom: boolean;
  /**
   * `percent` only. The room price includes this much VAT, and the town taxes
   * the price before VAT (Amsterdam does). Null or 0 = taken of the price as is.
   */
  vatIncludedPercent?: number | null;
}

export type TouristTaxCharge =
  | (TouristTaxChargeFlags & {
      kind: "fixed";
      /** Cents, multiplied by the `per` flags. */
      amountCents: number;
    })
  | (TouristTaxChargeFlags & {
      kind: "percent";
      /** 12.5 means 12.5% of each night's room price. */
      percent: number;
    });

export interface TouristTaxRule {
  /** "2027-01-01". The rule applies to nights on or after this date. */
  effectiveFrom: string;
  /** Empty = no tourist tax from this date on. */
  charges: TouristTaxCharge[];
  /** Per-person charges count adults only. */
  childrenExempt: boolean;
  /**
   * Per-person charges count infants (under 2) too. Only while children pay:
   * a rule that exempts children exempts infants as well. Left out = infants
   * don't pay, which is also the default for a new rule.
   */
  infantsTaxed?: boolean;
  /** Per-night charges stop after this many nights of the stay. Null = no cap. */
  maxNights: number | null;
}

export interface TouristTaxStay {
  /** One entry per night, with the room price for that night in cents (incl. VAT). */
  nights: { date: string; priceCents: number }[];
  adults: number;
  children: number;
  /** Under 2. Counted only where the rule says infants pay. */
  infants?: number;
  rooms: number;
}

export interface TouristTaxLine {
  /** "€2.50 per person per night" */
  label: string;
  amountCents: number;
  /** The rule this charge belongs to, for stays that span a rate change. */
  effectiveFrom: string;
}

export interface TouristTaxResult {
  totalCents: number;
  lines: TouristTaxLine[];
}

/** The rule that applies on `date`: the latest one that has started. */
export function ruleInForce(rules: TouristTaxRule[], date: string): TouristTaxRule | null {
  let current: TouristTaxRule | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom > date) continue;
    if (!current || rule.effectiveFrom > current.effectiveFrom) current = rule;
  }
  return current;
}

export function calculateTouristTax(
  rules: TouristTaxRule[],
  stay: TouristTaxStay,
): TouristTaxResult {
  if (stay.nights.length === 0) return { totalCents: 0, lines: [] };

  // Cents per (rule, charge), in insertion order so lines read in the order
  // the host entered them.
  const byCharge = new Map<string, { rule: TouristTaxRule; charge: TouristTaxCharge; amountCents: number }>();
  const add = (rule: TouristTaxRule, index: number, cents: number) => {
    const key = `${rule.effectiveFrom}#${index}`;
    const entry = byCharge.get(key);
    if (entry) entry.amountCents += cents;
    else byCharge.set(key, { rule, charge: rule.charges[index], amountCents: cents });
  };

  const guests = (rule: TouristTaxRule) => taxedGuests(rule, stay);

  stay.nights.forEach((night, nightIndex) => {
    const rule = ruleInForce(rules, night.date);
    if (!rule) return;
    if (rule.maxNights !== null && nightIndex >= rule.maxNights) return;

    rule.charges.forEach((charge, index) => {
      if (charge.kind === "percent") {
        add(rule, index, percentOfNight(charge, night.priceCents));
      } else if (charge.perNight) {
        add(rule, index, fixedAmount(charge, guests(rule), stay.rooms));
      }
    });
  });

  // Charges that are not per night are owed once, under the rule on arrival.
  const arrivalRule = ruleInForce(rules, stay.nights[0].date);
  arrivalRule?.charges.forEach((charge, index) => {
    if (charge.kind === "fixed" && !charge.perNight) {
      add(arrivalRule, index, fixedAmount(charge, guests(arrivalRule), stay.rooms));
    }
  });

  const lines: TouristTaxLine[] = [];
  for (const { rule, charge, amountCents } of byCharge.values()) {
    if (amountCents === 0) continue;
    lines.push({ label: describeCharge(charge), amountCents, effectiveFrom: rule.effectiveFrom });
  }

  return { totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0), lines };
}

/**
 * The tax owed per night of the stay in cents, for refunds of the nights not
 * stayed. Per-night charges land on their night; charges owed once per stay
 * land on the first night, which is always stayed when a guest leaves early.
 * Each night is the same whole cents `calculateTouristTax` adds up, so the
 * nights always sum to its `totalCents` exactly.
 */
export function touristTaxByNight(rules: TouristTaxRule[], stay: TouristTaxStay): number[] {
  if (stay.nights.length === 0) return [];

  const guests = (rule: TouristTaxRule) => taxedGuests(rule, stay);

  const cents = stay.nights.map((night, nightIndex) => {
    const rule = ruleInForce(rules, night.date);
    if (!rule) return 0;
    if (rule.maxNights !== null && nightIndex >= rule.maxNights) return 0;
    return rule.charges.reduce((sum, charge) => {
      if (charge.kind === "percent") return sum + percentOfNight(charge, night.priceCents);
      if (charge.perNight) return sum + fixedAmount(charge, guests(rule), stay.rooms);
      return sum;
    }, 0);
  });

  const arrivalRule = ruleInForce(rules, stay.nights[0].date);
  arrivalRule?.charges.forEach((charge) => {
    if (charge.kind === "fixed" && !charge.perNight) {
      cents[0] += fixedAmount(charge, guests(arrivalRule), stay.rooms);
    }
  });

  return cents;
}

/** The people a per-person charge counts under this rule. */
function taxedGuests(rule: TouristTaxRule, stay: TouristTaxStay): number {
  if (rule.childrenExempt) return stay.adults;
  return stay.adults + stay.children + (rule.infantsTaxed ? (stay.infants ?? 0) : 0);
}

/**
 * Whether infants pay tourist tax under the rule in force on `today` or any
 * rule after it: a per-person charge, under a rule that taxes infants.
 */
export function infantsPayTouristTax(rules: TouristTaxRule[], today: string): boolean {
  const current = ruleInForce(rules, today);
  return rules.some(
    (rule) =>
      (rule === current || rule.effectiveFrom > today) &&
      rule.infantsTaxed === true &&
      !rule.childrenExempt &&
      rule.charges.some((c) => c.kind === "fixed" && c.perPerson),
  );
}

/** A fixed charge in cents: whole cents times whole counts, so already exact. */
function fixedAmount(
  charge: Extract<TouristTaxCharge, { kind: "fixed" }>,
  guests: number,
  rooms: number,
): number {
  return charge.amountCents * (charge.perPerson ? guests : 1) * (charge.perRoom ? rooms : 1);
}

/**
 * A percentage charge on one night, in cents. The part of the price before
 * VAT (when the town taxes that) is rounded half up to a whole cent first,
 * then the percentage of it.
 */
function percentOfNight(charge: Extract<TouristTaxCharge, { kind: "percent" }>, priceCents: number): number {
  const taxable = charge.vatIncludedPercent
    ? roundHalfUp((priceCents * 100) / (100 + charge.vatIncludedPercent))
    : priceCents;
  return percentOfCents(Math.max(0, taxable), charge.percent);
}

/** "€2.50 per person per night", "12.5% of the room price excl. 9% VAT". */
export function describeCharge(charge: TouristTaxCharge): string {
  if (charge.kind === "percent") {
    const vat = charge.vatIncludedPercent ? ` excl. ${charge.vatIncludedPercent}% VAT` : "";
    return `${charge.percent}% of the room price${vat}`;
  }
  const per = [
    charge.perPerson && "per person",
    charge.perRoom && "per room",
    charge.perNight && "per night",
  ].filter(Boolean);
  return `${formatCents(charge.amountCents, { whole: "always-decimals" })} ${per.length ? per.join(" ") : "per booking"}`;
}
