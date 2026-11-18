import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";
import { LegalDocument } from "@/components/legal/LegalDocument";
import { getServerSession } from "@/lib/auth";
import { getHostAgreementVersion } from "@/lib/legal/host-agreement";

/**
 * The Host Agreement is for hosts only: every render needs a business-portal
 * session. proxy.ts already sends anyone without one to /login before the page
 * runs; this repeats the check in the page itself, so a change to the proxy's
 * matcher can never publish the agreement to anonymous visitors.
 */
async function requireBusinessSession(returnTo: string): Promise<void> {
  const session = await getServerSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
}

/** Never indexed or cached by anything but the host's own browser. */
export const hostAgreementMetadata: Metadata = {
  title: "Host Agreement | OpenBookings",
  robots: { index: false, follow: false, nocache: true },
};

export async function renderHostAgreement(version: string, returnTo: string) {
  await requireBusinessSession(returnTo);

  const entry = getHostAgreementVersion(version);
  if (!entry) notFound();

  const { default: Body, title } = await entry.load();
  return (
    <LegalDocument version={entry} title={title} isArchived={entry.version !== HOST_AGREEMENT_VERSION}>
      <Body />
    </LegalDocument>
  );
}
