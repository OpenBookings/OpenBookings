import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { periodFor } from "../period";
import type { PartySnapshot } from "../render/document";
import { runDeliver, type InvoiceMailer } from "./deliver";
import { seedHost, type Host } from "./draft.fixtures";
import type { ObjectStore } from "./store";

const PERIOD = periodFor("2026-10");
const BUYER: PartySnapshot = {
  legalName: "Hotel BV",
  addressLines: ["1 Canal Street", "1011 AA Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL123456789B01",
  kvk: null,
  email: "billing@hotel.test",
};

describeWithDb("emailing issued invoices", () => {
  let db: Client;
  let objects: Map<string, Uint8Array>;
  let sent: Parameters<InvoiceMailer>[0][];
  let failNext: boolean;

  const store: ObjectStore = {
    head: async () => null,
    put: async () => {},
    get: async (key) => {
      const body = objects.get(key);
      if (!body) throw new Error(`no ${key}`);
      return body;
    },
    presign: async () => "",
  };
  const mail: InvoiceMailer = async (m) => {
    if (failNext) throw new Error("Lettermint is down");
    sent.push(m);
    return { messageId: `msg-${sent.length}` };
  };

  /** An issued invoice; stored (with objects in the fake bucket) unless `stored` is false. */
  async function issued(
    host: Host,
    number: string,
    opts: { stored?: boolean; docType?: "invoice" | "credit_note"; buyer?: PartySnapshot } = {},
  ): Promise<string> {
    const stored = opts.stored ?? true;
    const key = `invoices/2026/${number}`;
    const { rows } = await db.query(
      `INSERT INTO invoices
         (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
          seller, buyer, vat_treatment, vat_rate_bp, net_total, vat_total, gross_total, vat_collected, vat_rounding_diff,
          pdf_key, pdf_sha256, csv_key, csv_sha256)
       VALUES ($1, $2, $3, $4, 'issued', 'OB-2026', $5, $6, '2026-11-05', $7::jsonb, $7::jsonb,
               'NL_DOMESTIC', 2100, 893, 187, 1080, 187, 0, $8, $9, $10, $11)
       RETURNING id`,
      [
        host.orgId,
        PERIOD.start,
        PERIOD.end,
        opts.docType ?? "invoice",
        Number(number.slice(-4)),
        number,
        JSON.stringify(opts.buyer ?? BUYER),
        stored ? `${key}.pdf` : null,
        stored ? "a".repeat(64) : null,
        stored ? `${key}-specification.csv` : null,
        stored ? "b".repeat(64) : null,
      ],
    );
    if (stored) {
      objects.set(`${key}.pdf`, new TextEncoder().encode(`%PDF ${number}`));
      objects.set(`${key}-specification.csv`, new TextEncoder().encode(`csv ${number}`));
    }
    return rows[0].id as string;
  }

  const stateOf = async (id: string) =>
    (await db.query(`SELECT status, sent_at IS NOT NULL AS has_sent_at, email_message_id FROM invoices WHERE id = $1`, [id])).rows[0] as {
      status: string;
      has_sent_at: boolean;
      email_message_id: string | null;
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
    objects = new Map();
    sent = [];
    failNext = false;
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("sends each issued invoice once with both attachments", async () => {
    const id = await issued(await seedHost(db), "OB-2026-0042");

    const report = await runDeliver(PERIOD, { db, store, mail });

    expect(report).toEqual({ sent: ["OB-2026-0042"], failed: [], skipped: [] });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe("billing@hotel.test");
    expect(m.subject).toBe("Your OpenBookings commission invoice OB-2026-0042 (October 2026)");
    expect(m.idempotencyKey).toBe(id);
    expect(m.attachments).toEqual([
      { filename: "OB-2026-0042.pdf", base64: Buffer.from("%PDF OB-2026-0042").toString("base64"), contentType: "application/pdf" },
      {
        filename: "OB-2026-0042-specification.csv",
        base64: Buffer.from("csv OB-2026-0042").toString("base64"),
        contentType: "text/csv",
      },
    ]);
    expect(m.text).toContain("October 2026");
    expect(m.text).toContain("nothing to pay");
    expect(m.html).toContain("Finance");
    expect(await stateOf(id)).toEqual({ status: "sent", has_sent_at: true, email_message_id: "msg-1" });
  });

  test("a credit note is worded as one", async () => {
    await issued(await seedHost(db), "OB-2026-0043", { docType: "credit_note" });
    await runDeliver(PERIOD, { db, store, mail });
    expect(sent[0]!.subject).toBe("Your OpenBookings commission credit note OB-2026-0043 (October 2026)");
    expect(sent[0]!.text).toContain("credit note");
  });

  test("a second run sends nothing", async () => {
    await issued(await seedHost(db), "OB-2026-0042");
    await runDeliver(PERIOD, { db, store, mail });

    expect(await runDeliver(PERIOD, { db, store, mail })).toEqual({ sent: [], failed: [], skipped: [] });
    expect(sent).toHaveLength(1);
  });

  test("an invoice not yet stored is not sent", async () => {
    const id = await issued(await seedHost(db), "OB-2026-0042", { stored: false });

    expect(await runDeliver(PERIOD, { db, store, mail })).toEqual({ sent: [], failed: [], skipped: [] });
    expect(sent).toHaveLength(0);
    expect((await stateOf(id)).status).toBe("issued");
  });

  test("a failed send leaves the invoice issued for the next run", async () => {
    const id = await issued(await seedHost(db), "OB-2026-0042");
    failNext = true;

    const report = await runDeliver(PERIOD, { db, store, mail });

    expect(report.sent).toEqual([]);
    expect(report.failed).toEqual([{ number: "OB-2026-0042", message: "Lettermint is down" }]);
    expect(await stateOf(id)).toEqual({ status: "issued", has_sent_at: false, email_message_id: null });

    failNext = false;
    expect((await runDeliver(PERIOD, { db, store, mail })).sent).toEqual(["OB-2026-0042"]);
    expect(sent[0]!.idempotencyKey).toBe(id);
  });

  test("an invoice without a billing email is skipped and the others still go out", async () => {
    await issued(await seedHost(db), "OB-2026-0042", { buyer: { ...BUYER, email: null } });
    await issued(await seedHost(db), "OB-2026-0043");

    const report = await runDeliver(PERIOD, { db, store, mail });

    expect(report.sent).toEqual(["OB-2026-0043"]);
    expect(report.skipped).toEqual([{ number: "OB-2026-0042", reason: "no_recipient" }]);
  });

  test("with a test recipient every email goes there, marked [TEST], naming the host it would have gone to", async () => {
    const id = await issued(await seedHost(db), "OB-2026-0042");

    const report = await runDeliver(PERIOD, { db, store, mail, testRecipient: "me@openbookings.test" });

    expect(report.sent).toEqual(["OB-2026-0042"]);
    const m = sent[0]!;
    expect(m.to).toBe("me@openbookings.test");
    expect(m.subject).toBe("[TEST] Your OpenBookings commission invoice OB-2026-0042 (October 2026)");
    expect(m.text).toContain("this would have gone to Hotel BV");
    expect(m.html).toContain("this would have gone to Hotel BV");
    expect(m.text).not.toContain("billing@hotel.test");
    expect(m.idempotencyKey).toBe(id);
  });
});
