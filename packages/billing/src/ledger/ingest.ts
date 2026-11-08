import type { Queryable } from "@openbookings/db";
import { getBillingProfile } from "../profiles";
import { NonEuCountryError, splitInclusive, splitRefund, vatRateBp, vatTreatmentFor, type VatTreatment } from "../vat";
import { billingEntityForAccount, resolvePayment, type PaymentResolution } from "./resolve";

/** The fields of a Stripe `ApplicationFee` the ledger uses. */
export type FeeLike = { id: string; amount: number; currency: string; created: number; account: string; charge: string };

/** The fields of a Stripe `FeeRefund` the ledger uses. */
export type FeeRefundLike = { id: string; amount: number; created: number; fee: string };

/** The charge a fee was taken from, as Stripe reports it on the host's account. */
export type ChargeInfo = { paymentIntentId: string; metadata: Record<string, string>; amount: number; amountRefunded: number };

/**
 * Everything the ledger needs from outside: the database (a transaction or
 * the pool), Stripe, the audit log and Sentry. Stripe is reached only through
 * these functions, so the ledger never loads the Stripe SDK.
 */
export type LedgerDeps = {
  db: Queryable;
  chargeInfo(chargeId: string, accountId: string): Promise<ChargeInfo>;
  /** Refunds the charge in full, application fee included. Same charge, same refund: idempotent on Stripe. */
  returnPayment(chargeId: string, accountId: string, reason: "unexplained"): Promise<{ refundId: string }>;
  audit(entry: { action: "payment.unexplained-returned"; stripeAccountId: string; dedupeKey: string; detail: object }): Promise<void>;
  report(error: unknown, context?: object): void;
};

/**
 * Thrown for a fee on a booking from before the checkout split whose
 * organization has no billing country: its VAT treatment is unknown, so it
 * cannot be invoiced correctly. Nothing is recorded until the profile is filled.
 */
export class MissingBillingProfileError extends Error {
  readonly organizationId: string;

  constructor(organizationId: string, feeId: string) {
    super(`Fee ${feeId} cannot be split: organization ${organizationId} has no billing country`);
    this.name = "MissingBillingProfileError";
    this.organizationId = organizationId;
  }
}

/** Thrown when a fee refund is not between 1 cent and what is left of its fee. */
export class FeeRefundOutOfRangeError extends Error {
  constructor(refundId: string, amount: bigint, remaining: bigint) {
    super(`Fee refund ${refundId} of ${amount} cents does not fit the ${remaining} cents left of its fee`);
    this.name = "FeeRefundOutOfRangeError";
  }
}

type Disposition = "booked" | "returned";

type NewEntry = {
  kind: "fee" | "fee_refund";
  billingEntityId: string;
  propertyId: string | null;
  bookingId: string | null;
  bookingIntentId: string | null;
  bookingRef: string | null;
  stayStart: string | null;
  stayEnd: string | null;
  stripeAccountId: string;
  stripeApplicationFeeId: string;
  stripeFeeRefundId: string | null;
  stripePaymentRef: string | null;
  base: bigint;
  net: bigint;
  vat: bigint;
  vatRateBp: bigint;
  treatment: VatTreatment;
  occurredAt: Date;
  refundsEntryId: string | null;
  disposition: Disposition;
  amountMismatch: boolean;
};

type EntryRow = {
  id: string;
  billing_entity_id: string;
  property_id: string | null;
  booking_id: string | null;
  booking_intent_id: string | null;
  booking_ref: string | null;
  stay_start: string | null;
  stay_end: string | null;
  stripe_account_id: string;
  stripe_payment_ref: string | null;
  base_amount: string;
  commission_net: string;
  vat_amount: string;
  gross_amount: string;
  vat_rate_bp: number;
  vat_treatment: VatTreatment;
  disposition: Disposition;
};

const ENTRY_COLUMNS = `id, billing_entity_id, property_id, booking_id, booking_intent_id, booking_ref,
  stay_start::text AS stay_start, stay_end::text AS stay_end, stripe_account_id, stripe_payment_ref,
  base_amount::text AS base_amount, commission_net::text AS commission_net, vat_amount::text AS vat_amount,
  gross_amount::text AS gross_amount, vat_rate_bp, vat_treatment, disposition`;

async function feeEntry(db: Queryable, feeId: string, lock = false): Promise<EntryRow | undefined> {
  const { rows } = await db.query(
    `SELECT ${ENTRY_COLUMNS} FROM commission_entries
      WHERE stripe_application_fee_id = $1 AND kind = 'fee'${lock ? " FOR UPDATE" : ""}`,
    [feeId],
  );
  return rows[0] as EntryRow | undefined;
}

async function refundEntryId(db: Queryable, refundId: string): Promise<string | undefined> {
  const { rows } = await db.query(`SELECT id FROM commission_entries WHERE stripe_fee_refund_id = $1`, [refundId]);
  return (rows[0] as { id: string } | undefined)?.id;
}

/** Inserts the row unless its fee (or fee refund) is already there; returns the id and whether this call inserted it. */
async function insertEntry(db: Queryable, e: NewEntry): Promise<{ entryId: string; inserted: boolean }> {
  const { rows } = await db.query(
    `INSERT INTO commission_entries
       (kind, billing_entity_id, property_id, booking_id, booking_intent_id, booking_ref, stay_start, stay_end,
        stripe_account_id, stripe_application_fee_id, stripe_fee_refund_id, stripe_payment_ref,
        base_amount, commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment, currency,
        occurred_at, refunds_entry_id, disposition, amount_mismatch)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'eur', $19, $20, $21, $22)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      e.kind,
      e.billingEntityId,
      e.propertyId,
      e.bookingId,
      e.bookingIntentId,
      e.bookingRef,
      e.stayStart,
      e.stayEnd,
      e.stripeAccountId,
      e.stripeApplicationFeeId,
      e.stripeFeeRefundId,
      e.stripePaymentRef,
      e.base.toString(),
      e.net.toString(),
      Number(e.vatRateBp),
      e.vat.toString(),
      (e.net + e.vat).toString(),
      e.treatment,
      e.occurredAt,
      e.refundsEntryId,
      e.disposition,
      e.amountMismatch,
    ],
  );
  const id = (rows[0] as { id: string } | undefined)?.id;
  if (id) return { entryId: id, inserted: true };
  const existing =
    e.kind === "fee" ? (await feeEntry(db, e.stripeApplicationFeeId))?.id : await refundEntryId(db, e.stripeFeeRefundId ?? "");
  if (!existing) throw new Error(`Ledger insert for ${e.stripeFeeRefundId ?? e.stripeApplicationFeeId} conflicted with no row`);
  return { entryId: existing, inserted: false };
}

function cents(value: number, what: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative whole number of cents, got ${value}`);
  return BigInt(value);
}

/** The treatment on the organization's billing profile, or null when it has no country. */
async function profileTreatment(db: Queryable, organizationId: string): Promise<VatTreatment | null> {
  const country = (await getBillingProfile(db, organizationId))?.countryCode;
  return country ? vatTreatmentFor(country) : null;
}

/**
 * Records one Stripe application fee in the commission ledger, exactly once.
 * The webhook and the reconciliation run both call it; a fee already in the
 * ledger returns its row with `inserted: false` and does nothing else.
 *
 * The billing entity is the organization owning `fee.account`. The payment is
 * **booked** when a booking was paid with it: the row carries the booking's
 * reference, stay and rooms total, and the commission split stored at checkout
 * (for a booking from before that split, the fee is split with the billing
 * profile's treatment). A fee that differs from the booking's commission is
 * still recorded, re-split from Stripe's amount, flagged `amount_mismatch` and
 * reported. Any other payment is **returned** (spec decision 8): recorded with
 * base 0 and never invoiced. A returned payment still with us is refunded in
 * full here when nothing else explains it, audited and reported; oversold and
 * duplicate payments are refunded by the booking confirmation, so they are
 * only reported.
 *
 * Throws (and reports) `UnknownAccountError` and `MissingBillingProfileError`,
 * and throws `PaymentNotSettledError` while the payment may still become a
 * booking; in each case nothing is recorded.
 */
export async function recordApplicationFee(
  fee: FeeLike,
  deps: LedgerDeps,
): Promise<{ entryId: string; inserted: boolean; disposition: Disposition }> {
  const { db } = deps;
  const existing = await feeEntry(db, fee.id);
  if (existing) return { entryId: existing.id, inserted: false, disposition: existing.disposition };

  const extra = { applicationFeeId: fee.id, chargeId: fee.charge, stripeAccountId: fee.account, amount: fee.amount };
  const surface = (error: unknown): never => {
    deps.report(error, { level: "error", extra });
    throw error;
  };

  const amount = cents(fee.amount, "An application fee");
  if (fee.currency.toLowerCase() !== "eur") surface(new Error(`Application fee ${fee.id} is in ${fee.currency}; only EUR is billed`));
  const billingEntityId = await billingEntityForAccount(db, fee.account).catch(surface);
  const charge = await deps.chargeInfo(fee.charge, fee.account);
  const payment = await resolvePayment(db, charge);

  const common = {
    kind: "fee" as const,
    billingEntityId,
    stripeAccountId: fee.account,
    stripeApplicationFeeId: fee.id,
    stripeFeeRefundId: null,
    stripePaymentRef: fee.charge,
    occurredAt: new Date(fee.created * 1000),
    refundsEntryId: null,
  };

  if (payment.disposition === "booked") {
    const b = payment.booking;
    let treatment = b.treatment;
    let split = b.netCents !== null && b.vatCents !== null ? { net: b.netCents, vat: b.vatCents } : null;
    if (!treatment || !split) {
      treatment = await profileTreatment(db, billingEntityId).catch(surface);
      if (!treatment) return surface(new MissingBillingProfileError(billingEntityId, fee.id));
      split = splitInclusive(amount, vatRateBp(treatment));
    }
    const amountMismatch = amount !== b.commissionCents || split.net + split.vat !== amount;
    if (amountMismatch) {
      split = splitInclusive(amount, vatRateBp(treatment));
      deps.report(new Error(`Application fee ${fee.id} is ${amount} cents, the booking's commission ${b.commissionCents}`), {
        level: "error",
        extra: { ...extra, bookingId: b.id, commissionCents: b.commissionCents.toString() },
      });
    }
    const r = await insertEntry(db, {
      ...common,
      propertyId: b.propertyId,
      bookingId: b.id,
      bookingIntentId: b.intentId,
      bookingRef: b.id.slice(0, 8).toUpperCase(),
      stayStart: b.checkIn,
      stayEnd: b.checkOut,
      base: b.roomsTotalCents,
      net: split.net,
      vat: split.vat,
      vatRateBp: vatRateBp(treatment),
      treatment,
      disposition: "booked",
      amountMismatch,
    });
    return { ...r, disposition: "booked" };
  }

  const treatment = await returnedTreatment(db, billingEntityId);
  if (charge.amountRefunded < charge.amount) await returnPayment(fee, charge, payment, deps, extra);
  const split = splitInclusive(amount, vatRateBp(treatment));
  const r = await insertEntry(db, {
    ...common,
    propertyId: payment.intent?.propertyId ?? null,
    bookingId: null,
    bookingIntentId: payment.intent?.id ?? null,
    bookingRef: null,
    stayStart: payment.intent?.checkIn ?? null,
    stayEnd: payment.intent?.checkOut ?? null,
    base: 0n,
    net: split.net,
    vat: split.vat,
    vatRateBp: vatRateBp(treatment),
    treatment,
    disposition: "returned",
    amountMismatch: false,
  });
  return { ...r, disposition: "returned" };
}

/**
 * The treatment a returned fee is recorded with. Returned entries are never
 * invoiced and net to zero with their refund, so when the organization has no
 * usable billing country (none yet, or outside the EU) they are recorded as
 * reverse charge with 0 VAT rather than refused (ruling R11): refusing would
 * keep the ledger from matching Stripe for a payment that is going back anyway.
 */
async function returnedTreatment(db: Queryable, organizationId: string): Promise<VatTreatment> {
  try {
    return (await profileTreatment(db, organizationId)) ?? "EU_REVERSE_CHARGE";
  } catch (error) {
    if (error instanceof NonEuCountryError) return "EU_REVERSE_CHARGE";
    throw error;
  }
}

/** A returned payment still with us: refunds it when nothing else will, else tells a person who will. */
async function returnPayment(
  fee: FeeLike,
  charge: ChargeInfo,
  payment: Extract<PaymentResolution, { disposition: "returned" }>,
  deps: LedgerDeps,
  extra: Record<string, unknown>,
): Promise<void> {
  const detail = { ...extra, paymentIntentId: charge.paymentIntentId, intentId: payment.intent?.id ?? null, reason: payment.reason };
  if (payment.reason !== "unexplained") {
    deps.report(new Error(`Application fee ${fee.id} is on a ${payment.reason} payment the booking confirmation has not refunded yet`), {
      level: "warning",
      extra: detail,
    });
    return;
  }
  const { refundId } = await deps.returnPayment(fee.charge, fee.account, "unexplained");
  await deps.audit({
    action: "payment.unexplained-returned",
    stripeAccountId: fee.account,
    dedupeKey: fee.charge,
    detail: { ...detail, refundId },
  });
  deps.report(new Error(`Payment ${charge.paymentIntentId} matched no booking or intent and was returned in full`), {
    level: "warning",
    extra: { ...detail, refundId },
  });
}

/**
 * Records one Stripe fee refund in the commission ledger, exactly once. When
 * its fee is not in the ledger yet, the fee is fetched with `fetchFee` and
 * recorded first. The refund inherits everything from its fee (organization,
 * booking, stay, treatment, disposition) and points at it with
 * `refunds_entry_id`. A refund of the whole fee negates the fee's row exactly;
 * a partial one is split in proportion (`splitRefund`). A refund larger than
 * what is left of the fee throws `FeeRefundOutOfRangeError` (reported).
 *
 * Pass a transaction as `deps.db` to serialise concurrent refunds of one fee:
 * the fee's row is locked while the remaining amount is checked.
 */
export async function recordApplicationFeeRefund(
  refund: FeeRefundLike,
  deps: LedgerDeps,
  fetchFee: (feeId: string) => Promise<FeeLike>,
): Promise<{ entryId: string; inserted: boolean }> {
  const { db } = deps;
  const existing = await refundEntryId(db, refund.id);
  if (existing) return { entryId: existing, inserted: false };

  let fee = await feeEntry(db, refund.fee, true);
  if (!fee) {
    const fetched = await fetchFee(refund.fee);
    if (fetched.id !== refund.fee) throw new Error(`Fetched fee ${fetched.id} for refund ${refund.id} of fee ${refund.fee}`);
    await recordApplicationFee(fetched, deps);
    fee = await feeEntry(db, refund.fee, true);
    if (!fee) throw new Error(`Fee ${refund.fee} was recorded but cannot be read back`);
  }

  const { rows } = await db.query(
    `SELECT COALESCE(-SUM(gross_amount), 0)::text AS refunded FROM commission_entries WHERE refunds_entry_id = $1`,
    [fee.id],
  );
  const refunded = BigInt((rows[0] as { refunded: string }).refunded);
  const gross = BigInt(fee.gross_amount);
  const amount = cents(refund.amount, "A fee refund");
  if (amount < 1n || amount > gross - refunded) {
    const error = new FeeRefundOutOfRangeError(refund.id, amount, gross - refunded);
    deps.report(error, { level: "error", extra: { feeRefundId: refund.id, applicationFeeId: refund.fee } });
    throw error;
  }

  const base = BigInt(fee.base_amount);
  const split =
    refunded === 0n && amount === gross
      ? { base: -base, net: -BigInt(fee.commission_net), vat: -BigInt(fee.vat_amount) }
      : splitRefund({ base, gross, rateBp: BigInt(fee.vat_rate_bp) }, amount);

  return insertEntry(db, {
    kind: "fee_refund",
    billingEntityId: fee.billing_entity_id,
    propertyId: fee.property_id,
    bookingId: fee.booking_id,
    bookingIntentId: fee.booking_intent_id,
    bookingRef: fee.booking_ref,
    stayStart: fee.stay_start,
    stayEnd: fee.stay_end,
    stripeAccountId: fee.stripe_account_id,
    stripeApplicationFeeId: refund.fee,
    stripeFeeRefundId: refund.id,
    stripePaymentRef: fee.stripe_payment_ref,
    base: split.base,
    net: split.net,
    vat: split.vat,
    vatRateBp: BigInt(fee.vat_rate_bp),
    treatment: fee.vat_treatment,
    occurredAt: new Date(refund.created * 1000),
    refundsEntryId: fee.id,
    disposition: fee.disposition,
    amountMismatch: false,
  });
}
