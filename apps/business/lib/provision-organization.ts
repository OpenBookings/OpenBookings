import type { PoolClient } from "pg";
import type {
  CoreInfoTextData,
  CoreInfoLocationData,
  LegalNBoringData,
} from "@/app/(onboarding)/onboarding/actions";

/**
 * Org provisioning (handoff task 9). One transactional function, called on
 * host signup completion — not spread across the 4-step onboarding — so an
 * abandoned onboarding leaves zero org rows and a failed one rolls back
 * completely.
 *
 * Rate-plan scaffolding is deliberately absent: rate_plans are room-scoped
 * (schema), and a draft property has no rooms yet. The default rate plan is
 * created with the first room instead.
 */

/** Slugs that can never become org slugs (route/subdomain collisions). */
export const RESERVED_ORG_SLUGS = new Set([
  "admin",
  "api",
  "support",
  "www",
  "business",
  "app",
]);

export function slugifyOrgName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug || RESERVED_ORG_SLUGS.has(slug)) return slug ? `${slug}-org` : "org";
  return slug;
}

export type ProvisionInput = {
  userId: string;
  legal: LegalNBoringData;
  coreText: CoreInfoTextData | undefined;
  location: CoreInfoLocationData | undefined;
  stripeAccountId: string | null;
};

export type ProvisionResult = {
  organizationId: string;
  slug: string;
  propertyId: string | null;
  alreadyProvisioned: boolean;
};

/**
 * Runs inside the caller's transaction (`withTransaction` from
 * @openbookings/db). Idempotent per user: if the user already owns an org,
 * returns it untouched, so a retried completeOnboarding never creates a
 * second org.
 */
export async function provisionOrganizationTx(
  client: PoolClient,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  // Serialize concurrent completions for the same user (double-submit).
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    `provision-org:${input.userId}`,
  ]);

  const existing = await client.query<{ organizationId: string; slug: string }>(
    `SELECT m."organizationId", o.slug
     FROM "member" m JOIN "organization" o ON o.id = m."organizationId"
     WHERE m."userId" = $1 AND m.role = 'owner'`,
    [input.userId],
  );
  if (existing.rows[0]) {
    return {
      organizationId: existing.rows[0].organizationId,
      slug: existing.rows[0].slug,
      propertyId: null,
      alreadyProvisioned: true,
    };
  }

  const orgName = input.legal.legalCompanyName.trim();
  if (!orgName) throw new Error("Legal company name is required to provision an organization");

  // 1. Organization + unique slug.
  const base = slugifyOrgName(orgName);
  let slug = base;
  for (let attempt = 2; ; attempt++) {
    const taken = await client.query(
      `SELECT 1 FROM "organization" WHERE slug = $1`,
      [slug],
    );
    if (taken.rowCount === 0) break;
    slug = `${base}-${attempt}`;
  }
  const org = await client.query<{ id: string }>(
    `INSERT INTO "organization" (id, name, slug, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, NOW())
     RETURNING id`,
    [orgName, slug],
  );
  const organizationId = org.rows[0]!.id;

  // 2. Legal/financial profile — typed columns, not plugin metadata JSON.
  await client.query(
    `INSERT INTO org_profile
       (organization_id, legal_entity_name, kvk_number, vat_number, stripe_account_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      organizationId,
      orgName,
      input.legal.cocNumber ?? null,
      input.legal.vatNumber || null,
      input.stripeAccountId,
    ],
  );

  // 3. Owner membership.
  await client.query(
    `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'owner', NOW())`,
    [organizationId, input.userId],
  );

  // 4. Draft property from the onboarding core-info steps. Dual-written
  // with owner_user_id while repositories still authorize on it (task 11).
  let propertyId: string | null = null;
  if (input.coreText && input.location) {
    const [lng, lat] = input.location.coordinates ?? [0, 0];
    const property = await client.query<{ id: string }>(
      `INSERT INTO properties
         (name, slug, subtitle, address_line_1, city, country, timezone,
          location, check_in_time, check_out_time, stripe_account_id,
          is_active, owner_user_id, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
               '15:00', '11:00', $10, FALSE, $11, $12)
       RETURNING id`,
      [
        input.coreText.displayName,
        `${slug}-${Date.now().toString(36)}`,
        input.coreText.tagline || null,
        input.location.streetAddress,
        input.location.city,
        (input.location.country || "NL").slice(0, 2).toUpperCase(),
        "Europe/Amsterdam",
        lng,
        lat,
        input.stripeAccountId,
        input.userId,
        organizationId,
      ],
    );
    propertyId = property.rows[0]!.id;
  }

  // 5. Host Agreement + DPA consent rows from the signed legal step.
  for (const [docId, signature] of [
    ["partner-agreement", input.legal.partnerAgreement],
    ["dpa", input.legal.dpa],
  ] as const) {
    if (!signature) continue;
    await client.query(
      `INSERT INTO org_consent
         (organization_id, doc_id, signed_by_user_id, signer_full_name,
          signer_role_title, signer_ip, signed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        organizationId,
        docId,
        input.userId,
        input.legal.fullName,
        input.legal.roleTitle || null,
        signature.signerIp,
        signature.signedAt,
      ],
    );
  }

  // 6. Audit event.
  await client.query(
    `INSERT INTO audit_log (action, actor_user_id, organization_id, detail)
     VALUES ('org.provisioned', $1, $2, $3)`,
    [
      input.userId,
      organizationId,
      JSON.stringify({ slug, propertyId, stripeAccountId: input.stripeAccountId }),
    ],
  );

  // 7. Point the user's live sessions at the new org so activeOrganizationId
  // resolves immediately (task 11: org id comes from the session, never from
  // client input).
  await client.query(
    `UPDATE "session" SET "activeOrganizationId" = $1 WHERE "userId" = $2`,
    [organizationId, input.userId],
  );

  return { organizationId, slug, propertyId, alreadyProvisioned: false };
}
