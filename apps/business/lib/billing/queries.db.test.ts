import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { recordViesResult, upsertBillingProfile } from "@openbookings/billing/profiles";
import { draftTotals } from "@openbookings/billing/steps/draft";
import { splitInclusive, vatRateBp, type VatTreatment } from "@openbookings/billing/vat";
import { findInvoiceFile, listInvoices, upcomingInvoice, type BillingScope } from "./queries";

const NOW = new Date("2026-11-08T10:00:00Z");

describeWithDb("billing queries", () => {
  let db: Client;

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
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  const scopeOf = (organizationId: string): BillingScope => ({ organizationId, db });

  type Host = { orgId: string; propertyId: string; bookingId: string; scope: BillingScope };

  async function host(country = "NL", verified = true): Promise<Host> {
    const { propertyId, roomId, ratePlanId } = await seedProperty(db);
    const orgId = `org-${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2 WHERE id = $1`, [propertyId, orgId]);
    await upsertBillingProfile(db, orgId, {
      legalName: "Hotel BV",
      addressLine1: "1 Canal Street",
      postalCode: "1011 AA",
      city: "Amsterdam",
      countryCode: country,
      vatId: country === "NL" ? "NL123456789B01" : "BE0123456789",
      billingEmail: "billing@hotel.test",
    });
    if (country !== "NL" && verified) {
      await recordViesResult(db, orgId, { valid: true, requestId: "r", checkedAt: new Date("2026-10-20T10:00:00Z") });
    }
    const { bookingId } = await seedBooking(db, { propertyId, roomId, ratePlanId }, { checkIn: "2026-11-20", nights: 2 });
    return { orgId, propertyId, bookingId, scope: scopeOf(orgId) };
  }

  async function entry(
    h: Host,
    gross: bigint,
    opts: { at?: string; disposition?: "booked" | "returned"; invoiceId?: string; treatment?: VatTreatment } = {},
  ): Promise<string> {
    const treatment = opts.treatment ?? "NL_DOMESTIC";
    const rate = vatRateBp(treatment);
    const { net, vat } = splitInclusive(gross, rate);
    const booked = (opts.disposition ?? "booked") === "booked";
    const { rows } = await db.query(
      `INSERT INTO commission_entries
         (kind, billing_entity_id, property_id, booking_id, booking_ref, stay_start, stay_end,
          stripe_account_id, stripe_application_fee_id, stripe_payment_ref,
          base_amount, commission_net, vat_rate_bp, vat_amount, gross_amount, vat_treatment,
          occurred_at, invoice_id, disposition)
       VALUES ('fee', $1, $2, $3, $4, '2026-11-20', '2026-11-22', 'acct_x', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        h.orgId,
        booked ? h.propertyId : null,
        booked ? h.bookingId : null,
        booked ? h.bookingId.slice(0, 8).toUpperCase() : null,
        `fee_${crypto.randomUUID()}`,
        `ch_${crypto.randomUUID()}`,
        (gross * 22n).toString(),
        net.toString(),
        Number(rate),
        vat.toString(),
        gross.toString(),
        treatment,
        opts.at ?? "2026-11-03T12:00:00Z",
        opts.invoiceId ?? null,
        opts.disposition ?? "booked",
      ],
    );
    return rows[0].id as string;
  }

  async function invoice(
    h: Host,
    status: "draft" | "issued" | "sent",
    n: number,
    keys: { pdf?: string | null; csv?: string | null } = {},
  ): Promise<string> {
    const issued = status !== "draft";
    const { rows } = await db.query(
      `INSERT INTO invoices
         (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
          seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff,
          pdf_key, csv_key)
       VALUES ($1, $2, $3, 'invoice', $4, $5, $6, $7, $8, $9::jsonb, $9::jsonb, 'NL_DOMESTIC', 2100, 893, 187, 1080, 187, 0, $10, $11)
       RETURNING id`,
      [
        h.orgId,
        `2026-${String(n).padStart(2, "0")}-01`,
        `2026-${String(n).padStart(2, "0")}-28`,
        status,
        issued ? "OB-2100" : null,
        issued ? n : null,
        issued ? `OB-2100-${String(n).padStart(4, "0")}` : null,
        issued ? "2026-11-05" : null,
        issued ? "{}" : null,
        keys.pdf ?? null,
        keys.csv ?? null,
      ],
    );
    return rows[0].id as string;
  }

  test("drafts are not listed", async () => {
    const h = await host();
    await invoice(h, "draft", 9);
    const issued = await invoice(h, "issued", 8, { pdf: "invoices/2100/OB-2100-0008.pdf" });
    const sent = await invoice(h, "sent", 7);
    const list = await listInvoices(h.scope);
    expect(list.map((r) => r.id)).toEqual([issued, sent]);
    expect(list[0]).toMatchObject({ number: "OB-2100-0008", grossTotal: 1080n, netTotal: 893n, vatTotal: 187n, hasPdf: true, hasCsv: false });
  });

  test("another organization's invoices are not listed", async () => {
    const mine = await host();
    const theirs = await host();
    await invoice(theirs, "issued", 8);
    expect(await listInvoices(mine.scope)).toEqual([]);
  });

  test("a member of another organization gets nothing for an invoice", async () => {
    const mine = await host();
    const theirs = await host();
    const id = await invoice(theirs, "issued", 8, { pdf: "k.pdf", csv: "k.csv" });
    expect(await findInvoiceFile(mine.scope, id, "pdf")).toBeNull();
    expect(await findInvoiceFile(theirs.scope, id, "pdf")).toEqual({ key: "k.pdf", filename: "OB-2100-0008.pdf" });
    expect(await findInvoiceFile(theirs.scope, id, "csv")).toEqual({ key: "k.csv", filename: "OB-2100-0008-specification.csv" });
  });

  test("a draft, an unstored file and a malformed id all find nothing", async () => {
    const h = await host();
    const draft = await invoice(h, "draft", 9, { pdf: "k.pdf" });
    const noFile = await invoice(h, "issued", 8);
    expect(await findInvoiceFile(h.scope, draft, "pdf")).toBeNull();
    expect(await findInvoiceFile(h.scope, noFile, "pdf")).toBeNull();
    expect(await findInvoiceFile(h.scope, "not-a-uuid", "pdf")).toBeNull();
  });

  test("the upcoming invoice shows only this month's un-invoiced booked entries", async () => {
    const h = await host();
    const issuedId = await invoice(h, "issued", 8);
    await entry(h, 1080n);
    await entry(h, 500n, { at: "2026-10-31T22:30:00Z" }); // 31 Oct 23:30 Amsterdam: still October
    await entry(h, 700n, { at: "2026-10-05T12:00:00Z" }); // last month
    await entry(h, 300n, { invoiceId: issuedId }); // already invoiced
    await entry(h, 900n, { disposition: "returned" }); // returned: never invoiced, never shown
    const other = await host();
    await entry(other, 111n);

    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.period.start).toBe("2026-11-01");
    expect(up.rows.map((r) => r.gross)).toEqual([1080n]);
    expect(up.rows[0].bookingRef).toBe(h.bookingId.slice(0, 8).toUpperCase());
    expect(up.totals?.grossTotal).toBe(1080n);
    expect(up.treatment).toEqual({ kind: "NL_DOMESTIC", label: "21% Dutch VAT is included in the commission" });
    expect(up.blockers).toEqual([]);
  });

  test("the upcoming invoice uses the same totals as the draft step", async () => {
    const h = await host();
    await entry(h, 1080n);
    await entry(h, 333n);
    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.totals).toEqual(
      draftTotals(
        [1080n, 333n].map((gross) => {
          const { net, vat } = splitInclusive(gross, 2100n);
          void net;
          return { kind: "fee" as const, base: gross * 22n, gross, vat };
        }),
        "NL_DOMESTIC",
      ),
    );
    expect(up.totals).toMatchObject({ grossTotal: 1413n, netTotal: 1168n, vatTotal: 245n, docType: "invoice" });
  });

  test("a month with nothing booked has no totals", async () => {
    const h = await host();
    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.rows).toEqual([]);
    expect(up.totals).toBeNull();
  });

  test("an unverified reverse-charge VAT number is listed as a blocker", async () => {
    const h = await host("BE", false);
    await entry(h, 1000n, { treatment: "EU_REVERSE_CHARGE" });
    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.blockers).toEqual(["Your VAT number is not verified yet. Use Check again below."]);
    expect(up.totals).toMatchObject({ netTotal: 1000n, vatTotal: 0n });
  });

  test("a verified reverse-charge number is labelled with its check date", async () => {
    const h = await host("BE", true);
    await entry(h, 1000n, { treatment: "EU_REVERSE_CHARGE" });
    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.blockers).toEqual([]);
    expect(up.treatment).toEqual({
      kind: "EU_REVERSE_CHARGE",
      label: "Reverse charge: VAT number BE0123456789 verified on 20 Oct 2026",
    });
  });

  test("incomplete billing details are a blocker", async () => {
    const h = await host();
    await db.query(`UPDATE billing_profiles SET city = NULL WHERE organization_id = $1`, [h.orgId]);
    const up = await upcomingInvoice(h.scope, NOW);
    expect(up.blockers).toEqual(["Your billing details are incomplete. Fill in every field below."]);
    expect(up.treatment).toBeNull();
  });
});
