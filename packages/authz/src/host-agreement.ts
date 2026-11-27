/**
 * The Host Agreement: the contract a host accepts during onboarding.
 *
 * It includes the data sharing arrangement (Annex A: both parties are
 * independent controllers, so it is not a processor DPA) and the cancellation
 * tiers (Annex B). It was called the "Partner Agreement" up to v1.2; that name
 * is retired.
 *
 * The text lives in this repository, in apps/business/content/legal, and is
 * published to signed-in business users at HOST_AGREEMENT_PATH. The version
 * below is written into the acceptance record (`org_consent.doc_id`), the same
 * way RATES_TAX_INCLUSIVE_DOC_ID dates its statement. Publishing a new version
 * means adding its text, registering it, and bumping HOST_AGREEMENT_VERSION:
 * hosts who accepted the old version can then accept the new one, and nobody
 * can accept the same version twice.
 *
 * In a file of its own, with no imports, so client components can use it
 * without pulling the database client into the bundle.
 */
export const HOST_AGREEMENT_TITLE = "Host Agreement";
export const HOST_AGREEMENT_VERSION = "1.6";
export const HOST_AGREEMENT_DOC_ID = `host-agreement@${HOST_AGREEMENT_VERSION}`;

/** The current version, on the business app. Sign-in required. */
export const HOST_AGREEMENT_PATH = "/legal/host-agreement";

/** One exact version, so an acceptance record always links to what was accepted. */
export function hostAgreementVersionPath(version: string): string {
  return `${HOST_AGREEMENT_PATH}/v/${encodeURIComponent(version)}`;
}

/**
 * Where the current version's text is read, or null when a host must not be
 * asked to accept it.
 *
 * By default that is this version's page on the business app, which every
 * deployment has. HOST_AGREEMENT_URL overrides it, for a deployment that
 * publishes its own agreement elsewhere; only http(s) URLs count, so a typo
 * cannot turn the link into a script, and a malformed value blocks acceptance
 * rather than silently falling back to a text the operator replaced.
 */
export function hostAgreementUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const configured = env.HOST_AGREEMENT_URL?.trim();
  if (!configured) return hostAgreementVersionPath(HOST_AGREEMENT_VERSION);
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // Falls through: a malformed value is refused.
  }
  return null;
}
