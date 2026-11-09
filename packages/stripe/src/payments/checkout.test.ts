import { beforeEach, describe, expect, mock, test } from "bun:test";

// The client is a lazy proxy that needs STRIPE_SECRET_KEY; tests never talk to Stripe.
const expire = mock(async (_id: string, _params?: unknown, _options?: unknown): Promise<unknown> => ({}));
mock.module("../client", () => ({ stripe: { checkout: { sessions: { expire } } } }));

const { buildBookingCheckoutParams, expireBookingCheckout } = await import("./checkout");
type BookingCheckoutInput = import("./checkout").BookingCheckoutInput;

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
  test("uses Stripe's separate elements: the page draws its own details and Pay button", () => {
    expect(buildBookingCheckoutParams(input).ui_mode).toBe("elements");
  });

  test("leaves the phone to the page, which sends it on confirm", () => {
    expect("phone_number_collection" in buildBookingCheckoutParams(input)).toBe(false);
  });

  test("still insists on a billing address, and keeps the account email locked", () => {
    const params = buildBookingCheckoutParams(input);
    expect(params.billing_address_collection).toBe("required");
    expect(params.customer_email).toBe("guest@example.com");
  });

  test("is a direct charge: nothing routes the money through the platform", () => {
    const params = buildBookingCheckoutParams(input);
    expect(params.payment_intent_data?.transfer_data).toBeUndefined();
    expect(params.payment_intent_data?.on_behalf_of).toBeUndefined();
  });

  test("takes the commission as an application fee", () => {
    expect(buildBookingCheckoutParams(input).payment_intent_data?.application_fee_amount).toBe(2498);
  });

  test("the PaymentIntent carries the booking intent id", () => {
    expect(buildBookingCheckoutParams(input).payment_intent_data?.metadata).toEqual({ bookingIntentId: "b1" });
    // Fee or not.
    const noFee = buildBookingCheckoutParams({ ...input, applicationFeeCents: null });
    expect(noFee.payment_intent_data).toEqual({ metadata: { bookingIntentId: "b1" } });
    // No intent id to carry: no PaymentIntent metadata, and no throw.
    const bare = buildBookingCheckoutParams({ ...input, applicationFeeCents: null, metadata: {} });
    expect(bare.payment_intent_data).toBeUndefined();
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

  test("is a one-off payment that lapses when the hold allows", () => {
    const params = buildBookingCheckoutParams(input);
    expect(params.mode).toBe("payment");
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

describe("expireBookingCheckout", () => {
  beforeEach(() => {
    expire.mockReset();
    expire.mockImplementation(async () => ({}));
  });

  test("expires the session on the host's connected account", async () => {
    await expireBookingCheckout("cs_1", "acct_test_1");
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire.mock.calls[0]).toEqual(["cs_1", {}, { stripeAccount: "acct_test_1" }]);
  });

  test("swallows Stripe refusing because the session is no longer open", async () => {
    expire.mockImplementation(async () => {
      throw Object.assign(new Error('Only Checkout Sessions with a status in ["open"] can be expired.'), {
        type: "StripeInvalidRequestError",
      });
    });
    await expect(expireBookingCheckout("cs_1", "acct_test_1")).resolves.toBeUndefined();
  });

  test("rethrows anything else", async () => {
    expire.mockImplementation(async () => {
      throw Object.assign(new Error("No such checkout.session: 'cs_1'"), { type: "StripeInvalidRequestError" });
    });
    await expect(expireBookingCheckout("cs_1", "acct_test_1")).rejects.toThrow("No such checkout.session");
    expire.mockImplementation(async () => {
      throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
    });
    await expect(expireBookingCheckout("cs_1", "acct_test_1")).rejects.toThrow("socket hang up");
  });
});
