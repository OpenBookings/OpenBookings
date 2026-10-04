import { describe, expect, test } from "bun:test";
import { isStripeAccountReady } from "./stripe-readiness";

const ready = {
  accountId: "acct_1",
  currentlyDue: [],
  eventuallyDue: ["company.tax_id"],
  chargesEnabled: true,
  payoutsEnabled: true,
};

describe("isStripeAccountReady", () => {
  test("an account with nothing due that can take payments and be paid out is ready", () => {
    expect(isStripeAccountReady(ready)).toBe(true);
  });

  test("an account with requirements currently due is not", () => {
    expect(isStripeAccountReady({ ...ready, currentlyDue: ["external_account"] })).toBe(false);
  });

  test("an account that cannot take payments is not", () => {
    expect(isStripeAccountReady({ ...ready, chargesEnabled: false })).toBe(false);
  });

  test("an account that can take payments but cannot be paid out is not", () => {
    expect(isStripeAccountReady({ ...ready, payoutsEnabled: false })).toBe(false);
  });
});
