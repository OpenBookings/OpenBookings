import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { entry, seedHost, type Host, type StripeSide } from "./draft.fixtures";
import { runReport } from "./report";

describeWithDb("quarterly reports", () => {
  let db: Client;
  let stripe: StripeSide;
  let outDir: string;
  let nl: Host;
  let be: Host;

  /** An invoice or credit note of a host for a month, with the buyer snapshot the reports read. */
  async function invoice(
    host: Host,
    o: { number: string; status?: string; docType?: "invoice" | "credit_note"; treatment: "NL_DOMESTIC" | "EU_REVERSE_CHARGE"; periodStart: string; issuedOn: string; net: number; vat: number; vatId: string; name: string },
  ): Promise<string> {
    const issued = (o.status ?? "issued") !== "draft";
    const buyer = { legalName: o.name, addressLines: ["x"], countryName: "x", vatId: o.vatId, kvk: null, email: null };
    const { rows } = await db.query(
      `INSERT INTO invoices
         (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
          seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
       VALUES ($1, $2, ($2::date + interval '1 month' - interval '1 day')::date, $3, $4, $5, $6, $7, $8,
               $9::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $13, 0)
       RETURNING id`,
      [
        host.orgId,
        o.periodStart,
        o.docType ?? "invoice",
        o.status ?? "issued",
        issued ? "OB-2100" : null,
        issued ? Number(o.number.slice(-4)) : null,
        issued ? o.number : null,
        issued ? o.issuedOn : null,
        JSON.stringify(buyer),
        o.treatment,
        o.treatment === "NL_DOMESTIC" ? 2100 : 0,
        o.net,
        o.vat,
        o.net + o.vat,
      ],
    );
    return rows[0].id as string;
  }

  /** Seeds 2100Q4: an NL and a BE invoice for October, a BE credit note for November, a draft, a payment returned across the October/November turn, and an un-invoiced December fee. */
  async function seedQuarter() {
    nl = await seedHost(db, "NL");
    be = await seedHost(db, "BE");
    const nlInv = await invoice(nl, { number: "OB-2100-0001", treatment: "NL_DOMESTIC", periodStart: "2100-10-01", issuedOn: "2100-11-05", net: 893, vat: 187, vatId: "NL123456789B01", name: "Hotel NL" });
    const beInv = await invoice(be, { number: "OB-2100-0002", treatment: "EU_REVERSE_CHARGE", periodStart: "2100-10-01", issuedOn: "2100-11-05", net: 2000, vat: 0, vatId: "BE0123456789", name: "Hotel BE" });
    const credit = await invoice(be, { number: "OB-2100-0003", docType: "credit_note", treatment: "EU_REVERSE_CHARGE", periodStart: "2100-11-01", issuedOn: "2100-12-03", net: -500, vat: 0, vatId: "BE0123456789", name: "Hotel BE" });
    await invoice(nl, { number: "", status: "draft", treatment: "NL_DOMESTIC", periodStart: "2100-12-01", issuedOn: "", net: 8264, vat: 1736, vatId: "NL123456789B01", name: "Hotel NL" });

    await entry(db, stripe, nl, { gross: 1080n, occurredAt: "2100-10-14T12:00:00Z", invoiceId: nlInv });
    const beFee = await entry(db, stripe, be, { gross: 2000n, treatment: "EU_REVERSE_CHARGE", occurredAt: "2100-10-20T12:00:00Z", invoiceId: beInv });
    await entry(db, stripe, be, { gross: -500n, treatment: "EU_REVERSE_CHARGE", refundsEntryId: beFee.id, occurredAt: "2100-11-10T12:00:00Z", invoiceId: credit });
    // Returned: the fee on 31 Oct 23:30 Amsterdam, its refund after midnight.
    const returned = await entry(db, stripe, nl, { gross: 900n, disposition: "returned", occurredAt: "2100-10-31T22:30:00Z" });
    await entry(db, stripe, nl, { gross: -900n, disposition: "returned", refundsEntryId: returned.id, occurredAt: "2100-11-01T00:30:00Z" });
    // Booked, but its host could not be invoiced yet.
    await entry(db, stripe, nl, { gross: 700n, occurredAt: "2100-12-10T12:00:00Z" });
  }

  const read = async (name: string) => (await readFile(join(outDir, name), "utf8")).split("\n");

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
    outDir = await mkdtemp(join(tmpdir(), "report-"));
    await seedQuarter();
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
    await rm(outDir, { recursive: true, force: true });
  });

  test("the VAT return splits domestic and reverse-charge turnover", async () => {
    const files = await runReport("2100Q4", { db, outDir });

    expect(files.map((f) => f.slice(outDir.length + 1))).toEqual([
      "2100Q4-vat-return.csv",
      "2100Q4-icp.csv",
      "2100Q4-dac7.csv",
      "2100Q4-returned-payments.csv",
      "2100Q4-stripe-reconciliation.csv",
    ]);
    // 893 domestic net and 187 VAT; 2000 - 500 reverse-charge net.
    expect(await read("2100Q4-vat-return.csv")).toEqual(["quarter;nl_net;nl_vat;rc_net", "2100Q4;8.93;1.87;15.00", ""]);
  });

  test("the ICP listing nets the BE credit note", async () => {
    await runReport("2100Q4", { db, outDir });
    expect(await read("2100Q4-icp.csv")).toEqual(["vat_id;country_code;rc_net", "BE0123456789;BE;15.00", ""]);
  });

  test("drafts are left out", async () => {
    await runReport("2100Q4", { db, outDir });
    const vat = (await read("2100Q4-vat-return.csv"))[1];
    expect(vat).toBe("2100Q4;8.93;1.87;15.00");
    const dac7 = await read("2100Q4-dac7.csv");
    expect(dac7[0]).toBe("billing_entity_id;legal_name;fee_gross");
    expect(dac7.slice(1, -1).sort()).toEqual([`${be.orgId};Hotel BE;15.00`, `${nl.orgId};Hotel NL;10.80`].sort());
  });

  test("returned payments are listed and net to zero", async () => {
    await runReport("2100Q4", { db, outDir });
    const lines = await read("2100Q4-returned-payments.csv");
    expect(lines[0]).toBe("billing_entity_id;stripe_account_id;stripe_payment;stripe_application_fee;fee_gross;refunded_gross;returned_on");
    expect(lines).toHaveLength(3);
    const cols = lines[1]!.split(";");
    expect(cols[0]).toBe(nl.orgId);
    expect(cols[1]).toBe(nl.account);
    expect(cols[4]).toBe("9.00");
    expect(cols[5]).toBe("9.00");
    expect(cols[6]).toBe("2100-10-31");
  });

  test("the reconciliation sheet ties Stripe totals to invoiced plus returned", async () => {
    await runReport("2100Q4", { db, outDir });
    expect(await read("2100Q4-stripe-reconciliation.csv")).toEqual([
      "month;stripe_fees_net;invoiced_gross;returned_net;not_yet_invoiced;difference;reconciliation",
      // October: 10.80 + 20.00 + 9.00 returned, all invoiced or returned.
      "2100-10;39.80;30.80;9.00;0.00;0.00;none",
      // November: the 5.00 credit note, and the 9.00 refund of last month's returned fee.
      "2100-11;-14.00;-5.00;-9.00;0.00;0.00;none",
      // December: a booked fee waiting for its invoice.
      "2100-12;7.00;0.00;0.00;7.00;0.00;none",
      "",
    ]);
  });

  test("a quarter must look like 2100Q4", async () => {
    await expect(runReport("2100Q5", { db, outDir })).rejects.toThrow("2100Q5");
    await expect(runReport("2100-Q4", { db, outDir })).rejects.toThrow("2100-Q4");
  });
});
