import type { RateChange } from "@openbookings/apps-contract";
import { type OtaError, currencyNotSupported, invalidIncludedOccupancy, ratesNotTaxInclusive } from "../soap/errors";
import { asArray, asNode, attr, fail, isRecord, single, statusControl } from "./status-control";

// Whole euros, then up to two decimals; further decimals only as trailing zeros (lossless, never rounded).
const DECIMAL = /^(\d+)(?:\.(\d{1,2})0*)?$/;
const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * A decimal amount string as integer cents, without floating point: "186.50" → 18650, "0.1" → 10.
 * Undefined for anything else: exponents, signs, a third non-zero decimal, separators, or more cents than a
 * JS number holds exactly.
 */
export function decimalToCents(s: string): number | undefined {
  const match = DECIMAL.exec(s);
  if (!match) return undefined;
  const cents = BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  return cents > MAX_CENTS ? undefined : Number(cents);
}

const amountError = (name: string, value: string | undefined) => fail(`${name} must be a decimal amount like 186.50, got "${value ?? ""}"`);

/** No CurrencyCode means EUR (SiteMinder can switch the attribute off for single-currency channels). */
function currencyError(node: Record<string, unknown>): { error: OtaError } | undefined {
  const currency = attr(node, "CurrencyCode");
  return currency === undefined || currency === "EUR" ? undefined : { error: currencyNotSupported(currency) };
}

type Amounts = Pick<RateChange, "priceCents" | "extraAdultCents" | "extraChildCents">;

/**
 * One `Rate` under Per Day Pricing. The price is the `BaseByGuestAmt` without `NumberOfGuests`. We do not enable
 * Included Occupancy or occupancy-based pricing (guests included stays our base occupancy), so any amount for 2+
 * guests is answered with the docs' "Invalid included occupancy". A `NumberOfGuests="1"` amount next to the base
 * is a Single Guest Discount, also not offered: ignored, as the docs ask for unsupported features.
 */
function rateAmounts(rate: Record<string, unknown>): Amounts | { error: OtaError } {
  const bases = (isRecord(rate.BaseByGuestAmts) ? asArray(rate.BaseByGuestAmts.BaseByGuestAmt) : []).map(asNode);
  if (bases.length === 0) return fail("Node BaseByGuestAmt must exist");
  for (const node of bases) {
    const guests = attr(node, "NumberOfGuests");
    if (guests === undefined) continue;
    if (!/^\d+$/.test(guests)) return fail(`NumberOfGuests must be a whole number, got "${guests}"`);
    if (Number(guests) >= 2) return { error: invalidIncludedOccupancy() };
  }
  const plain = bases.filter((node) => attr(node, "NumberOfGuests") === undefined);
  if (plain.length === 0) return { error: invalidIncludedOccupancy() };
  if (plain.length > 1) return fail("Node BaseByGuestAmt without NumberOfGuests must occur once");
  const base = plain[0] as Record<string, unknown>;

  const currency = currencyError(base);
  if (currency) return currency;
  const after = attr(base, "AmountAfterTax");
  if (after === undefined) return { error: ratesNotTaxInclusive() };
  const priceCents = decimalToCents(after);
  if (priceCents === undefined) return amountError("AmountAfterTax", after);
  if (priceCents === 0) return fail("AmountAfterTax must be greater than 0");

  const amounts: Amounts = { priceCents, extraAdultCents: null, extraChildCents: null };
  const extras = (isRecord(rate.AdditionalGuestAmounts) ? asArray(rate.AdditionalGuestAmounts.AdditionalGuestAmount) : []).map(asNode);
  for (const node of extras) {
    const code = attr(node, "AgeQualifyingCode") ?? "";
    const field = code === "10" ? "extraAdultCents" : code === "8" ? "extraChildCents" : undefined;
    if (!field) return fail(`Unsupported AdditionalGuestAmount AgeQualifyingCode "${code}"`);
    if (amounts[field] !== null) return fail(`AdditionalGuestAmount AgeQualifyingCode "${code}" must occur once`);
    const extraCurrency = currencyError(node);
    if (extraCurrency) return extraCurrency;
    const amount = attr(node, "Amount");
    const cents = amount === undefined ? undefined : decimalToCents(amount);
    if (cents === undefined) return amountError("Amount", amount);
    amounts[field] = cents;
  }
  return amounts;
}

/** `OTA_HotelRateAmountNotifRQ` → one rate change per message and date span. Pure: codes are checked by the core. */
export function rateAmountNotifToChanges(body: Record<string, unknown>): { hotelCode: string; rates: RateChange[] } | { error: OtaError } {
  const container = single(body, "RateAmountMessages");
  if (!container) return fail("Node RateAmountMessages must occur once");
  const hotelCode = attr(container, "HotelCode");
  if (!hotelCode) return fail("Attribute HotelCode must exist");
  const messages = asArray(container.RateAmountMessage).map(asNode);
  if (messages.length === 0) return fail("Node RateAmountMessage must exist");

  const rates: RateChange[] = [];
  for (const message of messages) {
    const control = statusControl(message);
    if ("error" in control) return control;
    if (!control.ratePlanCode) return fail("Attribute RatePlanCode must exist");
    const ratesNode = single(message, "Rates");
    const rate = ratesNode && single(ratesNode, "Rate");
    if (!rate) return fail("Node Rate must occur once");
    const amounts = rateAmounts(rate);
    if ("error" in amounts) return amounts;
    for (const range of control.ranges) rates.push({ ratePlanCode: control.ratePlanCode, ...range, ...amounts });
  }
  return { hotelCode, rates };
}
