/**
 * The one organisation that owns every generated demo hotel. In testing mode
 * every host who signs in to the business app becomes its owner (see
 * membership.ts), so the tester sees the demo hotels and their bookings.
 * Outside testing mode the app ignores it, whatever rows are left over. It
 * exists so demo properties look like any other on the booking path.
 *
 * Checkout only sells a property whose organisation confirmed that its rates
 * include VAT (an `org_consent` row for RATES_TAX_INCLUSIVE_DOC_ID), so the
 * demo organisation carries that confirmation, signed by the system.
 *
 * The same goes for the readiness gate (spec decision 9): the organisation
 * carries a placeholder Stripe account and a complete Dutch billing profile,
 * and every demo hotel carries legal details (see `insertDemoProperty`), so
 * demo hotels pass the gate honestly rather than around it.
 */

import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import type { Queryable } from "@openbookings/db";
import { DEMO_ORG_ID } from "@openbookings/mode";

export { DEMO_ORG_ID };

const DEMO_ORG_NAME = "OpenBookings Demo";
const DEMO_ORG_SLUG = "openbookings-demo";
/** org_consent.signed_by_user_id has no foreign key; no real user signed this. */
const SYSTEM_SIGNER_ID = "demo";
/** Stands in for a connected account; checkout takes the real one from the environment in testing mode. */
const DEMO_STRIPE_ACCOUNT_ID = "acct_demo";
/** Legal details of the demo organisation, also copied onto every demo hotel. */
export const DEMO_LEGAL_COMPANY_NAME = "OpenBookings Demo B.V.";
export const DEMO_VAT_NUMBER = "NL000000000B01";

/**
 * Creates the organisation, its profile and its rates confirmation, each only
 * if missing. Idempotent. Run it inside a transaction: the advisory lock then
 * keeps two concurrent callers from both adding the consent row.
 */
export async function ensureDemoOrganisation(db: Queryable): Promise<string> {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('demo:organisation'))`);
  await db.query(
    `INSERT INTO "organization" (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_ORG_SLUG],
  );
  await db.query(
    `INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO UPDATE
       SET stripe_account_id = COALESCE(org_profile.stripe_account_id, EXCLUDED.stripe_account_id)`,
    [DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_STRIPE_ACCOUNT_ID],
  );
  await db.query(
    `INSERT INTO billing_profiles
       (organization_id, legal_name, address_line1, postal_code, city, country_code, vat_id, billing_email)
     VALUES ($1, $2, 'Demostraat 1', '1011 AA', 'Amsterdam', 'NL', $3, 'billing@demo.openbookings.test')
     ON CONFLICT (organization_id) DO NOTHING`,
    [DEMO_ORG_ID, DEMO_LEGAL_COMPANY_NAME, DEMO_VAT_NUMBER],
  );
  await db.query(
    `INSERT INTO org_consent (organization_id, doc_id, signed_by_user_id, signer_full_name, signed_at)
     SELECT $1, $2, $3, $4, NOW()
     WHERE NOT EXISTS (SELECT 1 FROM org_consent WHERE organization_id = $1 AND doc_id = $2)`,
    [DEMO_ORG_ID, RATES_TAX_INCLUSIVE_DOC_ID, SYSTEM_SIGNER_ID, DEMO_ORG_NAME],
  );
  return DEMO_ORG_ID;
}
