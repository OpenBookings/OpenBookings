import { beforeEach, describe, expect, mock, test } from "bun:test";

type Domain = { id: string; enabled: boolean; apple_pay: { status: string } };

let listed: Domain[] = [];
const list = mock(async (_params: unknown, _options: unknown) => ({ data: listed }));
const create = mock(async (_params: unknown, _options: unknown): Promise<Domain> => ({
  id: "pmd_new",
  enabled: true,
  apple_pay: { status: "active" },
}));
const update = mock(async (_id: string, _params: unknown, _options: unknown): Promise<Domain> => ({
  id: "pmd_old",
  enabled: true,
  apple_pay: { status: "active" },
}));
// The client is a lazy proxy that needs STRIPE_SECRET_KEY; tests never talk to Stripe.
mock.module("../client", () => ({ stripe: { paymentMethodDomains: { list, create, update } } }));

const { ensurePaymentMethodDomain } = await import("./payment-domain");

const ON_ACCOUNT = { stripeAccount: "acct_test_1" };

beforeEach(() => {
  listed = [];
  list.mockClear();
  create.mockClear();
  update.mockClear();
});

describe("ensurePaymentMethodDomain", () => {
  test("leaves an enabled domain alone", async () => {
    listed = [{ id: "pmd_old", enabled: true, apple_pay: { status: "active" } }];
    expect(await ensurePaymentMethodDomain("acct_test_1", "openbookings.co")).toEqual({
      outcome: "exists",
      applePay: "active",
    });
    expect(list).toHaveBeenCalledWith({ domain_name: "openbookings.co", limit: 1 }, ON_ACCOUNT);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("registers the domain on the hotel's account when it is missing", async () => {
    expect(await ensurePaymentMethodDomain("acct_test_1", "openbookings.co")).toEqual({
      outcome: "created",
      applePay: "active",
    });
    expect(create).toHaveBeenCalledWith({ domain_name: "openbookings.co" }, ON_ACCOUNT);
  });

  test("turns a disabled domain back on", async () => {
    listed = [{ id: "pmd_old", enabled: false, apple_pay: { status: "inactive" } }];
    expect(await ensurePaymentMethodDomain("acct_test_1", "openbookings.co")).toEqual({
      outcome: "enabled",
      applePay: "active",
    });
    expect(update).toHaveBeenCalledWith("pmd_old", { enabled: true }, ON_ACCOUNT);
  });

  test("lets Stripe's errors through for the caller to handle", async () => {
    list.mockImplementationOnce(async () => {
      throw new Error("No such account");
    });
    await expect(ensurePaymentMethodDomain("acct_test_1", "openbookings.co")).rejects.toThrow("No such account");
  });
});
