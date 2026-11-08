import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "./testing/db-harness";

describeWithDb("commission invoices schema against Postgres", () => {
  let db: Client;
  let orgId: string;
  let propertyId: string;
  let bookingId: string;

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
    orgId = `test-org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Test Org', $1, now())`, [orgId]);
    const ids = await seedProperty(db);
    propertyId = ids.propertyId;
    bookingId = (await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 })).bookingId;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  type Overrides = Record<string, unknown>;

  /** Insert a ledger entry; any column can be overridden, and null clears a default. */
  const insertEntry = async (overrides: Overrides = {}) => {
    const row: Overrides = {
      kind: "fee",
      billing_entity_id: orgId,
      property_id: propertyId,
      booking_id: bookingId,
      booking_ref: bookingId.slice(0, 8).toUpperCase(),
      stay_start: "2031-11-10",
      stay_end: "2031-11-12",
      stripe_account_id: "acct_test",
      stripe_application_fee_id: `fee_${crypto.randomUUID()}`,
      base_amount: 20000,
      commission_net: 744,
      vat_rate_bp: 2100,
      vat_amount: 156,
      gross_amount: 900,
      vat_treatment: "NL_DOMESTIC",
      currency: "eur",
      occurred_at: "2031-11-01T10:00:00Z",
      disposition: "booked",
      ...overrides,
    };
    const cols = Object.keys(row);
    const result = await db.query(
      `INSERT INTO commission_entries (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      cols.map((c) => row[c]),
    );
    return result.rows[0].id as string;
  };

  const insertRun = async () =>
    (
      await db.query(
        `INSERT INTO invoice_runs (period_start, step, status) VALUES ('2031-11-01', 'draft', 'running') RETURNING id`,
      )
    ).rows[0].id as string;

  const insertInvoice = async (overrides: Overrides = {}) => {
    const row: Overrides = {
      run_id: await insertRun(),
      billing_entity_id: orgId,
      period_start: "2031-10-01",
      period_end: "2031-11-01",
      doc_type: "invoice",
      status: "draft",
      vat_treatment: "NL_DOMESTIC",
      vat_rate_bp: 2100,
      fee_count: 1,
      fee_base_total: 20000,
      fee_gross_total: 900,
      refund_count: 0,
      refund_base_total: 0,
      refund_gross_total: 0,
      net_total: 744,
      vat_total: 156,
      gross_total: 900,
      vat_collected: 156,
      vat_rounding_diff: 0,
      seller: JSON.stringify({ name: "Seller" }),
      buyer: JSON.stringify({ name: "Buyer" }),
      ...overrides,
    };
    const cols = Object.keys(row);
    const result = await db.query(
      `INSERT INTO invoices (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      cols.map((c) => row[c]),
    );
    return result.rows[0].id as string;
  };

  const issued = (n: number) => ({
    status: "issued",
    series: "OB-2031",
    sequence_number: n,
    number: `OB-2031-${String(n).padStart(4, "0")}`,
    issued_on: "2031-11-05",
  });

  /** Run a statement that must fail, then undo only its aborted state. */
  const rejects = async (run: () => Promise<unknown>, pattern: RegExp) => {
    await db.query("SAVEPOINT attempt");
    await expect(run()).rejects.toThrow(pattern);
    await db.query("ROLLBACK TO SAVEPOINT attempt");
  };

  test("commission entries reject DELETE", async () => {
    const id = await insertEntry();
    await rejects(() => db.query("DELETE FROM commission_entries WHERE id = $1", [id]), /append-only/);
  });

  test("commission entries reject UPDATE of anything but invoice_id", async () => {
    const id = await insertEntry();
    await rejects(() => db.query("UPDATE commission_entries SET base_amount = 1 WHERE id = $1", [id]), /append-only/);
  });

  test("invoice_id can be set once and never changed", async () => {
    const id = await insertEntry();
    const first = await insertInvoice();
    const second = await insertInvoice({ period_start: "2031-09-01", period_end: "2031-10-01" });
    await db.query("UPDATE commission_entries SET invoice_id = $1 WHERE id = $2", [first, id]);
    await rejects(
      () => db.query("UPDATE commission_entries SET invoice_id = $1 WHERE id = $2", [second, id]),
      /append-only/,
    );
    await rejects(() => db.query("UPDATE commission_entries SET invoice_id = NULL WHERE id = $1", [id]), /append-only/);
  });

  test("a returned entry cannot be linked to an invoice", async () => {
    const invoiceId = await insertInvoice();
    await rejects(() => insertEntry({ disposition: "returned", booking_id: null, invoice_id: invoiceId }), /check/);
    const id = await insertEntry({ disposition: "returned", booking_id: null });
    await rejects(() => db.query("UPDATE commission_entries SET invoice_id = $1 WHERE id = $2", [invoiceId, id]), /check/);
  });

  test("a booked entry needs a booking, property, reference and stay dates", async () => {
    for (const column of ["booking_id", "property_id", "booking_ref", "stay_start", "stay_end"]) {
      await rejects(() => insertEntry({ [column]: null }), /check/);
    }
    // An unexplained returned payment may lack all of them.
    await insertEntry({
      disposition: "returned",
      booking_id: null,
      property_id: null,
      booking_ref: null,
      stay_start: null,
      stay_end: null,
    });
  });

  test("gross must equal net + vat", async () => {
    await rejects(() => insertEntry({ gross_amount: 901 }), /check/);
  });

  test("a second fee entry for the same fee id is refused", async () => {
    await insertEntry({ stripe_application_fee_id: "fee_dup" });
    await rejects(() => insertEntry({ stripe_application_fee_id: "fee_dup" }), /unique/);
    // A refund of that fee shares the fee id but is its own entry, once per refund id.
    await insertEntry({ kind: "fee_refund", stripe_application_fee_id: "fee_dup", stripe_fee_refund_id: "fr_1" });
    await rejects(
      () => insertEntry({ kind: "fee_refund", stripe_application_fee_id: "fee_dup", stripe_fee_refund_id: "fr_1" }),
      /unique/,
    );
  });

  test("an issued invoice rejects a change to totals, number or buyer", async () => {
    const id = await insertInvoice(issued(1));
    for (const [column, value] of [
      ["gross_total", 1000],
      ["number", "OB-2031-0099"],
      ["buyer", JSON.stringify({ name: "Someone else" })],
      ["status", "draft"],
    ] as const) {
      await rejects(() => db.query(`UPDATE invoices SET ${column} = $1 WHERE id = $2`, [value, id]), /immutable/);
    }
  });

  test("an issued invoice may become sent and gain pdf/csv keys once", async () => {
    const id = await insertInvoice(issued(2));
    await db.query(
      `UPDATE invoices SET pdf_key = 'k.pdf', pdf_sha256 = 'aa', csv_key = 'k.csv', csv_sha256 = 'bb' WHERE id = $1`,
      [id],
    );
    await db.query(`UPDATE invoices SET status = 'sent', sent_at = now(), email_message_id = 'm1' WHERE id = $1`, [id]);
    const row = (await db.query("SELECT status, pdf_key FROM invoices WHERE id = $1", [id])).rows[0];
    expect(row).toEqual({ status: "sent", pdf_key: "k.pdf" });
    await rejects(() => db.query(`UPDATE invoices SET pdf_key = 'other.pdf' WHERE id = $1`, [id]), /immutable/);
  });

  test("an issued invoice cannot be deleted; a draft can", async () => {
    const draft = await insertInvoice();
    await db.query("DELETE FROM invoices WHERE id = $1", [draft]);
    const id = await insertInvoice({ ...issued(3), period_start: "2031-09-01", period_end: "2031-10-01" });
    await rejects(() => db.query("DELETE FROM invoices WHERE id = $1", [id]), /immutable/);
  });

  test("an organization with billing records cannot be deleted", async () => {
    await db.query(`INSERT INTO billing_profiles (organization_id, legal_name) VALUES ($1, 'Test BV')`, [orgId]);
    await rejects(() => db.query(`DELETE FROM "organization" WHERE id = $1`, [orgId]), /foreign key/);
    await db.query("DELETE FROM billing_profiles WHERE organization_id = $1", [orgId]);
    await insertEntry();
    await rejects(() => db.query(`DELETE FROM "organization" WHERE id = $1`, [orgId]), /foreign key/);
  });
});
