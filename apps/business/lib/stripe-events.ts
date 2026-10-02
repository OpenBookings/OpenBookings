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
  /** The connected account the object belongs to, for Connect events. */
  account?: string;
  data: { object: unknown };
};

export type StripeAuditEntry = {
  action: string;
  stripeAccountId: string;
  detail: Record<string, unknown>;
};

export type StripeEventDeps = {
  /** Record that this event is being processed; false if it already was. */
  claim: (eventId: string) => Promise<boolean>;
  /** Undo a claim after a failure, so Stripe's retry is processed. */
  release: (eventId: string) => Promise<void>;
  markOnboardingComplete: (stripeAccountId: string) => Promise<void>;
  /** Returns the commission handed back, in minor units (0 if none was due). */
  refundCommission: (
    chargeId: string,
    stripeAccountId: string,
    options: { lostDispute?: boolean },
  ) => Promise<number>;
  audit: (entry: StripeAuditEntry) => Promise<void>;
  /** A host's payout bank account was added, changed or removed. */
  onExternalAccountChanged?: (input: {
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
  const run = route(event, deps);
  if (!run) return "ignored";

  // Stripe delivers at least once. Claiming first means a redelivery does
  // nothing; releasing on failure means a genuine retry still gets processed.
  if (!(await deps.claim(event.id))) return "duplicate";
  try {
    await run();
    return "handled";
  } catch (error) {
    await deps.release(event.id).catch(() => {});
    throw error;
  }
}

/** The work for an event, or null when there is none to do. */
function route(event: StripeEventLike, deps: StripeEventDeps): (() => Promise<void>) | null {
  const object = (event.data.object ?? {}) as Obj;
  const account = str(event.account);

  switch (event.type) {
    case "account.updated": {
      const requirements = (object.requirements ?? {}) as Obj;
      const due = Array.isArray(requirements.currently_due) ? requirements.currently_due : [];
      const id = str(object.id);
      // Both: a host who can take payments but cannot be paid out is not ready.
      const ready = due.length === 0 && object.charges_enabled === true && object.payouts_enabled === true;
      if (!id || !ready) return null;
      return () => deps.markOnboardingComplete(id);
    }

    case "account.external_account.created":
    case "account.external_account.updated":
    case "account.external_account.deleted": {
      const notify = deps.onExternalAccountChanged;
      if (!account || !notify) return null;
      const change = event.type.split(".").pop() as "created" | "updated" | "deleted";
      return () =>
        notify({
          stripeAccountId: account,
          change,
          last4: str(object.last4),
          country: str(object.country),
        });
    }

    case "checkout.session.completed":
      // Deduped and acknowledged. Creating the booking from it comes with
      // real booking intents; checkout is still pinned to a seeded booking.
      return account ? async () => {} : null;

    case "charge.refunded": {
      const chargeId = str(object.id);
      if (!account || !chargeId) return null;
      return () => returnCommission(deps, chargeId, account, "refund", {});
    }

    case "charge.dispute.closed": {
      const chargeId = str(object.charge);
      if (!account || !chargeId || object.status !== "lost") return null;
      return () => returnCommission(deps, chargeId, account, "lost-dispute", { lostDispute: true });
    }

    case "charge.dispute.created": {
      if (!account) return null;
      return () =>
        deps.audit({
          action: "payment.dispute-opened",
          stripeAccountId: account,
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

/** If the booking did not happen, OpenBookings does not earn. */
async function returnCommission(
  deps: StripeEventDeps,
  chargeId: string,
  stripeAccountId: string,
  reason: "refund" | "lost-dispute",
  options: { lostDispute?: boolean },
): Promise<void> {
  const amount = await deps.refundCommission(chargeId, stripeAccountId, options);
  if (amount <= 0) return;
  await deps.audit({
    action: "commission.refunded",
    stripeAccountId,
    detail: { chargeId, amount, reason },
  });
}
