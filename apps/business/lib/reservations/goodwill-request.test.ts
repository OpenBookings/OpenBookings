import { describe, expect, test } from "bun:test";
import {
  SUPPORT_EMAIL,
  goodwillRequestMailto,
  goodwillRequestSubject,
  goodwillRequestText,
  parseProposedAmount,
} from "./goodwill-request";

const request = { reference: "0A1B2C3D", amount: 45.5, reason: "Noisy works next door all night" };

describe("goodwillRequestText", () => {
  test("carries the booking reference, the proposed amount and the reason", () => {
    const text = goodwillRequestText(request);
    expect(text).toContain("Please issue a goodwill refund to the guest.");
    expect(text).toContain("Booking: 0A1B2C3D");
    expect(text).toMatch(/Amount: €\s?45,50/);
    expect(text).toContain("Reason: Noisy works next door all night");
  });

  test("leaves the amount to support when the host doesn't propose one", () => {
    expect(goodwillRequestText({ ...request, amount: null })).toContain("Amount: please advise");
  });

  test("marks a missing reason", () => {
    expect(goodwillRequestText({ ...request, reason: "  " })).toContain("Reason: (please add)");
  });
});

describe("goodwillRequestMailto", () => {
  test("mails support with the booking in the subject and the same text in the body", () => {
    const url = new URL(goodwillRequestMailto(request));
    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe(SUPPORT_EMAIL);
    expect(SUPPORT_EMAIL).toBe("support@openbookings.co");
    expect(url.searchParams.get("subject")).toBe(goodwillRequestSubject("0A1B2C3D"));
    expect(url.searchParams.get("subject")).toContain("0A1B2C3D");
    expect(url.searchParams.get("body")).toBe(goodwillRequestText(request));
  });

  test("encodes spaces as %20, not +, so mail clients show them", () => {
    expect(goodwillRequestMailto(request)).not.toContain("+");
    expect(goodwillRequestMailto(request)).toContain("Goodwill%20refund");
  });
});

describe("parseProposedAmount", () => {
  test("empty is fine: support works the amount out", () => {
    expect(parseProposedAmount("", 100)).toBeNull();
    expect(parseProposedAmount("   ", 100)).toBeNull();
  });

  test("accepts an amount up to what is left, with a comma or a dot", () => {
    expect(parseProposedAmount("12,5", 100)).toBe(12.5);
    expect(parseProposedAmount("100", 100)).toBe(100);
  });

  test("refuses junk, zero, negatives and more than is left", () => {
    for (const bad of ["abc", "0", "-5", "100.01", "Infinity"]) {
      expect(parseProposedAmount(bad, 100)).toBeUndefined();
    }
  });
});
