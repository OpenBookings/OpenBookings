import type { Queryable } from "@openbookings/db";
import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import { getBillingProfile, missingProfileFields } from "./profiles";
import { vatTreatmentFor } from "./vat";

/** A thing a property still needs before it can go live or be booked. */
export type ReadinessItem =
  | "stripe_account"
  | "stripe_charges"
  | "rates_confirmed"
  | "legal_details"
  | "billing_profile"
  | "vat_id_verified";

/** The order items are reported and shown in. */
export const READINESS_ITEMS: readonly ReadinessItem[] = [
  "stripe_account",
  "stripe_charges",
  "rates_confirmed",
  "legal_details",
  "billing_profile",
  "vat_id_verified",
];

const COPY: Record<ReadinessItem, string> = {
  stripe_account: "Connect Stripe",
  stripe_charges: "Finish Stripe verification",
  rates_confirmed: "Confirm your rates include VAT",
  legal_details: "Add your legal company name and VAT number",
  billing_profile: "Complete your billing details",
  vat_id_verified: "Get your VAT number verified",
};

/** What to tell a host to do about an item. One wording for the rail, the billing checklist and the publish error. */
export function readinessCopy(item: ReadinessItem): string {
  return COPY[item];
}

/**
 * Whether property readiness is enforced. On unless `PROPERTY_READINESS_ENFORCE`
 * is `off`, which exists to roll the gate out (or back) without a deploy.
 */
export function readinessEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.PROPERTY_READINESS_ENFORCE !== "off";
}

type ReadinessRow = {
  organization_id: string | null;
  stripe_account_id: string | null;
  rates_confirmed: boolean;
  legal_ok: boolean;
};

/**
 * What a property still needs before it can be published or booked (spec
 * decision 9), in the fixed order of `READINESS_ITEMS`.
 *
 * - `stripe_account`: a connected account, the property's own or its
 *   organization's.
 * - `stripe_charges`: only when `chargesEnabled` is given, as it costs a call
 *   to Stripe. A Stripe error counts as "not enabled" rather than throwing.
 * - `rates_confirmed`: the organization confirmed its rates include VAT.
 * - `legal_details`: the property's legal company name and VAT number.
 * - `billing_profile`: the organization's billing profile is complete and its
 *   country is an EU member state.
 * - `vat_id_verified`: only for a reverse-charge host, whose VAT id VIES
 *   confirmed. A Dutch host needs no VIES result.
 *
 * A property without an organization has no account and no billing profile, so
 * it is never ready. Pass `db` to read inside a transaction.
 */
export async function propertyReadiness(
  db: Queryable,
  propertyId: string,
  opts: { chargesEnabled?: (accountId: string) => Promise<boolean> } = {},
): Promise<{ ready: boolean; missing: ReadinessItem[] }> {
  const { rows } = await db.query(
    `SELECT p.organization_id,
            COALESCE(NULLIF(btrim(p.stripe_account_id), ''), NULLIF(btrim(op.stripe_account_id), '')) AS stripe_account_id,
            EXISTS (SELECT 1 FROM org_consent oc
                     WHERE oc.organization_id = p.organization_id AND oc.doc_id = $2) AS rates_confirmed,
            COALESCE(btrim(pc.legal_company_name) <> '' AND btrim(pc.vat_number) <> '', false) AS legal_ok
       FROM properties p
       LEFT JOIN org_profile op ON op.organization_id = p.organization_id
       LEFT JOIN property_content pc ON pc.property_id = p.id
      WHERE p.id = $1`,
    [propertyId, RATES_TAX_INCLUSIVE_DOC_ID],
  );
  const row = rows[0] as ReadinessRow | undefined;
  const missing = new Set<ReadinessItem>();

  if (!row) return { ready: false, missing: [...READINESS_ITEMS].filter((i) => i !== "stripe_charges" && i !== "vat_id_verified") };

  if (!row.stripe_account_id) {
    missing.add("stripe_account");
  } else if (opts.chargesEnabled) {
    const enabled = await opts.chargesEnabled(row.stripe_account_id).catch(() => false);
    if (!enabled) missing.add("stripe_charges");
  }

  if (!row.rates_confirmed) missing.add("rates_confirmed");
  if (!row.legal_ok) missing.add("legal_details");

  const profile = row.organization_id ? await getBillingProfile(db, row.organization_id) : null;
  if (missingProfileFields(profile).length > 0) {
    missing.add("billing_profile");
  } else {
    try {
      if (vatTreatmentFor(profile!.countryCode!) === "EU_REVERSE_CHARGE" && profile!.vatIdValid !== true) {
        missing.add("vat_id_verified");
      }
    } catch {
      missing.add("billing_profile");
    }
  }

  const ordered = READINESS_ITEMS.filter((i) => missing.has(i));
  return { ready: ordered.length === 0, missing: ordered };
}
