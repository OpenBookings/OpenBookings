import { hostAgreementVersionPath } from "@openbookings/authz/host-agreement";
import { hostAgreementMetadata, renderHostAgreement } from "../../_lib/render";

// Reads the session on every request; never prerendered or shared.
export const dynamic = "force-dynamic";

export const metadata = hostAgreementMetadata;

type Props = { params: Promise<{ version: string }> };

/**
 * One exact version, current or superseded. Acceptance records link here, so
 * a host can always read the text it accepted. Sign-in required.
 */
export default async function HostAgreementVersionPage({ params }: Props) {
  const { version } = await params;
  return renderHostAgreement(version, hostAgreementVersionPath(version));
}
