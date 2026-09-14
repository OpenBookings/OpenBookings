"use server";

import { getServerSession } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@openbookings/db";
import { headers } from "next/headers";
import { createConnectAccount } from "@openbookings/stripe";
import { provisionOrganizationTx } from "@/lib/provision-organization";
import { promoteOnboardingToProperty } from "./promotion";

export interface LegalSignatureRecord {
  signedAt: string;
  signerIp: string;
  downloadedAt?: string;
  downloadedFilename?: string;
}

export interface LegalAttemptRecord {
  resetAt: string;
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  vatNumber?: string;
  cocNumber?: string;
  partnerAgreement?: LegalSignatureRecord;
  dpa?: LegalSignatureRecord;
}

export interface LegalNBoringData {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  vatNumber: string;
  cocNumber?: string;
  partnerAgreement?: LegalSignatureRecord;
  dpa?: LegalSignatureRecord;
  previousAttempts?: LegalAttemptRecord[];
}

export interface CoreInfoTextData {
  displayName: string;
  tagline: string;
  description: string;
  houseRulesText: string;
}

export interface CoreInfoLocationData {
  streetAddress: string;
  city: string;
  country: string;
  postalCode: string;
  coordinates: [number, number] | null;
}

type StepData = {
  "core-info-text"?: CoreInfoTextData;
  "core-info-location"?: CoreInfoLocationData;
  "legal-n-boring"?: LegalNBoringData;
  [key: string]: unknown;
};

/** Keys under which step data is persisted in `host_onboarding`. Stable across URL slug renames. */
export type DbStep = "core-info-text" | "core-info-location" | "legal-n-boring";

async function getSession() {
  const session = await getServerSession();
  if (!session) throw new Error("Unauthenticated");
  return session;
}

/** Persist step data and mark the step complete. */
export async function saveStepData(step: DbStep, data: unknown): Promise<void> {
  const session = await getSession();
  const userId = session.user.id;

  await query(
    `INSERT INTO host_onboarding (user_id, completed_steps, step_data)
     VALUES ($1, ARRAY[$2::text], $3::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       completed_steps = (
         SELECT array_agg(DISTINCT elem ORDER BY elem)
         FROM unnest(
           array_append(host_onboarding.completed_steps, $2::text)
         ) AS elem
       ),
       step_data = host_onboarding.step_data || $3::jsonb`,
    [userId, step, JSON.stringify({ [step]: data })]
  );
}

/** Load all previously saved step data for the current user. */
export async function loadStepData(): Promise<StepData> {
  const session = await getSession();

  const row = await queryOne<{ step_data: StepData }>(
    `SELECT step_data FROM host_onboarding WHERE user_id = $1`,
    [session.user.id]
  );

  return row?.step_data ?? {};
}

/** Record a legal document signature. Captures the signer's IP server-side. */
export async function signLegalDocument(
  docId: "partner-agreement" | "dpa",
  signerDetails: { legalCompanyName: string; fullName: string; roleTitle: string; vatNumber: string; cocNumber?: string }
): Promise<void> {
  await getSession();
  const hdrs = await headers();

  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";

  const existing = await loadStepData();
  const legal = existing["legal-n-boring"] ?? ({} as LegalNBoringData);

  const signature = { signedAt: new Date().toISOString(), signerIp: ip };
  const updated: LegalNBoringData = {
    ...legal,
    ...signerDetails,
    ...(docId === "partner-agreement"
      ? { partnerAgreement: signature }
      : { dpa: signature }),
  };

  await saveStepData("legal-n-boring", updated);
}

/** Archive current legal data as a previous attempt and clear the active fields. */
export async function resetLegalData(): Promise<void> {
  await getSession();

  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];

  const attempt: LegalAttemptRecord = {
    resetAt: new Date().toISOString(),
    legalCompanyName: legal?.legalCompanyName ?? "",
    fullName: legal?.fullName ?? "",
    roleTitle: legal?.roleTitle ?? "",
    vatNumber: legal?.vatNumber,
    cocNumber: legal?.cocNumber,
    ...(legal?.partnerAgreement && { partnerAgreement: legal.partnerAgreement }),
    ...(legal?.dpa && { dpa: legal.dpa }),
  };

  const updated: LegalNBoringData = {
    legalCompanyName: "",
    fullName: "",
    roleTitle: "",
    vatNumber: "",
    previousAttempts: [...(legal?.previousAttempts ?? []), attempt],
  };

  await saveStepData("legal-n-boring", updated);
}

/** Create a Stripe Connect account for the host (idempotent — skips if already provisioned). */
export async function provisionStripeAccount(): Promise<string> {
  const session = await getSession();
  const userId = session.user.id;

  const existingRow = await queryOne<{ stripe_account_id: string | null }>(
    `SELECT step_data->>'stripe_account_id' AS stripe_account_id FROM host_onboarding WHERE user_id = $1`,
    [userId]
  );
  if (existingRow?.stripe_account_id) return existingRow.stripe_account_id;

  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];
  const location = stepData["core-info-location"];

  if (!legal) throw new Error("Legal step data is missing");
  if (!location) throw new Error("Location step data is missing");

  const accountId = await createConnectAccount({
    email: session.user.email,
    legalCompanyName: legal.legalCompanyName,
    fullName: legal.fullName,
    roleTitle: legal.roleTitle,
    vatNumber: legal.vatNumber,
    cocNumber: legal.cocNumber ?? "",
    city: location.city,
    country: location.country || "NL",
    postalCode: location.postalCode,
    streetAddress: location.streetAddress,
  });

  await query(
    `INSERT INTO host_onboarding (user_id, completed_steps, step_data)
     VALUES ($1, ARRAY[]::text[], jsonb_build_object('stripe_account_id', $2::text))
     ON CONFLICT (user_id) DO UPDATE SET
       step_data = host_onboarding.step_data || jsonb_build_object('stripe_account_id', $2::text)`,
    [userId, accountId]
  );

  return accountId;
}

/**
 * Mark onboarding as complete: provision the organization and materialise the
 * host's property in the same transaction, so org + profile + owner membership
 * + consent rows + audit event + property land together or not at all. An
 * abandoned or failed completion never leaves partial rows (handoff task 9).
 *
 * Property creation lives in promoteOnboardingToProperty rather than inline:
 * it handles slug collisions and country->timezone mapping, seeds
 * property_content, and is shared with the backfill script. It is given
 * transaction-bound deps so its INSERTs roll back with the org if anything
 * below fails — its ON CONFLICT DO NOTHING is deliberately written to be safe
 * inside a surrounding transaction.
 */
export async function completeOnboarding(): Promise<void> {
  const session = await getSession();
  const userId = session.user.id;
  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];
  if (!legal) throw new Error("Legal step data is missing");

  await withTransaction(async (client) => {
    const txDeps = {
      query: async <T = unknown>(text: string, values?: unknown[]) =>
        (await client.query(text, values)).rows as T[],
      queryOne: async <T = unknown>(text: string, values?: unknown[]) =>
        ((await client.query(text, values)).rows[0] ?? null) as T | null,
    };

    const { organizationId } = await provisionOrganizationTx(client, {
      userId,
      legal,
      stripeAccountId:
        (stepData as { stripe_account_id?: string }).stripe_account_id ?? null,
    });

    const result = await promoteOnboardingToProperty(
      { userId, userEmail: session.user.email, stepData },
      txDeps,
    );

    // A promotion that could not run is not a reason to trap the host in the
    // wizard — they finished it. The editor's empty state picks up from here.
    if (!result.created && result.reason !== "already-owns-property") {
      console.error("[onboarding] property promotion skipped", {
        userId,
        reason: result.reason,
      });
    }

    // promoteOnboardingToProperty predates the org model and only sets
    // owner_user_id. Link the host's properties to the org they now own;
    // scoped to NULL so a re-run never moves a property between orgs.
    await client.query(
      `UPDATE properties SET organization_id = $1
        WHERE owner_user_id = $2 AND organization_id IS NULL`,
      [organizationId, userId],
    );

    await client.query(
      `UPDATE host_onboarding SET onboarding_completed_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  });
}
