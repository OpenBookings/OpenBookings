import { Pool } from "pg";
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
  /** Stripe ids recorded by this run (in a dry run: that would be). */
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
  /** Returned fees this run gave back (in a dry run: would), with what the ledger held as refunded before. */
  returned: { feeId: string; chargeRef: string; gross: string; refundedGross: string }[];
  /** Returned fees still not refunded in full. */
  notYetReturned: string[];
  /** The period's ledger after the run, by disposition; gross is fees plus (negative) refunds. */
  totals: { booked: Totals; returned: Totals };
};

export type ReconcileDeps = {
  /** Where the ledger lives; the ledger functions run on it too (`ledger.db` is not used). */
  db: Queryable;
  stripe: StripeLedgerSource;
  ledger: LedgerDeps;
  dryRun: boolean;
  /**
   * Runs `work` in one transaction. Defaults to a BEGIN/COMMIT on a client of
   * `db` when it is a pool; any other `db` is used as it is, so a caller
   * passing one connection owns its transaction.
   */
  inTransaction?: <T>(work: (db: Queryable) => Promise<T>) => Promise<T>;
};

type LedgerRow = { kind: "fee" | "fee_refund"; stripe_id: string; gross: string; in_period: boolean };

type ReturnedFee = { fee_id: string; charge: string | null; account: string; gross: string; refunded: string };

/** The instant as Stripe's whole seconds. */
const unixSeconds = (at: Date) => Math.floor(at.getTime() / 1000);

const abs = (n: bigint) => (n < 0n ? -n : n);

function defaultInTransaction(db: Queryable) {
  return async <T>(work: (db: Queryable) => Promise<T>): Promise<T> => {
    if (!(db instanceof Pool)) return work(db);
    const client = await db.connect();
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
 * recorded. One that is still short after that blocks the run.
 *
 * `dryRun` records nothing and moves no money: it lists what it would
 * backfill and return. Each fee refund is recorded in its own transaction.
 */
export async function reconcile(period: Period, deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, stripe, dryRun } = deps;
  const inTransaction = deps.inTransaction ?? defaultInTransaction(db);
  const ledger = (on: Queryable): LedgerDeps => ({ ...deps.ledger, db: on });

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
    if (dryRun) result.backfilled.push(bt.source);
    else await backfill(bt.source, bt.source, async () => recordApplicationFee(await stripe.retrieveFee(bt.source), ledger(db)));
  }
  for (const bt of missing.filter((m) => m.type === "application_fee_refund")) {
    if (dryRun) {
      result.backfilled.push(bt.source);
      continue;
    }
    const refund = await stripe.retrieveFeeRefund(bt.source);
    await backfill(bt.source, refund.fee, () => recordRefund(refund));
  }

  // Compare again.
  const after = dryRun ? before : await readLedger();
  for (const bt of listed.values()) {
    const row = after.get(bt.source);
    if (row && abs(BigInt(bt.amount)) !== abs(BigInt(row.gross))) {
      result.amountMismatches.push({ id: bt.source, stripe: bt.amount, ledger: row.gross });
    }
  }
  for (const row of after.values()) {
    if (row.in_period && !listed.has(row.stripe_id)) result.missingInStripe.push(row.stripe_id);
  }

  await settleReturnedFees(period, deps, recordRefund, result);
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
 * reported) and records its refund. Whatever is still short is listed in
 * `notYetReturned`.
 */
async function settleReturnedFees(
  period: Period,
  deps: ReconcileDeps,
  recordRefund: (refund: FeeRefundLike) => Promise<{ inserted: boolean }>,
  result: ReconcileResult,
): Promise<void> {
  const { db, stripe, ledger, dryRun } = deps;

  /** Records the fee's refunds Stripe has and the ledger lacks; in a dry run, only counts them. */
  const syncRefunds = async (fee: ReturnedFee): Promise<bigint> => {
    let pending = 0n;
    for (const refund of await stripe.listFeeRefunds(fee.fee_id)) {
      const { rows } = await db.query(`SELECT 1 FROM commission_entries WHERE stripe_fee_refund_id = $1`, [refund.id]);
      if (rows.length > 0) continue;
      if (dryRun) {
        pending += BigInt(refund.amount);
        result.backfilled.push(refund.id);
      } else if ((await recordRefund(refund)).inserted) {
        result.backfilled.push(refund.id);
      }
    }
    return pending;
  };

  const refundedNow = async (fee: ReturnedFee) => BigInt((await returnedFees(db, period, fee.fee_id))[0]?.refunded ?? fee.refunded);

  for (const fee of (await returnedFees(db, period)).filter(short)) {
    const gross = BigInt(fee.gross);
    const pending = await syncRefunds(fee);
    if ((dryRun ? BigInt(fee.refunded) + pending : await refundedNow(fee)) >= gross) continue;

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

    const entry = { feeId: fee.fee_id, chargeRef: fee.charge, gross: fee.gross, refundedGross: fee.refunded };
    if (dryRun) {
      result.returned.push(entry);
      continue;
    }
    ledger.report(new Error(`Returned fee ${fee.fee_id} was still not refunded at month end; returning payment ${fee.charge} now`), {
      level: "warning",
      extra,
    });
    try {
      const { refundId } = await ledger.returnPayment(fee.charge, fee.account, "unexplained");
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
    if ((await refundedNow(fee)) >= gross) result.returned.push(entry);
    else result.notYetReturned.push(fee.fee_id);
  }
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
