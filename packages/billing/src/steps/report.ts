import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Queryable } from "@openbookings/db";
import { periodFor } from "../period";
import { decimal, field } from "../render/csv";
import { lastReconcileStatus } from "../runs";

const QUARTER = /^(\d{4})Q([1-4])$/;

type Table = { header: string[]; rows: string[][] };

/** `;`-separated, UTF-8 without a BOM, `\n` line ends, one header line. */
function toCsv({ header, rows }: Table): string {
  return [header, ...rows].map((r) => r.map(field).join(";")).join("\n") + "\n";
}

const text = (rows: unknown[], column: string): string => String((rows[0] as Record<string, unknown> | undefined)?.[column] ?? "0");

/** The months of a quarter as `YYYY-MM`. */
function monthsOf(year: string, quarter: number): string[] {
  return [0, 1, 2].map((i) => `${year}-${String((quarter - 1) * 3 + i + 1).padStart(2, "0")}`);
}

async function vatReturn(db: Queryable, quarter: string): Promise<Table> {
  const { rows } = await db.query(
    `SELECT nl_net::text, nl_vat::text, rc_net::text FROM v_vat_return_quarter WHERE quarter = $1`,
    [quarter],
  );
  const cents = (c: string) => decimal(BigInt(text(rows, c)));
  return { header: ["quarter", "nl_net", "nl_vat", "rc_net"], rows: [[quarter, cents("nl_net"), cents("nl_vat"), cents("rc_net")]] };
}

async function icp(db: Queryable, quarter: string): Promise<Table> {
  const { rows } = await db.query(
    `SELECT vat_id, country_code, rc_net::text AS rc_net FROM v_icp_listing_quarter WHERE quarter = $1 ORDER BY vat_id`,
    [quarter],
  );
  return {
    header: ["vat_id", "country_code", "rc_net"],
    rows: (rows as { vat_id: string; country_code: string; rc_net: string }[]).map((r) => [r.vat_id, r.country_code, decimal(BigInt(r.rc_net))]),
  };
}

async function dac7(db: Queryable, quarter: string): Promise<Table> {
  const { rows } = await db.query(
    `SELECT billing_entity_id, legal_name, fee_gross::text AS fee_gross FROM v_dac7_fees_quarter WHERE quarter = $1 ORDER BY legal_name, billing_entity_id`,
    [quarter],
  );
  return {
    header: ["billing_entity_id", "legal_name", "fee_gross"],
    rows: (rows as { billing_entity_id: string; legal_name: string; fee_gross: string }[]).map((r) => [
      r.billing_entity_id,
      r.legal_name,
      decimal(BigInt(r.fee_gross)),
    ]),
  };
}

async function returnedPayments(db: Queryable, quarter: string): Promise<Table> {
  const { rows } = await db.query(
    `SELECT billing_entity_id, stripe_account_id, stripe_payment_ref, stripe_application_fee_id,
            fee_gross::text AS fee_gross, refunded_gross::text AS refunded_gross, returned_on::text AS returned_on
       FROM v_returned_payments_quarter WHERE quarter = $1 ORDER BY returned_on, stripe_application_fee_id`,
    [quarter],
  );
  type R = {
    billing_entity_id: string;
    stripe_account_id: string;
    stripe_payment_ref: string | null;
    stripe_application_fee_id: string;
    fee_gross: string;
    refunded_gross: string;
    returned_on: string;
  };
  return {
    header: ["billing_entity_id", "stripe_account_id", "stripe_payment", "stripe_application_fee", "fee_gross", "refunded_gross", "returned_on"],
    rows: (rows as R[]).map((r) => [
      r.billing_entity_id,
      r.stripe_account_id,
      r.stripe_payment_ref ?? "",
      r.stripe_application_fee_id,
      decimal(BigInt(r.fee_gross)),
      decimal(BigInt(r.refunded_gross)),
      r.returned_on,
    ]),
  };
}

async function sum(db: Queryable, sql: string, values: unknown[]): Promise<bigint> {
  const { rows } = await db.query(sql, values);
  return BigInt(text(rows, "total"));
}

/**
 * One line per month: what the ledger holds for Stripe's fees and fee refunds
 * in the month (the ledger equals Stripe once that month's reconciliation
 * succeeded, shown in the last column), against the gross of the invoices for
 * that period, the net of returned payments, and booked fees not invoiced yet
 * (a blocked or unbilled host). `difference` is what none of them explains
 * and should be zero. A payment returned across a month end shows up as a
 * returned amount in one month and its opposite in the next.
 */
async function reconciliation(db: Queryable, year: string, quarter: number): Promise<Table> {
  const rows: string[][] = [];
  for (const month of monthsOf(year, quarter)) {
    const p = periodFor(month);
    const window = [p.from, p.to];
    const stripe = await sum(db, `SELECT COALESCE(SUM(gross_amount), 0)::text AS total FROM commission_entries WHERE occurred_at >= $1 AND occurred_at < $2`, window);
    const invoiced = await sum(
      db,
      `SELECT COALESCE(SUM(gross_total), 0)::text AS total FROM invoices WHERE period_start = $1 AND status IN ('issued', 'sent')`,
      [p.start],
    );
    const returned = await sum(
      db,
      `SELECT COALESCE(SUM(gross_amount), 0)::text AS total FROM commission_entries WHERE disposition = 'returned' AND occurred_at >= $1 AND occurred_at < $2`,
      window,
    );
    const pending = await sum(
      db,
      `SELECT COALESCE(SUM(gross_amount), 0)::text AS total FROM commission_entries
        WHERE disposition = 'booked' AND invoice_id IS NULL AND occurred_at >= $1 AND occurred_at < $2`,
      window,
    );
    const status = await lastReconcileStatus(db, p.start);
    rows.push([month, decimal(stripe), decimal(invoiced), decimal(returned), decimal(pending), decimal(stripe - invoiced - returned - pending), status ?? "none"]);
  }
  return {
    header: ["month", "stripe_fees_net", "invoiced_gross", "returned_net", "not_yet_invoiced", "difference", "reconciliation"],
    rows,
  };
}

/**
 * The quarterly report step: writes the quarter's
 * five CSV files into `outDir` and returns their paths, in this order:
 * `{quarter}-vat-return.csv`, `-icp.csv`, `-dac7.csv`,
 * `-returned-payments.csv` and `-stripe-reconciliation.csv`. `quarter` is
 * `YYYYQn`. Invoice reports cover issued and sent documents by issue date;
 * returned payments by the Amsterdam date of the fee.
 */
export async function runReport(quarter: string, deps: { db: Queryable; outDir: string }): Promise<string[]> {
  const match = QUARTER.exec(quarter);
  if (!match) throw new RangeError(`Invalid quarter "${quarter}", expected YYYYQn such as 2026Q4`);
  const [, year, q] = match as unknown as [string, string, string];
  await mkdir(deps.outDir, { recursive: true });

  const files: [string, Table][] = [
    ["vat-return", await vatReturn(deps.db, quarter)],
    ["icp", await icp(deps.db, quarter)],
    ["dac7", await dac7(deps.db, quarter)],
    ["returned-payments", await returnedPayments(deps.db, quarter)],
    ["stripe-reconciliation", await reconciliation(deps.db, year, Number(q))],
  ];
  const paths: string[] = [];
  for (const [name, table] of files) {
    const path = join(deps.outDir, `${quarter}-${name}.csv`);
    await writeFile(path, toCsv(table), "utf8");
    paths.push(path);
  }
  return paths;
}
