import type { Queryable } from "@openbookings/db";

/** Thrown when no organization owns the connected account a fee was taken on. */
export class UnknownAccountError extends Error {
  readonly accountId: string;

  constructor(accountId: string, detail = "no organization owns it") {
    super(`Stripe account ${accountId} cannot be billed: ${detail}`);
    this.name = "UnknownAccountError";
    this.accountId = accountId;
  }
}

/**
 * Thrown when a payment names a booking intent that has not been turned into
 * a booking yet (the fee usually arrives moments before the checkout event).
 * Nothing is recorded: the payment may still become a booking, and a ledger
 * row cannot change its disposition later. Stripe redelivers the event, and the
 * reconciliation run picks it up after that.
 */
export class PaymentNotSettledError extends Error {
  readonly paymentIntentId: string;
  readonly intentId: string;

  constructor(paymentIntentId: string, intentId: string, status: string) {
    super(`Payment ${paymentIntentId} for booking intent ${intentId} (${status}) has no booking yet`);
    this.name = "PaymentNotSettledError";
    this.paymentIntentId = paymentIntentId;
    this.intentId = intentId;
  }
}

/**
 * The organization billed for fees taken on `accountId`: the one whose
 * `org_profile.stripe_account_id` it is, or failing that the single
 * organization whose property is connected to it (checkout charges on
 * `properties.stripe_account_id`). Throws `UnknownAccountError` when there is
 * none, or more than one.
 */
export async function billingEntityForAccount(db: Queryable, accountId: string): Promise<string> {
  const pick = (rows: unknown[]) => (rows as { organization_id: string }[]).map((r) => r.organization_id);

  const byProfile = pick(
    (await db.query(`SELECT DISTINCT organization_id FROM org_profile WHERE stripe_account_id = $1`, [accountId])).rows,
  );
  if (byProfile.length > 1) throw new UnknownAccountError(accountId, "more than one organization claims it");
  if (byProfile[0]) return byProfile[0];

  const byProperty = pick(
    (
      await db.query(
        `SELECT DISTINCT organization_id FROM properties WHERE stripe_account_id = $1 AND organization_id IS NOT NULL`,
        [accountId],
      )
    ).rows,
  );
  if (byProperty.length > 1) throw new UnknownAccountError(accountId, "properties of more than one organization use it");
  if (byProperty[0]) return byProperty[0];
  throw new UnknownAccountError(accountId);
}

/** The booking a payment paid for, with the commission split stored at checkout (NULL on legacy bookings). */
export type PaidBooking = {
  id: string;
  propertyId: string;
  checkIn: string;
  checkOut: string;
  roomsTotalCents: bigint;
  commissionCents: bigint;
  treatment: "NL_DOMESTIC" | "EU_REVERSE_CHARGE" | null;
  netCents: bigint | null;
  vatCents: bigint | null;
  intentId: string | null;
};

/** The booking intent a payment's metadata names. */
export type PaymentIntentRef = { id: string; propertyId: string; checkIn: string; checkOut: string };

/**
 * What a payment is. `booked`: a booking was paid with it. `returned`: it
 * never became a booking and goes back to the guest, either through the booking
 * confirmation (`oversold`, `duplicate`) or through the ledger itself
 * (`unexplained`: no intent we know of).
 */
export type PaymentResolution =
  | { disposition: "booked"; booking: PaidBooking }
  | { disposition: "returned"; reason: "oversold" | "duplicate" | "unexplained"; intent: PaymentIntentRef | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BookingRow = {
  id: string;
  hotel_id: string;
  check_in: string;
  check_out: string;
  rooms_total_cents: string;
  commission_cents: string;
  commission_vat_treatment: "NL_DOMESTIC" | "EU_REVERSE_CHARGE" | null;
  commission_net_cents: string | null;
  commission_vat_cents: string | null;
  intent_id: string | null;
};

type IntentRow = {
  id: string;
  property_id: string;
  status: string;
  booking_id: string | null;
  check_in: string;
  check_out: string;
};

/**
 * Decides whether a payment is booked or returned (spec decision 8). Booked
 * means a booking's `stripe_payment_intent_id` is this payment; anything else
 * is returned. A payment whose intent may still become a booking throws
 * `PaymentNotSettledError` instead of being decided too early.
 */
export async function resolvePayment(
  db: Queryable,
  charge: { paymentIntentId: string; metadata: Record<string, string> },
): Promise<PaymentResolution> {
  const { rows: bookings } = await db.query(
    `SELECT b.id, b.hotel_id, b.check_in_date::text AS check_in, b.check_out_date::text AS check_out,
            b.rooms_total_cents::text AS rooms_total_cents, b.commission_cents::text AS commission_cents,
            b.commission_vat_treatment, b.commission_net_cents::text AS commission_net_cents,
            b.commission_vat_cents::text AS commission_vat_cents,
            (SELECT bi.id FROM booking_intents bi WHERE bi.booking_id = b.id ORDER BY bi.created_at LIMIT 1) AS intent_id
       FROM bookings b
      WHERE b.stripe_payment_intent_id = $1`,
    [charge.paymentIntentId],
  );
  if (bookings.length > 1) {
    throw new Error(`Payment ${charge.paymentIntentId} is on ${bookings.length} bookings; the ledger cannot tell which it paid for`);
  }
  const b = bookings[0] as BookingRow | undefined;
  if (b) {
    const big = (v: string | null) => (v === null ? null : BigInt(v));
    return {
      disposition: "booked",
      booking: {
        id: b.id,
        propertyId: b.hotel_id,
        checkIn: b.check_in,
        checkOut: b.check_out,
        roomsTotalCents: BigInt(b.rooms_total_cents),
        commissionCents: BigInt(b.commission_cents),
        treatment: b.commission_vat_treatment,
        netCents: big(b.commission_net_cents),
        vatCents: big(b.commission_vat_cents),
        intentId: b.intent_id,
      },
    };
  }

  const intentId = charge.metadata.bookingIntentId;
  const { rows: intents } =
    intentId && UUID.test(intentId)
      ? await db.query(
          `SELECT id, property_id, status, booking_id, check_in_date::text AS check_in, check_out_date::text AS check_out
             FROM booking_intents WHERE id = $1::uuid`,
          [intentId],
        )
      : { rows: [] };
  const i = intents[0] as IntentRow | undefined;
  if (!i) return { disposition: "returned", reason: "unexplained", intent: null };

  const intent = { id: i.id, propertyId: i.property_id, checkIn: i.check_in, checkOut: i.check_out };
  if (i.status === "oversold" || i.status === "refunded_oversold") return { disposition: "returned", reason: "oversold", intent };
  // The intent was booked with another payment: this one is a second payment for it.
  if (i.booking_id) return { disposition: "returned", reason: "duplicate", intent };
  throw new PaymentNotSettledError(charge.paymentIntentId, i.id, i.status);
}
