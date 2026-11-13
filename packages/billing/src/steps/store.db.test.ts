import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb } from "@openbookings/db/testing";
import { periodFor } from "../period";
import type { InvoiceDocument, PartySnapshot } from "../render/document";
import { entry, seedHost, type Host, type StripeSide } from "./draft.fixtures";
import { StoredObjectConflictError, runStore, storeInvoice, type ObjectStore } from "./store";

const PERIOD = periodFor("2100-10");
const PARTY: PartySnapshot = {
  legalName: "Hotel BV",
  addressLines: ["1 Canal Street", "1011 AA Amsterdam"],
  countryName: "Netherlands",
  vatId: "NL123456789B01",
  kvk: null,
  email: null,
};

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const text = (s: string) => new TextEncoder().encode(s);

/** An object store held in memory, remembering what was put. */
function memoryStore() {
  const objects = new Map<string, { body: Uint8Array; sha256: string | null; contentType: string }>();
  const puts: string[] = [];
  const store: ObjectStore = {
    head: async (key) => {
      const o = objects.get(key);
      return o ? { sha256: o.sha256 } : null;
    },
    put: async (key, body, contentType, sha256) => {
      puts.push(key);
      objects.set(key, { body, sha256, contentType });
    },
    get: async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error(`no ${key}`);
      return o.body;
    },
    presign: async (key) => `https://r2.test/${key}`,
  };
  return { store, objects, puts };
}

describeWithDb("storing issued invoices", () => {
  let db: Client;
  let stripe: StripeSide;
  let renders: { pdf: number; csv: number };

  const render = {
    pdf: async (doc: InvoiceDocument) => {
      renders.pdf++;
      return text(`pdf of ${doc.number}`);
    },
    csv: async (doc: InvoiceDocument) => {
      renders.csv++;
      return `csv of ${doc.number}`;
    },
  };

  /** An issued invoice with real snapshots and one linked fee entry. */
  async function issued(host: Host, number: string, status: "issued" | "sent" | "draft" = "issued"): Promise<string> {
    const { rows } = await db.query(
      `INSERT INTO invoices
         (billing_entity_id, period_start, period_end, doc_type, status, series, sequence_number, number, issued_on,
          seller, buyer, vat_treatment, vat_rate_bp, fee_count, fee_base_total, fee_gross_total,
          net_total, vat_total, gross_total, vat_collected, vat_rounding_diff)
       VALUES ($1, $2, $3, 'invoice', $4, 'OB-2100', $5, $6, '2100-11-05', $7::jsonb, $7::jsonb,
               'NL_DOMESTIC', 2100, 1, 24000, 1080, 893, 187, 1080, 187, 0)
       RETURNING id`,
      [host.orgId, PERIOD.start, PERIOD.end, status, Number(number.slice(-4)), number, JSON.stringify(PARTY)],
    );
    const id = rows[0].id as string;
    const fee = await entry(db, stripe, host, { gross: 1080n, base: 24_000n });
    await db.query(`UPDATE commission_entries SET invoice_id = $1 WHERE id = $2`, [id, fee.id]);
    return id;
  }

  const keysOf = async (id: string) =>
    (await db.query(`SELECT pdf_key, pdf_sha256, csv_key, csv_sha256 FROM invoices WHERE id = $1`, [id])).rows[0] as {
      pdf_key: string | null;
      pdf_sha256: string | null;
      csv_key: string | null;
      csv_sha256: string | null;
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
    renders = { pdf: 0, csv: 0 };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("uploads pdf and csv and records keys and hashes", async () => {
    const mem = memoryStore();
    const id = await issued(await seedHost(db), "OB-2100-0042");

    expect(await storeInvoice(db, id, { store: mem.store, render })).toBe("stored");

    const pdf = text("pdf of OB-2100-0042");
    const csv = text("csv of OB-2100-0042");
    expect(await keysOf(id)).toEqual({
      pdf_key: "invoices/2100/OB-2100-0042.pdf",
      pdf_sha256: sha(pdf),
      csv_key: "invoices/2100/OB-2100-0042-specification.csv",
      csv_sha256: sha(csv),
    });
    expect(mem.objects.get("invoices/2100/OB-2100-0042.pdf")).toEqual({ body: pdf, sha256: sha(pdf), contentType: "application/pdf" });
    expect(mem.objects.get("invoices/2100/OB-2100-0042-specification.csv")?.contentType).toBe("text/csv; charset=utf-8");
  });

  test("issued invoice without pdf_key is rendered on the next run", async () => {
    const mem = memoryStore();
    const host = await seedHost(db);
    const a = await issued(host, "OB-2100-0042");
    const hostB = await seedHost(db);
    const b = await issued(hostB, "OB-2100-0043", "sent");
    await issued(await seedHost(db), "OB-2100-0044", "draft");

    const report = await runStore(PERIOD, { db, store: mem.store, render });

    expect(report).toEqual({ stored: ["OB-2100-0042", "OB-2100-0043"], alreadyStored: [], conflicts: [], failed: [] });
    expect((await keysOf(a)).pdf_key).not.toBeNull();
    expect((await keysOf(b)).csv_key).not.toBeNull();
  });

  test("an object already there with the same hash is just recorded", async () => {
    const mem = memoryStore();
    const id = await issued(await seedHost(db), "OB-2100-0042");
    const pdf = text("pdf of OB-2100-0042");
    mem.objects.set("invoices/2100/OB-2100-0042.pdf", { body: pdf, sha256: sha(pdf), contentType: "application/pdf" });

    await storeInvoice(db, id, { store: mem.store, render });

    expect(mem.puts).toEqual(["invoices/2100/OB-2100-0042-specification.csv"]);
    expect((await keysOf(id)).pdf_sha256).toBe(sha(pdf));
  });

  test("an object there with a different hash stops with an alert", async () => {
    const mem = memoryStore();
    const id = await issued(await seedHost(db), "OB-2100-0042");
    mem.objects.set("invoices/2100/OB-2100-0042.pdf", { body: text("other"), sha256: sha(text("other")), contentType: "application/pdf" });

    await expect(storeInvoice(db, id, { store: mem.store, render })).rejects.toBeInstanceOf(StoredObjectConflictError);
    expect(mem.puts).toEqual([]);
    expect(await keysOf(id)).toEqual({ pdf_key: null, pdf_sha256: null, csv_key: null, csv_sha256: null });

    const report = await runStore(PERIOD, { db, store: mem.store, render });
    expect(report.conflicts).toEqual(["OB-2100-0042"]);
    expect(report.stored).toEqual([]);
  });

  test("a stored invoice is never rendered again", async () => {
    const mem = memoryStore();
    const id = await issued(await seedHost(db), "OB-2100-0042");
    await storeInvoice(db, id, { store: mem.store, render });
    expect(renders).toEqual({ pdf: 1, csv: 1 });

    expect(await storeInvoice(db, id, { store: mem.store, render })).toBe("already_stored");
    expect(await runStore(PERIOD, { db, store: mem.store, render })).toEqual({ stored: [], alreadyStored: [], conflicts: [], failed: [] });
    expect(renders).toEqual({ pdf: 1, csv: 1 });
    expect(mem.puts).toHaveLength(2);
  });

  test("a render failure on one invoice is reported and the others are still stored", async () => {
    const mem = memoryStore();
    const a = await issued(await seedHost(db), "OB-2100-0042");
    const b = await issued(await seedHost(db), "OB-2100-0043");
    const failing = {
      ...render,
      pdf: async (doc: InvoiceDocument) => {
        if (doc.number === "OB-2100-0042") throw new Error("cannot render");
        return render.pdf(doc);
      },
    };

    const report = await runStore(PERIOD, { db, store: mem.store, render: failing });

    expect(report.failed).toEqual([{ number: "OB-2100-0042", message: "cannot render" }]);
    expect(report.stored).toEqual(["OB-2100-0043"]);
    expect((await keysOf(a)).pdf_key).toBeNull();
    expect((await keysOf(b)).pdf_key).not.toBeNull();
  });
});
