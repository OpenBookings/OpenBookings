/**
 * The one organisation that owns every generated demo hotel. It has no
 * members, so no host ever sees it in the business app; it exists so demo
 * properties look like any other on the booking path.
 *
 * Checkout only sells a property whose organisation confirmed that its rates
 * include VAT (an `org_consent` row for RATES_TAX_INCLUSIVE_DOC_ID), so the
 * demo organisation carries that confirmation, signed by the system.
 */

import { RATES_TAX_INCLUSIVE_DOC_ID } from "@openbookings/authz/rates-doc";
import type { Queryable } from "@openbookings/db";

export const DEMO_ORG_ID = "demo-organisation";

const DEMO_ORG_NAME = "OpenBookings Demo";
const DEMO_ORG_SLUG = "openbookings-demo";
/** org_consent.signed_by_user_id has no foreign key; no real user signed this. */
const SYSTEM_SIGNER_ID = "demo";

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
    `INSERT INTO org_profile (organization_id, legal_entity_name)
     VALUES ($1, $2)
     ON CONFLICT (organization_id) DO NOTHING`,
    [DEMO_ORG_ID, DEMO_ORG_NAME],
  );
  await db.query(
    `INSERT INTO org_consent (organization_id, doc_id, signed_by_user_id, signer_full_name, signed_at)
     SELECT $1, $2, $3, $4, NOW()
     WHERE NOT EXISTS (SELECT 1 FROM org_consent WHERE organization_id = $1 AND doc_id = $2)`,
    [DEMO_ORG_ID, RATES_TAX_INCLUSIVE_DOC_ID, SYSTEM_SIGNER_ID, DEMO_ORG_NAME],
  );
  return DEMO_ORG_ID;
}
