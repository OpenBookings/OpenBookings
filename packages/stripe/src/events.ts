/**
 * What OpenBookings does with each Stripe event.
 *
 * Kept apart from the routes so it can be tested without Stripe or a database:
 * each route verifies the signature and supplies the real dependencies.
 *
 * Two apps take Stripe events, each on its own endpoint and secret: `web`
 * handles the guest's booking checkouts, `business` the host's account and the
 * money that moves after a booking (refunds, disputes). Each passes only the
 * handlers it owns; an event without one is ignored and left unrecorded, so it
 * never reads as done to the app that does handle it. The two endpoints must
 * still subscribe to different event types: both record handled events in the
 * same `processed_events` table under the same id.
 *
 * Bookings are direct charges, so payment events arrive for the host's
 * connected account (`event.account`). Handlers here record and notify. The
 * money they move is OpenBookings' own commission, back to the host, and a
 * guest's payment that could not become a booking, back to the guest.
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
  /** Returns every commission refund that now exists on the charge. Wired together with `audit`. */
  refundCommission?: (
    chargeId: string,
    stripeAccountId: string,
    options: { lostDisputeAmount?: number },
  ) => Promise<Array<{ id: string; amount: number }>>;
  audit?: (entry: StripeAuditEntry) => Promise<void>;
  /** A host's payout bank account was added, changed or removed. */
  onExternalAccountChanged?: (input: {
    /** The Stripe event id, so the record and the email happen once per event. */
    eventId: string;
    stripeAccountId: string;
    change: "created" | "updated" | "deleted";
    last4: string | null;
    country: string | null;
  }) => Promise<void>;
  /**
   * A booking checkout was paid: turn its intent into a booking, or refund it.
   * Amounts are Stripe's, in cents, as charged on the host's account.
   */
  onCheckoutPaid?: (input: PaidCheckout & { eventId: string }) => Promise<void>;
  /** A delayed payment (a bank debit) failed: the intent stops holding its rooms. */
  onCheckoutFailed?: (input: { intentId: string; sessionId: string }) => Promise<void>;
  /** The checkout lapsed unpaid: the intent's hold ends now. */
  onCheckoutExpired?: (input: { intentId: string; sessionId: string }) => Promise<void>;
  /**
   * OpenBookings took a commission: a Stripe application fee was created.
   * Platform events, so they carry no `event.account`.
   */
  onApplicationFee?: (input: ApplicationFeePayload & { eventId: string }) => Promise<void>;
  /**
   * Some of a commission went back to the host. `refunds` is what the event
   * carries; `hasMoreRefunds` means Stripe left some off and the handler must
   * list the rest.
   */
  onApplicationFeeRefunded?: (input: {
    eventId: string;
    fee: ApplicationFeePayload;
    refunds: ApplicationFeeRefundPayload[];
    hasMoreRefunds: boolean;
  }) => Promise<void>;
};

export type StripeEventOutcome = "handled" | "ignored" | "duplicate";

/**
 * The fields of a Stripe application fee that OpenBookings records. Declared
 * here, structurally, so the billing package's own type accepts it without
 * this package importing billing.
 */
export type ApplicationFeePayload = {
  id: string;
  amount: number;
  currency: string;
  created: number;
  /** The connected account the fee was taken from. */
  account: string;
  charge: string;
};

/** The fields of a Stripe fee refund that OpenBookings records. */
export type ApplicationFeeRefundPayload = { id: string; amount: number; created: number; fee: string };

/** A booking checkout Stripe has taken the money for. Amounts in cents, as charged. */
export type PaidCheckout = {
  intentId: string;
  sessionId: string;
  paymentIntentId: string;
  stripeAccountId: string;
  amountCents: number;
};

type Obj = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const asObj = (value: unknown): Obj => (value && typeof value === "object" ? (value as Obj) : {});

function readFee(value: unknown): ApplicationFeePayload | null {
  const o = asObj(value);
  const { id, currency, account, charge } = { id: str(o.id), currency: str(o.currency), account: str(o.account), charge: str(o.charge) };
  if (!id || !currency || !account || !charge) return null;
  if (typeof o.amount !== "number" || typeof o.created !== "number") return null;
  return { id, amount: o.amount, currency, created: o.created, account, charge };
}

function readFeeRefund(value: unknown, feeId: string): ApplicationFeeRefundPayload | null {
  const o = asObj(value);
  const id = str(o.id);
  if (!id || typeof o.amount !== "number" || typeof o.created !== "number") return null;
  return { id, amount: o.amount, created: o.created, fee: str(o.fee) ?? feeId };
}

/**
 * The paid booking checkout in a Checkout Session, or null when it is not one:
 * not a booking intent's, or not paid yet (a bank payment still clearing).
 *
 * The webhook and the payment reconciliation both decide through this, so a
 * session Stripe reports as paid is confirmed the same way whichever finds it.
 * `payment_intent` may be an id or, when retrieved expanded, the object.
 */
export function readPaidCheckout(session: unknown, stripeAccountId: string | null): PaidCheckout | null {
  const object = asObj(session);
  const intentId = str(asObj(object.metadata).bookingIntentId);
  const sessionId = str(object.id);
  const paymentIntentId = str(object.payment_intent) ?? str(asObj(object.payment_intent).id);
  const amountCents = object.amount_total;
  if (!stripeAccountId || !intentId || !sessionId || !paymentIntentId) return null;
  if (object.payment_status !== "paid" || typeof amountCents !== "number") return null;
  return { intentId, sessionId, paymentIntentId, stripeAccountId, amountCents };
}

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

    // `completed` while still `unpaid` is a bank payment that has not cleared:
    // async_payment_succeeded (or _failed) follows, and decides.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const confirm = deps.onCheckoutPaid;
      const paid = readPaidCheckout(object, account);
      if (!confirm || !paid) return null;
      return () => confirm({ eventId: event.id, ...paid });
    }

    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      const release = event.type === "checkout.session.expired" ? deps.onCheckoutExpired : deps.onCheckoutFailed;
      const intentId = str(asObj(object.metadata).bookingIntentId);
      const sessionId = str(object.id);
      if (!release || !intentId || !sessionId) return null;
      return () => release({ intentId, sessionId });
    }

    // Platform events: Stripe sends them without `event.account`. One that
    // does carry it was delivered for a connected account, not for OpenBookings'
    // own commission, and is none of the ledger's business.
    case "application_fee.created": {
      const record = deps.onApplicationFee;
      const fee = readFee(object);
      if (!record || !fee || account) return null;
      return () => record({ ...fee, eventId: event.id });
    }

    case "application_fee.refunded": {
      const record = deps.onApplicationFeeRefunded;
      const fee = readFee(object);
      if (!record || !fee || account) return null;
      const list = asObj(object.refunds);
      const refunds = (Array.isArray(list.data) ? list.data : [])
        .map((refund) => readFeeRefund(refund, fee.id))
        .filter((refund): refund is ApplicationFeeRefundPayload => refund !== null);
      return () => record({ eventId: event.id, fee, refunds, hasMoreRefunds: list.has_more === true });
    }

    case "charge.refunded": {
      const commission = commissionDeps(deps);
      const chargeId = str(object.id);
      if (!commission || !account || !chargeId) return null;
      return () => returnCommission(commission, chargeId, account, {});
    }

    case "charge.dispute.closed": {
      const chargeId = str(object.charge);
      const amount = typeof object.amount === "number" ? object.amount : 0;
      const commission = commissionDeps(deps);
      if (!commission || !account || !chargeId || object.status !== "lost" || amount <= 0) return null;
      return () => returnCommission(commission, chargeId, account, { lostDisputeAmount: amount });
    }

    case "charge.dispute.created": {
      const audit = deps.audit;
      const disputeId = str(object.id);
      if (!audit || !account || !disputeId) return null;
      return () =>
        audit({
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
type CommissionDeps = Required<Pick<StripeEventDeps, "refundCommission" | "audit">>;

/** Both, or neither: a commission refund that moved money must be recorded. */
function commissionDeps(deps: StripeEventDeps): CommissionDeps | null {
  const { refundCommission, audit } = deps;
  return refundCommission && audit ? { refundCommission, audit } : null;
}

async function returnCommission(
  deps: CommissionDeps,
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
