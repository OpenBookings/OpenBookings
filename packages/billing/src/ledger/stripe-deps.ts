import type { Queryable } from "@openbookings/db";
import { returnUnexplainedPayment } from "@openbookings/stripe";
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
