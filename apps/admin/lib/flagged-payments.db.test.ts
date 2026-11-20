import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Client } from "pg";
import { applyPendingMigrations, connectionString, describeWithDb, seedBooking, seedProperty } from "@openbookings/db/testing";
import { bookingRef, loadFlaggedPayments, resolvePaymentFlag } from "./flagged-payments";

const RANDOM = "7f1f6f0e-0000-4000-8000-000000000000";

describeWithDb("flagged payments against Postgres", () => {
  let db: Client;
  let bookingId: string;
  let orgId: string;
  let account: string;
  let pi: string;

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
    const ids = await seedProperty(db);
    ({ bookingId } = await seedBooking(db, ids, { checkIn: "2031-11-10", nights: 2 }));
    const suffix = crypto.randomUUID().slice(0, 8);
    orgId = `test-org-${suffix}`;
    account = `acct_${suffix}`;
    pi = `pi_${suffix}`;
    await db.query(`UPDATE bookings SET stripe_payment_intent_id = $2 WHERE id = $1`, [bookingId, pi]);
    await db.query(`INSERT INTO "organization" (id, name, slug, "createdAt") VALUES ($1, 'Hotel Flag', $1, NOW())`, [orgId]);
    await db.query(`INSERT INTO org_profile (organization_id, legal_entity_name, stripe_account_id) VALUES ($1, 'Hotel Flag BV', $2)`, [
      orgId,
      account,
    ]);
    for (const [role, email] of [
      ["owner", `owner-${suffix}@example.test`],
      ["member", `staff-${suffix}@example.test`],
    ]) {
      const userId = `test-user-${role}-${suffix}`;
      await db.query(
        `INSERT INTO "user" (id, name, email, "emailVerified", account_type) VALUES ($1, 'U', $2, true, 'private'::account_type)`,
        [userId, email],
      );
      await db.query(
        `INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt") VALUES (gen_random_uuid()::text, $1, $2, $3, NOW())`,
        [orgId, userId, role],
      );
    }
  });
  afterEach(async () => {
    await db.query("ROLLBACK");
  });

  /** As the business app's recordStripeAudit writes it. */
  const flag = async (action: string, detail: Record<string, unknown>, dedupeKey: string, at: string) =>
    (
      await db.query(
        `INSERT INTO audit_log (action, organization_id, detail, created_at)
         VALUES ($1, (SELECT organization_id FROM org_profile WHERE stripe_account_id = $2), $3::jsonb, $4)
         RETURNING id`,
        [action, account, JSON.stringify({ ...detail, stripeAccountId: account, dedupeKey }), at],
      )
    ).rows[0].id as string;

  const ours = async () => (await loadFlaggedPayments(db)).filter((f) => f.organizationId === orgId);

  test("lists refunds outside OpenBookings and lost disputes, newest first, with host, owners and booking", async () => {
    await flag(
      "payment.refund-outside-openbookings",
      { chargeId: "ch_1", refundId: "re_1", paymentIntentId: pi, amount: 5000, created: 1, reason: "requested_by_customer" },
      "re_1",
      "2031-01-01T10:00:00Z",
    );
    await flag(
      "payment.dispute-lost",
      { chargeId: "ch_2", disputeId: "dp_1", paymentIntentId: "pi_unknown", amount: 12345, reason: "fraudulent" },
      "dp_1",
      "2031-01-02T10:00:00Z",
    );
    await flag("commission.refunded", { chargeId: "ch_1", feeRefundId: "fr_1", amount: 225 }, "fr_1", "2031-01-03T10:00:00Z");

    const rows = await ours();
    expect(rows.map((r) => [r.kind, r.objectId, r.amountCents, r.bookingId])).toEqual([
      ["dispute-lost", "dp_1", 12345, null],
      ["refund-outside", "re_1", 5000, bookingId],
    ]);
    const refund = rows[1]!;
    expect(refund.organizationName).toBe("Hotel Flag");
    expect(refund.ownerEmails).toEqual([expect.stringMatching(/^owner-/)]);
    expect(refund.chargeId).toBe("ch_1");
    expect(refund.paymentIntentId).toBe(pi);
    expect(refund.stripeAccountId).toBe(account);
    expect(refund.reason).toBe("requested_by_customer");
    expect(refund.resolvedAt).toBeNull();
    expect(bookingRef(bookingId)).toBe(bookingId.slice(0, 8).toUpperCase());
  });

  test("resolving writes one audit row with the flag's dedupe key, and a second resolve writes none", async () => {
    const id = await flag("payment.dispute-lost", { chargeId: "ch_2", disputeId: "dp_9", amount: 100 }, "dp_9", "2031-01-02T10:00:00Z");
    expect(await resolvePaymentFlag(db, { flagId: id, note: " Guest's card was stolen " })).toEqual({ ok: true });
    expect(await resolvePaymentFlag(db, { flagId: id })).toEqual({ ok: false, error: "already_resolved" });

    const resolved = (
      await db.query(`SELECT organization_id, actor_user_id, reason, detail FROM audit_log WHERE action = 'payment.flag-resolved' AND detail->>'dedupeKey' = 'dp_9'`)
    ).rows;
    expect(resolved).toEqual([
      {
        organization_id: orgId,
        actor_user_id: "dev-super-admin",
        reason: "Guest's card was stolen",
        detail: { dedupeKey: "dp_9", flagId: id, flagAction: "payment.dispute-lost" },
      },
    ]);
    const [row] = await ours();
    expect(row!.resolvedAt).toBeInstanceOf(Date);
    expect(row!.resolvedNote).toBe("Guest's card was stolen");
  });

  test("only flags can be resolved", async () => {
    const other = await flag("commission.refunded", { chargeId: "ch_1", feeRefundId: "fr_1", amount: 225 }, "fr_1", "2031-01-03T10:00:00Z");
    expect(await resolvePaymentFlag(db, { flagId: other })).toEqual({ ok: false, error: "not_found" });
    expect(await resolvePaymentFlag(db, { flagId: RANDOM })).toEqual({ ok: false, error: "not_found" });
    expect(await resolvePaymentFlag(db, { flagId: "abc" })).toEqual({ ok: false, error: "invalid" });
  });
});
