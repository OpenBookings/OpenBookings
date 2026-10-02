import { describe, expect, test } from "bun:test";
import { buildBookingCheckoutParams, type BookingCheckoutInput } from "./checkout";

const input: BookingCheckoutInput = {
  stripeAccountId: "acct_test_1",
  customerEmail: "guest@example.com",
  currency: "eur",
  lines: [{ name: "Garden Suite", description: "Hotel — Garden", unitAmountCents: 18_500, quantity: 3 }],
  applicationFeeCents: 2498,
  metadata: { bookingIntentId: "b1" },
  returnUrl: "https://openbookings.co/checkout/return?session_id={CHECKOUT_SESSION_ID}",
  expiresAt: 1_800_000_000,
};

describe("buildBookingCheckoutParams", () => {
  test("is a direct charge: nothing routes the money through the platform", () => {
    const params = buildBookingCheckoutParams(input);
    expect(params.payment_intent_data?.transfer_data).toBeUndefined();
    expect(params.payment_intent_data?.on_behalf_of).toBeUndefined();
  });

  test("takes the commission as an application fee", () => {
    expect(buildBookingCheckoutParams(input).payment_intent_data?.application_fee_amount).toBe(2498);
  });

  test("sends no fee field at all when there is no fee", () => {
    for (const fee of [null, 0]) {
      const params = buildBookingCheckoutParams({ ...input, applicationFeeCents: fee });
      expect(params.payment_intent_data && "application_fee_amount" in params.payment_intent_data).toBeFalsy();
    }
  });

  test("charges the lines one for one", () => {
    expect(buildBookingCheckoutParams(input).line_items).toEqual([
      {
        price_data: {
          currency: "eur",
          unit_amount: 18_500,
          product_data: { name: "Garden Suite", description: "Hotel — Garden" },
        },
        quantity: 3,
      },
    ]);
  });

  test("keeps the checkout form's behaviour: locked email, phone, billing address", () => {
    const params = buildBookingCheckoutParams(input);
    expect(params.mode).toBe("payment");
    expect(params.ui_mode).toBe("form");
    expect(params.customer_email).toBe("guest@example.com");
    expect(params.phone_number_collection).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.expires_at).toBe(1_800_000_000);
  });

  test("includes a payment method configuration only when one is set", () => {
    expect("payment_method_configuration" in buildBookingCheckoutParams(input)).toBe(false);
    expect(buildBookingCheckoutParams({ ...input, paymentMethodConfiguration: "pmc_1" }).payment_method_configuration).toBe("pmc_1");
  });

  test("refuses to build a charge with no connected account", () => {
    expect(() => buildBookingCheckoutParams({ ...input, stripeAccountId: "" })).toThrow();
  });
});
