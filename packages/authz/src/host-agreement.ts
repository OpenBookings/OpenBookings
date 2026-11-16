/**
 * The Host Agreement: the contract a host accepts during onboarding.
 *
 * It includes the data processing agreement (DPA) and its annexes (Annex B
 * holds the cancellation tiers). It was called the "Partner Agreement" in
 * earlier copy; that name is retired.
 *
 * The text is published outside this repository, so the version below is the
 * only thing the code can vouch for. It is written into the acceptance record
 * (`org_consent.doc_id`), the same way RATES_TAX_INCLUSIVE_DOC_ID dates its
 * statement. Publishing a new version means bumping HOST_AGREEMENT_VERSION
 * and pointing HOST_AGREEMENT_URL at the new text: hosts who accepted the old
 * version can then accept the new one, and nobody can accept the same version
 * twice.
 *
 * In a file of its own, with no imports, so client components can use it
 * without pulling the database client into the bundle.
 */
export const HOST_AGREEMENT_TITLE = "Host Agreement";
export const HOST_AGREEMENT_VERSION = "1.2";
export const HOST_AGREEMENT_DOC_ID = `host-agreement@${HOST_AGREEMENT_VERSION}`;

/**
 * Where the text is read from outside production while no URL is configured,
 * so local onboarding still works. Deliberately not a real page.
 */
export const HOST_AGREEMENT_PLACEHOLDER_URL =
  "https://openbookings.invalid/host-agreement-placeholder";

/**
 * Where the current version's text is published, or null when a host must not
 * be asked to accept it.
 *
 * Production reads HOST_AGREEMENT_URL and nothing else: with it unset there is
 * no text to show, and accepting an agreement nobody can read is no
 * agreement. Elsewhere the placeholder stands in. Only http(s) URLs count, so
 * a typo cannot turn the link into a script.
 */
export function hostAgreementUrl(
  env: { HOST_AGREEMENT_URL?: string; NODE_ENV?: string } = process.env,
): string | null {
  const configured = env.HOST_AGREEMENT_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch {
      // Falls through: a malformed value is treated as unset.
    }
    return null;
  }
  return env.NODE_ENV === "production" ? null : HOST_AGREEMENT_PLACEHOLDER_URL;
}
