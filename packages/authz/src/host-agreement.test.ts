import { describe, expect, test } from "bun:test";
import {
  HOST_AGREEMENT_DOC_ID,
  HOST_AGREEMENT_PATH,
  HOST_AGREEMENT_VERSION,
  hostAgreementUrl,
  hostAgreementVersionPath,
} from "./host-agreement";

describe("host agreement", () => {
  test("the doc id carries the version", () => {
    expect(HOST_AGREEMENT_DOC_ID).toBe(`host-agreement@${HOST_AGREEMENT_VERSION}`);
  });

  test("by default the text is this version's page on the business app", () => {
    const own = `${HOST_AGREEMENT_PATH}/v/${HOST_AGREEMENT_VERSION}`;
    expect(hostAgreementUrl({})).toBe(own);
    expect(hostAgreementUrl({ HOST_AGREEMENT_URL: "  " })).toBe(own);
  });

  test("a configured https URL overrides it", () => {
    const url = "https://example.com/legal/host-agreement/1.3";
    expect(hostAgreementUrl({ HOST_AGREEMENT_URL: url })).toBe(url);
  });

  test("a non-http or malformed value is refused rather than linked", () => {
    expect(hostAgreementUrl({ HOST_AGREEMENT_URL: "javascript:alert(1)" })).toBeNull();
    expect(hostAgreementUrl({ HOST_AGREEMENT_URL: "not a url" })).toBeNull();
  });

  test("a version path escapes what it is given", () => {
    expect(hostAgreementVersionPath("1.3")).toBe("/legal/host-agreement/v/1.3");
    expect(hostAgreementVersionPath("../x")).toBe("/legal/host-agreement/v/..%2Fx");
  });
});
