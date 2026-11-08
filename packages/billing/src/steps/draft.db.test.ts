import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { periodFor } from "../period";
import { upsertBillingProfile } from "../profiles";
import type { ViesResult } from "../vies";
import { entry, issuedInvoice, quietLedger, seedHost, stripeSource, type Host, type StripeSide } from "./draft.fixtures";
import { runDraft, type DraftDeps } from "./draft";
import { savepointTransaction } from "./reconcile";

const PERIOD = periodFor("2026-10");
const NOW = new Date("2026-11-01T06:00:00Z");

type InvoiceRow = {
  id: string;
  run_id: string;
  status: string;
  number: string | null;
  period_start: string;
  period_end: string;
  doc_type: string;
  vat_treatment: string;
  vat_rate_bp: number;
  fee_count: number;
  fee_base_total: string;
  fee_gross_total: string;
  refund_count: number;
  refund_base_total: string;
  refund_gross_total: string;
  refers_to_invoice_numbers: string[];
  net_total: string;
  vat_total: string;
  gross_total: string;
  vat_collected: string;
  vat_rounding_diff: string;
};

describeWithDb("drafting the monthly commission invoices", () => {
  let db: Client;
  let stripe: StripeSide;
  let viesCalls: string[];

  const deps = (runId: string, over: Partial<DraftDeps> = {}): DraftDeps => ({
    db,
    stripe: stripeSource(stripe),
    ledger: quietLedger(db),
    inTransaction: savepointTransaction(db),
    vies: async (vatId): Promise<ViesResult> => {
      viesCalls.push(vatId);
      return { valid: true, requestId: "vies-new", checkedAt: NOW };
    },
    viesDeps: { requester: { countryCode: "NL", vatNumber: "NL000000000B01" } },
    now: () => NOW,
    dryRun: false,
    runId,
    ...over,
  });

  /** One draft run: its `invoice_runs` row, then the step. */
  const draft = async (over: Partial<DraftDeps> = {}) => {
    const runId = (
      await db.query(`INSERT INTO invoice_runs (period_start, step, status) VALUES ($1, 'draft', 'running') RETURNING id`, [PERIOD.start])
    ).rows[0].id as string;
    return { runId, report: await runDraft(PERIOD, deps(runId, over)) };
  };

  const invoices = async (host: Host): Promise<InvoiceRow[]> =>
    (
      await db.query(
        `SELECT id, run_id, status, number, period_start::text, period_end::text, doc_type, vat_treatment, vat_rate_bp,
                fee_count, fee_base_total::text, fee_gross_total::text, refund_count, refund_base_total::text,
                refund_gross_total::text, refers_to_invoice_numbers, net_total::text, vat_total::text, gross_total::text,
                vat_collected::text, vat_rounding_diff::text
           FROM invoices WHERE billing_entity_id = $1 ORDER BY period_start`,
        [host.orgId],
      )
    ).rows as InvoiceRow[];

  const octoberInvoice = async (host: Host) => (await invoices(host)).find((i) => i.period_start === PERIOD.start);

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
    viesCalls = [];
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("one draft per eligible host", async () => {
    const nl = await seedHost(db, "NL");
    const be = await seedHost(db, "BE");
    const incomplete = await seedHost(db, "NL");
    await upsertBillingProfile(db, incomplete.orgId, { billingEmail: null });
    await entry(db, stripe, nl, { gross: 1080n, base: 24_000n });
    await entry(db, stripe, nl, { gross: 1081n, base: 24_022n, occurredAt: "2026-10-31T22:30:00Z" }); // 31 Oct 23:30 Amsterdam
    await entry(db, stripe, be, { gross: 1080n, base: 24_000n, treatment: "EU_REVERSE_CHARGE" });
    await entry(db, stripe, incomplete, { gross: 1080n });

    const { runId, report } = await draft();

    expect(report.period).toBe("2026-10");
    expect(report.dryRun).toBe(false);
    expect(report.reconcile.status).toBe("succeeded");
    expect(report.blocked).toEqual([{ entityId: incomplete.orgId, reasons: ["missing_fields"], missing: ["billingEmail"] }]);
    expect(report.skippedIssued).toEqual([]);
    expect(await invoices(incomplete)).toEqual([]);

    const nlInvoice = await octoberInvoice(nl);
    expect(nlInvoice).toEqual({
      id: expect.any(String),
      run_id: runId,
      status: "draft",
      number: null,
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      doc_type: "invoice",
      vat_treatment: "NL_DOMESTIC",
      vat_rate_bp: 2100,
      fee_count: 2,
      fee_base_total: "48022",
      fee_gross_total: "2161",
      refund_count: 0,
      refund_base_total: "0",
      refund_gross_total: "0",
      refers_to_invoice_numbers: [],
      net_total: "1786",
      vat_total: "375",
      gross_total: "2161",
      vat_collected: "375",
      vat_rounding_diff: "0",
    });
    const beInvoice = await octoberInvoice(be);
    expect(beInvoice).toMatchObject({
      vat_treatment: "EU_REVERSE_CHARGE",
      vat_rate_bp: 0,
      net_total: "1080",
      vat_total: "0",
      gross_total: "1080",
      vat_collected: "0",
    });
    expect(viesCalls).toEqual([]);

    const mine = report.drafts.filter((d) => [nl.orgId, be.orgId].includes(d.entityId));
    expect(mine).toHaveLength(2);
    expect(mine.find((d) => d.entityId === nl.orgId)).toEqual({
      entityId: nl.orgId,
      invoiceId: nlInvoice!.id,
      docType: "invoice",
      vatTreatment: "NL_DOMESTIC",
      grossTotal: 2161n,
      netTotal: 1786n,
      vatTotal: 375n,
      vatRoundingDiff: 0n,
      feeCount: 2,
      refundCount: 0,
    });
  });

  test("a confirmed booking fully refunded in the same month gets a €0.00 invoice", async () => {
    const host = await seedHost(db);
    const fee = await entry(db, stripe, host, { gross: 1080n, base: 24_000n });
    await entry(db, stripe, host, { gross: -1080n, base: -24_000n, refundsEntryId: fee.id, occurredAt: "2026-10-20T12:00:00Z" });

    await draft();

    expect(await octoberInvoice(host)).toMatchObject({
      doc_type: "invoice",
      fee_count: 1,
      fee_gross_total: "1080",
      refund_count: 1,
      refund_base_total: "-24000",
      refund_gross_total: "-1080",
      net_total: "0",
      vat_total: "0",
      gross_total: "0",
      vat_collected: "0",
      vat_rounding_diff: "0",
    });
  });

  test("a month with only returned payments gets no document", async () => {
    const host = await seedHost(db);
    const returned = await entry(db, stripe, host, { gross: 1080n, disposition: "returned" });
    await entry(db, stripe, host, { gross: -1080n, disposition: "returned", refundsEntryId: returned.id });

    const { report } = await draft();

    expect(report.reconcile.status).toBe("succeeded");
    expect(report.drafts.filter((d) => d.entityId === host.orgId)).toEqual([]);
    expect(report.blocked).toEqual([]);
    expect(await invoices(host)).toEqual([]);
  });

  test("returned entries never count towards a draft's totals", async () => {
    const host = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n, base: 24_000n });
    const returned = await entry(db, stripe, host, { gross: 2000n, base: 44_444n, disposition: "returned" });
    await entry(db, stripe, host, { gross: -2000n, base: -44_444n, disposition: "returned", refundsEntryId: returned.id });

    await draft();

    expect(await octoberInvoice(host)).toMatchObject({
      fee_count: 1,
      fee_base_total: "24000",
      fee_gross_total: "1080",
      refund_count: 0,
      refund_gross_total: "0",
      gross_total: "1080",
      vat_collected: "187",
    });
  });

  test("a rerun replaces the draft", async () => {
    const host = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    const first = await draft();
    const before = await octoberInvoice(host);

    await entry(db, stripe, host, { gross: 540n, occurredAt: "2026-10-30T12:00:00Z" });
    const second = await draft();

    const after = await invoices(host);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: before!.id, run_id: second.runId, status: "draft", fee_count: 2, gross_total: "1620" });
    expect(second.runId).not.toBe(first.runId);
    expect(second.report.drafts.find((d) => d.entityId === host.orgId)?.invoiceId).toBe(before!.id);
  });

  test("an issued invoice is left untouched by a rerun", async () => {
    const host = await seedHost(db);
    const issuedId = await issuedInvoice(db, host, PERIOD.start, PERIOD.end, "OB-2026-0042");
    await entry(db, stripe, host, { gross: 540n }); // a late entry after the month was issued
    const before = await octoberInvoice(host);

    const { report } = await draft();

    expect(report.skippedIssued).toEqual([host.orgId]);
    expect(report.drafts.filter((d) => d.entityId === host.orgId)).toEqual([]);
    const after = await invoices(host);
    expect(after).toEqual([before!]);
    expect(after[0]).toMatchObject({ id: issuedId, status: "issued", number: "OB-2026-0042", gross_total: "1080" });
  });

  test("a blocked reconcile creates no drafts", async () => {
    const host = await seedHost(db);
    const other = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    await entry(db, stripe, other, { gross: 1080n });
    await draft();
    const before = await octoberInvoice(other);
    await entry(db, stripe, host, { gross: 540n, list: false }); // a ledger entry Stripe does not have

    const { report } = await draft();

    expect(report.reconcile.status).toBe("blocked");
    expect(report.reconcile.missingInStripe).toHaveLength(1);
    expect(report.drafts).toEqual([]);
    expect(report.blocked).toEqual([]);
    expect(await octoberInvoice(host)).toMatchObject({ fee_count: 1, gross_total: "1080" });
    expect(await octoberInvoice(other)).toEqual(before!);
  });

  test("refund of a not-yet-issued fee", async () => {
    const host = await seedHost(db);
    const september = await entry(db, stripe, host, { gross: 1080n, occurredAt: "2026-09-12T12:00:00Z", list: false });
    await entry(db, stripe, host, { gross: -540n, refundsEntryId: september.id });

    await draft();

    expect(await octoberInvoice(host)).toMatchObject({
      status: "draft",
      doc_type: "credit_note",
      fee_count: 0,
      refund_count: 1,
      gross_total: "-540",
      refers_to_invoice_numbers: [],
    });
  });

  test("referenced invoice numbers come from the refunded fees' invoices", async () => {
    const host = await seedHost(db);
    const augustInvoice = await issuedInvoice(db, host, "2026-08-01", "2026-08-31", "OB-2026-0007");
    const septemberInvoice = await issuedInvoice(db, host, "2026-09-01", "2026-09-30", "OB-2026-0003");
    const inAugust = { occurredAt: "2026-08-12T12:00:00Z", list: false };
    const inSeptember = { occurredAt: "2026-09-12T12:00:00Z", list: false };
    const a = await entry(db, stripe, host, { gross: 1080n, invoiceId: augustInvoice, ...inAugust });
    const b = await entry(db, stripe, host, { gross: 1080n, invoiceId: septemberInvoice, ...inSeptember });
    const c = await entry(db, stripe, host, { gross: 1080n, invoiceId: septemberInvoice, ...inSeptember });
    const notIssued = await entry(db, stripe, host, { gross: 1080n, ...inSeptember });
    await entry(db, stripe, host, { gross: 2000n });
    await entry(db, stripe, host, { gross: -1080n, refundsEntryId: a.id });
    await entry(db, stripe, host, { gross: -270n, refundsEntryId: b.id });
    await entry(db, stripe, host, { gross: -270n, refundsEntryId: c.id });
    await entry(db, stripe, host, { gross: -100n, refundsEntryId: notIssued.id });

    await draft();

    expect(await octoberInvoice(host)).toMatchObject({
      doc_type: "invoice",
      fee_count: 1,
      refund_count: 4,
      refund_gross_total: "-1720",
      gross_total: "280",
      refers_to_invoice_numbers: ["OB-2026-0003", "OB-2026-0007"],
    });
  });

  test("--entity limits the run to one host", async () => {
    const one = await seedHost(db);
    const other = await seedHost(db);
    await entry(db, stripe, one, { gross: 1080n });
    await entry(db, stripe, other, { gross: 1080n });
    await draft({ entity: other.orgId });
    const otherBefore = await octoberInvoice(other);
    await entry(db, stripe, other, { gross: 540n, occurredAt: "2026-10-29T12:00:00Z" });

    const { report } = await draft({ entity: one.orgId });

    expect(report.drafts.map((d) => d.entityId)).toEqual([one.orgId]);
    expect(await octoberInvoice(one)).toMatchObject({ status: "draft", gross_total: "1080" });
    expect(await octoberInvoice(other)).toEqual(otherBefore!);
  });

  test("a host that is now blocked loses its stale draft", async () => {
    const host = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    await draft();
    expect(await invoices(host)).toHaveLength(1);
    await upsertBillingProfile(db, host.orgId, { billingEmail: "" });

    const { report } = await draft();

    expect(report.blocked).toEqual([{ entityId: host.orgId, reasons: ["missing_fields"], missing: ["billingEmail"] }]);
    expect(await invoices(host)).toEqual([]);
  });

  test("a host with no booked entries any more loses its stale draft", async () => {
    const host = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    await draft();
    const stale = (await octoberInvoice(host))!;
    // Stand in for entries that are no longer the period's: move the draft to a host with nothing this month.
    const empty = await seedHost(db);
    await db.query(`UPDATE invoices SET billing_entity_id = $2 WHERE id = $1`, [stale.id, empty.orgId]);

    await draft();

    expect(await invoices(empty)).toEqual([]);
    expect(await octoberInvoice(host)).toMatchObject({ status: "draft", gross_total: "1080" });
  });

  test("a dry run writes no invoices", async () => {
    const host = await seedHost(db);
    const fresh = await seedHost(db);
    await entry(db, stripe, host, { gross: 1080n });
    await draft();
    const before = await octoberInvoice(host);
    await entry(db, stripe, host, { gross: 540n, occurredAt: "2026-10-29T12:00:00Z" });
    await entry(db, stripe, fresh, { gross: 1080n });

    const { report } = await draft({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.reconcile.status).toBe("succeeded");
    expect(report.drafts.find((d) => d.entityId === host.orgId)).toMatchObject({ invoiceId: before!.id, grossTotal: 1620n, feeCount: 2 });
    expect(report.drafts.find((d) => d.entityId === fresh.orgId)).toMatchObject({ invoiceId: `dry-run:${fresh.orgId}`, grossTotal: 1080n });
    expect(await octoberInvoice(host)).toEqual(before!);
    expect(await invoices(fresh)).toEqual([]);
  });
});
