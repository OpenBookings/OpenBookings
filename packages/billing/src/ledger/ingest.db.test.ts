import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { upsertBillingProfile } from "../profiles";
import {
  MissingBillingProfileError,
  PaymentNotSettledError,
  UnknownAccountError,
  recordApplicationFee,
  recordApplicationFeeRefund,
  type ChargeInfo,
  type FeeLike,
  type LedgerDeps,
} from ".";

const CREATED = 4_129_305_600; // 2100-11-07T21:20:00Z

type Calls = {
  returnPayment: [string, string, string][];
  audit: Parameters<LedgerDeps["audit"]>[0][];
  report: { error: unknown; context?: object }[];
};

describeWithDb("commission ledger ingestion against Postgres", () => {
  let db: Client;
  let orgId: string;
  let propertyId: string;
  let roomId: string;
  let ratePlanId: string;
  let bookingId: string;
  let account: string;
  let pi: string;

  /** The charge Stripe reports for a fee; one per test, changed by the test where it matters. */
  let charge: ChargeInfo;
  let calls: Calls;

  const deps = (): LedgerDeps => ({
    db,
    chargeInfo: async () => ({ ...charge, metadata: { ...charge.metadata } }),
    returnPayment: async (chargeId, accountId, reason) => {
      calls.returnPayment.push([chargeId, accountId, reason]);
      charge = { ...charge, amountRefunded: charge.amount };
      return { refundId: `re_${chargeId}` };
    },
    audit: async (entry) => {
      calls.audit.push(entry);
    },
    report: (error, context) => {
      calls.report.push({ error, context });
    },
  });

  const fee = (over: Partial<FeeLike> = {}): FeeLike => ({
    id: `fee_${crypto.randomUUID()}`,
    amount: 1080,
    currency: "eur",
    created: CREATED,
    account,
    charge: `ch_${crypto.randomUUID()}`,
    ...over,
  });

  const entry = async (where: string, value: string) =>
    (
      await db.query(
        `SELECT id, kind, billing_entity_id, property_id, booking_id, booking_intent_id, booking_ref,
                stay_start::text AS stay_start, stay_end::text AS stay_end, stripe_account_id,
                stripe_application_fee_id, stripe_fee_refund_id, stripe_payment_ref,
                base_amount::text AS base, commission_net::text AS net, vat_rate_bp, vat_amount::text AS vat,
                gross_amount::text AS gross, vat_treatment, currency, occurred_at, refunds_entry_id,
                disposition, amount_mismatch
           FROM commission_entries WHERE ${where} = $1`,
        [value],
      )
    ).rows;

  const seedIntent = async (opts: { status: string; bookingId?: string; paymentReference?: string }) =>
    (
      await db.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at, snapshot,
            total_amount, commission_cents, booking_id, payment_reference)
         VALUES ('u', $1, '2100-12-01', '2100-12-04', $2, now(), '{"roomsTotal": 240}'::jsonb, 240, 1080, $3, $4)
         RETURNING id`,
        [propertyId, opts.status, opts.bookingId ?? null, opts.paymentReference ?? null],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    db = new Client({ connectionString });
    await db.connect();
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await db.query("BEGIN");
    await applyPendingMigrations(db);
    ({ propertyId, roomId, ratePlanId } = await seedProperty(db));
    orgId = `org-${crypto.randomUUID()}`;
    account = `acct_${crypto.randomUUID().slice(0, 12)}`;
    pi = `pi_${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2, stripe_account_id = $3 WHERE id = $1`, [
      propertyId,
      orgId,
      account,
    ]);
    await db.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel BV', $2)`, [
      orgId,
      account,
    ]);
    await upsertBillingProfile(db, orgId, { legalName: "Hotel BV", countryCode: "NL", vatId: "NL123456789B01" });
    ({ bookingId } = await seedBooking(db, { propertyId, roomId, ratePlanId }, { checkIn: "2100-11-20", nights: 2 }));
    await db.query(
      `UPDATE bookings
          SET status = 'confirmed', stripe_payment_intent_id = $2,
              rooms_total_cents = 24000, total_cents = 24000, commission_cents = 1080, commission_rate = 0.045,
              commission_vat_treatment = 'NL_DOMESTIC', commission_net_cents = 893, commission_vat_cents = 187
        WHERE id = $1`,
      [bookingId, pi],
    );
    charge = { paymentIntentId: pi, metadata: {}, amount: 25_000, amountRefunded: 0 };
    calls = { returnPayment: [], audit: [], report: [] };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("records an NL fee with the booking's split", async () => {
    const f = fee();
    const r = await recordApplicationFee(f, deps());
    expect(r).toEqual({ entryId: expect.any(String), inserted: true, disposition: "booked" });
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({
      kind: "fee",
      billing_entity_id: orgId,
      property_id: propertyId,
      booking_id: bookingId,
      booking_ref: bookingId.slice(0, 8).toUpperCase(),
      stay_start: "2100-11-20",
      stay_end: "2100-11-22",
      stripe_account_id: account,
      stripe_application_fee_id: f.id,
      stripe_fee_refund_id: null,
      stripe_payment_ref: f.charge,
      base: "24000",
      net: "893",
      vat: "187",
      gross: "1080",
      vat_rate_bp: 2100,
      vat_treatment: "NL_DOMESTIC",
      currency: "eur",
      refunds_entry_id: null,
      disposition: "booked",
      amount_mismatch: false,
    });
    expect((row.occurred_at as Date).toISOString()).toBe(new Date(CREATED * 1000).toISOString());
    expect(calls.report).toEqual([]);
  });

  test("records a BE fee as reverse charge", async () => {
    await upsertBillingProfile(db, orgId, { countryCode: "BE", vatId: "BE0123456789" });
    await db.query(
      `UPDATE bookings SET commission_vat_treatment = 'EU_REVERSE_CHARGE', commission_net_cents = 1080, commission_vat_cents = 0
        WHERE id = $1`,
      [bookingId],
    );
    const r = await recordApplicationFee(fee(), deps());
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({
      net: "1080",
      vat: "0",
      gross: "1080",
      vat_rate_bp: 0,
      vat_treatment: "EU_REVERSE_CHARGE",
      disposition: "booked",
    });
  });

  test("a second delivery of the same fee inserts nothing", async () => {
    const f = fee();
    const first = await recordApplicationFee(f, deps());
    const second = await recordApplicationFee(f, deps());
    expect(second).toEqual({ entryId: first.entryId, inserted: false, disposition: "booked" });
    expect(await entry("stripe_application_fee_id", f.id)).toHaveLength(1);
  });

  test("a legacy booking without a split is split from the billing profile", async () => {
    await db.query(
      `UPDATE bookings SET commission_rate = NULL, commission_vat_treatment = NULL, commission_net_cents = NULL,
              commission_vat_cents = NULL
        WHERE id = $1`,
      [bookingId],
    );
    const r = await recordApplicationFee(fee(), deps());
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({ net: "893", vat: "187", gross: "1080", vat_rate_bp: 2100, vat_treatment: "NL_DOMESTIC" });
    expect(row.amount_mismatch).toBe(false);
  });

  test("a legacy booking without a billing profile is refused and reported", async () => {
    await db.query(`UPDATE bookings SET commission_vat_treatment = NULL, commission_net_cents = NULL, commission_vat_cents = NULL WHERE id = $1`, [
      bookingId,
    ]);
    await db.query(`DELETE FROM billing_profiles WHERE organization_id = $1`, [orgId]);
    const f = fee();
    await expect(recordApplicationFee(f, deps())).rejects.toBeInstanceOf(MissingBillingProfileError);
    expect(await entry("stripe_application_fee_id", f.id)).toHaveLength(0);
    expect(calls.report).toHaveLength(1);
  });

  test("a fee that differs from the booking's commission is kept, flagged and reported", async () => {
    const r = await recordApplicationFee(fee({ amount: 1000 }), deps());
    const [row] = await entry("id", r.entryId);
    // 1000 * 10000 / 12100 = 826.4 -> 826
    expect(row).toMatchObject({ net: "826", vat: "174", gross: "1000", vat_treatment: "NL_DOMESTIC", amount_mismatch: true });
    expect(row.disposition).toBe("booked");
    expect(calls.report).toHaveLength(1);
  });

  test("a fee on an oversold intent is returned, not booked", async () => {
    const otherPi = `pi_${crypto.randomUUID()}`;
    const intentId = await seedIntent({ status: "oversold", paymentReference: otherPi });
    charge = { paymentIntentId: otherPi, metadata: { bookingIntentId: intentId }, amount: 25_000, amountRefunded: 0 };
    const r = await recordApplicationFee(fee(), deps());
    expect(r.disposition).toBe("returned");
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({
      booking_id: null,
      booking_ref: null,
      property_id: propertyId,
      booking_intent_id: intentId,
      stay_start: "2100-12-01",
      stay_end: "2100-12-04",
      base: "0",
      net: "893",
      vat: "187",
      gross: "1080",
      vat_treatment: "NL_DOMESTIC",
      disposition: "returned",
    });
    expect(calls.returnPayment).toEqual([]);
    expect(calls.audit).toEqual([]);
    expect(calls.report).toHaveLength(1);
  });

  test("a duplicate payment for a booked intent is returned, not attached", async () => {
    const intentId = await seedIntent({ status: "paid", bookingId, paymentReference: pi });
    const secondPi = `pi_${crypto.randomUUID()}`;
    charge = { paymentIntentId: secondPi, metadata: { bookingIntentId: intentId }, amount: 25_000, amountRefunded: 0 };
    const r = await recordApplicationFee(fee(), deps());
    expect(r.disposition).toBe("returned");
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({ booking_id: null, booking_intent_id: intentId, property_id: propertyId, disposition: "returned" });
    expect(calls.returnPayment).toEqual([]);
    expect(calls.report).toHaveLength(1);
  });

  test("an unexplained payment is returned in full, audited and reported", async () => {
    charge = { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 0 };
    const f = fee();
    const r = await recordApplicationFee(f, deps());
    expect(r.disposition).toBe("returned");
    expect(calls.returnPayment).toEqual([[f.charge, account, "unexplained"]]);
    expect(calls.audit).toEqual([
      {
        action: "payment.unexplained-returned",
        stripeAccountId: account,
        dedupeKey: f.charge,
        detail: expect.objectContaining({ applicationFeeId: f.id, chargeId: f.charge, refundId: `re_${f.charge}` }),
      },
    ]);
    expect(calls.report).toHaveLength(1);
    expect(calls.report[0]?.context).toMatchObject({ level: "warning" });
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({ booking_id: null, property_id: null, booking_intent_id: null, stay_start: null, disposition: "returned" });

    const again = await recordApplicationFee(f, deps());
    expect(again).toEqual({ entryId: r.entryId, inserted: false, disposition: "returned" });
    expect(calls.returnPayment).toHaveLength(1);
  });

  test("an unexplained payment the ledger has not kept is not refunded twice", async () => {
    charge = { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 0 };
    const f = fee();
    // The first delivery refunded the payment, then failed before its insert.
    const failing = { ...deps(), audit: async () => Promise.reject(new Error("audit down")) };
    await expect(recordApplicationFee(f, failing)).rejects.toThrow("audit down");
    expect(calls.returnPayment).toHaveLength(1);
    await recordApplicationFee(f, deps());
    expect(calls.returnPayment).toHaveLength(1);
  });

  test("an already refunded unexplained payment is not refunded again", async () => {
    charge = { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 25_000 };
    const r = await recordApplicationFee(fee(), deps());
    expect(r.disposition).toBe("returned");
    expect(calls.returnPayment).toEqual([]);
    expect(calls.audit).toEqual([]);
  });

  test("a payment whose intent is not converted yet is not recorded", async () => {
    const intentId = await seedIntent({ status: "open" });
    charge = { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: { bookingIntentId: intentId }, amount: 25_000, amountRefunded: 0 };
    const f = fee();
    await expect(recordApplicationFee(f, deps())).rejects.toBeInstanceOf(PaymentNotSettledError);
    expect(await entry("stripe_application_fee_id", f.id)).toHaveLength(0);
    expect(calls.returnPayment).toEqual([]);
  });

  test("a full fee refund negates the original", async () => {
    const f = fee();
    const original = await recordApplicationFee(f, deps());
    const refund = { id: `fr_${crypto.randomUUID()}`, amount: 1080, created: CREATED + 3600, fee: f.id };
    const r = await recordApplicationFeeRefund(refund, deps(), async () => f);
    expect(r).toEqual({ entryId: expect.any(String), inserted: true });
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({
      kind: "fee_refund",
      billing_entity_id: orgId,
      property_id: propertyId,
      booking_id: bookingId,
      booking_ref: bookingId.slice(0, 8).toUpperCase(),
      stay_start: "2100-11-20",
      stay_end: "2100-11-22",
      stripe_application_fee_id: f.id,
      stripe_fee_refund_id: refund.id,
      stripe_payment_ref: f.charge,
      base: "-24000",
      net: "-893",
      vat: "-187",
      gross: "-1080",
      vat_rate_bp: 2100,
      vat_treatment: "NL_DOMESTIC",
      refunds_entry_id: original.entryId,
      disposition: "booked",
    });
    expect((row.occurred_at as Date).toISOString()).toBe(new Date((CREATED + 3600) * 1000).toISOString());

    const again = await recordApplicationFeeRefund(refund, deps(), async () => f);
    expect(again).toEqual({ entryId: r.entryId, inserted: false });
  });

  test("a partial fee refund splits proportionally and points at the original", async () => {
    const f = fee();
    const original = await recordApplicationFee(f, deps());
    const r = await recordApplicationFeeRefund({ id: `fr_${crypto.randomUUID()}`, amount: 540, created: CREATED + 60, fee: f.id }, deps(), async () => f);
    const [row] = await entry("id", r.entryId);
    // 540 * 10000 / 12100 = 446.3 -> 446; base 24000 * 540 / 1080 = 12000
    expect(row).toMatchObject({
      base: "-12000",
      net: "-446",
      vat: "-94",
      gross: "-540",
      refunds_entry_id: original.entryId,
      disposition: "booked",
    });
  });

  test("a refund larger than what is left of the fee is refused", async () => {
    const f = fee();
    await recordApplicationFee(f, deps());
    await recordApplicationFeeRefund({ id: `fr_${crypto.randomUUID()}`, amount: 1000, created: CREATED + 60, fee: f.id }, deps(), async () => f);
    const tooMuch = { id: `fr_${crypto.randomUUID()}`, amount: 81, created: CREATED + 120, fee: f.id };
    await expect(recordApplicationFeeRefund(tooMuch, deps(), async () => f)).rejects.toThrow();
    expect(await entry("stripe_fee_refund_id", tooMuch.id)).toHaveLength(0);
    const last = { id: `fr_${crypto.randomUUID()}`, amount: 80, created: CREATED + 180, fee: f.id };
    const r = await recordApplicationFeeRefund(last, deps(), async () => f);
    expect((await entry("id", r.entryId))[0]?.gross).toBe("-80");
  });

  test("a refund of a returned fee is returned too", async () => {
    charge = { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 25_000 };
    const f = fee();
    const original = await recordApplicationFee(f, deps());
    const r = await recordApplicationFeeRefund({ id: `fr_${crypto.randomUUID()}`, amount: 1080, created: CREATED + 60, fee: f.id }, deps(), async () => f);
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({
      kind: "fee_refund",
      booking_id: null,
      gross: "-1080",
      base: "0",
      refunds_entry_id: original.entryId,
      disposition: "returned",
    });
  });

  test("a refund whose fee is not in the ledger records the fee first", async () => {
    const f = fee();
    const fetched: string[] = [];
    const r = await recordApplicationFeeRefund(
      { id: `fr_${crypto.randomUUID()}`, amount: 1080, created: CREATED + 60, fee: f.id },
      deps(),
      async (id) => (fetched.push(id), f),
    );
    expect(fetched).toEqual([f.id]);
    const [original] = await entry("stripe_application_fee_id", f.id).then((rows) => rows.filter((x) => x.kind === "fee"));
    expect(original).toMatchObject({ disposition: "booked", gross: "1080" });
    const [row] = await entry("id", r.entryId);
    expect(row).toMatchObject({ refunds_entry_id: original?.id, gross: "-1080", disposition: "booked" });
  });

  test("a fee on an account no organization owns throws UnknownAccountError and inserts nothing", async () => {
    const f = fee({ account: "acct_nobody_owns_this" });
    await expect(recordApplicationFee(f, deps())).rejects.toBeInstanceOf(UnknownAccountError);
    expect(await entry("stripe_application_fee_id", f.id)).toHaveLength(0);
    expect(calls.report).toHaveLength(1);
    expect(calls.returnPayment).toEqual([]);
  });

  test("an account only on a property still finds its organization", async () => {
    await db.query(`UPDATE org_profile SET stripe_account_id = NULL WHERE organization_id = $1`, [orgId]);
    const r = await recordApplicationFee(fee(), deps());
    expect((await entry("id", r.entryId))[0]?.billing_entity_id).toBe(orgId);
  });
});
