import type { Pool } from "pg";
import type { Queryable } from "@openbookings/db";
import {
  MissingBillingProfileError,
  PaymentNotSettledError,
  UnknownAccountError,
  recordApplicationFee,
  recordApplicationFeeRefund,
  type FeeLike,
  type FeeRefundLike,
  type LedgerDeps,
} from "../ledger";
import type { Period } from "../period";

/** One platform balance transaction of an application fee (`fee_…`) or fee refund (`fr_…`). A fee refund's amount is negative. */
export type BalanceTransactionLike = {
  type: "application_fee" | "application_fee_refund";
  source: string;
  amount: number;
  created: number;
};

/**
 * Stripe as the reconciliation reads it. The real one is `stripeLedgerSource`
 * in `@openbookings/billing/ledger/stripe-deps`; this module never loads the SDK.
 */
export type StripeLedgerSource = {
  /** Every application fee and fee refund balance transaction created in the period. */
  listBalanceTransactions(p: Period): AsyncIterable<BalanceTransactionLike>;
  retrieveFee(id: string): Promise<FeeLike>;
  /** A fee refund `listBalanceTransactions` listed. */
  retrieveFeeRefund(id: string): Promise<FeeRefundLike>;
  /** All refunds of one fee, whenever they were made. */
  listFeeRefunds(feeId: string): Promise<FeeRefundLike[]>;
};

type Totals = { fees: number; refunds: number; gross: string };

export type ReconcileResult = {
  status: "succeeded" | "blocked";
  /** Stripe ids this run recorded in the ledger (in a dry run: would record). */
  backfilled: string[];
  /** Ledger entries of the period Stripe did not list. */
  missingInStripe: string[];
  /** `stripe` is the balance transaction's amount, `ledger` the entry's gross. */
  amountMismatches: { id: string; stripe: number; ledger: string }[];
  /** Connected accounts no organization owns, so their fees cannot be recorded. */
  unknownAccounts: string[];
  /** Fees whose payment may still become a booking. */
  unsettled: { feeId: string; paymentIntentId: string; intentId: string | null }[];
  /** Fees on legacy bookings whose organization has no billing country. */
  missingProfiles: { feeId: string; organizationId: string }[];
  /** Payments this run returned to the guest (in a dry run: would), as their fees, with what the ledger held as refunded before. */
  returned: { feeId: string; chargeRef: string; gross: string; refundedGross: string }[];
  /** Returned fees still not refunded in full. */
  notYetReturned: string[];
  /** The period's ledger after the run, by disposition; gross is fees plus (negative) refunds. */
  totals: { booked: Totals; returned: Totals };
};

/** Runs `work` in one transaction on one connection: committed when it returns, rolled back when it throws. */
export type TransactionRunner = <T>(work: (db: Queryable) => Promise<T>) => Promise<T>;

export type ReconcileDeps = {
  /** Where the ledger lives; the ledger functions run on it too (`ledger.db` is not used). */
  db: Queryable;
  stripe: StripeLedgerSource;
  ledger: LedgerDeps;
  /** Runs everything as for real inside one transaction that is rolled back, with no money moved and nothing reported. */
  dryRun: boolean;
  /**
   * Transactions on `db`. Each fee refund is recorded in its own; a dry run
   * runs entirely in one and throws to roll it back, so this must roll back
   * when its work throws. `poolTransaction(pool)` for a pool,
   * `savepointTransaction(client)` for a connection already in a transaction.
   */
  inTransaction: TransactionRunner;
};

/** BEGIN / COMMIT on a client checked out of `pool`; ROLLBACK when the work throws; the client is always released. */
export function poolTransaction(pool: Pool): TransactionRunner {
  return async (work) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
}

/** Savepoint names are unique per process, so runners nested on one connection never address each other's. */
let savepoints = 0;

/**
 * A nested transaction on a connection that is already in one: a SAVEPOINT,
 * released when the work returns, rolled back to and released when it throws,
 * so a failed unit is undone, leaves nothing on the savepoint stack, and the
 * outer transaction stays usable.
 */
export function savepointTransaction(db: Queryable): TransactionRunner {
  return async (work) => {
    const name = `reconcile_sp_${++savepoints}`;
    await db.query(`SAVEPOINT ${name}`);
    try {
      const result = await work(db);
      await db.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      try {
        await db.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await db.query(`RELEASE SAVEPOINT ${name}`);
      } catch {
        // surface the work's error, not the rollback's
      }
      throw error;
    }
  };
}

type LedgerRow = { kind: "fee" | "fee_refund"; stripe_id: string; gross: string; in_period: boolean };

type ReturnedFee = { fee_id: string; charge: string | null; account: string; gross: string; refunded: string };

/** Payments this run returned to the guest, by charge, with what the ledger held as refunded before. */
type Returns = Map<string, { refundedGross: string }>;

const abs = (n: bigint) => (n < 0n ? -n : n);

class DryRunRollback extends Error {}

const DRY_RUN_SAVEPOINT = "reconcile_dry_run";

/** The ledger for a dry run: reads Stripe as usual, but returns no payment, writes no audit row and reports nothing. */
function dryRunLedger(ledger: LedgerDeps): LedgerDeps {
  return {
    ...ledger,
    returnPayment: async (chargeId) => ({ refundId: `dry-run:${chargeId}` }),
    audit: async () => {},
    report: () => {},
  };
}

/**
 * Checks the commission ledger against Stripe for one month: the blocking step
 * before any invoice is drafted (spec, the job, step 2). Every application fee
 * and fee refund Stripe moved in the period must be in the ledger with the
 * same amount, and every ledger entry of the period must be on Stripe.
 *
 * What Stripe has and the ledger lacks is recorded now through the ledger
 * functions (backfill). A fee that cannot be recorded blocks the run and is
 * listed: an account no organization owns (`unknownAccounts`), a payment that
 * may still become a booking (`unsettled`), a legacy booking whose
 * organization has no billing country (`missingProfiles`). Any other error
 * fails the run. Ledger entries Stripe did not list and amounts that differ
 * block the run.
 *
 * Every returned fee of the period (spec decision 8) must by now be refunded
 * in full, counting its fee refunds in any month. One that is short has its
 * Stripe refunds recorded first; still short, its payment is returned to the
 * guest (`ledger.returnPayment`), audited and reported, and its refund
 * recorded. One that is still short after that blocks the run. Every payment
 * returned by this run, here or by the ledger while backfilling, is listed in
 * `returned`.
 *
 * `dryRun` runs all of this for real inside one transaction that is rolled
 * back, with `returnPayment`, `audit` and `report` replaced by stand-ins, so
 * its result is what a real run would produce, with nothing kept and no money
 * moved. A payment the dry run would return counts as returned.
 */
export async function reconcile(period: Period, deps: ReconcileDeps): Promise<ReconcileResult> {
  if (!deps.dryRun) return run(period, deps, deps.ledger);
  let result: ReconcileResult | undefined;
  try {
    await deps.inTransaction(async (tx) => {
      // Our own savepoint: refused outside a transaction block, so a runner that
      // opens none cannot let dry-run writes through; and undone here, whatever
      // the runner then does.
      try {
        await tx.query(`SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
      } catch (error) {
        throw new Error("A dry run needs a transaction: inTransaction must run its work inside one", { cause: error });
      }
      try {
        result = await run(period, { ...deps, db: tx, inTransaction: savepointTransaction(tx) }, dryRunLedger(deps.ledger));
      } catch (error) {
        await tx.query(`ROLLBACK TO SAVEPOINT ${DRY_RUN_SAVEPOINT}`).catch(() => {});
        throw error;
      }
      await tx.query(`ROLLBACK TO SAVEPOINT ${DRY_RUN_SAVEPOINT}`);
      throw new DryRunRollback("Dry run: rolling back");
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (!result) throw new Error("Dry run produced no result");
  return result;
}

async function run(period: Period, deps: ReconcileDeps, baseLedger: LedgerDeps): Promise<ReconcileResult> {
  const { db, stripe, inTransaction } = deps;

  // Every payment returned by this run, whether by the ledger while backfilling or by the settling below.
  const returns: Returns = new Map();
  const tracked: LedgerDeps = {
    ...baseLedger,
    returnPayment: async (chargeId, accountId, reason) => {
      const r = await baseLedger.returnPayment(chargeId, accountId, reason);
      if (!returns.has(chargeId)) returns.set(chargeId, { refundedGross: "0" });
      return r;
    },
  };
  const ledger = (on: Queryable): LedgerDeps => ({ ...tracked, db: on });

  const result: ReconcileResult = {
    status: "succeeded",
    backfilled: [],
    missingInStripe: [],
    amountMismatches: [],
    unknownAccounts: [],
    unsettled: [],
    missingProfiles: [],
    returned: [],
    notYetReturned: [],
    totals: { booked: { fees: 0, refunds: 0, gross: "0" }, returned: { fees: 0, refunds: 0, gross: "0" } },
  };

  const listed = new Map<string, BalanceTransactionLike>();
  for await (const bt of stripe.listBalanceTransactions(period)) {
    if (!Number.isSafeInteger(bt.amount)) throw new Error(`Balance transaction for ${bt.source} has amount ${bt.amount}`);
    listed.set(bt.source, bt);
  }

  /** Records a fee refund in its own transaction, fetching and recording its fee first when the ledger lacks it. */
  const recordRefund = (refund: FeeRefundLike) =>
    inTransaction((tx) => recordApplicationFeeRefund(refund, ledger(tx), (id) => stripe.retrieveFee(id)));

  /** Runs one backfill; the errors that only block the run are listed instead of thrown. */
  const backfill = async (stripeId: string, feeId: string, work: () => Promise<{ inserted: boolean }>) => {
    try {
      if ((await work()).inserted) result.backfilled.push(stripeId);
    } catch (error) {
      // A fee and its refund can fail on the same cause: list each fee once.
      if (error instanceof PaymentNotSettledError) {
        if (!result.unsettled.some((u) => u.feeId === feeId)) {
          result.unsettled.push({ feeId, paymentIntentId: error.paymentIntentId, intentId: error.intentId ?? null });
        }
      } else if (error instanceof UnknownAccountError) {
        if (!result.unknownAccounts.includes(error.accountId)) result.unknownAccounts.push(error.accountId);
      } else if (error instanceof MissingBillingProfileError) {
        if (!result.missingProfiles.some((m) => m.feeId === feeId)) result.missingProfiles.push({ feeId, organizationId: error.organizationId });
      } else {
        throw error;
      }
    }
  };

  const readLedger = async () => {
    const ids = (type: BalanceTransactionLike["type"]) => [...listed.values()].filter((bt) => bt.type === type).map((bt) => bt.source);
    const { rows } = await db.query(
      `SELECT kind, COALESCE(stripe_fee_refund_id, stripe_application_fee_id) AS stripe_id, gross_amount::text AS gross,
              (occurred_at >= $1 AND occurred_at < $2) AS in_period
         FROM commission_entries
        WHERE (occurred_at >= $1 AND occurred_at < $2)
           OR (kind = 'fee' AND stripe_application_fee_id = ANY($3::text[]))
           OR (kind = 'fee_refund' AND stripe_fee_refund_id = ANY($4::text[]))
        ORDER BY occurred_at, id`,
      [period.from, period.to, ids("application_fee"), ids("application_fee_refund")],
    );
    return new Map((rows as LedgerRow[]).map((r) => [r.stripe_id, r]));
  };

  // Backfill what Stripe has and the ledger lacks: fees first, so a refund finds its fee.
  const before = await readLedger();
  const missing = [...listed.values()].filter((bt) => !before.has(bt.source));
  for (const bt of missing.filter((m) => m.type === "application_fee")) {
    await backfill(bt.source, bt.source, async () => recordApplicationFee(await stripe.retrieveFee(bt.source), ledger(db)));
  }
  for (const bt of missing.filter((m) => m.type === "application_fee_refund")) {
    const refund = await stripe.retrieveFeeRefund(bt.source);
    await backfill(bt.source, refund.fee, () => recordRefund(refund));
  }

  // Compare again.
  const after = await readLedger();
  for (const bt of listed.values()) {
    const row = after.get(bt.source);
    if (row && abs(BigInt(bt.amount)) !== abs(BigInt(row.gross))) {
      result.amountMismatches.push({ id: bt.source, stripe: bt.amount, ledger: row.gross });
    }
  }
  for (const row of after.values()) {
    if (row.in_period && !listed.has(row.stripe_id)) result.missingInStripe.push(row.stripe_id);
  }

  await settleReturnedFees(period, { ...deps, ledger: ledger(db) }, recordRefund, returns, result);
  result.returned = await returnedByThisRun(db, returns, result.notYetReturned);
  result.totals = await totals(db, period);

  const blocked =
    result.missingInStripe.length +
    result.amountMismatches.length +
    result.unknownAccounts.length +
    result.unsettled.length +
    result.missingProfiles.length +
    result.notYetReturned.length;
  result.status = blocked > 0 ? "blocked" : "succeeded";
  return result;
}

/** The period's returned fees with what their refunds in the ledger (any month) add up to. */
async function returnedFees(db: Queryable, period: Period, feeId?: string): Promise<ReturnedFee[]> {
  const { rows } = await db.query(
    `SELECT f.stripe_application_fee_id AS fee_id, f.stripe_payment_ref AS charge, f.stripe_account_id AS account,
            f.gross_amount::text AS gross,
            (SELECT COALESCE(-SUM(r.gross_amount), 0) FROM commission_entries r WHERE r.refunds_entry_id = f.id)::text AS refunded
       FROM commission_entries f
      WHERE f.kind = 'fee' AND f.disposition = 'returned'
        AND f.occurred_at >= $1 AND f.occurred_at < $2
        AND ($3::text IS NULL OR f.stripe_application_fee_id = $3)
      ORDER BY f.occurred_at, f.id`,
    [period.from, period.to, feeId ?? null],
  );
  return rows as ReturnedFee[];
}

const short = (fee: ReturnedFee) => BigInt(fee.refunded) < BigInt(fee.gross);

/**
 * Makes sure every returned fee of the period went back to the guest. First
 * records any refunds Stripe already has; then, if the payment itself is still
 * with the host, returns it in full (a returned payment normally goes back
 * through the booking confirmation, so one still here at month end is
 * reported) and records its refund. A payment this run already returned is
 * not returned again. Whatever is still short is listed in `notYetReturned`;
 * in a dry run, a payment it would return counts as returned.
 */
async function settleReturnedFees(
  period: Period,
  deps: ReconcileDeps,
  recordRefund: (refund: FeeRefundLike) => Promise<{ inserted: boolean }>,
  returns: Returns,
  result: ReconcileResult,
): Promise<void> {
  const { db, stripe, ledger, dryRun } = deps;

  /** Records the fee's refunds Stripe has and the ledger lacks. */
  const syncRefunds = async (fee: ReturnedFee) => {
    for (const refund of await stripe.listFeeRefunds(fee.fee_id)) {
      const { rows } = await db.query(`SELECT 1 FROM commission_entries WHERE stripe_fee_refund_id = $1`, [refund.id]);
      if (rows.length === 0 && (await recordRefund(refund)).inserted) result.backfilled.push(refund.id);
    }
  };

  /** Refunded in full in the ledger; in a dry run, also a payment the run would have returned (Stripe holds no refund for it). */
  const covered = async (fee: ReturnedFee) => {
    if (dryRun && fee.charge && returns.has(fee.charge)) return true;
    const now = (await returnedFees(db, period, fee.fee_id))[0]?.refunded ?? fee.refunded;
    return BigInt(now) >= BigInt(fee.gross);
  };

  for (const fee of (await returnedFees(db, period)).filter(short)) {
    await syncRefunds(fee);
    if (await covered(fee)) continue;

    const extra = { applicationFeeId: fee.fee_id, chargeId: fee.charge, stripeAccountId: fee.account, gross: fee.gross, refunded: fee.refunded };
    if (!fee.charge) {
      ledger.report(new Error(`Returned fee ${fee.fee_id} has no charge to refund`), { level: "error", extra });
      result.notYetReturned.push(fee.fee_id);
      continue;
    }
    const charge = await ledger.chargeInfo(fee.charge, fee.account);
    if (charge.amountRefunded >= charge.amount) {
      ledger.report(new Error(`Returned fee ${fee.fee_id}: the charge is refunded but the application fee is not`), {
        level: "error",
        extra,
      });
      result.notYetReturned.push(fee.fee_id);
      continue;
    }

    ledger.report(new Error(`Returned fee ${fee.fee_id} was still not refunded at month end; returning payment ${fee.charge} now`), {
      level: "warning",
      extra,
    });
    try {
      const { refundId } = await ledger.returnPayment(fee.charge, fee.account, "unexplained");
      returns.set(fee.charge, { refundedGross: fee.refunded });
      await ledger.audit({
        action: "payment.unexplained-returned",
        stripeAccountId: fee.account,
        dedupeKey: fee.charge,
        detail: { ...extra, paymentIntentId: charge.paymentIntentId, refundId, by: "reconciliation" },
      });
      await syncRefunds(fee);
    } catch (error) {
      ledger.report(error, { level: "error", extra });
      result.notYetReturned.push(fee.fee_id);
      continue;
    }
    if (!(await covered(fee))) result.notYetReturned.push(fee.fee_id);
  }
}

/** The payments this run returned, as their fees, leaving out any fee still not refunded in full. */
async function returnedByThisRun(db: Queryable, returns: Returns, notYetReturned: string[]): Promise<ReconcileResult["returned"]> {
  const out: ReconcileResult["returned"] = [];
  for (const [chargeRef, { refundedGross }] of returns) {
    const { rows } = await db.query(
      `SELECT stripe_application_fee_id AS fee_id, gross_amount::text AS gross
         FROM commission_entries WHERE kind = 'fee' AND stripe_payment_ref = $1 ORDER BY occurred_at LIMIT 1`,
      [chargeRef],
    );
    const fee = rows[0] as { fee_id: string; gross: string } | undefined;
    if (fee && !notYetReturned.includes(fee.fee_id)) out.push({ feeId: fee.fee_id, chargeRef, gross: fee.gross, refundedGross });
  }
  return out;
}

/** The period's ledger by disposition: fee and refund counts and their gross (exact, as a decimal string). */
async function totals(db: Queryable, period: Period): Promise<ReconcileResult["totals"]> {
  const { rows } = await db.query(
    `SELECT disposition,
            COUNT(*) FILTER (WHERE kind = 'fee')::int AS fees,
            COUNT(*) FILTER (WHERE kind = 'fee_refund')::int AS refunds,
            COALESCE(SUM(gross_amount), 0)::text AS gross
       FROM commission_entries
      WHERE occurred_at >= $1 AND occurred_at < $2
      GROUP BY disposition`,
    [period.from, period.to],
  );
  const out: ReconcileResult["totals"] = {
    booked: { fees: 0, refunds: 0, gross: "0" },
    returned: { fees: 0, refunds: 0, gross: "0" },
  };
  for (const r of rows as { disposition: "booked" | "returned"; fees: number; refunds: number; gross: string }[]) {
    out[r.disposition] = { fees: r.fees, refunds: r.refunds, gross: r.gross };
  }
  return out;
}
