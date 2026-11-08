import { z } from "zod";
import type { Queryable } from "@openbookings/db";
import { compactVatId, getBillingProfile, recordViesResult, upsertBillingProfile, type BillingProfile } from "@openbookings/billing/profiles";
import { EU_COUNTRY_CODES } from "@openbookings/billing/vat";
import { checkVatId, ViesUnavailableError } from "@openbookings/billing/vies";

/** The VAT prefix VIES and tax offices use for a country (Greece is `EL`, not `GR`). */
function vatPrefix(country: string): string {
  return country === "GR" ? "EL" : country;
}

const text = (label: string) => z.string().trim().min(1, `${label} is required`).max(200);
const optional = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** What the billing details form accepts. Country must be an EU member state; the VAT number is required. */
export const billingDetailsSchema = z
  .object({
    legalName: text("Company name"),
    addressLine1: text("Address"),
    addressLine2: optional,
    postalCode: text("Postal code").max(20),
    city: text("City"),
    countryCode: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .refine((v) => EU_COUNTRY_CODES.includes(v), "Choose an EU member state"),
    vatId: z
      .string()
      .trim()
      .min(1, "VAT number is required")
      .transform(compactVatId)
      .refine((v) => /^[A-Z]{2}[A-Z0-9]{2,12}$/.test(v), "Enter the VAT number with its country prefix, for example NL123456789B01"),
    kvkNumber: optional,
    billingEmail: z.string().trim().min(1, "Billing email is required").pipe(z.email("Enter a valid email address")),
  })
  .refine((v) => v.vatId.startsWith(vatPrefix(v.countryCode)), {
    path: ["vatId"],
    message: "The VAT number must start with your country's prefix",
  });

export type BillingDetailsInput = z.infer<typeof billingDetailsSchema>;

/** How a VAT number check ended. */
export type VatCheckOutcome =
  | "not_needed" // Dutch hosts need no VIES result
  | "verified"
  | "invalid"
  | "unavailable" // VIES could not answer; nothing is recorded
  | "not_configured"; // no requester VAT number set, so no check was made

/** OpenBookings' own VAT number as VIES wants it, from `VIES_REQUESTER_VAT` (e.g. `NL123456789B01`). */
export function viesRequester(env: Record<string, string | undefined> = process.env): { countryCode: "NL"; vatNumber: string } | null {
  const vat = env.VIES_REQUESTER_VAT ? compactVatId(env.VIES_REQUESTER_VAT) : "";
  return /^NL[A-Z0-9]{9,12}$/.test(vat) ? { countryCode: "NL", vatNumber: vat.slice(2) } : null;
}

export type VatCheckDeps = { check?: typeof checkVatId; requester?: ReturnType<typeof viesRequester> };

/**
 * Checks the profile's VAT number against VIES and stores the answer. Dutch
 * hosts are not checked. Without a requester VAT number, or when VIES is down,
 * nothing is stored and the number simply stays "not verified yet".
 */
export async function runVatCheck(
  db: Queryable,
  profile: BillingProfile,
  deps: VatCheckDeps = {},
): Promise<VatCheckOutcome> {
  if (!profile.countryCode || !profile.vatId || profile.countryCode === "NL") return "not_needed";
  const requester = deps.requester === undefined ? viesRequester() : deps.requester;
  if (!requester) return "not_configured";
  try {
    const result = await (deps.check ?? checkVatId)(profile.vatId, { requester });
    await recordViesResult(db, profile.organizationId, result);
    return result.valid ? "verified" : "invalid";
  } catch (error) {
    if (error instanceof ViesUnavailableError) return "unavailable";
    throw error;
  }
}

/** Saves the form's fields, then checks the VAT number when it needs it. Returns the saved profile and how the check ended. */
export async function storeBillingDetails(
  db: Queryable,
  organizationId: string,
  input: BillingDetailsInput,
  deps: VatCheckDeps = {},
): Promise<{ profile: BillingProfile; outcome: VatCheckOutcome }> {
  const saved = await upsertBillingProfile(db, organizationId, input);
  const outcome = await runVatCheck(db, saved, deps);
  const profile = (await getBillingProfile(db, organizationId)) ?? saved;
  return { profile, outcome };
}
