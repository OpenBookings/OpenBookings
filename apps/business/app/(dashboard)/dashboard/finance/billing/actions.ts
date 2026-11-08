"use server";

import { revalidatePath } from "next/cache";
import { getOrgScopedDb } from "@openbookings/authz";
import { roleAllows } from "@openbookings/authz/permissions";
import { getBillingProfile } from "@openbookings/billing/profiles";
import { getServerSession } from "@/lib/auth";
import { billingDetailsSchema, runVatCheck, storeBillingDetails, type VatCheckOutcome } from "@/lib/billing/details";
import { billingScope } from "@/lib/billing/queries";

export type BillingFormState = {
  ok: boolean;
  message: string | null;
  fieldErrors: Record<string, string>;
  vat: VatCheckOutcome | null;
};

const BILLING_PATH = "/dashboard/finance/billing";
const FIELDS = ["legalName", "addressLine1", "addressLine2", "postalCode", "city", "countryCode", "vatId", "kvkNumber", "billingEmail"] as const;

const fail = (message: string, fieldErrors: Record<string, string> = {}): BillingFormState => ({
  ok: false,
  message,
  fieldErrors,
  vat: null,
});

/** The caller's organization, when their role may update billing. Checked on every call, never taken from the page. */
async function updater() {
  const session = await getServerSession();
  const scoped = await getOrgScopedDb(session);
  if (!scoped || !roleAllows(scoped.memberRole, { billing: ["update"] }, false)) return null;
  return billingScope(scoped);
}

/**
 * Saves the billing details (`billing:update`). The country must be in the
 * EU. After saving, a non-Dutch VAT number is checked against VIES; when VIES
 * cannot answer, the details are still saved and the number stays "not
 * verified yet".
 */
export async function saveBillingDetails(_prev: BillingFormState, formData: FormData): Promise<BillingFormState> {
  const scope = await updater();
  if (!scope) return fail("You don't have permission to change the billing details.");

  const raw = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  const parsed = billingDetailsSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return fail("Check the highlighted fields.", fieldErrors);
  }

  const { outcome } = await storeBillingDetails(scope.db, scope.organizationId, parsed.data);
  revalidatePath(BILLING_PATH);
  return { ok: true, message: "Billing details saved.", fieldErrors: {}, vat: outcome };
}

/** Checks the saved VAT number against VIES again (`billing:update`), for the "Check again" button. */
export async function recheckVatId(): Promise<BillingFormState> {
  const scope = await updater();
  if (!scope) return fail("You don't have permission to change the billing details.");
  const profile = await getBillingProfile(scope.db, scope.organizationId);
  if (!profile?.vatId) return fail("Save your VAT number first.");

  const outcome = await runVatCheck(scope.db, profile);
  revalidatePath(BILLING_PATH);
  return { ok: true, message: null, fieldErrors: {}, vat: outcome };
}
