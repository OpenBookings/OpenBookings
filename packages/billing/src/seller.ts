import { countryNameOf, type PartySnapshot } from "./render/document";

/** The environment variables that make up OpenBookings as the seller on every invoice, in the order they are reported. */
export const SELLER_VARIABLES = [
  "SELLER_LEGAL_NAME",
  "SELLER_ADDRESS",
  "SELLER_KVK",
  "SELLER_VAT_ID",
  "SELLER_BILLING_EMAIL",
] as const;

type SellerVariable = (typeof SELLER_VARIABLES)[number];

/** The seller's details are incomplete, so no invoice may be issued in live mode (spec, guards). */
export class SellerConfigError extends Error {
  constructor(readonly missing: SellerVariable[]) {
    super(`Seller config incomplete, set ${missing.join(", ")}`);
    this.name = "SellerConfigError";
  }
}

/**
 * OpenBookings as the seller, frozen into each invoice when it is issued.
 * Read from `SELLER_LEGAL_NAME`, `SELLER_ADDRESS` (one line per newline, a
 * literal `\n` included, ending with "postcode city"), `SELLER_KVK`,
 * `SELLER_VAT_ID` and `SELLER_BILLING_EMAIL`. The seller is a Dutch B.V., so
 * the country is always the Netherlands. In live mode a blank or missing
 * variable throws `SellerConfigError` naming every one that is missing; in
 * test mode it is filled with a `[SELLER_…]` placeholder instead.
 */
export function sellerFromEnv(env: Record<string, string | undefined>, mode: "live" | "test"): PartySnapshot {
  const value = (name: SellerVariable) => env[name]?.trim() || null;
  const addressLines = (env.SELLER_ADDRESS ?? "")
    .split(/\r?\n|\\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const missing = SELLER_VARIABLES.filter((name) => (name === "SELLER_ADDRESS" ? !addressLines.length : !value(name)));
  if (mode === "live" && missing.length) throw new SellerConfigError(missing);

  const read = (name: SellerVariable) => value(name) ?? `[${name}]`;
  return {
    legalName: read("SELLER_LEGAL_NAME"),
    addressLines: addressLines.length ? addressLines : ["[SELLER_ADDRESS]"],
    countryName: countryNameOf("NL"),
    vatId: read("SELLER_VAT_ID"),
    kvk: read("SELLER_KVK"),
    email: read("SELLER_BILLING_EMAIL"),
  };
}
