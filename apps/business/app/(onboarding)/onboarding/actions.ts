"use server";

import { getServerSession } from "@/lib/auth";
import { query, queryOne, withTransaction } from "@openbookings/db";
import { DEMO_ORG_ID } from "@openbookings/mode";
import { headers } from "next/headers";
import { CONNECT_OWNER_METADATA_KEY, createConnectAccount, retrieveConnectAccount } from "@openbookings/stripe";
import { provisionOrganizationTx } from "@/lib/provision-organization";
import { completionPrecheck } from "@/lib/onboarding-completion";
import { isStripeAccountReady } from "@/lib/stripe-readiness";
import { promoteOnboardingToProperty } from "./promotion";
import { summariseStripeAccount } from "./_lib/status";
import { euPropertyCountry, parseClientStepData } from "./_lib/step-data";
import { HOST_AGREEMENT_DOC_ID, hostAgreementUrl } from "@openbookings/authz/host-agreement";
import {
  decideHostAgreementSignature,
  isCurrentHostAgreement,
  type LegalSignatureRecord,
  type SignerDetails,
} from "./_lib/host-agreement";

interface LegalAttemptRecord {
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
  /** Acceptance of the Host Agreement, with the version accepted (see _lib/host-agreement.ts). */
  hostAgreement?: LegalSignatureRecord;
  /**
   * Legacy: clicks on the unversioned "Partner Agreement" button, which showed
   * no text. Kept as history; they do not count as accepting the Host Agreement.
   */
  partnerAgreement?: LegalSignatureRecord;
  /** Legacy: never asked for in the UI. The DPA is part of the Host Agreement. */
  dpa?: LegalSignatureRecord;
  /**
   * Confirmation that the host's rates include VAT, with tourist tax added on top (see
   * RATES_TAX_INCLUSIVE_STATEMENT). Becomes an org_consent row when the
   * organisation is provisioned.
   */
  ratesInclusive?: LegalSignatureRecord;
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

/**
 * Write one step's data and mark it complete. Server-internal: callers pass a
 * step and a value the server itself produced. Not exported, so it is not a
 * server action.
 */
async function persistStepData(userId: string, step: DbStep, data: unknown): Promise<void> {
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

/**
 * Persist step data from the onboarding forms and mark the step complete.
 *
 * Callable straight from the browser, so `step` and `data` are untrusted: only
 * the steps the forms save are accepted, parsed to exactly their fields (see
 * _lib/step-data.ts for why — `step` becomes a key in the same JSON that holds
 * the Stripe payout account and the signed legal records).
 */
export async function saveStepData(step: DbStep, data: unknown): Promise<void> {
  const session = await getSession();
  const clean = parseClientStepData(step, data);
  if (clean === null) throw new Error("Invalid onboarding data");
  await persistStepData(session.user.id, step, clean);
}

/** Server-side write of legal data the server built (signatures, resets). */
async function saveLegalData(data: LegalNBoringData): Promise<void> {
  const session = await getSession();
  await persistStepData(session.user.id, "legal-n-boring", data);
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

export type SignHostAgreementResult =
  | { ok: true; signedAt: string; alreadySigned: boolean }
  | { ok: false; error: string };

/**
 * Record that the host accepted the current Host Agreement. Captures the
 * signer's IP server-side and stores the version and where its text was
 * published.
 *
 * Final per version: once this version is accepted, calling again changes
 * nothing (not the date, the IP or the signer details) and returns the
 * original record. Accepting a newer version later is a new record.
 *
 * Refused when there is no text to link (a malformed HOST_AGREEMENT_URL):
 * accepting an agreement nobody can read is no agreement.
 */
export async function signHostAgreement(signer: SignerDetails): Promise<SignHostAgreementResult> {
  const session = await getSession();
  const hdrs = await headers();

  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";

  const existing = await loadStepData();
  const legal = existing["legal-n-boring"] ?? ({} as LegalNBoringData);

  // Posted by the browser, so typed only by hope.
  const details: SignerDetails = {
    legalCompanyName: String(signer?.legalCompanyName ?? "").trim().slice(0, 200),
    fullName: String(signer?.fullName ?? "").trim().slice(0, 200),
    roleTitle: String(signer?.roleTitle ?? "").trim().slice(0, 200),
    vatNumber: String(signer?.vatNumber ?? "").trim().slice(0, 50),
    ...(signer?.cocNumber ? { cocNumber: String(signer.cocNumber).trim().slice(0, 50) } : {}),
  };

  const decision = decideHostAgreementSignature(legal, {
    signer: details,
    ip,
    now: new Date(),
    documentUrl: hostAgreementUrl(),
  });

  if (
    decision.kind === "sign" &&
    !(details.legalCompanyName && details.fullName && details.roleTitle && details.vatNumber)
  ) {
    return { ok: false, error: "Fill in your company name, full name, role and VAT number first." };
  }
  if (decision.kind === "unavailable") {
    return { ok: false, error: "The Host Agreement is not published yet, so it cannot be accepted." };
  }
  if (decision.kind === "already-signed") {
    return { ok: true, signedAt: decision.record.signedAt, alreadySigned: true };
  }

  // The read above and this write are not one transaction. The WHERE makes the
  // write itself refuse to replace an acceptance of this version that landed
  // in between (a double click from two tabs).
  const written = await query(
    `INSERT INTO host_onboarding (user_id, completed_steps, step_data)
     VALUES ($1, ARRAY['legal-n-boring'::text], $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       completed_steps = (
         SELECT array_agg(DISTINCT elem ORDER BY elem)
         FROM unnest(array_append(host_onboarding.completed_steps, 'legal-n-boring'::text)) AS elem
       ),
       step_data = host_onboarding.step_data || $2::jsonb
     WHERE host_onboarding.step_data #>> '{legal-n-boring,hostAgreement,docId}' IS DISTINCT FROM $3
     RETURNING user_id`,
    [session.user.id, JSON.stringify({ "legal-n-boring": decision.data }), HOST_AGREEMENT_DOC_ID],
  );
  if (written.length === 0) {
    const now = (await loadStepData())["legal-n-boring"]?.hostAgreement;
    return { ok: true, signedAt: now?.signedAt ?? decision.record.signedAt, alreadySigned: true };
  }

  return { ok: true, signedAt: decision.record.signedAt, alreadySigned: false };
}

/**
 * Record (or withdraw) the host's confirmation that their rates include tax.
 * Captured like a signature, with time and IP, because guests are told the
 * price includes tax on the strength of it.
 */
export async function setInclusiveRatesConfirmation(confirmed: boolean): Promise<void> {
  await getSession();
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";

  const existing = await loadStepData();
  const legal = { ...(existing["legal-n-boring"] ?? ({} as LegalNBoringData)) };
  delete legal.ratesInclusive;

  await saveLegalData({
    ...legal,
    ...(confirmed && { ratesInclusive: { signedAt: new Date().toISOString(), signerIp: ip } }),
  });
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

  // The country decides which regulator the account sits under and cannot be
  // changed afterwards, so it is never defaulted.
  if (!location.country) throw new Error("Property country is missing");
  const country = euPropertyCountry(location.country);
  if (!country) throw new Error("OpenBookings is only for properties in the EU");

  const accountId = await createConnectAccount({
    email: session.user.email,
    legalCompanyName: legal.legalCompanyName,
    country,
    userId,
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
 *
 * This is the only place onboarding is marked complete
 * (`org_profile.onboarding_completed_at`), so it checks for itself what the
 * verify step checks in the browser: the Stripe account must be ready.
 */
export async function completeOnboarding(): Promise<void> {
  const session = await getSession();
  const userId = session.user.id;
  const stepData = await loadStepData();
  const legal = stepData["legal-n-boring"];
  if (!legal) throw new Error("Legal step data is missing");
  if (!isCurrentHostAgreement(legal.hostAgreement)) {
    throw new Error("The current Host Agreement has not been accepted");
  }

  const stripeAccountId =
    (stepData as { stripe_account_id?: string }).stripe_account_id ?? null;
  const completedOrg = stripeAccountId
    ? await queryOne<{ caller_is_member: boolean }>(
        `SELECT EXISTS (
                  SELECT 1 FROM "member" m
                  WHERE m."organizationId" = op.organization_id AND m."userId" = $2
                ) AS caller_is_member
         FROM org_profile op
         WHERE op.stripe_account_id = $1 AND op.onboarding_completed_at IS NOT NULL
         ORDER BY caller_is_member DESC
         LIMIT 1`,
        [stripeAccountId, userId],
      )
    : null;

  const precheck = completionPrecheck({
    stripeAccountId,
    completedOrg: completedOrg && { callerIsMember: completedOrg.caller_is_member },
  });
  if (precheck === "already-complete") return;
  if (precheck === "no-account") throw new Error("Stripe account is missing");
  if (precheck === "account-taken") {
    throw new Error("This Stripe account belongs to an organisation you are no longer part of");
  }

  const stripeAccount = await retrieveConnectAccount(stripeAccountId!);
  // An account we created is stamped with the user it was created for. One
  // stamped for somebody else must not become this host's payout destination,
  // however its id got into step_data. (Accounts from before the stamp existed
  // carry none and cannot be checked.)
  const boundTo = stripeAccount.metadata?.[CONNECT_OWNER_METADATA_KEY];
  if (boundTo && boundTo !== userId) throw new Error("Stripe account belongs to a different user");
  const account = summariseStripeAccount(stripeAccount);
  if (!isStripeAccountReady(account)) throw new Error("Stripe account is not ready yet");

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
      stripeAccountId,
    });
    if (organizationId === DEMO_ORG_ID) {
      throw new Error("Refusing to complete onboarding into the demo organisation");
    }

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

    // The completion flag the wall reads. Set on the organisation returned
    // above, whether it was just created or already existed.
    await client.query(
      `UPDATE org_profile SET onboarding_completed_at = NOW()
        WHERE organization_id = $1 AND onboarding_completed_at IS NULL`,
      [organizationId],
    );

    // Transition dual-write: keeps a rollback to the previous code (which
    // gates on this column) working. Removed with migration 0021.
    await client.query(
      `UPDATE host_onboarding SET onboarding_completed_at = NOW() WHERE user_id = $1`,
      [userId],
    );
  });
}
