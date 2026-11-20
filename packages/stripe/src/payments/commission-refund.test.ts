import { describe, expect, test } from "bun:test";
import { commissionDueOnRefunds, ownUnsplitRefunded } from "./commission-refund";

// EUR 100 room price, no tourist tax; 4.5% commission is EUR 4.50.
const roomOnly = { chargeAmount: 10_000, feeAmount: 450 };
const ok = "succeeded";
/** A refund the host made in their own Stripe Dashboard: no OpenBookings metadata. */
const outside = (amount: number) => ({ amount, status: ok, metadata: {} });
/** OpenBookings' own refund of a booking, naming its room-price part. */
const ours = (amount: number, room: number, roomTotal: number) => ({
  amount,
  status: ok,
  metadata: { refundId: "r1", accommodationCents: String(room), accommodationTotalCents: String(roomTotal) },
});

describe("commissionDueOnRefunds: refunds outside OpenBookings return no commission", () => {
  test("the host refunds EUR 20 of a EUR 100 charge in Stripe: nothing back", () => {
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [outside(2_000)] })).toBe(0);
  });

  test("the host refunds the whole charge in Stripe: still nothing back", () => {
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [outside(10_000)] })).toBe(0);
  });

  test("the same EUR 20 refunded through OpenBookings returns 20% of the fee", () => {
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [ours(2_000, 2_000, 10_000)] })).toBe(90);
  });

  test("our own refunds without a split count against the whole charge", () => {
    const oversold = { amount: 10_000, status: ok, metadata: { intentId: "i1", reason: "oversold" } };
    const duplicate = { amount: 10_000, status: ok, metadata: { intentId: "i1", reason: "duplicate" } };
    const unexplained = { amount: 5_000, status: ok, metadata: { reason: "unexplained" } };
    const noRoomPrice = { amount: 3_000, status: ok, metadata: { refundId: "r2" } };
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [oversold] })).toBe(450);
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [duplicate] })).toBe(450);
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [unexplained] })).toBe(225);
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [noRoomPrice] })).toBe(135);
  });

  test("a lost dispute counts against the whole charge, whatever the host refunded in Stripe", () => {
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [], lostDisputeAmount: 4_000 })).toBe(180);
    expect(
      commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [outside(2_000)], lostDisputeAmount: 4_000 }),
    ).toBe(180);
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [], lostDisputeAmount: 10_000 })).toBe(450);
  });

  test("a mixture: only our split refund and the dispute count, the outside refund does not", () => {
    // EUR 100 room + EUR 5 tourist tax. Ours: EUR 20 room + EUR 5 tax (20% of
    // the room price). The host's own: EUR 30. A dispute lost for EUR 21 (20%
    // of the charge). 20% + 20% of EUR 4.50.
    const charge = { chargeAmount: 10_500, feeAmount: 450 };
    const refunds = [ours(2_500, 2_000, 10_000), outside(3_000)];
    const first = commissionDueOnRefunds({ ...charge, feeRefunded: 0, refunds, lostDisputeAmount: 2_100 });
    expect(first).toBe(180);
    // Every event on the charge recomputes the same target, so repeats return nothing.
    expect(commissionDueOnRefunds({ ...charge, feeRefunded: first, refunds, lostDisputeAmount: 2_100 })).toBe(0);
    expect(commissionDueOnRefunds({ ...charge, feeRefunded: first, refunds })).toBe(0);
    expect(commissionDueOnRefunds({ ...charge, feeRefunded: first, refunds: [...refunds, outside(4_000)] })).toBe(0);
  });

  test("repeated calls return nothing more", () => {
    const refunds = [ours(2_000, 2_000, 10_000), outside(5_000)];
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 90, refunds })).toBe(0);
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 90, refunds })).toBe(0);
  });

  test("commission returned earlier on an outside refund is never clawed back", () => {
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 90, refunds: [outside(2_000)] })).toBe(0);
  });

  test("our refunds plus a lost dispute never return more than the fee", () => {
    const oversold = { amount: 10_000, status: ok, metadata: { intentId: "i1", reason: "oversold" } };
    expect(commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [oversold], lostDisputeAmount: 10_000 })).toBe(450);
    expect(
      commissionDueOnRefunds({ ...roomOnly, feeRefunded: 0, refunds: [ours(8_000, 8_000, 10_000)], lostDisputeAmount: 10_000 }),
    ).toBe(450);
  });
});

describe("ownUnsplitRefunded", () => {
  test("adds up our refunds without a split, and skips outside, split, failed and canceled ones", () => {
    expect(
      ownUnsplitRefunded([
        { amount: 1_000, status: ok, metadata: { intentId: "i1" } },
        { amount: 2_000, status: "pending", metadata: { reason: "unexplained" } },
        { amount: 4_000, status: ok, metadata: {} },
        { amount: 8_000, status: ok, metadata: null },
        { amount: 16_000, status: ok, metadata: { refundId: "r1", accommodationCents: "1", accommodationTotalCents: "2" } },
        { amount: 32_000, status: "failed", metadata: { intentId: "i1" } },
        { amount: 64_000, status: "canceled", metadata: { refundId: "r1" } },
      ]),
    ).toBe(3_000);
  });

  test("our refund whose split is not whole cents counts against the whole charge", () => {
    expect(
      ownUnsplitRefunded([{ amount: 100, status: ok, metadata: { accommodationCents: "1.5", accommodationTotalCents: "100" } }]),
    ).toBe(100);
  });
});
