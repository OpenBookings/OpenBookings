import { compactVatId, type BillingProfileFields } from "./profiles";

/** The `org_profile` columns the backfill reads. */
export type OrgProfileSource = {
  legalEntityName: string | null;
  kvkNumber: string | null;
  vatNumber: string | null;
};

/** The parts of a Stripe connected account the backfill reads. */
export type StripeAccountSource = {
  country?: string | null;
  email?: string | null;
  business_profile?: { support_email?: string | null } | null;
  company?: {
    address?: {
      line1?: string | null;
      line2?: string | null;
      postal_code?: string | null;
      city?: string | null;
      country?: string | null;
    } | null;
  } | null;
};

const blank = (v: string | null | undefined): boolean => !v || !v.trim();
const clean = (v: string | null | undefined): string | undefined => (blank(v) ? undefined : v!.trim());

/**
 * What can be pre-filled on an organization's billing profile from its
 * `org_profile` row and connected Stripe account. Returns only the fields the
 * existing profile has empty; a field that already has a value is never
 * returned, so it can never be overwritten. A VAT number without a country
 * prefix gets the profile's (or Stripe's) country put in front (`EL` for
 * Greece); with no country known it is left out.
 */
export function mergeProfileSources(
  existing: BillingProfileFields | null,
  orgProfile: OrgProfileSource | null,
  stripeAccount: StripeAccountSource | null,
): BillingProfileFields {
  const have = existing ?? {};
  const address = stripeAccount?.company?.address;
  const candidates: BillingProfileFields = {
    legalName: clean(orgProfile?.legalEntityName),
    kvkNumber: clean(orgProfile?.kvkNumber),
    addressLine1: clean(address?.line1),
    addressLine2: clean(address?.line2),
    postalCode: clean(address?.postal_code),
    city: clean(address?.city),
    countryCode: clean(address?.country ?? stripeAccount?.country)?.toUpperCase(),
    billingEmail: clean(stripeAccount?.business_profile?.support_email) ?? clean(stripeAccount?.email),
  };

  const patch: BillingProfileFields = {};
  for (const key of Object.keys(candidates) as (keyof BillingProfileFields)[]) {
    const value = candidates[key];
    if (value !== undefined && blank(have[key])) patch[key] = value;
  }

  const vat = clean(orgProfile?.vatNumber);
  if (vat && blank(have.vatId)) {
    let compact = compactVatId(vat);
    if (!/^[A-Z]{2}/.test(compact)) {
      const country = clean(have.countryCode ?? patch.countryCode)?.toUpperCase();
      compact = country ? `${country === "GR" ? "EL" : country}${compact}` : "";
    }
    if (compact) patch.vatId = compact;
  }
  return patch;
}
