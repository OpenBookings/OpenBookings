import { query, type Queryable } from "@openbookings/db";
import { vatTreatmentFor, type VatTreatment } from "./vat";

const globalDb: Queryable = {
  query: async (text, values) => ({ rows: await query(text, values) }),
};

/**
 * The VAT treatment of the commission invoices for a property, from the
 * billing profile of the organization that owns it. `null` when the
 * organization has no profile yet or no country on it; there is no fallback to
 * the property's own country. A non-EU country throws `NonEuCountryError`.
 * Pass `db` to read inside a transaction.
 */
export async function billingTreatmentForProperty(
  propertyId: string,
  db: Queryable = globalDb,
): Promise<VatTreatment | null> {
  const { rows } = await db.query(
    `SELECT bp.country_code
       FROM properties p
       JOIN billing_profiles bp ON bp.organization_id = p.organization_id
      WHERE p.id = $1`,
    [propertyId],
  );
  const country = (rows[0] as { country_code: string | null } | undefined)?.country_code;
  return country ? vatTreatmentFor(country) : null;
}
