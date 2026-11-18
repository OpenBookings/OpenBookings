import { HOST_AGREEMENT_PATH, HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";
import { hostAgreementMetadata, renderHostAgreement } from "./_lib/render";

// Reads the session on every request; never prerendered or shared.
export const dynamic = "force-dynamic";

export const metadata = hostAgreementMetadata;

/** The current Host Agreement. Sign-in required (see `_lib/render.tsx`). */
export default function HostAgreementPage() {
  return renderHostAgreement(HOST_AGREEMENT_VERSION, HOST_AGREEMENT_PATH);
}
