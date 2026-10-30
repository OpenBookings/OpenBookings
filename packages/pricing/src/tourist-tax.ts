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
 * Amounts are in euros, like the rest of this package, and every line is
 * rounded to cents before it is summed, so the lines always add up to the
 * total a host or guest is shown.
 */

export interface TouristTaxCharge {
  kind: "percent" | "fixed";
  /** `percent`: 12.5 means 12.5% of the room price. `fixed`: euros. */
  amount: number;
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

export interface TouristTaxRule {
  /** "2027-01-01". The rule applies to nights on or after this date. */
  effectiveFrom: string;
  /** Empty = no tourist tax from this date on. */
  charges: TouristTaxCharge[];
  /** Per-person charges count adults only. */
  childrenExempt: boolean;
  /** Per-night charges stop after this many nights of the stay. Null = no cap. */
  maxNights: number | null;
}

export interface TouristTaxStay {
  /** One entry per night, with the room price for that night (incl. VAT). */
  nights: { date: string; price: number }[];
  adults: number;
  children: number;
  rooms: number;
}

export interface TouristTaxLine {
  /** "€2.50 per person per night" */
  label: string;
  amount: number;
  /** The rule this charge belongs to, for stays that span a rate change. */
  effectiveFrom: string;
}

export interface TouristTaxResult {
  total: number;
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
  if (stay.nights.length === 0) return { total: 0, lines: [] };

  // Exact amounts per (rule, charge), in insertion order so lines read in the
  // order the host entered them.
  const exact = new Map<string, { rule: TouristTaxRule; charge: TouristTaxCharge; amount: number }>();
  const add = (rule: TouristTaxRule, index: number, amount: number) => {
    const key = `${rule.effectiveFrom}#${index}`;
    const entry = exact.get(key);
    if (entry) entry.amount += amount;
    else exact.set(key, { rule, charge: rule.charges[index], amount });
  };

  const guests = (rule: TouristTaxRule) =>
    rule.childrenExempt ? stay.adults : stay.adults + stay.children;

  stay.nights.forEach((night, nightIndex) => {
    const rule = ruleInForce(rules, night.date);
    if (!rule) return;
    if (rule.maxNights !== null && nightIndex >= rule.maxNights) return;

    rule.charges.forEach((charge, index) => {
      if (charge.kind === "percent") {
        add(rule, index, (taxableRoomPrice(charge, night.price) * charge.amount) / 100);
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
  for (const { rule, charge, amount } of exact.values()) {
    const rounded = round2(amount);
    if (rounded === 0) continue;
    lines.push({ label: describeCharge(charge), amount: rounded, effectiveFrom: rule.effectiveFrom });
  }

  return { total: round2(lines.reduce((sum, line) => sum + line.amount, 0)), lines };
}

function fixedAmount(charge: TouristTaxCharge, guests: number, rooms: number): number {
  return charge.amount * (charge.perPerson ? guests : 1) * (charge.perRoom ? rooms : 1);
}

/** The part of one night's price a percentage is taken of. */
function taxableRoomPrice(charge: TouristTaxCharge, price: number): number {
  const taxable = charge.vatIncludedPercent ? price / (1 + charge.vatIncludedPercent / 100) : price;
  return Math.max(0, taxable);
}

/** "€2.50 per person per night", "12.5% of the room price excl. 9% VAT". */
export function describeCharge(charge: TouristTaxCharge): string {
  if (charge.kind === "percent") {
    const vat = charge.vatIncludedPercent ? ` excl. ${charge.vatIncludedPercent}% VAT` : "";
    return `${charge.amount}% of the room price${vat}`;
  }
  const per = [
    charge.perPerson && "per person",
    charge.perRoom && "per room",
    charge.perNight && "per night",
  ].filter(Boolean);
  return `€${charge.amount.toFixed(2)} ${per.length ? per.join(" ") : "per booking"}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
