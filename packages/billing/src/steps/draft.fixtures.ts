/**
 * Test fixtures for the draft and eligibility suites: hosts with a billing
 * profile, ledger rows written directly, and the Stripe side reconciliation
 * reads, kept in step with those rows.
 */
import type { Client } from "pg";
import { seedBooking, seedProperty } from "@openbookings/db/testing";
import type { LedgerDeps } from "../ledger";
import type { Period } from "../period";
import { recordViesResult, upsertBillingProfile } from "../profiles";
import { splitInclusive, vatRateBp, type VatTreatment } from "../vat";
import type { BalanceTransactionLike, StripeLedgerSource } from "./reconcile";

export type Host = { orgId: string; propertyId: string; bookingId: string; account: string };

/** The balance transactions Stripe lists for the period; `entry` adds to it. */
export type StripeSide = { listed: BalanceTransactionLike[] };

const VAT_IDS: Record<string, string> = { NL: "NL123456789B01", BE: "BE0123456789", US: "US123456789" };

/** A host with one confirmed booking and a complete billing profile in `country`; a non-NL VAT id is VIES-valid as of `viesCheckedAt`. */
export async function seedHost(db: Client, country = "NL", viesCheckedAt: Date | null = new Date("2100-10-20T10:00:00Z")): Promise<Host> {
  const { propertyId, roomId, ratePlanId } = await seedProperty(db);
  const orgId = `org-${crypto.randomUUID()}`;
  const account = `acct_${crypto.randomUUID().slice(0, 12)}`;
  await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
  await db.query(`UPDATE properties SET organization_id = $2, stripe_account_id = $3 WHERE id = $1`, [propertyId, orgId, account]);
  await upsertBillingProfile(db, orgId, {
    legalName: "Hotel BV",
    addressLine1: "1 Canal Street",
    postalCode: "1011 AA",
    city: "Amsterdam",
    countryCode: country,
    vatId: VAT_IDS[country] ?? `${country}123456789`,
    billingEmail: "billing@hotel.test",
  });
  if (country !== "NL" && viesCheckedAt) {
    await recordViesResult(db, orgId, { valid: true, requestId: "vies-ok", checkedAt: viesCheckedAt });
  }
  const { bookingId } = await seedBooking(db, { propertyId, roomId, ratePlanId }, { checkIn: "2100-11-20", nights: 2 });
  await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [bookingId]);
  return { orgId, propertyId, bookingId, account };
}

export type EntryInput = {
  kind?: "fee" | "fee_refund";
  /** Signed: negative for a refund. */
  gross: bigint;
  base?: bigint;
  treatment?: VatTreatment;
  disposition?: "booked" | "returned";
  refundsEntryId?: string;
  invoiceId?: string;
  occurredAt?: string;
  /** Whether Stripe lists it among the period's balance transactions (default: yes). */
  list?: boolean;
};

/** A ledger row written directly, split like the ledger splits it; listed on `stripe` unless `list` is false. */
export async function entry(
  db: Client,
  stripe: StripeSide,
  host: Host,
  input: EntryInput,
): Promise<{ id: string; feeId: string }> {
  const kind = input.kind ?? (input.gross < 0n ? "fee_refund" : "fee");
  const treatment = input.treatment ?? "NL_DOMESTIC";
  const disposition = input.disposition ?? "booked";
  const rate = vatRateBp(treatment);
  const { net, vat } = splitInclusive(input.gross, rate);
  const feeId = input.refundsEntryId
    ? ((await db.query(`SELECT stripe_application_fee_id AS id FROM commission_entries WHERE id = $1`, [input.refundsEntryId])).rows[0].id as string)
    : `fee_${crypto.randomUUID()}`;
  const refundId = kind === "fee_refund" ? `fr_${crypto.randomUUID()}` : null;
  const occurredAt = input.occurredAt ?? "2100-10-14T12:00:00Z";
  const booked = disposition === "booked";
  const { rows } = await db.query(
    `INSERT INTO commission_entries
       (kind, billing_entity_id, property_id, booking_id, booking_ref, stay_start, stay_end,
        stripe_account_id, stripe_application_fee_id, stripe_fee_refund_id, stripe_payment_ref,
        base_amount, commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment,
        occurred_at, refunds_entry_id, invoice_id, disposition)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [
      kind,
      host.orgId,
      booked ? host.propertyId : null,
      booked ? host.bookingId : null,
      booked ? host.bookingId.slice(0, 8).toUpperCase() : null,
      booked ? "2100-11-20" : null,
      booked ? "2100-11-22" : null,
      host.account,
      feeId,
      refundId,
      `ch_${crypto.randomUUID()}`,
      (input.base ?? input.gross * 22n).toString(),
      net.toString(),
      Number(rate),
      vat.toString(),
      input.gross.toString(),
      treatment,
      occurredAt,
      input.refundsEntryId ?? null,
      input.invoiceId ?? null,
      disposition,
    ],
  );
  if (input.list ?? true) {
    stripe.listed.push({
      type: kind === "fee" ? "application_fee" : "application_fee_refund",
      source: refundId ?? feeId,
      amount: Number(input.gross),
      created: Math.floor(Date.parse(occurredAt) / 1000),
    });
  }
  return { id: rows[0].id as string, feeId };
}

/** An issued invoice of `host` for the month starting `periodStart`, numbered `number`. */
export async function issuedInvoice(db: Client, host: Host, periodStart: string, periodEnd: string, number: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO invoices
       (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
        seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
     VALUES ($1, $2, $3, 'invoice', 'issued', 'OB-2100', $4, $5, '2100-10-05', '{}'::jsonb, '{}'::jsonb,
             'NL_DOMESTIC', 2100, 893, 187, 1080, 187, 0)
     RETURNING id`,
    [host.orgId, periodStart, periodEnd, Number(number.slice(-4)), number],
  );
  return rows[0].id as string;
}

/** Stripe as reconciliation reads it: the listed balance transactions, and nothing to fetch. */
export function stripeSource(stripe: StripeSide): StripeLedgerSource {
  return {
    async *listBalanceTransactions(_p: Period) {
      yield* stripe.listed;
    },
    retrieveFee: async (id) => {
      throw new Error(`Unexpected retrieveFee ${id}`);
    },
    retrieveFeeRefund: async (id) => {
      throw new Error(`Unexpected retrieveFeeRefund ${id}`);
    },
    listFeeRefunds: async () => [],
  };
}

/** A ledger that must never be asked to move money: every row the tests need is already written. */
export function quietLedger(db: Client): LedgerDeps {
  return {
    db,
    chargeInfo: async (chargeId) => {
      throw new Error(`Unexpected chargeInfo ${chargeId}`);
    },
    returnPayment: async (chargeId) => {
      throw new Error(`Unexpected returnPayment ${chargeId}`);
    },
    audit: async () => {
      throw new Error("Unexpected audit");
    },
    report: () => {},
  };
}
