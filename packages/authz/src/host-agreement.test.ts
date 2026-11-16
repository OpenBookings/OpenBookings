import { describe, expect, test } from "bun:test";
import {
  HOST_AGREEMENT_DOC_ID,
  HOST_AGREEMENT_PLACEHOLDER_URL,
  HOST_AGREEMENT_VERSION,
  hostAgreementUrl,
} from "./host-agreement";

describe("host agreement", () => {
  test("the doc id carries the version", () => {
    expect(HOST_AGREEMENT_DOC_ID).toBe(`host-agreement@${HOST_AGREEMENT_VERSION}`);
  });

  test("production has no URL until one is configured", () => {
    expect(hostAgreementUrl({ NODE_ENV: "production" })).toBeNull();
    expect(hostAgreementUrl({ NODE_ENV: "production", HOST_AGREEMENT_URL: "  " })).toBeNull();
  });

  test("a configured https URL is used everywhere", () => {
    const url = "https://openbookings.eu/legal/host-agreement/1.2";
    expect(hostAgreementUrl({ NODE_ENV: "production", HOST_AGREEMENT_URL: url })).toBe(url);
    expect(hostAgreementUrl({ NODE_ENV: "development", HOST_AGREEMENT_URL: url })).toBe(url);
  });

  test("outside production the placeholder stands in", () => {
    expect(hostAgreementUrl({ NODE_ENV: "development" })).toBe(HOST_AGREEMENT_PLACEHOLDER_URL);
    expect(hostAgreementUrl({})).toBe(HOST_AGREEMENT_PLACEHOLDER_URL);
  });

  test("a non-http or malformed value is refused rather than linked", () => {
    expect(hostAgreementUrl({ NODE_ENV: "production", HOST_AGREEMENT_URL: "javascript:alert(1)" })).toBeNull();
    expect(hostAgreementUrl({ NODE_ENV: "development", HOST_AGREEMENT_URL: "not a url" })).toBeNull();
  });
});
