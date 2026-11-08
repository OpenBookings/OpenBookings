import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client, Pool, type PoolClient } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { upsertBillingProfile } from "../profiles";
import { periodFor } from "../period";
import { recordApplicationFee, recordApplicationFeeRefund, type ChargeInfo, type FeeLike, type FeeRefundLike, type LedgerDeps } from "../ledger";
import {
  poolTransaction,
  reconcile,
  savepointTransaction,
  type BalanceTransactionLike,
  type ReconcileDeps,
  type StripeLedgerSource,
} from "./reconcile";

const PERIOD = periodFor("2026-10");
const CREATED = 1_792_000_000; // 2026-10-14T17:46:40Z
const NEXT_MONTH = Math.floor(PERIOD.to.getTime() / 1000) + 60; // 1 November, just after midnight

type Calls = {
  returnPayment: [string, string, string][];
  audit: Parameters<LedgerDeps["audit"]>[0][];
  report: { error: unknown; context?: object }[];
  listed: unknown[];
};

describeWithDb("reconciling the commission ledger against Stripe", () => {
  let db: Client;
  let orgId: string;
  let propertyId: string;
  let roomId: string;
  let ratePlanId: string;
  let bookingId: string;
  let account: string;
  let pi: string;

  /** What Stripe reports per charge; a charge not listed is the booked one. */
  let charges: Map<string, ChargeInfo>;
  /** Stripe's side: the period's balance transactions, and every fee and fee refund it holds. */
  let listed: BalanceTransactionLike[];
  let stripeFees: Map<string, FeeLike>;
  let stripeRefunds: Map<string, FeeRefundLike>;
  /** What `returnPayment` does on Stripe: by default refunds the fee in full on 1 November. */
  let onReturn: (chargeId: string) => void;
  let calls: Calls;

  const bookedCharge = (): ChargeInfo => ({ paymentIntentId: pi, metadata: {}, amount: 25_000, amountRefunded: 0 });

  const ledger = (): LedgerDeps => ({
    db,
    chargeInfo: async (chargeId) => ({ ...(charges.get(chargeId) ?? bookedCharge()) }),
    returnPayment: async (chargeId, accountId, reason) => {
      calls.returnPayment.push([chargeId, accountId, reason]);
      onReturn(chargeId);
      const c = charges.get(chargeId);
      if (c) charges.set(chargeId, { ...c, amountRefunded: c.amount });
      return { refundId: `re_${chargeId}` };
    },
    audit: async (entry) => {
      calls.audit.push(entry);
    },
    report: (error, context) => {
      calls.report.push({ error, context });
    },
  });

  const source = (): StripeLedgerSource => ({
    async *listBalanceTransactions(p) {
      calls.listed.push(p);
      yield* listed;
    },
    retrieveFee: async (id) => {
      const f = stripeFees.get(id);
      if (!f) throw new Error(`No such fee ${id}`);
      return f;
    },
    retrieveFeeRefund: async (id) => {
      const r = stripeRefunds.get(id);
      if (!r) throw new Error(`No such fee refund ${id}`);
      return r;
    },
    listFeeRefunds: async (feeId) => [...stripeRefunds.values()].filter((r) => r.fee === feeId),
  });

  const deps = (over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({
    db,
    stripe: source(),
    ledger: ledger(),
    dryRun: false,
    inTransaction: savepointTransaction(db),
    ...over,
  });

  /** A fee on Stripe; listed among the period's balance transactions unless `list` is false. */
  const stripeFee = (over: Partial<FeeLike> = {}, list = true): FeeLike => {
    const f: FeeLike = {
      id: `fee_${crypto.randomUUID()}`,
      amount: 1080,
      currency: "eur",
      created: CREATED,
      account,
      charge: `ch_${crypto.randomUUID()}`,
      ...over,
    };
    stripeFees.set(f.id, f);
    if (list) listed.push({ type: "application_fee", source: f.id, amount: f.amount, created: f.created });
    return f;
  };

  const stripeRefund = (fee: FeeLike, amount: number, created = CREATED + 3600, list = true): FeeRefundLike => {
    const r: FeeRefundLike = { id: `fr_${crypto.randomUUID()}`, amount, created, fee: fee.id };
    stripeRefunds.set(r.id, r);
    if (list) listed.push({ type: "application_fee_refund", source: r.id, amount: -amount, created });
    return r;
  };

  const record = (f: FeeLike) => recordApplicationFee(f, ledger());
  const recordRefund = (r: FeeRefundLike) => recordApplicationFeeRefund(r, ledger(), async (id) => stripeFees.get(id)!);

  /** This test's ledger rows: those of the fees it put on Stripe. */
  const rows = async () =>
    (
      await db.query(
        `SELECT kind, stripe_application_fee_id AS fee, stripe_fee_refund_id AS refund, gross_amount::text AS gross, disposition
           FROM commission_entries WHERE stripe_application_fee_id = ANY($1::text[]) ORDER BY occurred_at, kind`,
        [[...stripeFees.keys()]],
      )
    ).rows;

  const seedIntent = async (status: string) =>
    (
      await db.query(
        `INSERT INTO booking_intents
           (user_id, property_id, check_in_date, check_out_date, status, hold_expires_at, snapshot,
            total_amount, commission_cents)
         VALUES ('u', $1, '2026-12-01', '2026-12-04', $2, now(), '{"roomsTotal": 240}'::jsonb, 240, 1080)
         RETURNING id`,
        [propertyId, status],
      )
    ).rows[0].id as string;

  /** A fee Stripe took on an oversold payment: the ledger records it returned and refunds nothing itself. */
  const oversoldFee = async (): Promise<FeeLike> => {
    const intentId = await seedIntent("oversold");
    const f = stripeFee();
    charges.set(f.charge, {
      paymentIntentId: `pi_${crypto.randomUUID()}`,
      metadata: { bookingIntentId: intentId },
      amount: 25_000,
      amountRefunded: 0,
    });
    return f;
  };

  const emptyTotals = { fees: 0, refunds: 0, gross: "0" };

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
    ({ propertyId, roomId, ratePlanId } = await seedProperty(db));
    orgId = `org-${crypto.randomUUID()}`;
    account = `acct_${crypto.randomUUID().slice(0, 12)}`;
    pi = `pi_${crypto.randomUUID()}`;
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await db.query(`UPDATE properties SET organization_id = $2, stripe_account_id = $3 WHERE id = $1`, [propertyId, orgId, account]);
    await db.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel BV', $2)`, [
      orgId,
      account,
    ]);
    await upsertBillingProfile(db, orgId, { legalName: "Hotel BV", countryCode: "NL", vatId: "NL123456789B01" });
    ({ bookingId } = await seedBooking(db, { propertyId, roomId, ratePlanId }, { checkIn: "2026-11-20", nights: 2 }));
    await db.query(
      `UPDATE bookings
          SET status = 'confirmed', stripe_payment_intent_id = $2,
              rooms_total_cents = 24000, total_cents = 24000, commission_cents = 1080, commission_rate = 0.045,
              commission_vat_treatment = 'NL_DOMESTIC', commission_net_cents = 893, commission_vat_cents = 187
        WHERE id = $1`,
      [bookingId, pi],
    );
    charges = new Map();
    listed = [];
    stripeFees = new Map();
    stripeRefunds = new Map();
    calls = { returnPayment: [], audit: [], report: [], listed: [] };
    onReturn = (chargeId) => {
      const f = [...stripeFees.values()].find((x) => x.charge === chargeId)!;
      stripeRefund(f, f.amount, NEXT_MONTH, false);
    };
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  test("everything matches → succeeded", async () => {
    const f = stripeFee();
    const r = stripeRefund(f, 540);
    await record(f);
    await recordRefund(r);

    const result = await reconcile(PERIOD, deps());

    expect(calls.listed).toEqual([PERIOD]);
    expect(result).toEqual({
      status: "succeeded",
      backfilled: [],
      missingInStripe: [],
      amountMismatches: [],
      unknownAccounts: [],
      unsettled: [],
      missingProfiles: [],
      returned: [],
      notYetReturned: [],
      totals: { booked: { fees: 1, refunds: 1, gross: "540" }, returned: emptyTotals },
    });
  });

  test("a fee missing in the ledger is backfilled, then succeeded", async () => {
    const f = stripeFee();
    const r = stripeRefund(f, 1080);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(result.backfilled).toEqual([f.id, r.id]);
    expect(await rows()).toEqual([
      { kind: "fee", fee: f.id, refund: null, gross: "1080", disposition: "booked" },
      { kind: "fee_refund", fee: f.id, refund: r.id, gross: "-1080", disposition: "booked" },
    ]);
    expect(result.totals.booked).toEqual({ fees: 1, refunds: 1, gross: "0" });
  });

  test("a refund of a fee from an earlier month the ledger lacks records that fee first", async () => {
    const f = stripeFee({ created: CREATED - 40 * 86_400 }, false); // September
    const r = stripeRefund(f, 270);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(result.backfilled).toEqual([r.id]);
    expect((await rows()).map((x) => [x.kind, x.gross])).toEqual([
      ["fee", "1080"],
      ["fee_refund", "-270"],
    ]);
    expect(result.totals.booked).toEqual({ fees: 0, refunds: 1, gross: "-270" });
  });

  test("a ledger entry Stripe does not have → blocked", async () => {
    const f = stripeFee({}, false);
    await record(f);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("blocked");
    expect(result.missingInStripe).toEqual([f.id]);
  });

  test("an entry of another month is no concern of this one", async () => {
    const f = stripeFee({ created: NEXT_MONTH }, false);
    await record(f);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(result.totals.booked).toEqual(emptyTotals);
  });

  test("an amount mismatch → blocked", async () => {
    const f = stripeFee();
    const r = stripeRefund(f, 500);
    await record(f);
    await recordRefund(r);
    listed[0] = { ...listed[0]!, amount: 1000 };
    listed[1] = { ...listed[1]!, amount: -400 };

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("blocked");
    expect(result.amountMismatches).toEqual([
      { id: f.id, stripe: 1000, ledger: "1080" },
      { id: r.id, stripe: -400, ledger: "-500" },
    ]);
    expect(result.missingInStripe).toEqual([]);
  });

  test.each([false, true])("a fee on an unknown account → blocked, listed (dry run: %p)", async (dryRun) => {
    const stranger = `acct_${crypto.randomUUID().slice(0, 12)}`;
    stripeFee({ account: stranger });

    const result = await reconcile(PERIOD, deps({ dryRun }));

    expect(result.status).toBe("blocked");
    expect(result.unknownAccounts).toEqual([stranger]);
    expect(result.backfilled).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  test.each([false, true])("a fee whose payment has not become a booking yet → blocked, listed as unsettled (dry run: %p)", async (dryRun) => {
    const intentId = await seedIntent("open");
    const f = stripeFee();
    const otherPi = `pi_${crypto.randomUUID()}`;
    charges.set(f.charge, { paymentIntentId: otherPi, metadata: { bookingIntentId: intentId }, amount: 25_000, amountRefunded: 0 });
    stripeRefund(f, 100); // its refund fails on the same cause; the fee is listed once

    const result = await reconcile(PERIOD, deps({ dryRun }));

    expect(result.status).toBe("blocked");
    expect(result.unsettled).toEqual([{ feeId: f.id, paymentIntentId: otherPi, intentId }]);
    expect(await rows()).toEqual([]);
  });

  test.each([false, true])("a fee whose organization has no billing profile → blocked, listed (dry run: %p)", async (dryRun) => {
    await db.query(`DELETE FROM billing_profiles WHERE organization_id = $1`, [orgId]);
    await db.query(
      `UPDATE bookings SET commission_vat_treatment = NULL, commission_net_cents = NULL, commission_vat_cents = NULL WHERE id = $1`,
      [bookingId],
    );
    const f = stripeFee();

    const result = await reconcile(PERIOD, deps({ dryRun }));

    expect(result.status).toBe("blocked");
    expect(result.missingProfiles).toEqual([{ feeId: f.id, organizationId: orgId }]);
  });

  test("any other failure fails the run", async () => {
    const f = stripeFee();
    stripeFees.delete(f.id);

    await expect(reconcile(PERIOD, deps())).rejects.toThrow(/No such fee/);
  });

  test("a returned fee refunded in the next month is returned", async () => {
    const f = await oversoldFee();
    await record(f);
    await recordRefund(stripeRefund(f, 1080, NEXT_MONTH, false));

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(result.returned).toEqual([]);
    expect(calls.returnPayment).toEqual([]);
    expect(result.totals).toEqual({ booked: emptyTotals, returned: { fees: 1, refunds: 0, gross: "1080" } });
  });

  test("a returned fee Stripe refunded but the ledger missed is recorded, not refunded again", async () => {
    const f = await oversoldFee();
    await record(f);
    const r = stripeRefund(f, 1080, NEXT_MONTH, false);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(calls.returnPayment).toEqual([]);
    expect(result.backfilled).toEqual([r.id]);
    expect((await rows()).map((x) => x.refund)).toEqual([null, r.id]);
  });

  test("a returned fee that was never refunded is returned now", async () => {
    const f = await oversoldFee();
    await record(f);

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("succeeded");
    expect(calls.returnPayment).toEqual([[f.charge, account, "unexplained"]]);
    expect(result.returned).toEqual([{ feeId: f.id, chargeRef: f.charge, gross: "1080", refundedGross: "0" }]);
    expect(await rows()).toEqual([
      { kind: "fee", fee: f.id, refund: null, gross: "1080", disposition: "returned" },
      { kind: "fee_refund", fee: f.id, refund: expect.stringMatching(/^fr_/), gross: "-1080", disposition: "returned" },
    ]);
    expect(calls.audit).toEqual([
      expect.objectContaining({ action: "payment.unexplained-returned", stripeAccountId: account, dedupeKey: f.charge }),
    ]);
    expect(calls.report.some((c) => (c.context as { level?: string } | undefined)?.level === "warning")).toBe(true);
  });

  test("a returned fee that cannot be refunded blocks the run", async () => {
    const f = await oversoldFee();
    await record(f);
    onReturn = () => {
      throw new Error("Stripe said no");
    };

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("blocked");
    expect(result.notYetReturned).toEqual([f.id]);
    expect(result.returned).toEqual([]);
    expect(calls.report.some((c) => (c.error as Error).message === "Stripe said no")).toBe(true);
  });

  test("a returned fee whose refund leaves the fee with us blocks the run", async () => {
    const f = await oversoldFee();
    await record(f);
    onReturn = () => {}; // the charge is refunded, the application fee is not

    const result = await reconcile(PERIOD, deps());

    expect(result.status).toBe("blocked");
    expect(result.notYetReturned).toEqual([f.id]);
  });

  test("dry run backfills and returns nothing", async () => {
    const missing = stripeFee();
    const missingRefund = stripeRefund(missing, 1080);
    const returned = await oversoldFee();
    await record(returned);
    calls.report = [];

    const result = await reconcile(PERIOD, deps({ dryRun: true }));

    expect(result).toEqual({
      status: "succeeded",
      backfilled: [missing.id, missingRefund.id],
      missingInStripe: [],
      amountMismatches: [],
      unknownAccounts: [],
      unsettled: [],
      missingProfiles: [],
      returned: [{ feeId: returned.id, chargeRef: returned.charge, gross: "1080", refundedGross: "0" }],
      notYetReturned: [],
      // What the real run would leave: the backfilled fee and refund are counted, then rolled back.
      totals: { booked: { fees: 1, refunds: 1, gross: "0" }, returned: { fees: 1, refunds: 0, gross: "1080" } },
    });
    expect(calls.returnPayment).toEqual([]);
    expect(calls.audit).toEqual([]);
    expect(calls.report).toEqual([]);
    expect((await rows()).map((x) => x.fee)).toEqual([returned.id]);
  });

  test("savepoint runners nested on one connection each undo only their own work", async () => {
    const outer = savepointTransaction(db);
    const inner = savepointTransaction(db);
    await db.query("CREATE TEMP TABLE reconcile_sp_probe (x int) ON COMMIT DROP");
    await expect(
      outer(async () => {
        await db.query("INSERT INTO reconcile_sp_probe VALUES (1)");
        await expect(
          inner(async () => {
            await db.query("INSERT INTO reconcile_sp_probe VALUES (2)");
            throw new Error("unit");
          }),
        ).rejects.toThrow("unit");
        await db.query("INSERT INTO reconcile_sp_probe VALUES (3)");
        throw new Error("outer");
      }),
    ).rejects.toThrow("outer");
    expect((await db.query("SELECT x FROM reconcile_sp_probe")).rows).toEqual([]);
  });

  test("a savepoint that cannot be rolled back to surfaces the work's error", async () => {
    const statements: string[] = [];
    const broken = {
      query: async (text: string) => {
        statements.push(text);
        if (text.startsWith("ROLLBACK TO")) throw new Error("connection lost");
        return { rows: [] };
      },
    };
    await expect(
      savepointTransaction(broken)(async () => {
        throw new Error("the real failure");
      }),
    ).rejects.toThrow("the real failure");
    expect(statements[0]).toMatch(/^SAVEPOINT reconcile_sp_\d+$/);
  });

  test("a dry run keeps nothing when a refund unit fails after a fee was backfilled", async () => {
    stripeFee(); // backfilled first
    const intentId = await seedIntent("open");
    const earlier = stripeFee({ created: CREATED - 40 * 86_400 }, false); // September, not listed
    charges.set(earlier.charge, {
      paymentIntentId: `pi_${crypto.randomUUID()}`,
      metadata: { bookingIntentId: intentId },
      amount: 25_000,
      amountRefunded: 0,
    });
    stripeRefund(earlier, 100); // fails as unsettled inside its own unit

    const result = await reconcile(PERIOD, deps({ dryRun: true }));

    expect(result.unsettled).toEqual([expect.objectContaining({ feeId: earlier.id, intentId })]);
    expect(result.backfilled).toHaveLength(1);
    expect(await rows()).toEqual([]);
  });

  test.each([false, true])("a payment the ledger returns while backfilling is listed as returned (dry run: %p)", async (dryRun) => {
    const f = stripeFee();
    charges.set(f.charge, { paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 0 });

    const result = await reconcile(PERIOD, deps({ dryRun }));

    expect(result.status).toBe("succeeded");
    expect(result.returned).toEqual([{ feeId: f.id, chargeRef: f.charge, gross: "1080", refundedGross: "0" }]);
    expect(result.notYetReturned).toEqual([]);
    // Returned once, by the ledger; the settling step does not return it again.
    expect(calls.returnPayment).toEqual(dryRun ? [] : [[f.charge, account, "unexplained"]]);
    expect(await rows()).toHaveLength(dryRun ? 0 : 2);
  });

  test("runs each fee refund through the transaction wrapper", async () => {
    const f = stripeFee();
    stripeRefund(f, 100);
    let wrapped = 0;

    await reconcile(
      PERIOD,
      deps({
        inTransaction: async (work) => {
          wrapped += 1;
          return work(db);
        },
      }),
    );

    expect(wrapped).toBe(1);
  });
});

describeWithDb("reconciliation transactions on a real pool", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_DIRECT ?? connectionString, max: 1 });
  });
  afterAll(async () => {
    await pool.end();
  });

  test("poolTransaction commits, rolls back on a throw, and releases its client", async () => {
    const tx = poolTransaction(pool);
    await tx((c) => c.query("CREATE TEMP TABLE reconcile_committed (x int)"));
    await expect(
      tx(async (c) => {
        await c.query("CREATE TEMP TABLE reconcile_rolled_back (x int)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rows } = await pool.query(
      `SELECT to_regclass('pg_temp.reconcile_committed') IS NOT NULL AS committed,
              to_regclass('pg_temp.reconcile_rolled_back') IS NOT NULL AS rolled_back`,
    );
    expect(rows[0]).toEqual({ committed: true, rolled_back: false });
    expect(pool.idleCount).toBe(pool.totalCount);
    await pool.query("DROP TABLE reconcile_committed");
  });

  test("a dry run refuses a runner that does not open a transaction", async () => {
    const fee = `fee_${crypto.randomUUID()}`;
    let listed = false;
    const stripe: StripeLedgerSource = {
      async *listBalanceTransactions() {
        listed = true;
        yield { type: "application_fee", source: fee, amount: 1080, created: 1 };
      },
      retrieveFee: async (id) => {
        throw new Error(`unexpected ${id}`);
      },
      retrieveFeeRefund: async (id) => {
        throw new Error(`unexpected ${id}`);
      },
      listFeeRefunds: async () => [],
    };
    const ledger: LedgerDeps = {
      db: pool,
      chargeInfo: async () => {
        throw new Error("unexpected chargeInfo");
      },
      returnPayment: async () => {
        throw new Error("unexpected returnPayment");
      },
      audit: async () => {},
      report: () => {},
    };

    await expect(
      reconcile(periodFor("2031-03"), { db: pool, stripe, ledger, dryRun: true, inTransaction: (work) => work(pool) }),
    ).rejects.toThrow(/dry run needs a transaction/i);
    expect(listed).toBe(false);
  });

  test("a dry run on a pool keeps nothing and moves no money", async () => {
    // The ledger is append-only, so a dry run that wrongly committed would leave
    // rows on the shared test database for good: this pool turns COMMIT into
    // ROLLBACK and counts it.
    const dryPool = new Pool({ connectionString: process.env.DATABASE_URL_DIRECT ?? connectionString, max: 1 });
    let commits = 0;
    const connect = dryPool.connect.bind(dryPool) as () => Promise<PoolClient>;
    dryPool.connect = (async () => {
      const client = await connect();
      const query = client.query.bind(client) as (text: string, values?: unknown[]) => Promise<unknown>;
      client.query = ((text: string, values?: unknown[]) => {
        if (text === "COMMIT") {
          commits += 1;
          return query("ROLLBACK");
        }
        return query(text, values);
      }) as never;
      return client;
    }) as never;

    // Committed, so the dry run's own connection sees it; removed again below.
    const orgId = `org-${crypto.randomUUID()}`;
    const account = `acct_${crypto.randomUUID().slice(0, 12)}`;
    await pool.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Org', $1, NOW())`, [orgId]);
    await pool.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel BV', $2)`, [
      orgId,
      account,
    ]);
    try {
      const period = periodFor("2031-03"); // a month no other data reaches
      const fee: FeeLike = {
        id: `fee_${crypto.randomUUID()}`,
        amount: 1080,
        currency: "eur",
        created: Math.floor(period.from.getTime() / 1000) + 86_400,
        account,
        charge: `ch_${crypto.randomUUID()}`,
      };
      const moved: unknown[] = [];
      const ledger: LedgerDeps = {
        db: dryPool,
        // A payment nothing explains: the ledger returns it while recording the fee.
        chargeInfo: async () => ({ paymentIntentId: `pi_${crypto.randomUUID()}`, metadata: {}, amount: 25_000, amountRefunded: 0 }),
        returnPayment: async (...args) => {
          moved.push(["returnPayment", ...args]);
          return { refundId: "re_real" };
        },
        audit: async (entry) => void moved.push(["audit", entry]),
        report: (error) => void moved.push(["report", error]),
      };
      const stripe: StripeLedgerSource = {
        async *listBalanceTransactions() {
          yield { type: "application_fee", source: fee.id, amount: fee.amount, created: fee.created };
        },
        retrieveFee: async () => fee,
        retrieveFeeRefund: async (id) => {
          throw new Error(`unexpected ${id}`);
        },
        listFeeRefunds: async () => [],
      };

      const result = await reconcile(period, { db: dryPool, stripe, ledger, dryRun: true, inTransaction: poolTransaction(dryPool) });

      expect(result.status).toBe("succeeded");
      expect(result.backfilled).toEqual([fee.id]);
      expect(result.returned).toEqual([{ feeId: fee.id, chargeRef: fee.charge, gross: "1080", refundedGross: "0" }]);
      expect(result.totals.returned).toEqual({ fees: 1, refunds: 0, gross: "1080" });
      expect(moved).toEqual([]);
      expect(commits).toBe(0);
      const kept = await pool.query(`SELECT 1 FROM commission_entries WHERE stripe_application_fee_id = $1`, [fee.id]);
      expect(kept.rows).toEqual([]);
      expect(dryPool.idleCount).toBe(dryPool.totalCount);
    } finally {
      await dryPool.end();
      await pool.query(`DELETE FROM org_profile WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM "organization" WHERE id = $1`, [orgId]);
    }
  });
});
