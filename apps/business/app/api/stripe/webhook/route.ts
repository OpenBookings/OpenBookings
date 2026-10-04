import { constructWebhookEvent, refundCommissionForCharge, type StripeEvent } from "@openbookings/stripe";
import { query } from "@openbookings/db";
import { NextResponse } from "next/server";
import { handleStripeEvent, type StripeEventDeps } from "@/lib/stripe-events";
import { sendPayoutChangeAlert } from "@/lib/mailing/payout-change-alert";

export const dynamic = "force-dynamic";

/**
 * Stripe's Connect webhook: events about hosts' connected accounts and the
 * payments made on them. What each event does lives in lib/stripe-events.ts;
 * this route proves the event came from Stripe and wires in the database.
 *
 * `processed_events` is shared with the support bot's Chatwoot ledger, hence
 * the `stripe:` prefix on the id.
 */
const deps: StripeEventDeps = {
  livemode: (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_"),
  isProcessed: async (eventId) => {
    const rows = await query<{ event_id: string }>(
      `SELECT event_id FROM processed_events WHERE event_id = $1`,
      [`stripe:${eventId}`],
    );
    return rows.length > 0;
  },
  markProcessed: async (eventId) => {
    await query(
      `INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING`,
      [`stripe:${eventId}`],
    );
  },
  refundCommission: refundCommissionForCharge,
  audit: async ({ action, stripeAccountId, detail, dedupeKey }) => {
    // One row per fact: a retried event finds the row already there.
    await query(
      `INSERT INTO audit_log (action, organization_id, detail)
       SELECT $1, (SELECT organization_id FROM org_profile WHERE stripe_account_id = $2), $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM audit_log WHERE action = $1 AND detail->>'dedupeKey' = $4
       )`,
      [action, stripeAccountId, JSON.stringify({ ...detail, stripeAccountId, dedupeKey }), dedupeKey],
    );
  },
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
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: StripeEvent;
  try {
    event = constructWebhookEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event, deps);
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    // A 500 makes Stripe retry; the event was not marked done, so the retry runs.
    // The event type and id only: never the body.
    console.error(
      "[stripe-webhook]",
      event.type,
      event.id,
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
