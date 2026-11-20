import { describe, expect, test } from "bun:test";
import { applicationFeeCents, bookingSplitCents, commissionRefundDue, roomPriceOfRefunds } from "./fees";

describe("applicationFeeCents", () => {
  test("4.5% of the full guest price", () => {
    expect(applicationFeeCents(100_00, 0.045)).toBe(450);
  });

  test("rounds half up to a whole cent", () => {
    expect(applicationFeeCents(55_500, 0.045)).toBe(2498); // 2497.5
    expect(applicationFeeCents(1_011, 0.045)).toBe(45); // 45.495
  });

  test("a zero rate is no fee", () => {
    expect(applicationFeeCents(100_00, 0)).toBe(0);
  });

  test("a rate that cannot be a commission is refused, not charged", () => {
    for (const rate of [-0.01, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applicationFeeCents(100_00, rate)).toThrow();
    }
  });

  test("a total that is not a whole positive amount is refused", () => {
    for (const total of [-1, 10.5, Number.NaN]) {
      expect(() => applicationFeeCents(total, 0.045)).toThrow();
    }
  });

  test("is always below the total", () => {
    expect(applicationFeeCents(1, 0.99)).toBe(0);
    expect(applicationFeeCents(2, 0.99)).toBe(1);
  });
});

describe("commissionRefundDue", () => {
  const charge = { chargeAmount: 55_500, feeAmount: 2498 };

  test("a full refund returns the whole commission", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, unsplitRefunded: 55_500, feeRefunded: 0 })).toBe(2498);
  });

  test("half refunded returns half; the rest returns the rest, to the cent", () => {
    const first = commissionRefundDue({ ...charge, chargeRefunded: 27_750, unsplitRefunded: 27_750, feeRefunded: 0 });
    expect(first).toBe(1249);
    const second = commissionRefundDue({ ...charge, chargeRefunded: 55_500, unsplitRefunded: 55_500, feeRefunded: first });
    expect(first + second).toBe(2498);
  });

  test("a redelivered event returns nothing more", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 27_750, unsplitRefunded: 27_750, feeRefunded: 1249 })).toBe(0);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, unsplitRefunded: 55_500, feeRefunded: 2498 })).toBe(0);
  });

  test("a dispute lost for the whole payment returns the whole commission", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 0, unsplitRefunded: 0, feeRefunded: 0, lostDisputeAmount: 55_500 })).toBe(2498);
  });

  test("a dispute lost for part of the payment returns that part's commission, not all of it", () => {
    // Guest disputes EUR 100 of a EUR 555 stay and wins: the stay mostly happened.
    expect(commissionRefundDue({ ...charge, chargeRefunded: 0, unsplitRefunded: 0, feeRefunded: 0, lostDisputeAmount: 10_000 })).toBe(450);
  });

  test("half refunded, then the other half lost to a dispute, returns the fee exactly once", () => {
    const first = commissionRefundDue({ ...charge, chargeRefunded: 27_750, unsplitRefunded: 27_750, feeRefunded: 0 });
    const second = commissionRefundDue({ ...charge, chargeRefunded: 27_750, unsplitRefunded: 27_750, feeRefunded: first, lostDisputeAmount: 27_750 });
    expect(first + second).toBe(2498);
    // The dispute event redelivered.
    expect(commissionRefundDue({ ...charge, chargeRefunded: 27_750, unsplitRefunded: 27_750, feeRefunded: 2498, lostDisputeAmount: 27_750 })).toBe(0);
  });

  test("a refund arriving after a lost dispute never claws commission back", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 5_000, unsplitRefunded: 5_000, feeRefunded: 2498 })).toBe(0);
  });

  test("never returns more than was collected, whatever the inputs say", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 99_999, unsplitRefunded: 99_999, feeRefunded: 0 })).toBe(2498);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, unsplitRefunded: 55_500, feeRefunded: 3000 })).toBe(0);
  });

  test("no fee, no charge or nothing refunded means nothing to return", () => {
    expect(commissionRefundDue({ chargeAmount: 55_500, feeAmount: 0, chargeRefunded: 55_500, unsplitRefunded: 55_500, feeRefunded: 0 })).toBe(0);
    expect(commissionRefundDue({ chargeAmount: 0, feeAmount: 2498, chargeRefunded: 0, unsplitRefunded: 0, feeRefunded: 0 })).toBe(0);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 0, unsplitRefunded: 0, feeRefunded: 0 })).toBe(0);
  });
});

describe("commissionRefundDue on the room price", () => {
  // EUR 360 stay + EUR 45 tourist tax; 4.5% of the stay is EUR 16.20.
  const charge = { chargeAmount: 40_500, feeAmount: 1_620 };
  const split = (roomRefunded: number, refunded: number) => ({ roomTotal: 36_000, roomRefunded, refunded });

  test("a late cancellation that refunds only the tourist tax returns no commission", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 4_500, feeRefunded: 0, roomPrice: split(0, 4_500) })).toBe(0);
  });

  test("80% of the room price back returns 80% of the commission, whatever the tax does", () => {
    const refunded = 28_800 + 4_500;
    expect(commissionRefundDue({ ...charge, chargeRefunded: refunded, feeRefunded: 0, roomPrice: split(28_800, refunded) })).toBe(1_296);
  });

  test("a full refund returns the whole commission", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 40_500, feeRefunded: 0, roomPrice: split(36_000, 40_500) })).toBe(1_620);
  });

  test("tax first, then the room price: the parts sum to the fee exactly", () => {
    const first = commissionRefundDue({ ...charge, chargeRefunded: 4_500, feeRefunded: 0, roomPrice: split(0, 4_500) });
    const second = commissionRefundDue({ ...charge, chargeRefunded: 40_500, feeRefunded: first, roomPrice: split(36_000, 40_500) });
    expect([first, second]).toEqual([0, 1_620]);
  });

  test("the backstop after refundPayment already returned it finds nothing left", () => {
    const refunded = 28_800 + 4_500;
    expect(commissionRefundDue({ ...charge, chargeRefunded: refunded, feeRefunded: 1_296, roomPrice: split(28_800, refunded) })).toBe(0);
  });

  test("never returns more than was collected", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 40_500, unsplitRefunded: 40_500, feeRefunded: 0, roomPrice: split(99_999, 40_500), lostDisputeAmount: 40_500 })).toBe(1_620);
  });
});

describe("roomPriceOfRefunds", () => {
  test("adds up the refunds that name their room price, and skips the rest", () => {
    expect(
      roomPriceOfRefunds([
        { amount: 4_500, status: "succeeded", metadata: { accommodationCents: "0", accommodationTotalCents: "36000" } },
        { amount: 10_000, status: "pending", metadata: { accommodationCents: "9000", accommodationTotalCents: "36000" } },
        { amount: 8_100, status: "succeeded", metadata: {} },
        { amount: 5_000, status: "failed", metadata: { accommodationCents: "5000", accommodationTotalCents: "36000" } },
      ]),
    ).toEqual({ roomTotal: 36_000, roomRefunded: 9_000, refunded: 14_500 });
  });

  test("is null when no refund names a split, or the metadata is not whole cents", () => {
    expect(roomPriceOfRefunds([{ amount: 100, status: "succeeded", metadata: null }])).toBeNull();
    expect(
      roomPriceOfRefunds([{ amount: 100, status: "succeeded", metadata: { accommodationCents: "1.5", accommodationTotalCents: "100" } }]),
    ).toBeNull();
  });
});

describe("bookingSplitCents", () => {
  test("commission is taken on the stay, not on tourist tax", () => {
    expect(bookingSplitCents({ stayCents: 100_00, touristTaxCents: 5_00, rate: 0.045 })).toEqual({
      guestTotalCents: 105_00,
      commissionCents: 450,
      hostReceivesCents: 100_50,
    });
  });

  test("with no tourist tax it is the plain commission", () => {
    const split = bookingSplitCents({ stayCents: 185_00, touristTaxCents: 0, rate: 0.045 });
    expect(split.commissionCents).toBe(applicationFeeCents(185_00, 0.045));
    expect(split.guestTotalCents).toBe(185_00);
  });

  test("tourist tax that is not a whole positive amount is refused", () => {
    for (const touristTaxCents of [-1, 2.5, Number.NaN]) {
      expect(() => bookingSplitCents({ stayCents: 100_00, touristTaxCents, rate: 0.045 })).toThrow();
    }
  });
});
