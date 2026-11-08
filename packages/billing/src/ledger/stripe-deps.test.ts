import { describe, expect, test } from "bun:test";
import { periodFor } from "../period";
import { buildStripeLedgerDeps, stripeLedgerSource, type LedgerStripe, type LedgerSourceStripe } from "./stripe-deps";

function fake(charge: unknown) {
  const calls: unknown[][] = [];
  const stripe: LedgerStripe = {
    charges: {
      retrieve: async (...args: unknown[]) => {
        calls.push(args);
        return charge as never;
      },
    },
  };
  const deps = buildStripeLedgerDeps({
    db: { query: async () => ({ rows: [] }) },
    stripe,
    report: () => {},
    audit: async () => {},
  });
  return { deps, calls };
}

describe("buildStripeLedgerDeps chargeInfo", () => {
  test("takes the metadata from the PaymentIntent, not the charge", async () => {
    const { deps, calls } = fake({
      id: "ch_1",
      amount: 10_000,
      amount_refunded: 250,
      metadata: { bookingIntentId: "from-the-charge" },
      payment_intent: { id: "pi_1", metadata: { bookingIntentId: "i1" } },
    });
    expect(await deps.chargeInfo("ch_1", "acct_1")).toEqual({
      paymentIntentId: "pi_1",
      metadata: { bookingIntentId: "i1" },
      amount: 10_000,
      amountRefunded: 250,
    });
    expect(calls).toEqual([["ch_1", { expand: ["payment_intent"] }, { stripeAccount: "acct_1" }]]);
  });

  test("a charge's own metadata is ignored when the PaymentIntent has none", async () => {
    const { deps } = fake({
      id: "ch_1",
      amount: 1,
      amount_refunded: 0,
      metadata: { bookingIntentId: "from-the-charge" },
      payment_intent: { id: "pi_1", metadata: {} },
    });
    expect((await deps.chargeInfo("ch_1", "acct_1")).metadata).toEqual({});
  });

  test("throws when the PaymentIntent is absent or not expanded", async () => {
    for (const payment_intent of [null, "pi_1"]) {
      const { deps } = fake({ id: "ch_1", amount: 1, amount_refunded: 0, metadata: { bookingIntentId: "x" }, payment_intent });
      await expect(deps.chargeInfo("ch_1", "acct_1")).rejects.toThrow(/payment intent/i);
    }
  });
});

describe("stripeLedgerSource", () => {
  const period = periodFor("2026-10");
  const gte = Math.floor(period.from.getTime() / 1000);
  const lt = Math.floor(period.to.getTime() / 1000);

  function fakeSource(pages: Record<string, { data: unknown[]; has_more: boolean }[]>) {
    const calls: unknown[] = [];
    const stripe: LedgerSourceStripe = {
      balanceTransactions: {
        list: async (params) => {
          calls.push(params);
          return pages[params.type]!.shift()!;
        },
      },
      applicationFees: {
        retrieve: async (id) => ({ id, amount: 1080, currency: "eur", created: 1, account: "acct_1", charge: { id: "ch_1" } }),
        listRefunds: async () => ({ data: [{ id: "fr_9", amount: 5, created: 2, balance_transaction: "txn_7" }], has_more: false }),
      },
    };
    return { source: stripeLedgerSource(stripe), calls };
  }

  const collect = async <T,>(it: AsyncIterable<T>) => {
    const out: T[] = [];
    for await (const x of it) out.push(x);
    return out;
  };

  test("lists both types for the period, page by page, and maps each transaction", async () => {
    const { source, calls } = fakeSource({
      application_fee: [
        { data: [{ id: "txn_1", type: "application_fee", source: "fee_1", amount: 1080, created: gte }], has_more: true },
        { data: [{ id: "txn_2", type: "application_fee", source: { id: "fee_2" }, amount: 540, created: gte + 1 }], has_more: false },
      ],
      application_fee_refund: [
        {
          data: [
            {
              id: "txn_3",
              type: "application_fee_refund",
              source: {
                id: "fee_1",
                object: "application_fee",
                refunds: { data: [{ id: "fr_1", object: "fee_refund", amount: 270, created: gte + 2, fee: "fee_1", balance_transaction: "txn_3" }] },
              },
              amount: -270,
              created: gte + 2,
            },
          ],
          has_more: false,
        },
      ],
    });

    expect(await collect(source.listBalanceTransactions(period))).toEqual([
      { type: "application_fee", source: "fee_1", amount: 1080, created: gte },
      { type: "application_fee", source: "fee_2", amount: 540, created: gte + 1 },
      { type: "application_fee_refund", source: "fr_1", amount: -270, created: gte + 2 },
    ]);
    const base = { created: { gte, lt }, limit: 100, expand: ["data.source"] };
    expect(calls).toEqual([
      { type: "application_fee", ...base },
      { type: "application_fee", ...base, starting_after: "txn_1" },
      { type: "application_fee_refund", ...base },
    ]);
    expect(await source.retrieveFeeRefund("fr_1")).toEqual({ id: "fr_1", amount: 270, created: gte + 2, fee: "fee_1" });
  });

  test("finds the fee refund of a bare fee id (or one the fee does not embed) by paging the fee's refunds", async () => {
    const { source } = fakeSource({
      application_fee: [{ data: [], has_more: false }],
      application_fee_refund: [
        { data: [{ id: "txn_7", type: "application_fee_refund", source: "fee_1", amount: -5, created: gte }], has_more: false },
      ],
    });
    expect(await collect(source.listBalanceTransactions(period))).toEqual([
      { type: "application_fee_refund", source: "fr_9", amount: -5, created: gte },
    ]);
    expect(await source.retrieveFeeRefund("fr_9")).toEqual({ id: "fr_9", amount: 5, created: 2, fee: "fee_1" });
  });

  test("refuses an amount that is not a whole number of cents", async () => {
    const { source } = fakeSource({
      application_fee: [{ data: [{ id: "txn_1", type: "application_fee", source: "fee_1", amount: 10.5, created: gte }], has_more: false }],
      application_fee_refund: [{ data: [], has_more: false }],
    });
    await expect(collect(source.listBalanceTransactions(period))).rejects.toThrow(/whole number/);
  });

  test("a fee refund it did not list cannot be retrieved", async () => {
    const { source } = fakeSource({});
    await expect(source.retrieveFeeRefund("fr_x")).rejects.toThrow(/fr_x/);
  });

  test("reads fees and a fee's refunds through the fee reader", async () => {
    const { source } = fakeSource({});
    expect(await source.retrieveFee("fee_1")).toEqual({
      id: "fee_1",
      amount: 1080,
      currency: "eur",
      created: 1,
      account: "acct_1",
      charge: "ch_1",
    });
    expect(await source.listFeeRefunds("fee_1")).toEqual([{ id: "fr_9", amount: 5, created: 2, fee: "fee_1" }]);
  });
});
