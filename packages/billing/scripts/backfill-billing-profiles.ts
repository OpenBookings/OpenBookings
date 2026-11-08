/**
 * Pre-fills billing profiles for organizations that already have properties.
 *
 * Sources: org_profile (legal name, KvK, VAT number) and the connected Stripe
 * account (company address, support email, country). A field the profile
 * already has is never overwritten. Reverse-charge VAT ids (any EU country but
 * NL) are checked against VIES when VIES_REQUESTER_VAT is set. Prints, per
 * organization, what is still missing.
 *
 * Dry run by default: reads, prints, writes nothing. Pass --write to save.
 *
 * Run: bun --env-file=../../.env.local packages/billing/scripts/backfill-billing-profiles.ts [--write]
 * Needs DATABASE_URL, STRIPE_SECRET_KEY and (for VIES) VIES_REQUESTER_VAT (e.g. NL123456789B01).
 */
import { Pool } from "pg";
import { retrieveConnectAccount } from "@openbookings/stripe";
import { mergeProfileSources, type StripeAccountSource } from "../src/profile-backfill";
import {
  getBillingProfile,
  missingProfileFields,
  recordViesResult,
  upsertBillingProfile,
  type BillingProfile,
} from "../src/profiles";
import { checkVatId } from "../src/vies";

const write = process.argv.includes("--write");
const requesterVat = process.env.VIES_REQUESTER_VAT?.replace(/[\s.\-]/g, "").toUpperCase();
const requester = requesterVat?.startsWith("NL") ? { countryCode: "NL" as const, vatNumber: requesterVat.slice(2) } : null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type OrgRow = {
  id: string;
  name: string;
  legal_entity_name: string | null;
  kvk_number: string | null;
  vat_number: string | null;
  stripe_account_id: string | null;
};

try {
  const { rows } = await pool.query<OrgRow>(
    `SELECT o.id, o.name, op.legal_entity_name, op.kvk_number, op.vat_number, op.stripe_account_id
       FROM "organization" o
       LEFT JOIN org_profile op ON op.organization_id = o.id
      WHERE EXISTS (SELECT 1 FROM properties p WHERE p.organization_id = o.id)
      ORDER BY o.name`,
  );
  console.log(`${write ? "WRITE" : "DRY RUN"}: ${rows.length} organizations with a property\n`);

  const table: { organization: string; filled: string; vies: string; missing: string }[] = [];
  for (const org of rows) {
    const existing = await getBillingProfile(pool, org.id);

    let account: StripeAccountSource | null = null;
    if (org.stripe_account_id) {
      try {
        account = await retrieveConnectAccount(org.stripe_account_id);
      } catch (err) {
        console.warn(`${org.name}: could not read Stripe account (${err instanceof Error ? err.message : err})`);
      }
    }

    const patch = mergeProfileSources(
      existing,
      { legalEntityName: org.legal_entity_name, kvkNumber: org.kvk_number, vatNumber: org.vat_number },
      account,
    );
    let profile: BillingProfile | null = existing;
    if (Object.keys(patch).length > 0) {
      if (write) profile = await upsertBillingProfile(pool, org.id, patch);
      else profile = { ...(existing ?? emptyProfile(org.id)), ...patch };
    }

    let vies = "-";
    const vatId = profile?.vatId;
    const country = profile?.countryCode;
    if (vatId && country && country !== "NL" && profile?.vatIdValid === null) {
      if (!requester) {
        vies = "skipped (VIES_REQUESTER_VAT not set)";
      } else {
        try {
          const result = await checkVatId(vatId, { requester });
          vies = result.valid ? "valid" : "INVALID";
          if (write) await recordViesResult(pool, org.id, result);
        } catch (err) {
          vies = `unavailable (${err instanceof Error ? err.message : err})`;
        }
      }
    } else if (profile?.vatIdValid != null) {
      vies = profile.vatIdValid ? "valid (earlier)" : "INVALID (earlier)";
    }

    table.push({
      organization: org.name,
      filled: Object.keys(patch).join(", ") || "-",
      vies,
      missing: missingProfileFields(profile).join(", ") || "complete",
    });
  }
  console.table(table);
  if (!write) console.log("\nNothing was written. Re-run with --write to save.");
} finally {
  await pool.end();
}

function emptyProfile(organizationId: string): BillingProfile {
  return {
    organizationId,
    legalName: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    countryCode: null,
    vatId: null,
    kvkNumber: null,
    vatIdCheckedAt: null,
    vatIdValid: null,
    viesRequestId: null,
    billingEmail: null,
    updatedAt: new Date(),
  };
}
