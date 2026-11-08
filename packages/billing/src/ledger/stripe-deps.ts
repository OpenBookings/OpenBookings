import type { Queryable } from "@openbookings/db";
import { returnUnexplainedPayment } from "@openbookings/stripe";
import type { Period } from "../period";
import type { BalanceTransactionLike, StripeLedgerSource } from "../steps/reconcile";
import type { ChargeInfo, FeeLike, FeeRefundLike, LedgerDeps } from "./ingest";

/**
 * The slice of the Stripe client that `chargeInfo` uses. Structural, so tests
 * pass a fake and this module needs no Stripe types of its own.
 */
export type LedgerStripe = {
  charges: {
    retrieve(
      id: string,
      params: { expand: string[] },
      options: { stripeAccount: string },
    ): Promise<{
      amount: number;
      amount_refunded: number;
      payment_intent?: unknown;
    }>;
  };
};

/** The slice of the Stripe client that reads application fees and their refunds. */
export type FeeStripe = {
  applicationFees: {
    retrieve(id: string): Promise<unknown>;
    listRefunds(
      id: string,
      params: { limit: number; starting_after?: string },
    ): Promise<{ data: unknown[]; has_more: boolean }>;
  };
};

/**
 * Wires the ledger to Stripe: the real `chargeInfo`, the refund that returns
 * an unexplained payment, and the caller's database, audit log and reporter.
 * The platform webhook and the invoice job both build their ledger this way.
 *
 * Imports the Stripe client, so it has its own subpath
 * (`@openbookings/billing/ledger/stripe-deps`) and the plain `./ledger` stays
 * free of the SDK.
 */
export function buildStripeLedgerDeps(input: {
  db: Queryable;
  stripe: LedgerStripe;
  report: LedgerDeps["report"];
  audit: LedgerDeps["audit"];
}): LedgerDeps {
  return {
    db: input.db,
    chargeInfo: (chargeId, accountId) => retrieveChargeInfo(input.stripe, chargeId, accountId),
    returnPayment: returnUnexplainedPayment,
    audit: input.audit,
    report: input.report,
  };
}

/**
 * The charge as the ledger needs it. The booking's `bookingIntentId` is
 * written on the PaymentIntent (checkout's `payment_intent_data.metadata`),
 * never on the charge, so the metadata is read from there. A charge whose
 * PaymentIntent cannot be read throws: empty metadata would make a real
 * booking's fee look unexplained, and the guest would be refunded.
 */
async function retrieveChargeInfo(stripe: LedgerStripe, chargeId: string, accountId: string): Promise<ChargeInfo> {
  const charge = await stripe.charges.retrieve(chargeId, { expand: ["payment_intent"] }, { stripeAccount: accountId });
  const intent = charge.payment_intent;
  if (!intent || typeof intent !== "object" || typeof (intent as { id?: unknown }).id !== "string") {
    throw new Error(`Charge ${chargeId} has no expanded payment intent`);
  }
  const { id, metadata } = intent as { id: string; metadata?: Record<string, string> | null };
  return {
    paymentIntentId: id,
    metadata: { ...(metadata ?? {}) },
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
  };
}

const idOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  const id = (value as { id?: unknown } | null)?.id;
  if (typeof id === "string") return id;
  throw new Error("Expected a Stripe id or object");
};

/** A Stripe application fee as the ledger records it. */
export function toFeeLike(fee: unknown): FeeLike {
  const f = fee as Record<string, unknown>;
  return {
    id: idOf(f.id),
    amount: f.amount as number,
    currency: f.currency as string,
    created: f.created as number,
    account: idOf(f.account),
    charge: idOf(f.charge),
  };
}

/** Reads fees and their refunds from Stripe: `fetchFee` for the ledger, `listRefunds` to page past `has_more`. */
export function stripeFeeReader(stripe: FeeStripe): {
  fetchFee(feeId: string): Promise<FeeLike>;
  listRefunds(feeId: string): Promise<FeeRefundLike[]>;
} {
  return {
    fetchFee: async (feeId) => toFeeLike(await stripe.applicationFees.retrieve(feeId)),
    listRefunds: async (feeId) => {
      const refunds: FeeRefundLike[] = [];
      let startingAfter: string | undefined;
      for (;;) {
        const page = await stripe.applicationFees.listRefunds(feeId, { limit: 100, starting_after: startingAfter });
        for (const r of page.data as Array<Record<string, unknown>>) {
          refunds.push({ id: idOf(r.id), amount: r.amount as number, created: r.created as number, fee: feeId });
        }
        if (!page.has_more || page.data.length === 0) return refunds;
        startingAfter = idOf(page.data[page.data.length - 1]);
      }
    },
  };
}

/** The slice of the Stripe client the reconciliation reads: platform balance transactions, fees and fee refunds. */
export type LedgerSourceStripe = FeeStripe & {
  balanceTransactions: {
    list(params: {
      type: BalanceTransactionLike["type"];
      created: { gte: number; lt: number };
      limit: number;
      expand: string[];
      starting_after?: string;
    }): Promise<{ data: unknown[]; has_more: boolean }>;
  };
};

const wholeCents = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${what} is not a whole number: ${String(value)}`);
  return value;
};

/**
 * Stripe as the reconciliation reads it (`StripeLedgerSource`). Lists the
 * platform's `application_fee` and `application_fee_refund` balance
 * transactions created in the period, 100 a page, one type after the other.
 *
 * Stripe cannot retrieve a fee refund by its own id (it needs the fee's), so
 * the listing expands each transaction's source and keeps the fee refunds it
 * sees; `retrieveFeeRefund` answers from those and throws for any other.
 */
export function stripeLedgerSource(stripe: LedgerSourceStripe): StripeLedgerSource {
  const fees = stripeFeeReader(stripe);
  const refunds = new Map<string, FeeRefundLike>();

  /** The fee refund a `application_fee_refund` balance transaction (`btId`) belongs to, from the fee it names (expanded or not). */
  async function refundOf(feeSource: unknown, btId: string): Promise<FeeRefundLike> {
    const feeId = idOf(feeSource);
    const matches = (r: Record<string, unknown>) => r.balance_transaction !== null && r.balance_transaction !== undefined && idOf(r.balance_transaction) === btId;
    const embedded = ((feeSource as { refunds?: { data?: unknown[] } } | null)?.refunds?.data ?? []) as Array<Record<string, unknown>>;
    let found = embedded.find(matches);
    // An expanded fee embeds only its first refunds; ask for all of them.
    for (let startingAfter: string | undefined; !found; ) {
      const page = await stripe.applicationFees.listRefunds(feeId, { limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      const data = page.data as Array<Record<string, unknown>>;
      found = data.find(matches);
      if (found || !page.has_more || data.length === 0) break;
      startingAfter = idOf(data[data.length - 1]);
    }
    if (!found) throw new Error(`Balance transaction ${btId} is not the balance transaction of any refund of fee ${feeId}`);
    return {
      id: idOf(found),
      amount: wholeCents(found.amount, `Fee refund ${idOf(found)} amount`),
      created: wholeCents(found.created, `Fee refund ${idOf(found)} created`),
      fee: feeId,
    };
  }

  async function* list(period: Period): AsyncIterable<BalanceTransactionLike> {
    const created = { gte: Math.floor(period.from.getTime() / 1000), lt: Math.floor(period.to.getTime() / 1000) };
    for (const type of ["application_fee", "application_fee_refund"] as const) {
      let startingAfter: string | undefined;
      for (;;) {
        const page = await stripe.balanceTransactions.list({
          type,
          created,
          limit: 100,
          expand: ["data.source"],
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const bt of page.data as Array<Record<string, unknown>>) {
          let source = idOf(bt.source);
          if (type === "application_fee_refund") {
            // Stripe's balance transaction for a fee refund has the FEE as its source, not the refund:
            // the refund is the one of that fee whose own balance transaction this is.
            const refund = await refundOf(bt.source, idOf(bt.id));
            refunds.set(refund.id, refund);
            source = refund.id;
          }
          yield {
            type,
            source,
            amount: wholeCents(bt.amount, `Balance transaction ${String(bt.id)} amount`),
            created: wholeCents(bt.created, `Balance transaction ${String(bt.id)} created`),
          };
        }
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = idOf(page.data[page.data.length - 1]);
      }
    }
  }

  return {
    listBalanceTransactions: list,
    retrieveFee: fees.fetchFee,
    retrieveFeeRefund: async (id) => {
      const refund = refunds.get(id);
      if (!refund) throw new Error(`Fee refund ${id} was not in the balance transactions listed`);
      return refund;
    },
    listFeeRefunds: fees.listRefunds,
  };
}
