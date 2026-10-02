/**
 * Lists the properties affected by the move to tax-inclusive rates.
 *
 * Read-only. Checkout used to add `properties.tax_rate` on top of the room
 * price; it no longer does, so for a property with a non-zero rate the guest
 * total drops by that share unless the host raises their rates to include it.
 * Every organisation also has to confirm inclusive rates before its properties
 * can be booked or repriced, so the list shows who has and has not.
 *
 * Run: bun --env-file=../../.env.local packages/db/scripts/list-tax-rate-properties.ts
 *      add --all to include properties with tax_rate = 0
 */
import { Pool } from "pg";

// Keep in step with RATES_TAX_INCLUSIVE_DOC_ID in packages/authz/src/rates-doc.ts.
const DOC_ID = "rates-tax-inclusive@2026-10-02";
const all = process.argv.includes("--all");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query<{
    property: string;
    organisation: string | null;
    owner_email: string | null;
    tax_rate: string;
    active_rate_plans: string;
    is_active: boolean;
    confirmed: boolean;
  }>(
    `select p.name as property,
            o.name as organisation,
            (select u.email
               from "member" m join "user" u on u.id = m."userId"
              where m."organizationId" = p.organization_id and m.role = 'owner'
              order by m."createdAt" limit 1) as owner_email,
            p.tax_rate,
            (select count(*) from rate_plans rp join rooms r on r.id = rp.room_id
              where r.property_id = p.id and rp.is_active) as active_rate_plans,
            p.is_active,
            exists (select 1 from org_consent oc
                     where oc.organization_id = p.organization_id and oc.doc_id = $1) as confirmed
       from properties p
       left join "organization" o on o.id = p.organization_id
      where $2 or p.tax_rate > 0
      order by p.tax_rate desc, p.name`,
    [DOC_ID, all],
  );

  if (rows.length === 0) {
    console.log(all ? "No properties." : "No property has a non-zero tax_rate.");
  } else {
    console.table(
      rows.map((r) => ({
        property: r.property,
        organisation: r.organisation ?? "(none: cannot confirm)",
        owner: r.owner_email ?? "(no owner)",
        tax_rate: `${(Number(r.tax_rate) * 100).toFixed(2)}%`,
        rate_plans: Number(r.active_rate_plans),
        live: r.is_active ? "yes" : "no",
        confirmed: r.confirmed ? "yes" : "no",
      })),
    );
    console.log(`${rows.length} propert${rows.length === 1 ? "y" : "ies"}.`);
  }
} finally {
  await pool.end();
}
