import type { VatTreatment } from "@openbookings/db";
import { roundHalfUp } from "./money";

export type { VatTreatment };

/** Thrown when a host's country is outside the EU: OpenBookings is EU-only. */
export class NonEuCountryError extends Error {
  readonly countryCode: string;

  constructor(countryCode: string) {
    super(`Country "${countryCode}" is not an EU member state`);
    this.name = "NonEuCountryError";
    this.countryCode = countryCode;
  }
}

const EU_COUNTRIES: ReadonlySet<string> = Object.freeze(
  new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
    "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
    "SI", "ES", "SE",
  ]),
);

/** The 27 EU member states as ISO 3166-1 alpha-2 codes, sorted. */
export const EU_COUNTRY_CODES: readonly string[] = [...EU_COUNTRIES].sort();

/** VAT rate on the commission invoice in basis points (21% -> 2100). */
export function vatRateBp(treatment: VatTreatment): 2100n | 0n {
  return treatment === "NL_DOMESTIC" ? 2100n : 0n;
}

/**
 * Picks the VAT treatment from an ISO 3166-1 alpha-2 country code (any case):
 * the Netherlands is domestic, every other EU-27 country is reverse charge,
 * and anything else throws `NonEuCountryError`.
 */
export function vatTreatmentFor(countryCode: string): VatTreatment {
  const code = countryCode.trim().toUpperCase();
  if (code === "NL") return "NL_DOMESTIC";
  if (EU_COUNTRIES.has(code)) return "EU_REVERSE_CHARGE";
  throw new NonEuCountryError(countryCode);
}

/**
 * Splits a VAT-inclusive amount into net and VAT:
 * `net = round(gross * 10000 / (10000 + rateBp))`, `vat = gross - net`,
 * so the two parts always add back up to the gross exactly.
 */
export function splitInclusive(
  gross: bigint,
  rateBp: bigint,
): { net: bigint; vat: bigint } {
  const net = roundHalfUp(gross * 10000n, 10000n + rateBp);
  return { net, vat: gross - net };
}

/**
 * Splits a refund of `refund` cents against an earlier invoice line into
 * credit-note amounts, all negative. `base` is the refunded share of the
 * original rooms total, `net` and `vat` split the refunded commission, and
 * `net + vat === -refund` always holds. A refund equal to the original gross
 * returns the negated original split exactly.
 */
export function splitRefund(
  original: { base: bigint; gross: bigint; rateBp: bigint },
  refund: bigint,
): { base: bigint; net: bigint; vat: bigint } {
  if (refund === original.gross) {
    const { net, vat } = splitInclusive(original.gross, original.rateBp);
    return { base: -original.base, net: -net, vat: -vat };
  }
  const { net } = splitInclusive(refund, original.rateBp);
  return {
    base: -roundHalfUp(original.base * refund, original.gross),
    net: -net,
    vat: -(refund - net),
  };
}
