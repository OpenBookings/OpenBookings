import {
  handleWebhookRequest,
  refundCommissionForCharge,
  type StripeEventDeps,
} from "@openbookings/stripe";
import { isStripeEventProcessed, markStripeEventProcessed, query } from "@openbookings/db";
import * as Sentry from "@sentry/nextjs";
import { recordStripeAudit } from "@/lib/stripe/audit";
import { sendPayoutChangeAlert } from "@/lib/mailing/payout-change-alert";

export const dynamic = "force-dynamic";

/**
 * Stripe's webhook for hosts: their connected accounts, and the money that
 * moves after a booking (refunds, disputes). What each event does lives in
 * `@openbookings/stripe` (events.ts); this route wires in the database.
 *
 * Its own Connect endpoint in Stripe, with its own signing secret, subscribed
 * to: account.updated, account.external_account.{created,updated,deleted},
 * charge.refunded, charge.dispute.created, charge.dispute.closed.
 * Guests' booking checkouts go to the web app's endpoint instead, and neither
 * endpoint may be subscribed to the other's events.
 *
 * Locally: `stripe listen --forward-connect-to localhost:3001/api/stripe/webhook`,
 * and put the `whsec_…` it prints in this app's STRIPE_WEBHOOK_SECRET.
 */
const deps: StripeEventDeps = {
  livemode: (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
  isProcessed: isStripeEventProcessed,
  markProcessed: markStripeEventProcessed,
  refundCommission: refundCommissionForCharge,
  audit: recordStripeAudit,
};

/**
 * A host's payout bank account changed in Stripe. Bank details live behind
 * the host's own Stripe login, where OpenBookings cannot stop a takeover; what
 * it can do is make sure every owner hears about a change, so one that nobody
 * made is noticed.
 */
deps.onExternalAccountChanged = async ({ eventId, stripeAccountId, change, last4, country }) => {
  // Tied to the organisation that owns this account, and to its owners only.
  const rows = await query<{ organization_id: string; name: string; email: string }>(
    `SELECT op.organization_id, o.name, u.email
     FROM org_profile op
     JOIN "organization" o ON o.id = op.organization_id
     JOIN "member" m ON m."organizationId" = op.organization_id AND m.role = 'owner'
     JOIN "user" u ON u.id = m."userId"
     WHERE op.stripe_account_id = $1
     ORDER BY op.organization_id`,
    [stripeAccountId],
  );
  const organizationId = rows[0]?.organization_id ?? null;

  // One record per Stripe event. If Stripe retries (a slow mail provider, a
  // failed write further on), the row is already there and no second email
  // goes out. Last four digits and country only: never the account number.
  const inserted = await query<{ id: string }>(
    `INSERT INTO audit_log (action, organization_id, detail)
     SELECT 'payout.external-account-changed', $1, $2::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_log
       WHERE action = 'payout.external-account-changed' AND detail->>'dedupeKey' = $3
     )
     RETURNING id`,
    [organizationId, JSON.stringify({ stripeAccountId, change, last4, country, dedupeKey: eventId }), eventId],
  );
  if (inserted.length === 0) return;

  const owners = rows.filter((row) => row.organization_id === organizationId);
  if (owners.length === 0) return;
  // Never allowed to fail the webhook: a bounced email is not Stripe's problem.
  await sendPayoutChangeAlert(
    owners.map((row) => row.email),
    { organisationName: owners[0]!.name, change, last4, country },
  ).catch((error) => {
    console.error("[stripe-webhook] payout alert failed:", error instanceof Error ? error.message : error);
  });
};

export async function POST(req: Request) {
  return handleWebhookRequest(req, {
    secret: process.env.STRIPE_WEBHOOK_SECRET,
    deps,
    name: "business",
    report: (error) => Sentry.captureException(error, { level: "fatal", tags: { area: "stripe-webhook" } }),
  });
}
