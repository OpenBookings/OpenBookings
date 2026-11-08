import { query, type Queryable } from "@openbookings/db";
import { vatTreatmentFor, type VatTreatment } from "./vat";
import type { ViesResult } from "./vies";

const globalDb: Queryable = {
  query: async (text, values) => ({ rows: await query(text, values) }),
};

/** The legal details of the buyer on an organization's commission invoices. */
export type BillingProfile = {
  organizationId: string;
  legalName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  vatId: string | null;
  kvkNumber: string | null;
  vatIdCheckedAt: Date | null;
  vatIdValid: boolean | null;
  viesRequestId: string | null;
  billingEmail: string | null;
  updatedAt: Date;
};

/** The fields a host edits. Anything left out of an upsert stays as it was. */
export type BillingProfileFields = Partial<
  Pick<
    BillingProfile,
    | "legalName"
    | "addressLine1"
    | "addressLine2"
    | "postalCode"
    | "city"
    | "countryCode"
    | "vatId"
    | "kvkNumber"
    | "billingEmail"
  >
>;

const COLUMNS: Record<keyof BillingProfileFields, string> = {
  legalName: "legal_name",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  postalCode: "postal_code",
  city: "city",
  countryCode: "country_code",
  vatId: "vat_id",
  kvkNumber: "kvk_number",
  billingEmail: "billing_email",
};

const REQUIRED_FIELDS = [
  "legalName",
  "addressLine1",
  "postalCode",
  "city",
  "countryCode",
  "vatId",
  "billingEmail",
] as const satisfies readonly (keyof BillingProfileFields)[];

type ProfileRow = {
  organization_id: string;
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  vat_id: string | null;
  kvk_number: string | null;
  vat_id_checked_at: Date | null;
  vat_id_valid: boolean | null;
  vies_request_id: string | null;
  billing_email: string | null;
  updated_at: Date;
};

function toProfile(r: ProfileRow): BillingProfile {
  return {
    organizationId: r.organization_id,
    legalName: r.legal_name,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    postalCode: r.postal_code,
    city: r.city,
    countryCode: r.country_code,
    vatId: r.vat_id,
    kvkNumber: r.kvk_number,
    vatIdCheckedAt: r.vat_id_checked_at,
    vatIdValid: r.vat_id_valid,
    viesRequestId: r.vies_request_id,
    billingEmail: r.billing_email,
    updatedAt: r.updated_at,
  };
}

/** A VAT id without spaces, dots or dashes, in upper case. */
export function compactVatId(vatId: string): string {
  return vatId.replace(/[\s.\-]/g, "").toUpperCase();
}

/** The billing profile of an organization, or `null` when it has none yet. */
export async function getBillingProfile(db: Queryable, organizationId: string): Promise<BillingProfile | null> {
  const { rows } = await db.query(`SELECT * FROM billing_profiles WHERE organization_id = $1`, [organizationId]);
  const row = rows[0] as ProfileRow | undefined;
  return row ? toProfile(row) : null;
}

/**
 * Creates or updates an organization's billing profile. Only the fields given
 * change. The country is stored upper case and the VAT id in compact form.
 * When the VAT id or the country actually changes, the earlier VIES result no
 * longer applies and is cleared. Returns the saved profile.
 */
export async function upsertBillingProfile(
  db: Queryable,
  organizationId: string,
  fields: BillingProfileFields,
): Promise<BillingProfile> {
  const cols: string[] = [];
  const values: unknown[] = [organizationId];
  const sets: string[] = [];
  const changed: string[] = [];

  for (const key of Object.keys(COLUMNS) as (keyof BillingProfileFields)[]) {
    let value = fields[key];
    if (value === undefined) continue;
    if (typeof value === "string" && key === "countryCode") value = value.trim().toUpperCase();
    if (typeof value === "string" && key === "vatId") value = compactVatId(value);
    const col = COLUMNS[key];
    values.push(value);
    cols.push(col);
    sets.push(`${col} = EXCLUDED.${col}`);
    if (key === "vatId" || key === "countryCode") {
      changed.push(`EXCLUDED.${col} IS DISTINCT FROM billing_profiles.${col}`);
    }
  }
  if (changed.length) {
    const cond = changed.join(" OR ");
    for (const col of ["vat_id_checked_at", "vat_id_valid", "vies_request_id"]) {
      sets.push(`${col} = CASE WHEN ${cond} THEN NULL ELSE billing_profiles.${col} END`);
    }
  }
  sets.push("updated_at = now()");

  const { rows } = await db.query(
    `INSERT INTO billing_profiles (organization_id${cols.map((c) => `, ${c}`).join("")})
     VALUES ($1${cols.map((_, i) => `, $${i + 2}`).join("")})
     ON CONFLICT (organization_id) DO UPDATE SET ${sets.join(", ")}
     RETURNING *`,
    values,
  );
  return toProfile(rows[0] as ProfileRow);
}

/** Stores the outcome of a VIES check on the profile (the VAT id it was run for is the one on the profile now). */
export async function recordViesResult(db: Queryable, organizationId: string, r: ViesResult): Promise<void> {
  await db.query(
    `UPDATE billing_profiles
        SET vat_id_valid = $2, vies_request_id = $3, vat_id_checked_at = $4, updated_at = now()
      WHERE organization_id = $1`,
    [organizationId, r.valid, r.requestId, r.checkedAt],
  );
}

/**
 * The required fields a profile still lacks (blank counts as lacking), in
 * form order. A missing profile lacks all of them.
 */
export function missingProfileFields(p: BillingProfile | null): string[] {
  return REQUIRED_FIELDS.filter((f) => !p?.[f]?.trim());
}

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
