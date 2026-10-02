import { queryOne as dbQueryOne } from "@openbookings/db";
import type { AuthzDeps, SessionLike } from "./index";

/**
 * Inclusive-rates confirmation.
 *
 * OpenBookings shows the price a host enters as the full price the guest
 * pays, and adds no tax on top. That is only honest if the host has said, on
 * record, that their rates include tax. The record is one `org_consent` row
 * per organisation under this document id; these predicates are the single
 * place that reads it, for the price-writing actions and for guest checkout.
 *
 * The id is dated. Changing the statement's wording means a new id, and every
 * organisation confirms again.
 *
 * All checks fail closed: an unknown id, or a property with no organisation,
 * is "not confirmed".
 */
export const RATES_TAX_INCLUSIVE_DOC_ID = "rates-tax-inclusive@2026-10-02";

/** The statement an organisation confirms. Shown verbatim wherever it is asked. */
export const RATES_TAX_INCLUSIVE_STATEMENT =
  "All rates I enter on OpenBookings include tourist tax, VAT and any mandatory fees. The price I enter is the full price the guest pays. Collecting and remitting those taxes is my responsibility.";

const CONFIRMED_SQL = `EXISTS (
  SELECT 1 FROM org_consent oc
  WHERE oc.organization_id = p.organization_id AND oc.doc_id = $2
) AS confirmed`;

async function confirmed(text: string, id: string, deps: AuthzDeps): Promise<boolean> {
  if (!id) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ confirmed: boolean }>(text, [id, RATES_TAX_INCLUSIVE_DOC_ID]);
  return row?.confirmed === true;
}

export function propertyRatesConfirmed(propertyId: string, deps: AuthzDeps = {}): Promise<boolean> {
  return confirmed(`SELECT ${CONFIRMED_SQL} FROM properties p WHERE p.id = $1`, propertyId, deps);
}

export function roomRatesConfirmed(roomId: string, deps: AuthzDeps = {}): Promise<boolean> {
  return confirmed(
    `SELECT ${CONFIRMED_SQL}
     FROM rooms r
     JOIN properties p ON p.id = r.property_id
     WHERE r.id = $1`,
    roomId,
    deps,
  );
}

export function ratePlanRatesConfirmed(ratePlanId: string, deps: AuthzDeps = {}): Promise<boolean> {
  return confirmed(
    `SELECT ${CONFIRMED_SQL}
     FROM rate_plans rp
     JOIN rooms r      ON r.id = rp.room_id
     JOIN properties p ON p.id = r.property_id
     WHERE rp.id = $1`,
    ratePlanId,
    deps,
  );
}

/**
 * Confirming speaks for the whole organisation, so it is for owners and
 * admins only — not for a manager scoped to one property.
 */
export async function userCanConfirmRates(
  session: SessionLike | null | undefined,
  propertyId: string,
  deps: AuthzDeps = {},
): Promise<boolean> {
  const userId = session?.user?.id;
  if (!userId || !propertyId) return false;
  const queryOne = deps.queryOne ?? dbQueryOne;
  const row = await queryOne<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM properties p
     JOIN "member" m ON m."organizationId" = p.organization_id
     WHERE p.id = $1 AND m."userId" = $2 AND m.role IN ('owner', 'admin')`,
    [propertyId, userId],
  );
  return row?.ok === true;
}
