import { describe, expect, test } from "bun:test";
import { HOST_AGREEMENT_DOC_ID, HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";
import {
  decideHostAgreementSignature,
  isCurrentHostAgreement,
  type HostAgreementState,
  type SignerDetails,
} from "./host-agreement";

const signer: SignerDetails = {
  legalCompanyName: "Acme Hotels BV",
  fullName: "Jane Doe",
  roleTitle: "Director",
  vatNumber: "NL123456789B01",
};
const URL_ = "https://example.test/host-agreement-v1.2";
const now = new Date("2026-11-16T10:00:00.000Z");
const input = { signer, ip: "203.0.113.7", now, documentUrl: URL_ };

describe("decideHostAgreementSignature", () => {
  test("a first acceptance stores the version, doc id, URL, time and IP", () => {
    const d = decideHostAgreementSignature({} as HostAgreementState, input);
    expect(d.kind).toBe("sign");
    if (d.kind !== "sign") return;
    expect(d.record).toEqual({
      signedAt: now.toISOString(),
      signerIp: "203.0.113.7",
      docId: HOST_AGREEMENT_DOC_ID,
      version: HOST_AGREEMENT_VERSION,
      documentUrl: URL_,
    });
    expect(d.data).toMatchObject({ ...signer, hostAgreement: d.record });
    expect(isCurrentHostAgreement(d.data.hostAgreement)).toBe(true);
  });

  test("accepting the same version again changes nothing, signer details included", () => {
    const first = decideHostAgreementSignature({} as HostAgreementState, input);
    if (first.kind !== "sign") throw new Error("expected sign");

    const again = decideHostAgreementSignature(first.data, {
      ...input,
      signer: { ...signer, fullName: "Someone Else" },
      ip: "198.51.100.1",
      now: new Date("2026-12-01T00:00:00.000Z"),
    });
    expect(again).toEqual({ kind: "already-signed", record: first.record });
  });

  test("an older version can be replaced by the current one", () => {
    const legal: HostAgreementState = {
      ...signer,
      hostAgreement: {
        signedAt: "2026-01-01T00:00:00.000Z",
        signerIp: "198.51.100.1",
        docId: "host-agreement@1.1",
        version: "1.1",
        documentUrl: "https://example.test/v1.1",
      },
    };
    expect(isCurrentHostAgreement(legal.hostAgreement)).toBe(false);
    const d = decideHostAgreementSignature(legal, input);
    expect(d.kind).toBe("sign");
    if (d.kind === "sign") expect(d.record.docId).toBe(HOST_AGREEMENT_DOC_ID);
  });

  test("a legacy unversioned record does not count as accepting", () => {
    const legal = { ...signer, hostAgreement: { signedAt: "2026-01-01T00:00:00.000Z", signerIp: "x" } };
    expect(isCurrentHostAgreement(legal.hostAgreement)).toBe(false);
    expect(decideHostAgreementSignature(legal, input).kind).toBe("sign");
  });

  test("nothing is recorded while no text is published", () => {
    expect(decideHostAgreementSignature({} as HostAgreementState, { ...input, documentUrl: null })).toEqual({
      kind: "unavailable",
    });
  });
});
