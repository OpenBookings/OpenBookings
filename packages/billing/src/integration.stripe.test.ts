/**
 * End to end against Stripe test mode and a real (throwaway) database: two
 * connected accounts take direct charges with application fees, one payment is
 * refunded in full and one by half (fee refunded with it); then the monthly
 * steps run for real (reconcile and draft, issue, store, deliver) and the
 * ledger, the two documents, the stored files and the emails are checked.
 *
 * Use a DEDICATED Stripe sandbox for STRIPE_TEST_SECRET_KEY, not the test key
 * the apps run on: the connected accounts it creates are deleted afterwards,
 * but Stripe keeps their fees in the platform's history, and every later
 * reconciliation of that month would then meet fees on accounts no
 * organization owns.
 *
 * Skipped unless STRIPE_TEST_SECRET_KEY (a `sk_test_` key, anything else is
 * refused), DATABASE_URL AND the explicit flag BILLING_TEST_DATABASE=1 are
 * set. The flag says "DATABASE_URL is a throwaway test branch, not production":
 * the test COMMITS rows, so never set it against anything else. Everything it
 * creates is removed afterwards, in the database and on Stripe, and nothing
 * else is touched: invoices are issued into a private far-future series
 * (OB-2100 and later, picked at random), and only the runs, entries, invoices
 * and rows it created are deleted, by id. It refuses to start when the month
 * already holds issued invoices it does not own, because store and deliver
 * take the whole month.
 *
 * The month is the real current one, because Stripe stamps what it creates
 * with now. Reconciliation is narrowed to the fees this test made, so other
 * test activity on the same Stripe platform cannot block it; steps that take
 * the whole month (store, deliver) are asserted on this test's invoices only.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { buildConnectAccountParams, stripe } from "@openbookings/stripe";
import { ensureCommittedMigrations } from "@openbookings/db/testing";
import { buildStripeLedgerDeps, stripeLedgerSource } from "./ledger/stripe-deps";
import { periodFor, periodOf } from "./period";
import { recordViesResult, upsertBillingProfile } from "./profiles";
import { withRun } from "./runs";
import { runDeliver, type InvoiceMail } from "./steps/deliver";
import { runDraft } from "./steps/draft";
import { runIssue } from "./steps/issue";
import { poolTransaction, type StripeLedgerSource } from "./steps/reconcile";
import { runStore, type ObjectStore } from "./steps/store";

const stripeKey = process.env.STRIPE_TEST_SECRET_KEY;
const databaseUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const enabled = Boolean(stripeKey && process.env.DATABASE_URL && process.env.BILLING_TEST_DATABASE === "1");
// The shared Stripe client reads its key from here, lazily.
if (enabled) process.env.STRIPE_SECRET_KEY = stripeKey;

if (stripeKey && !stripeKey.startsWith("sk_test_")) {
  throw new Error("STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_…); refusing to run against anything else");
}

const migrated = enabled ? await ensureCommittedMigrations() : false;
if (enabled && !migrated) console.warn("integration.stripe.test: the database lacks the commission-invoice schema; skipping");

const RATE = 0.045;
const fee = (stay: number) => Math.round(stay * RATE);

/** Payments per host: stay in cents (the commission base, VAT included) and how much of it is refunded. */
const PAYMENTS = {
  NL: [
    { stay: 50_000, refund: "full" as const },
    { stay: 40_000, refund: null },
  ],
  BE: [{ stay: 60_000, refund: "half" as const }],
};

type Made = { piId: string; feeId: string; stay: number; refundIds: string[]; bookingId?: string };
type Host = { country: "NL" | "BE"; account: string; orgId: string; propertyId: string; email: string; payments: Made[] };

describe.skipIf(!enabled || !migrated)("commission invoices against Stripe test mode", () => {
  const id = `it${Date.now().toString(36)}${crypto.randomUUID().slice(0, 6)}`;
  const startedAt = new Date();
  const period = periodFor(periodOf(startedAt));
  // A far-future issue date puts the invoices in a series nothing real uses (OB-2100 … OB-2999).
  const seriesYear = 2100 + Math.floor(Math.random() * 900);
  const today = `${seriesYear}-01-15`;
  const series = `OB-${seriesYear}`;

  let pool: Pool;
  const hosts: Host[] = [];
  /** Every connected account created, deleted at the end even when setup failed half way. */
  const accounts: string[] = [];
  const mine = new Set<string>();
  const mailed: InvoiceMail[] = [];
  /** The `invoice_runs` rows this test wrote. */
  const runIds: string[] = [];

  /** Stripe as the reconciliation reads it, narrowed to the fees and fee refunds this test made. */
  const source = (): StripeLedgerSource => {
    const all = stripeLedgerSource(stripe as never);
    return {
      ...all,
      async *listBalanceTransactions(p) {
        for await (const bt of all.listBalanceTransactions(p)) if (mine.has(bt.source)) yield bt;
      },
    };
  };

  const objects = new Map<string, { body: Uint8Array; sha256: string | null }>();
  const store: ObjectStore = {
    head: async (key) => objects.get(key) ?? null,
    put: async (key, body, _type, sha256) => void objects.set(key, { body, sha256 }),
    get: async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error(`no object ${key}`);
      return o.body;
    },
    presign: async (key) => `https://r2.test/${key}`,
  };

  const reported: unknown[] = [];
  const draftOf = async (h: Host) => {
    const ledger = buildStripeLedgerDeps({
      db: pool,
      stripe: stripe as never,
      report: (error) => reported.push(error),
      audit: async () => {},
    });
    return withRun(pool, { periodStart: period.start, step: "draft" }, async (runId) => {
      runIds.push(runId);
      const report = await runDraft(period, {
        db: pool,
        stripe: source(),
        ledger,
        inTransaction: poolTransaction(pool),
        vies: async () => {
          throw new Error("VIES must not be called: the verdict is stored");
        },
        viesDeps: { requester: { countryCode: "NL", vatNumber: "123456789B01" } },
        now: () => new Date(),
        entity: h.orgId,
        dryRun: false,
        runId,
      });
      return { status: report.reconcile.status === "succeeded" && !report.blocked.length ? ("succeeded" as const) : ("blocked" as const), report, value: report };
    });
  };

  /** The platform's application fee for a charge. Stripe lists it a moment after the payment, so ask again for a few seconds. */
  async function feeOf(chargeId: string): Promise<string> {
    for (let attempt = 0; attempt < 15; attempt++) {
      const fees = await stripe.applicationFees.list({ charge: chargeId, limit: 2 });
      if (fees.data.length === 1) return fees.data[0].id;
      await Bun.sleep(1000);
    }
    throw new Error(`No application fee for ${chargeId} after 15 s`);
  }

  async function makeHost(country: "NL" | "BE"): Promise<Host> {
    const account = await stripe.accounts.create(
      buildConnectAccountParams({ email: `${id}-${country.toLowerCase()}@example.test`, legalCompanyName: `${id} ${country} Hotel`, country }),
    );
    accounts.push(account.id);
    const payments: Made[] = [];
    for (const p of PAYMENTS[country]) {
      const pi = await stripe.paymentIntents.create(
        {
          amount: p.stay,
          currency: "eur",
          payment_method: "pm_card_visa",
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          application_fee_amount: fee(p.stay),
          metadata: { integrationTest: id },
        },
        { stripeAccount: account.id },
      );
      if (pi.status !== "succeeded") throw new Error(`Payment ${pi.id} is ${pi.status}`);
      const feeId = await feeOf(String(pi.latest_charge));
      mine.add(feeId);
      if (p.refund) {
        await stripe.refunds.create(
          { payment_intent: pi.id, ...(p.refund === "half" ? { amount: p.stay / 2 } : {}), refund_application_fee: true },
          { stripeAccount: account.id },
        );
      }
      const refunds = await stripe.applicationFees.listRefunds(feeId, { limit: 10 });
      for (const r of refunds.data) mine.add(r.id);
      payments.push({ piId: pi.id, feeId, stay: p.stay, refundIds: refunds.data.map((r) => r.id) });
    }
    return { country, account: account.id, orgId: `${id}-org-${country.toLowerCase()}`, propertyId: "", email: `billing-${id}-${country.toLowerCase()}@example.test`, payments };
  }

  /** The organization, billing profile, property and one confirmed booking per payment a host needs. */
  async function seedHost(h: Host) {
    const { seedBooking, seedProperty } = await import("@openbookings/db/testing");
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const ids = await seedProperty(c as never);
      h.propertyId = ids.propertyId;
      await c.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, $2, $1, NOW())`, [h.orgId, `${id} ${h.country}`]);
      await c.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, $2, $3)`, [h.orgId, `${id} ${h.country} Hotel`, h.account]);
      await c.query(`UPDATE properties SET organization_id = $2, stripe_account_id = $3 WHERE id = $1`, [h.propertyId, h.orgId, h.account]);
      await upsertBillingProfile(c as never, h.orgId, {
        legalName: `${id} ${h.country} Hotel`,
        addressLine1: "1 Canal Street",
        postalCode: h.country === "NL" ? "1011 AA" : "1000",
        city: h.country === "NL" ? "Amsterdam" : "Brussels",
        countryCode: h.country,
        vatId: h.country === "NL" ? "NL123456789B01" : "BE0123456789",
        billingEmail: h.email,
      });
      // The VIES verdict is stored directly: the test never calls VIES.
      if (h.country === "BE") await recordViesResult(c as never, h.orgId, { valid: true, requestId: `vies-${id}`, checkedAt: new Date() });
      for (const p of h.payments) {
        const { bookingId } = await seedBooking(c as never, ids, { checkIn: "2027-01-10", nights: 2 });
        const gross = fee(p.stay);
        const net = h.country === "NL" ? Math.round((gross * 10000) / 12100) : gross;
        await c.query(
          `UPDATE bookings
              SET status = 'confirmed', stripe_payment_intent_id = $2,
                  rooms_total_cents = $3, total_cents = $3, commission_cents = $4, commission_rate = $5,
                  commission_vat_treatment = $6, commission_net_cents = $7, commission_vat_cents = $8
            WHERE id = $1`,
          [bookingId, p.piId, p.stay, gross, RATE, h.country === "NL" ? "NL_DOMESTIC" : "EU_REVERSE_CHARGE", net, gross - net],
        );
        p.bookingId = bookingId;
      }
      await c.query("COMMIT");
    } catch (error) {
      await c.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const foreign = (await pool.query(`SELECT number FROM invoices WHERE period_start = $1 AND status = 'issued'`, [period.start])).rows;
    if (foreign.length) throw new Error(`The database already holds issued invoices for ${period.start} that this test does not own; refusing to store or deliver them`);
    for (const country of ["NL", "BE"] as const) hosts.push(await makeHost(country));
    for (const h of hosts) await seedHost(h);
  }, 120_000);

  afterAll(async () => {
    const orgs = hosts.map((h) => h.orgId);
    if (pool && orgs.length) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        // The append-only and immutability triggers refuse DELETE, which is the point of them; only user triggers are switched off.
        await c.query(`ALTER TABLE commission_entries DISABLE TRIGGER USER`);
        await c.query(`ALTER TABLE invoices DISABLE TRIGGER USER`);
        await c.query(`UPDATE commission_entries SET refunds_entry_id = NULL WHERE billing_entity_id = ANY($1)`, [orgs]);
        await c.query(`DELETE FROM commission_entries WHERE billing_entity_id = ANY($1)`, [orgs]);
        await c.query(`DELETE FROM invoices WHERE billing_entity_id = ANY($1)`, [orgs]);
        await c.query(`ALTER TABLE commission_entries ENABLE TRIGGER USER`);
        await c.query(`ALTER TABLE invoices ENABLE TRIGGER USER`);
        await c.query(`DELETE FROM invoice_runs WHERE id = ANY($1)`, [runIds]);
        // The private far-future series: nothing else can have numbers in it.
        await c.query(`DELETE FROM invoice_sequences WHERE series = $1`, [series]);
        await c.query(`DELETE FROM billing_profiles WHERE organization_id = ANY($1)`, [orgs]);
        const bookings = hosts.flatMap((h) => h.payments.map((p) => p.bookingId).filter(Boolean));
        const users = (await c.query(`SELECT DISTINCT user_id FROM bookings WHERE id = ANY($1)`, [bookings])).rows.map((r) => r.user_id as string);
        await c.query(`DELETE FROM bookings WHERE id = ANY($1)`, [bookings]);
        await c.query(`DELETE FROM properties WHERE id = ANY($1)`, [hosts.map((h) => h.propertyId)]);
        await c.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
        await c.query(`DELETE FROM org_profile WHERE organization_id = ANY($1)`, [orgs]);
        await c.query(`DELETE FROM "organization" WHERE id = ANY($1)`, [orgs]);
        await c.query("COMMIT");
      } catch (error) {
        await c.query("ROLLBACK").catch(() => {});
        console.error("integration.stripe.test: database cleanup failed", error);
        throw error;
      } finally {
        c.release();
      }
    }
    await pool?.end();
    for (const acct of accounts) await stripe.accounts.del(acct).catch((e) => console.error(`could not delete ${acct}`, e));
  }, 120_000);

  const entries = async (orgId: string) =>
    (
      await pool.query(
        `SELECT kind, stripe_application_fee_id AS fee, stripe_fee_refund_id AS refund, gross_amount::text AS gross,
                commission_net::text AS net, vat_amount::text AS vat, disposition, invoice_id, booking_id
           FROM commission_entries WHERE billing_entity_id = $1 ORDER BY occurred_at, kind`,
        [orgId],
      )
    ).rows as { kind: string; fee: string; refund: string | null; gross: string; net: string; vat: string; disposition: string; invoice_id: string | null; booking_id: string }[];

  test("the ledger equals Stripe and every payment is booked", async () => {
    for (const h of hosts) {
      const report = (await draftOf(h)).value;
      expect(report.reconcile.status).toBe("succeeded");
      expect(report.reconcile.unknownAccounts).toEqual([]);
      expect(report.reconcile.unsettled).toEqual([]);
      expect(report.reconcile.missingInStripe).toEqual([]);
      expect(report.reconcile.amountMismatches).toEqual([]);
      expect(report.reconcile.returned).toEqual([]);
      expect(report.blocked).toEqual([]);
    }
    expect(reported).toEqual([]);

    const nl = await entries(hosts[0].orgId);
    expect(nl.filter((e) => e.kind === "fee").map((e) => [e.fee, e.gross]).sort()).toEqual(
      hosts[0].payments.map((p) => [p.feeId, String(fee(p.stay))]).sort(),
    );
    // The full refund takes back the whole fee, with its split negated.
    expect(nl.filter((e) => e.kind === "fee_refund").map((e) => [e.gross, e.net, e.vat])).toEqual([["-2250", "-1860", "-390"]]);
    const be = await entries(hosts[1].orgId);
    expect(be.filter((e) => e.kind === "fee_refund").map((e) => [e.gross, e.net, e.vat])).toEqual([["-1350", "-1350", "0"]]);
    for (const e of [...nl, ...be]) expect(e.disposition).toBe("booked");
    for (const h of hosts) {
      const refundIds = h.payments.flatMap((p) => p.refundIds);
      const ledgerRefunds = (await entries(h.orgId)).filter((e) => e.kind === "fee_refund").map((e) => e.refund);
      expect(ledgerRefunds.sort()).toEqual(refundIds.sort());
    }
  }, 120_000);

  test("drafts have the expected totals", async () => {
    const rows = (
      await pool.query(
        `SELECT billing_entity_id AS org, status, doc_type, vat_treatment, fee_count, refund_count,
                gross_total::text AS gross, net_total::text AS net, vat_total::text AS vat
           FROM invoices WHERE billing_entity_id = ANY($1) ORDER BY billing_entity_id`,
        [hosts.map((h) => h.orgId)],
      )
    ).rows;
    const byOrg = new Map(rows.map((r) => [r.org as string, r]));
    // NL: fees 2250 + 1800, full refund -2250 → 1800 inclusive = 1488 net + 312 VAT.
    expect(byOrg.get(hosts[0].orgId)).toMatchObject({ status: "draft", doc_type: "invoice", vat_treatment: "NL_DOMESTIC", fee_count: 2, refund_count: 1, gross: "1800", net: "1488", vat: "312" });
    // BE: fee 2700, half refunded -1350 → 1350, reverse charged.
    expect(byOrg.get(hosts[1].orgId)).toMatchObject({ status: "draft", doc_type: "invoice", vat_treatment: "EU_REVERSE_CHARGE", fee_count: 1, refund_count: 1, gross: "1350", net: "1350", vat: "0" });
  });

  test("issue, store and deliver once each", async () => {
    for (const h of hosts) {
      const issued = await runIssue(period, {
        db: pool,
        inTransaction: poolTransaction(pool),
        env: {},
        mode: "test",
        today,
        entity: h.orgId,
      });
      expect(issued.skipped).toEqual([]);
      expect(issued.issued).toHaveLength(1);
    }

    const stored = await runStore(period, { db: pool, store });
    expect(stored.conflicts).toEqual([]);

    const docs = (
      await pool.query(
        `SELECT billing_entity_id AS org, number, status, doc_type, gross_total::text AS gross, net_total::text AS net, vat_total::text AS vat,
                pdf_key, pdf_sha256, csv_key, csv_sha256
           FROM invoices WHERE billing_entity_id = ANY($1) ORDER BY billing_entity_id`,
        [hosts.map((h) => h.orgId)],
      )
    ).rows;
    expect(docs).toHaveLength(2);
    const [nl, be] = hosts.map((h) => docs.find((d) => d.org === h.orgId)!);
    expect(nl).toMatchObject({ doc_type: "invoice", gross: "1800", net: "1488", vat: "312" });
    expect(be).toMatchObject({ doc_type: "invoice", gross: "1350", net: "1350", vat: "0" });
    for (const d of docs) {
      expect(d.number).toMatch(/^OB-\d{4}-\d{4,}$/);
      expect(d.pdf_key).toBe(`invoices/${d.number.slice(3, 7)}/${d.number}.pdf`);
      expect(d.csv_key).toBe(`invoices/${d.number.slice(3, 7)}/${d.number}-specification.csv`);
      const pdf = objects.get(d.pdf_key)!;
      const csv = objects.get(d.csv_key)!;
      expect(new TextDecoder().decode(pdf.body.slice(0, 4))).toBe("%PDF");
      expect(pdf.sha256).toBe(d.pdf_sha256);
      expect(createHash("sha256").update(pdf.body).digest("hex")).toBe(d.pdf_sha256);
      expect(csv.sha256).toBe(d.csv_sha256);
      expect(createHash("sha256").update(csv.body).digest("hex")).toBe(d.csv_sha256);
    }
    // No guest data: the specification names bookings by reference only.
    const csv = new TextDecoder().decode(objects.get(nl.csv_key)!.body);
    expect(csv).not.toContain("example.test");
    expect(csv).not.toContain("Test Guest");

    // Every entry of the month belongs to exactly one of the two invoices.
    for (const h of hosts) {
      const invoiceId = (await pool.query(`SELECT id FROM invoices WHERE billing_entity_id = $1`, [h.orgId])).rows[0].id;
      expect((await entries(h.orgId)).every((e) => e.invoice_id === invoiceId)).toBe(true);
    }

    const mail = async (m: InvoiceMail) => {
      mailed.push(m);
      return { messageId: `msg-${m.idempotencyKey}` };
    };
    await runDeliver(period, { db: pool, store, mail });
    const ours = () => mailed.filter((m) => hosts.some((h) => h.email === m.to));
    expect(ours().map((m) => m.to).sort()).toEqual(hosts.map((h) => h.email).sort());
    for (const m of ours()) expect(m.attachments.map((a) => a.contentType).sort()).toEqual(["application/pdf", "text/csv"]);

    const again = await runDeliver(period, { db: pool, store, mail });
    expect(again.sent).toEqual([]);
    expect(ours()).toHaveLength(2);
    const sent = (await pool.query(`SELECT status, email_message_id FROM invoices WHERE billing_entity_id = ANY($1)`, [hosts.map((h) => h.orgId)])).rows;
    expect(sent.every((r) => r.status === "sent" && r.email_message_id)).toBe(true);
  }, 180_000);
});
