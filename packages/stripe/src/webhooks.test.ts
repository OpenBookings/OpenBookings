import { describe, expect, spyOn, test } from "bun:test";
import type { StripeEventDeps, StripeEventLike } from "./events";
import { handleWebhookRequest, type WebhookRequestOptions } from "./webhooks";

const event: StripeEventLike = {
  id: "evt_1",
  type: "charge.refunded",
  livemode: false,
  account: "acct_1",
  data: { object: { id: "ch_1" } },
};

function setup(over: Partial<WebhookRequestOptions> = {}) {
  const reported: unknown[] = [];
  const deps: StripeEventDeps = {
    livemode: false,
    isProcessed: async () => false,
    markProcessed: async () => {},
    refundCommission: async () => [],
    audit: async () => {},
  };
  const options: WebhookRequestOptions = {
    secret: "whsec_test",
    deps,
    name: "test",
    report: (error) => void reported.push(error),
    verify: (_body, signature) => {
      if (signature !== "good") throw new Error("bad signature");
      return event;
    },
    ...over,
  };
  return { options, reported };
}

const request = (signature: string | null) =>
  new Request("http://localhost/api/stripe/webhook", {
    method: "POST",
    body: "{}",
    headers: signature ? { "stripe-signature": signature } : {},
  });

describe("handleWebhookRequest", () => {
  test("a verified event is handled and acknowledged", async () => {
    const { options } = setup();
    const res = await handleWebhookRequest(request("good"), options);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, outcome: "handled" });
  });

  test("a missing secret is a reported 500, so Stripe keeps the event and retries it", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const { options, reported } = setup({ secret: undefined });
    const res = await handleWebhookRequest(request("good"), options);
    expect(res.status).toBe(500);
    expect(reported.length).toBe(1);
    expect(String(reported[0])).toContain("STRIPE_WEBHOOK_SECRET");
    error.mockRestore();
  });

  test("a request without a signature, or with a wrong one, is refused", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const { options } = setup();
    expect((await handleWebhookRequest(request(null), options)).status).toBe(400);
    expect((await handleWebhookRequest(request("forged"), options)).status).toBe(400);
    warn.mockRestore();
  });

  test("a handler that fails answers 500, so Stripe retries the event", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const { options } = setup();
    options.deps.refundCommission = async () => {
      throw new Error("Stripe unreachable");
    };
    expect((await handleWebhookRequest(request("good"), options)).status).toBe(500);
    error.mockRestore();
  });
});
