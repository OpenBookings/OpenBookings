import { HOST_AGREEMENT_DOC_ID, HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";

/** One accepted legal document, as kept in `host_onboarding.step_data`. */
export interface LegalSignatureRecord {
  signedAt: string;
  signerIp: string;
  /** e.g. `host-agreement@1.2`. Absent on records made before versioning. */
  docId?: string;
  version?: string;
  /** Where the accepted text was published at the time. */
  documentUrl?: string;
  downloadedAt?: string;
  downloadedFilename?: string;
}

export interface SignerDetails {
  legalCompanyName: string;
  fullName: string;
  roleTitle: string;
  vatNumber: string;
  cocNumber?: string;
}

/** The parts of the legal step this module reads and writes. */
export interface HostAgreementState extends Partial<SignerDetails> {
  hostAgreement?: LegalSignatureRecord;
}

/** Whether `record` accepts the Host Agreement version in force now. */
export function isCurrentHostAgreement(record: LegalSignatureRecord | undefined): boolean {
  return record?.docId === HOST_AGREEMENT_DOC_ID;
}

export type HostAgreementDecision<T extends HostAgreementState> =
  | { kind: "already-signed"; record: LegalSignatureRecord }
  | { kind: "unavailable" }
  | { kind: "sign"; data: T; record: LegalSignatureRecord };

/**
 * What accepting the Host Agreement does to the legal step.
 *
 * - No published text (`documentUrl` null): nothing is recorded.
 * - The current version is already accepted: nothing changes, signer details
 *   included. The record is final; a second click must not move its date, IP
 *   or the name it was signed under.
 * - Otherwise (never signed, or signed an older version): a new record for
 *   the current version, with the signer details given now.
 */
export function decideHostAgreementSignature<T extends HostAgreementState>(
  legal: T,
  input: { signer: SignerDetails; ip: string; now: Date; documentUrl: string | null },
): HostAgreementDecision<T> {
  if (isCurrentHostAgreement(legal.hostAgreement)) {
    return { kind: "already-signed", record: legal.hostAgreement! };
  }
  if (!input.documentUrl) return { kind: "unavailable" };

  const record: LegalSignatureRecord = {
    signedAt: input.now.toISOString(),
    signerIp: input.ip,
    docId: HOST_AGREEMENT_DOC_ID,
    version: HOST_AGREEMENT_VERSION,
    documentUrl: input.documentUrl,
  };
  return { kind: "sign", data: { ...legal, ...input.signer, hostAgreement: record }, record };
}
