/**
 * What this app does with each Stripe event.
 *
 * Kept apart from the route so it can be tested without Stripe or a database:
 * the route verifies the signature and supplies the real dependencies.
 *
 * Bookings are direct charges, so payment events arrive for the host's
 * connected account (`event.account`). Handlers here record and notify. The
 * only money they ever move is OpenBookings' own commission, back to the host
 * — never the host's funds.
 */

export type StripeEventLike = {
  id: string;
  type: string;
  /** False for events from Stripe's test mode. */
  livemode: boolean;
  /** The connected account the object belongs to, for Connect events. */
  account?: string;
  data: { object: unknown };
};

export type StripeAuditEntry = {
  action: string;
  stripeAccountId: string;
  detail: Record<string, unknown>;
  /**
   * Identifies the thing being recorded (a fee refund, a dispute). A second
   * entry with the same action and key is not written, so a retried event
   * cannot leave two records of one fact.
   */
  dedupeKey: string;
};

export type StripeEventDeps = {
  /** Whether this deployment runs on Stripe's live keys. */
  livemode: boolean;
  isProcessed: (eventId: string) => Promise<boolean>;
  /** Called only after the event's work has succeeded. */
  markProcessed: (eventId: string) => Promise<void>;
  /** Returns every commission refund that now exists on the charge. */
  refundCommission: (
    chargeId: string,
    stripeAccountId: string,
    options: { lostDisputeAmount?: number },
  ) => Promise<Array<{ id: string; amount: number }>>;
  audit: (entry: StripeAuditEntry) => Promise<void>;
  /** A host's payout bank account was added, changed or removed. */
  onExternalAccountChanged?: (input: {
    /** The Stripe event id, so the record and the email happen once per event. */
    eventId: string;
    stripeAccountId: string;
    change: "created" | "updated" | "deleted";
    last4: string | null;
    country: string | null;
  }) => Promise<void>;
};

export type StripeEventOutcome = "handled" | "ignored" | "duplicate";

type Obj = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export async function handleStripeEvent(
  event: StripeEventLike,
  deps: StripeEventDeps,
): Promise<StripeEventOutcome> {
  // A production Connect endpoint is also sent test-mode events. Their objects
  // do not exist for live keys, so acting on one could only fail, and Stripe
  // would keep retrying it for days.
  if (event.livemode !== deps.livemode) return "ignored";

  const run = route(event, deps);
  if (!run) return "ignored";

  // Stripe delivers at least once, so a redelivery is skipped. But the event
  // is marked done only AFTER its work succeeded: every handler here is safe
  // to repeat, whereas an event marked done before a crash would be lost for
  // good — and with it, a host's commission refund.
  if (await deps.isProcessed(event.id)) return "duplicate";
  await run();
  await deps.markProcessed(event.id);
  return "handled";
}

/** The work for an event, or null when there is none to do. */
function route(event: StripeEventLike, deps: StripeEventDeps): (() => Promise<void>) | null {
  const object = (event.data.object ?? {}) as Obj;
  const account = str(event.account);

  switch (event.type) {
    // Acknowledged, and nothing more. Onboarding is completed only by
    // completeOnboarding(), which provisions the organisation first; marking
    // it here could let a host past the wall with no organisation. A host
    // approved while away completes on return, through the verify step.
    case "account.updated":
      return async () => {};

    case "account.external_account.created":
    case "account.external_account.updated":
    case "account.external_account.deleted": {
      const notify = deps.onExternalAccountChanged;
      if (!account || !notify) return null;
      const change = event.type.split(".").pop() as "created" | "updated" | "deleted";
      return () =>
        notify({
          eventId: event.id,
          stripeAccountId: account,
          change,
          last4: str(object.last4),
          country: str(object.country),
        });
    }

    // checkout.session.completed is deliberately not handled yet: creating
    // the booking from it comes with real booking intents. Leaving it
    // unmarked means those events can still be replayed once it is.

    case "charge.refunded": {
      const chargeId = str(object.id);
      if (!account || !chargeId) return null;
      return () => returnCommission(deps, chargeId, account, {});
    }

    case "charge.dispute.closed": {
      const chargeId = str(object.charge);
      const amount = typeof object.amount === "number" ? object.amount : 0;
      if (!account || !chargeId || object.status !== "lost" || amount <= 0) return null;
      return () => returnCommission(deps, chargeId, account, { lostDisputeAmount: amount });
    }

    case "charge.dispute.created": {
      const disputeId = str(object.id);
      if (!account || !disputeId) return null;
      return () =>
        deps.audit({
          action: "payment.dispute-opened",
          stripeAccountId: account,
          dedupeKey: disputeId,
          detail: {
            disputeId: str(object.id),
            chargeId: str(object.charge),
            amount: typeof object.amount === "number" ? object.amount : null,
            reason: str(object.reason),
          },
        });
    }

    default:
      return null;
  }
}

/**
 * If the booking did not happen, OpenBookings does not earn.
 *
 * Records every commission refund on the charge, each keyed by its Stripe id.
 * Not just the one this event caused: if an earlier attempt moved the money
 * and failed before writing its record, this is where that record gets made.
 */
async function returnCommission(
  deps: StripeEventDeps,
  chargeId: string,
  stripeAccountId: string,
  options: { lostDisputeAmount?: number },
): Promise<void> {
  const refunds = await deps.refundCommission(chargeId, stripeAccountId, options);
  for (const refund of refunds) {
    await deps.audit({
      action: "commission.refunded",
      stripeAccountId,
      dedupeKey: refund.id,
      detail: { chargeId, feeRefundId: refund.id, amount: refund.amount },
    });
  }
}
