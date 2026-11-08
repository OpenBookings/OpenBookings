import type { Queryable } from "@openbookings/db";
import type { Period } from "../period";
import { getBillingProfile, missingProfileFields, recordViesResult, type BillingProfile } from "../profiles";
import { NonEuCountryError, vatTreatmentFor, type VatTreatment } from "../vat";
import { ViesUnavailableError, type checkVatId, type ViesDeps } from "../vies";
import type { Blocker } from "./types";

/** A VIES answer older than this is asked again before invoicing. */
const VIES_MAX_AGE_MS = 30 * 86_400_000;

export type EligibilityDeps = {
  db: Queryable;
  /** `checkVatId`, or a stand-in in tests. */
  vies: typeof checkVatId;
  /** What `vies` is called with: OpenBookings' own VAT number as the requester. */
  viesDeps: ViesDeps;
  now: () => Date;
  /** Ask VIES but store nothing. */
  dryRun?: boolean;
};

/**
 * Splits the hosts with entries to invoice for the month into those that can
 * be invoiced and those that are blocked, with every reason (spec, the job,
 * step 3). A host is blocked when its billing profile lacks a required field
 * (`missing_fields`, listing them), its country is outside the EU (`non_eu`),
 * its un-invoiced booked entries of the month carry more than one VAT
 * treatment or one that is not its profile's (`mixed_vat_treatment`), or, for
 * reverse charge, VIES says its VAT id is invalid (`vies_invalid`) or cannot
 * answer (`vies_unavailable`). VIES is asked again only when the profile's
 * last check is missing or older than 30 days; the answer is stored on the
 * profile (except in a dry run). An NL host needs no VIES check. Hosts keep
 * the order given.
 */
export async function checkEligibility(
  entityIds: string[],
  period: Period,
  deps: EligibilityDeps,
): Promise<{ eligible: string[]; blocked: Blocker[] }> {
  const eligible: string[] = [];
  const blocked: Blocker[] = [];
  for (const entityId of entityIds) {
    const blocker = await blockerFor(entityId, period, deps);
    if (blocker) blocked.push(blocker);
    else eligible.push(entityId);
  }
  return { eligible, blocked };
}

async function blockerFor(entityId: string, period: Period, deps: EligibilityDeps): Promise<Blocker | null> {
  const reasons: Blocker["reasons"] = [];
  const profile = await getBillingProfile(deps.db, entityId);

  const missing = missingProfileFields(profile);
  if (missing.length) reasons.push("missing_fields");

  let treatment: VatTreatment | null = null;
  if (profile?.countryCode?.trim()) {
    try {
      treatment = vatTreatmentFor(profile.countryCode);
    } catch (error) {
      if (!(error instanceof NonEuCountryError)) throw error;
      reasons.push("non_eu");
    }
  }

  const entryTreatments = await treatmentsInPeriod(deps.db, entityId, period);
  if (entryTreatments.length > 1 || (treatment && entryTreatments.some((t) => t !== treatment))) {
    reasons.push("mixed_vat_treatment");
  }

  if (treatment === "EU_REVERSE_CHARGE" && profile?.vatId?.trim()) {
    const vies = await viesStatus(profile, deps);
    if (vies !== "valid") reasons.push(vies);
  }

  if (!reasons.length) return null;
  return missing.length ? { entityId, reasons, missing } : { entityId, reasons };
}

/** The VAT treatments on the host's un-invoiced booked entries of the month. */
async function treatmentsInPeriod(db: Queryable, entityId: string, period: Period): Promise<VatTreatment[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT vat_treatment
       FROM commission_entries
      WHERE billing_entity_id = $1 AND disposition = 'booked' AND invoice_id IS NULL
        AND occurred_at >= $2 AND occurred_at < $3
      ORDER BY vat_treatment`,
    [entityId, period.from, period.to],
  );
  return (rows as { vat_treatment: VatTreatment }[]).map((r) => r.vat_treatment);
}

/** The profile's VIES verdict, asking VIES again when the last answer is missing or older than 30 days. */
async function viesStatus(profile: BillingProfile, deps: EligibilityDeps): Promise<"valid" | "vies_invalid" | "vies_unavailable"> {
  const checkedAt = profile.vatIdCheckedAt;
  if (checkedAt && deps.now().getTime() - checkedAt.getTime() <= VIES_MAX_AGE_MS) {
    return profile.vatIdValid === true ? "valid" : "vies_invalid";
  }
  try {
    const result = await deps.vies(profile.vatId!, deps.viesDeps);
    if (!deps.dryRun) await recordViesResult(deps.db, profile.organizationId, result);
    return result.valid ? "valid" : "vies_invalid";
  } catch (error) {
    if (error instanceof ViesUnavailableError) return "vies_unavailable";
    throw error;
  }
}
