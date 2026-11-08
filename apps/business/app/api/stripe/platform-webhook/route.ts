import { handleWebhookRequest, stripe, type StripeEventDeps } from "@openbookings/stripe";
import { getPool, isStripeEventProcessed, markStripeEventProcessed, withTransaction } from "@openbookings/db";
import { recordApplicationFee, recordApplicationFeeRefund, PaymentNotSettledError } from "@openbookings/billing/ledger";
import { buildStripeLedgerDeps, stripeFeeReader } from "@openbookings/billing/ledger/stripe-deps";
import * as Sentry from "@sentry/nextjs";
import { recordStripeAudit } from "@/lib/stripe/audit";

export const dynamic = "force-dynamic";

/**
 * Stripe's webhook for OpenBookings' own commission: every application fee and
 * fee refund goes into the commission ledger as it happens. What each event
 * does lives in `@openbookings/stripe` (events.ts) and the ledger in
 * `@openbookings/billing/ledger`; this route wires in the database and Stripe.
 *
 * An "Events on your account" endpoint (not Connect), with its own signing
 * secret, subscribed to exactly these two events: application_fee.created,
 * application_fee.refunded. These events carry no connected account.
 *
 * Locally: `stripe listen --forward-to localhost:3001/api/stripe/platform-webhook`,
 * and put the `whsec_…` it prints in this app's STRIPE_PLATFORM_WEBHOOK_SECRET.
 */
const report = (error: unknown, context?: object) =>
  Sentry.captureException(error, { tags: { area: "commission-ledger" }, ...(context as Record<string, unknown> | undefined) });

const fees = stripeFeeReader(stripe);
const ledger = (db: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> }) =>
  buildStripeLedgerDeps({ db, stripe, report, audit: recordStripeAudit });

/** A fee that arrived before its checkout was confirmed is a wait, not a fault. */
const retryable = (error: unknown) => error instanceof PaymentNotSettledError;

/** Reports a real failure, then lets it fail the request so Stripe retries. */
async function reporting<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!retryable(error)) Sentry.captureException(error, { level: "fatal", tags: { area: "commission-ledger" } });
    throw error;
  }
}

const deps: StripeEventDeps = {
  livemode: (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
  isProcessed: isStripeEventProcessed,
  markProcessed: markStripeEventProcessed,
  audit: recordStripeAudit,

  onApplicationFee: ({ eventId: _eventId, ...fee }) =>
    reporting(async () => void (await recordApplicationFee(fee, ledger(getPool())))),

  onApplicationFeeRefunded: ({ fee, refunds, hasMoreRefunds }) =>
    reporting(async () => {
      // Stripe may leave refunds off the event; the full list is on the fee.
      const all = hasMoreRefunds ? await fees.listRefunds(fee.id) : refunds;
      for (const refund of all) {
        // One transaction per refund: the ledger locks the original fee row, so
        // two partial refunds arriving together cannot overrun the fee.
        await withTransaction((client) => recordApplicationFeeRefund(refund, ledger(client), fees.fetchFee));
      }
    }),
};

export async function POST(req: Request) {
  return handleWebhookRequest(req, {
    secret: process.env.STRIPE_PLATFORM_WEBHOOK_SECRET,
    deps,
    name: "platform",
    retryable,
    report: (error) => Sentry.captureException(error, { level: "fatal", tags: { area: "stripe-webhook" } }),
  });
}
