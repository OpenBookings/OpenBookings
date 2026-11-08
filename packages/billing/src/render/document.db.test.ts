import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { upsertBillingProfile } from "../profiles";
import { entry, issuedInvoice, seedHost, type Host, type StripeSide } from "../steps/draft.fixtures";
import { loadInvoiceDocument, type PartySnapshot } from "./document";
import { SELLER } from "./fixtures";

const BUYER: PartySnapshot = {
  legalName: "Hotel BV",
  addressLines: ["1 Canal Street", "1011 AA Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL123456789B01",
  kvk: "12345678",
  email: "billing@hotel.test",
};

describeWithDb("loading an invoice document", () => {
  let db: Client;
  let stripe: StripeSide;
  let host: Host;

  /** The October invoice of `host`, in the given state. */
  const october = async (status: "draft" | "issued", over: { gross?: string; net?: string; vat?: string } = {}) => {
    const issued = status === "issued";
    const { rows } = await db.query(
      `INSERT INTO invoices
         (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
          seller, buyer, vat_treatment, vat_rate_bp, fee_count, fee_base_total, fee_gross_total,
          refund_count, refund_base_total, refund_gross_total, refers_to_invoice_numbers,
          net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
       VALUES ($1, '2026-10-01', '2026-10-31', 'invoice', $2, $3, $4, $5, $6, $7, $8, 'NL_DOMESTIC', 2100,
               2, 46000, 2070, 1, -11000, -495, $9, $10, $11, $12, 0, 0)
       RETURNING id`,
      [
        host.orgId,
        status,
        issued ? "OB-2026" : null,
        issued ? 42 : null,
        issued ? "OB-2026-0042" : null,
        issued ? "2026-11-01" : null,
        issued ? JSON.stringify({ ...SELLER }) : null,
        issued ? JSON.stringify(BUYER) : null,
        issued ? ["OB-2026-0031"] : [],
        over.net ?? "1301",
        over.vat ?? "274",
        over.gross ?? "1575",
      ],
    );
    return rows[0].id as string;
  };

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
    host = await seedHost(db, "NL");
    await db.query(`UPDATE bookings SET commission_rate = 0.045 WHERE id = $1`, [host.bookingId]);
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("an issued invoice comes from its row and its linked entries only", async () => {
    const earlier = await issuedInvoice(db, host, "2026-09-01", "2026-09-30", "OB-2026-0031");
    const originalFee = await entry(db, stripe, host, { gross: 990n, base: 22_000n, invoiceId: earlier, occurredAt: "2026-09-20T10:00:00Z" });
    const id = await october("issued");
    await entry(db, stripe, host, { gross: 1080n, base: 24_000n, invoiceId: id, occurredAt: "2026-10-31T23:30:00Z" });
    await entry(db, stripe, host, { gross: 990n, base: 22_000n, invoiceId: id, occurredAt: "2026-10-05T10:00:00Z" });
    await entry(db, stripe, host, { gross: -495n, base: -11_000n, invoiceId: id, refundsEntryId: originalFee.id, occurredAt: "2026-10-06T10:00:00Z" });
    // Not linked to the invoice, though inside the month: must not show up.
    await entry(db, stripe, host, { gross: 4500n, base: 100_000n, occurredAt: "2026-10-07T10:00:00Z" });
    // The host's live profile moves on; the document must not.
    await upsertBillingProfile(db, host.orgId, { legalName: "Renamed BV" });

    const doc = await loadInvoiceDocument(db, id);

    expect(doc.number).toBe("OB-2026-0042");
    expect(doc.issuedOn).toBe("2026-11-01");
    expect(doc.docType).toBe("invoice");
    expect(doc.buyer).toEqual(BUYER);
    expect(doc.seller.legalName).toBe("OpenBookings B.V.");
    expect(doc.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(doc.commissionRatePercent).toBe("4.5");
    expect(doc.rows.map((r) => [r.kind, r.paidOn, r.gross])).toEqual([
      ["fee", "2026-10-05", 990n],
      ["fee_refund", "2026-10-06", -495n],
      ["fee", "2026-11-01", 1080n], // 00:30 CET is already 1 Nov in Amsterdam
    ]);
    const refund = doc.rows[1]!;
    expect(refund.refundNote).toBe("Cancelled · 50% refund · from OB-2026-0031");
    expect(refund.fromInvoice).toBe("OB-2026-0031");
    expect(doc.lines.refund?.refersTo).toEqual(["OB-2026-0031"]);
    expect(doc.totals).toEqual({ net: 1301n, vat: 274n, gross: 1575n });
  });

  test("the specification adds up to the invoice's lines", async () => {
    const id = await october("issued");
    await entry(db, stripe, host, { gross: 1080n, base: 24_000n, invoiceId: id });
    await entry(db, stripe, host, { gross: 990n, base: 22_000n, invoiceId: id });
    await entry(db, stripe, host, { gross: -495n, base: -11_000n, invoiceId: id });

    const doc = await loadInvoiceDocument(db, id);
    const sum = (kind: string, pick: "base" | "gross") =>
      doc.rows.filter((r) => r.kind === kind).reduce((total, r) => total + r[pick], 0n);

    expect(sum("fee", "base")).toBe(doc.lines.fee.base);
    expect(sum("fee", "gross")).toBe(doc.lines.fee.gross);
    expect(sum("fee_refund", "base")).toBe(doc.lines.refund?.base ?? 0n);
    expect(sum("fee_refund", "gross")).toBe(doc.lines.refund?.gross ?? 0n);
    expect(doc.lines.fee.gross + (doc.lines.refund?.gross ?? 0n)).toBe(doc.totals.gross);
  });

  test("a draft is the month's un-invoiced booked entries with the parties passed in", async () => {
    const id = await october("draft");
    await entry(db, stripe, host, { gross: 1080n, base: 24_000n, occurredAt: "2026-10-03T10:00:00Z" });
    await entry(db, stripe, host, { gross: -540n, base: -12_000n, occurredAt: "2026-10-09T10:00:00Z" });
    await entry(db, stripe, host, { gross: 999n, disposition: "returned", occurredAt: "2026-10-04T10:00:00Z" });
    await entry(db, stripe, host, { gross: 777n, occurredAt: "2026-11-01T00:30:00Z" }); // 1 Nov 01:30 Amsterdam
    await entry(db, stripe, host, { gross: 555n, occurredAt: "2026-09-30T21:30:00Z" }); // 30 Sep 23:30 Amsterdam

    const doc = await loadInvoiceDocument(db, id, { seller: SELLER, buyer: BUYER });

    expect(doc.number).toBeNull();
    expect(doc.issuedOn).toBeNull();
    expect(doc.buyer).toEqual(BUYER);
    expect(doc.rows.map((r) => r.gross)).toEqual([1080n, -540n]);
    expect(doc.totals).toEqual({ net: 446n, vat: 94n, gross: 540n });
    expect(doc.lines.fee).toEqual({ count: 1, base: 24_000n, gross: 1080n });
    expect(doc.lines.refund).toEqual({ count: 1, base: -12_000n, gross: -540n, refersTo: [] });
  });

  test("a draft without parties throws", async () => {
    const id = await october("draft");
    await expect(loadInvoiceDocument(db, id)).rejects.toThrow(/seller and buyer/);
  });

  test("differing commission rates leave the rate out", async () => {
    const id = await october("issued");
    await entry(db, stripe, host, { gross: 1080n, base: 24_000n, invoiceId: id });
    const second = await seedHost(db, "NL");
    await db.query(`UPDATE bookings SET commission_rate = 0.05 WHERE id = $1`, [second.bookingId]);
    await db.query(`UPDATE commission_entries SET invoice_id = $1 WHERE booking_id = $2`, [id, second.bookingId]);
    await entry(db, stripe, second, { gross: 1000n, base: 20_000n, invoiceId: id });

    expect((await loadInvoiceDocument(db, id)).commissionRatePercent).toBeNull();
  });
});
