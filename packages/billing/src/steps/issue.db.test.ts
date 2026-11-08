import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client, Pool } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { periodFor, type Period } from "../period";
import { upsertBillingProfile } from "../profiles";
import { loadInvoiceDocument, type PartySnapshot } from "../render/document";
import { withRun } from "../runs";
import { SellerConfigError } from "../seller";
import { entry, quietLedger, seedHost, stripeSource, type Host, type StripeSide } from "./draft.fixtures";
import { runDraft } from "./draft";
import { IssueMismatchError, invoiceNumber, issueInvoice, runIssue, type IssueDeps } from "./issue";
import { poolTransaction, savepointTransaction } from "./reconcile";

const PERIOD = periodFor("2026-10");
const TODAY = "2026-11-05";

const SELLER: PartySnapshot = {
  legalName: "OpenBookings B.V.",
  addressLines: ["Keizersgracht 1", "1015 CC Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL123456789B01",
  kvk: "12345678",
  email: "billing@openbookings.test",
};

const BUYER: PartySnapshot = {
  legalName: "Hotel BV",
  addressLines: ["1 Canal Street", "1011 AA Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL123456789B01",
  kvk: null,
  email: "billing@hotel.test",
};

/** A draft written directly, with counts that need not match any entries. */
async function draftRow(
  db: Client | Pool,
  orgId: string,
  period: Pick<Period, "start" | "end">,
  counts: { fees?: number; refunds?: number } = {},
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO invoices
       (billing_entity_id, period_start, period_end, doc_type, status, vat_treatment, vat_rate_bp,
        fee_count, refund_count, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
     VALUES ($1, $2, $3, 'invoice', 'draft', 'NL_DOMESTIC', 2100, $4, $5, 0, 0, 0, 0, 0)
     RETURNING id`,
    [orgId, period.start, period.end, counts.fees ?? 0, counts.refunds ?? 0],
  );
  return rows[0].id as string;
}

describeWithDb("issuing the monthly commission invoices", () => {
  let db: Client;
  let stripe: StripeSide;

  const deps = (over: Partial<IssueDeps> = {}): IssueDeps => ({
    db,
    inTransaction: savepointTransaction(db),
    env: {},
    mode: "test",
    today: TODAY,
    ...over,
  });

  /** A draft run of the period as the job records it, so issuing is allowed. */
  const draft = async () =>
    withRun(db, { periodStart: PERIOD.start, step: "draft" }, async (runId) => {
      const report = await runDraft(PERIOD, {
        db,
        stripe: stripeSource(stripe),
        ledger: quietLedger(db),
        inTransaction: savepointTransaction(db),
        vies: async () => {
          throw new Error("unexpected VIES check");
        },
        viesDeps: { requester: { countryCode: "NL", vatNumber: "NL000000000B01" } },
        now: () => new Date("2026-11-01T06:00:00Z"),
        dryRun: false,
        runId,
      });
      return { status: report.reconcile.status, report, value: report };
    });

  /** A draft run row with the given outcome, written directly. */
  const recordDraftRun = async (status: "succeeded" | "blocked" | "failed", reconcile: string | null) => {
    const report = status === "failed" ? { error: "boom" } : { dryRun: false, reconcile: { status: reconcile } };
    await db.query(
      `INSERT INTO invoice_runs (period_start, step, status, started_at, finished_at, report)
       VALUES ($1, 'draft', $2, clock_timestamp(), clock_timestamp(), $3::jsonb)`,
      [PERIOD.start, status, JSON.stringify(report)],
    );
  };

  const invoiceOf = async (id: string) =>
    (
      await db.query(
        `SELECT status, series, sequence_number, number, issued_on::text AS issued_on, seller, buyer
           FROM invoices WHERE id = $1`,
        [id],
      )
    ).rows[0] as {
      status: string;
      series: string | null;
      sequence_number: number | null;
      number: string | null;
      issued_on: string | null;
      seller: unknown;
      buyer: unknown;
    };

  const linked = async (host: Host) =>
    (
      await db.query(`SELECT invoice_id FROM commission_entries WHERE billing_entity_id = $1 ORDER BY occurred_at, id`, [
        host.orgId,
      ])
    ).rows.map((r) => r.invoice_id as string | null);

  const nextValue = async (series: string) =>
    ((await db.query(`SELECT next_value FROM invoice_sequences WHERE series = $1`, [series])).rows[0]?.next_value as
      | number
      | undefined) ?? null;

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
    stripe = { listed: [] };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("the first invoice of 2026 is OB-2026-0001", async () => {
    const host = await seedHost(db, "NL");
    const fee = await entry(db, stripe, host, { gross: 1080n, base: 24_000n });
    await entry(db, stripe, host, { gross: 1081n, base: 24_022n, occurredAt: "2026-10-31T22:30:00Z" });
    await entry(db, stripe, host, { gross: -540n, base: -12_000n, refundsEntryId: fee.id, occurredAt: "2026-10-20T09:00:00Z" });
    // Not this month's, and returned: neither is linked.
    await entry(db, stripe, host, { gross: 1080n, occurredAt: "2026-11-01T00:30:00Z", list: false });
    const returned = await entry(db, stripe, host, { gross: 1080n, disposition: "returned" });
    await entry(db, stripe, host, { gross: -1080n, disposition: "returned", refundsEntryId: returned.id });
    const { value: drafted } = await draft();
    const invoiceId = drafted.drafts[0]!.invoiceId;

    const report = await runIssue(PERIOD, deps());

    expect(report).toEqual({ period: "2026-10", issued: [{ entityId: host.orgId, invoiceId, number: "OB-2026-0001" }], skipped: [] });
    expect(await invoiceOf(invoiceId)).toEqual({
      status: "issued",
      series: "OB-2026",
      sequence_number: 1,
      number: "OB-2026-0001",
      issued_on: TODAY,
      seller: {
        legalName: "[SELLER_LEGAL_NAME]",
        addressLines: ["[SELLER_ADDRESS]"],
        countryName: "Netherlands",
        vatId: "[SELLER_VAT_ID]",
        kvk: "[SELLER_KVK]",
        email: "[SELLER_BILLING_EMAIL]",
      },
      buyer: BUYER,
    });
    const ids = await linked(host);
    expect(ids.filter((id) => id === invoiceId)).toHaveLength(3);
    expect(ids.filter((id) => id === null)).toHaveLength(3);
    expect(await nextValue("OB-2026")).toBe(2);

    // The stored snapshots are what the renderer reads.
    const doc = await loadInvoiceDocument(db, invoiceId);
    expect(doc.number).toBe("OB-2026-0001");
    expect(doc.buyer).toEqual(BUYER);
    expect(doc.rows).toHaveLength(3);
  });

  test("numbers continue per year and restart in a new year", async () => {
    const a = await seedHost(db);
    const b = await seedHost(db);
    const c = await seedHost(db);
    const d = await seedHost(db);
    const issue = async (host: Host, today: string) =>
      issueInvoice(db, await draftRow(db, host.orgId, PERIOD), { today, seller: SELLER, buyer: BUYER });

    expect(await issue(a, "2026-11-05")).toEqual({ number: "OB-2026-0001" });
    expect(await issue(b, "2026-12-31")).toEqual({ number: "OB-2026-0002" });
    expect(await issue(c, "2027-01-01")).toEqual({ number: "OB-2027-0001" });
    expect(await issue(d, "2026-12-31")).toEqual({ number: "OB-2026-0003" });
    expect(await nextValue("OB-2026")).toBe(4);
    expect(await nextValue("OB-2027")).toBe(2);
  });

  test("a mismatch in linked entries rolls back and leaves no gap", async () => {
    const stale = await seedHost(db);
    const other = await seedHost(db);
    await entry(db, stripe, stale, { gross: 1080n });
    await entry(db, stripe, stale, { gross: 1080n, occurredAt: "2026-10-15T12:00:00Z" });
    // The draft counted one fee, but the month now holds two.
    const staleId = await draftRow(db, stale.orgId, PERIOD, { fees: 1 });

    let caught: unknown;
    try {
      await issueInvoice(db, staleId, { today: TODAY, seller: SELLER, buyer: BUYER });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IssueMismatchError);
    expect((caught as IssueMismatchError).expected).toBe(1);
    expect((caught as IssueMismatchError).affected).toBe(2);

    expect(await invoiceOf(staleId)).toMatchObject({ status: "draft", number: null, series: null, sequence_number: null });
    expect(await linked(stale)).toEqual([null, null]);
    expect(await nextValue("OB-2026")).toBeNull();

    const otherId = await draftRow(db, other.orgId, PERIOD);
    expect(await issueInvoice(db, otherId, { today: TODAY, seller: SELLER, buyer: BUYER })).toEqual({ number: "OB-2026-0001" });
  });

  test("issuing twice changes nothing", async () => {
    const host = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    await draft();

    const first = await runIssue(PERIOD, deps());
    expect(first.issued.map((i) => i.number)).toEqual(["OB-2026-0001"]);
    const invoiceId = first.issued[0]!.invoiceId;
    const before = await invoiceOf(invoiceId);

    expect(await runIssue(PERIOD, deps({ today: "2026-11-06" }))).toEqual({ period: "2026-10", issued: [], skipped: [] });
    expect(await issueInvoice(db, invoiceId, { today: "2026-11-06", seller: SELLER, buyer: BUYER })).toEqual({
      skipped: "not_draft",
    });
    expect(await invoiceOf(invoiceId)).toEqual(before);
    expect(await linked(host)).toEqual([invoiceId]);
    expect(await nextValue("OB-2026")).toBe(2);
  });

  test("refuses when reconcile did not succeed", async () => {
    const host = await seedHost(db);
    const invoiceId = await draftRow(db, host.orgId, PERIOD);

    await expect(runIssue(PERIOD, deps())).rejects.toThrow("No completed draft run for 2026-10 — run the draft step first");

    await recordDraftRun("blocked", "blocked");
    await expect(runIssue(PERIOD, deps())).rejects.toThrow(
      "Reconciliation for 2026-10 is blocked — resolve it and rerun the draft step first",
    );

    await recordDraftRun("failed", null);
    await expect(runIssue(PERIOD, deps())).rejects.toThrow("The last draft run for 2026-10 failed — rerun the draft step first");

    // A dry run never unlocks issuing.
    await db.query(
      `INSERT INTO invoice_runs (period_start, step, status, started_at, report)
       VALUES ($1, 'draft', 'succeeded', clock_timestamp(), '{"dryRun": true, "reconcile": {"status": "succeeded"}}')`,
      [PERIOD.start],
    );
    await expect(runIssue(PERIOD, deps())).rejects.toThrow(/failed/);

    expect(await invoiceOf(invoiceId)).toMatchObject({ status: "draft", number: null });
    expect(await nextValue("OB-2026")).toBeNull();
  });

  test("live mode refuses to issue without the seller's details", async () => {
    const host = await seedHost(db);
    const invoiceId = await draftRow(db, host.orgId, PERIOD);
    await recordDraftRun("succeeded", "succeeded");

    await expect(runIssue(PERIOD, deps({ mode: "live", env: { SELLER_KVK: "12345678" } }))).rejects.toBeInstanceOf(
      SellerConfigError,
    );
    expect(await invoiceOf(invoiceId)).toMatchObject({ status: "draft", number: null });
  });

  test("a stale draft is skipped and the other hosts are still issued", async () => {
    const hosts = [await seedHost(db), await seedHost(db), await seedHost(db)].sort((x, y) => (x.orgId < y.orgId ? -1 : 1));
    const [first, stale, last] = hosts as [Host, Host, Host];
    for (const host of hosts) await entry(db, stripe, host, { gross: 1080n });
    await draft();
    // Recorded after the draft: the stale host's draft no longer covers its month.
    await entry(db, stripe, stale, { gross: 1080n, occurredAt: "2026-10-16T12:00:00Z" });

    const report = await runIssue(PERIOD, deps());

    expect(report.issued.map((i) => [i.entityId, i.number])).toEqual([
      [first.orgId, "OB-2026-0001"],
      [last.orgId, "OB-2026-0002"],
    ]);
    expect(report.skipped).toEqual([
      { entityId: stale.orgId, reason: "draft_stale", message: "Draft is stale — rerun the draft step for this period" },
    ]);
    expect(await linked(stale)).toEqual([null, null]);
  });

  test("a host whose billing profile is no longer complete is skipped", async () => {
    const [x, y] = [await seedHost(db), await seedHost(db)].sort((p, q) => (p.orgId < q.orgId ? -1 : 1)) as [Host, Host];
    await entry(db, stripe, x, { gross: 1080n });
    await entry(db, stripe, y, { gross: 1080n });
    await draft();
    await upsertBillingProfile(db, x.orgId, { billingEmail: " ", city: null });

    const report = await runIssue(PERIOD, deps());

    expect(report.skipped).toEqual([
      { entityId: x.orgId, reason: "missing_fields", message: "Billing profile is missing: city, billingEmail" },
    ]);
    expect(report.issued.map((i) => [i.entityId, i.number])).toEqual([[y.orgId, "OB-2026-0001"]]);
    expect(await linked(x)).toEqual([null]);
  });

  test("entity limits issuing to one host", async () => {
    const x = await seedHost(db);
    const y = await seedHost(db);
    await entry(db, stripe, x, { gross: 1080n });
    await entry(db, stripe, y, { gross: 1080n });
    await draft();

    const report = await runIssue(PERIOD, deps({ entity: y.orgId }));

    expect(report.issued.map((i) => [i.entityId, i.number])).toEqual([[y.orgId, "OB-2026-0001"]]);
    expect(await linked(x)).toEqual([null]);
  });
});

describeWithDb("issuing on separate connections", () => {
  // These issues commit, so everything they touch is private to this run: its
  // own organizations and a series in a year no other data reaches. Issued
  // invoices cannot be deleted through the immutability trigger, so the
  // cleanup switches it off inside its own transaction.
  const year = 2100 + Math.floor(Math.random() * 7800);
  const series = `OB-${year}`;
  const prefix = `org-issue-test-${crypto.randomUUID().slice(0, 8)}-`;
  let pool: Pool;

  const leftovers = async () => {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM invoices WHERE billing_entity_id LIKE $1)::int AS invoices,
              (SELECT count(*) FROM "organization" WHERE id LIKE $1)::int AS organizations,
              (SELECT count(*) FROM invoice_sequences WHERE series = $2)::int AS sequences`,
      [`${prefix}%`, series],
    );
    return rows[0];
  };

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_DIRECT ?? connectionString, max: 20 });
  });
  afterAll(async () => {
    try {
      await poolTransaction(pool)(async (tx) => {
        await tx.query("ALTER TABLE invoices DISABLE TRIGGER invoices_immutable");
        await tx.query(`DELETE FROM invoices WHERE billing_entity_id LIKE $1`, [`${prefix}%`]);
        await tx.query("ALTER TABLE invoices ENABLE TRIGGER invoices_immutable");
        await tx.query(`DELETE FROM invoice_sequences WHERE series = $1`, [series]);
        await tx.query(`DELETE FROM "organization" WHERE id LIKE $1`, [`${prefix}%`]);
      });
      expect(await leftovers()).toEqual({ invoices: 0, organizations: 0, sequences: 0 });
    } finally {
      await pool.end();
    }
  });

  test("20 parallel issues give 20 distinct gapless numbers", async () => {
    const period = { start: `${year}-01-01`, end: `${year}-01-31` };
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const orgId = `${prefix}${String(i).padStart(2, "0")}`;
      await pool.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
      ids.push(await draftRow(pool, orgId, period));
    }

    // Settled, not Promise.all: a failure must not leave transactions running into the cleanup.
    const settled = await Promise.allSettled(
      ids.map((id) =>
        poolTransaction(pool)((tx) => issueInvoice(tx, id, { today: `${year}-02-03`, seller: SELLER, buyer: BUYER })),
      ),
    );
    const results = settled.map((s) => {
      if (s.status === "rejected") throw s.reason;
      return s.value;
    });

    const expected = Array.from({ length: 20 }, (_, i) => invoiceNumber(series, i + 1));
    const numbers = results.map((r) => ("number" in r ? r.number : r.skipped)).sort();
    expect(numbers).toEqual(expected);
    const { rows } = await pool.query(
      `SELECT number, sequence_number FROM invoices WHERE billing_entity_id LIKE $1 ORDER BY sequence_number`,
      [`${prefix}%`],
    );
    expect(rows).toEqual(expected.map((number, i) => ({ number, sequence_number: i + 1 })));
    const next = await pool.query(`SELECT next_value FROM invoice_sequences WHERE series = $1`, [series]);
    expect(next.rows).toEqual([{ next_value: 21 }]);
  });
});
