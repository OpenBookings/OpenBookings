import { describe, expect, test } from "bun:test";
import { checkoutCancellationTerms } from "./cancellation-terms";

const stay = {
  propertyTier: "flex" as const,
  timeZone: "Europe/Amsterdam",
  checkInTime: "15:00:00",
  arrivalDate: "2026-11-10",
  now: new Date("2026-10-05T10:00:00Z"),
};

describe("checkoutCancellationTerms", () => {
  test("a refundable rate shows the property tier with exact deadlines", () => {
    const terms = checkoutCancellationTerms({ ...stay, isRefundable: true });
    expect(terms.cancellationTier).toBe("flex");
    expect(terms.tierLabel).toBe("Flex");
    expect(terms.policyLines[0]).toBe("Free cancellation until Mon 9 Nov 2026, 15:00.");
    expect(terms.policyLines).toContain("If you don't show up, nothing is refunded.");
    expect(terms.requiresNonRefundableConsent).toBe(false);
  });

  test("a non-refundable rate asks the guest to confirm before paying", () => {
    const terms = checkoutCancellationTerms({ ...stay, isRefundable: false });
    expect(terms.cancellationTier).toBe("non_refundable");
    expect(terms.policyLines[0]).toBe("This rate is non-refundable.");
    expect(terms.requiresNonRefundableConsent).toBe(true);
  });

  test("a booking made inside 24 hours of the stay is past the free-cancellation deadline", () => {
    const terms = checkoutCancellationTerms({ ...stay, isRefundable: true, now: new Date("2026-11-10T08:00:00Z") });
    expect(terms.policyLines[0]).toBe("If you cancel now, the room price isn't refunded.");
  });
});
