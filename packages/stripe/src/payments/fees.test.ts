import { describe, expect, test } from "bun:test";
import { applicationFeeCents, commissionRefundDue } from "./fees";

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
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, feeRefunded: 0 })).toBe(2498);
  });

  test("half refunded returns half; the rest returns the rest, to the cent", () => {
    const first = commissionRefundDue({ ...charge, chargeRefunded: 27_750, feeRefunded: 0 });
    expect(first).toBe(1249);
    const second = commissionRefundDue({ ...charge, chargeRefunded: 55_500, feeRefunded: first });
    expect(first + second).toBe(2498);
  });

  test("a redelivered event returns nothing more", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 27_750, feeRefunded: 1249 })).toBe(0);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, feeRefunded: 2498 })).toBe(0);
  });

  test("a lost dispute returns everything that is left", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 0, feeRefunded: 0, lostDispute: true })).toBe(2498);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 27_750, feeRefunded: 1249, lostDispute: true })).toBe(1249);
  });

  test("never returns more than was collected, whatever the inputs say", () => {
    expect(commissionRefundDue({ ...charge, chargeRefunded: 99_999, feeRefunded: 0 })).toBe(2498);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 55_500, feeRefunded: 3000 })).toBe(0);
  });

  test("no fee, no charge or nothing refunded means nothing to return", () => {
    expect(commissionRefundDue({ chargeAmount: 55_500, feeAmount: 0, chargeRefunded: 55_500, feeRefunded: 0 })).toBe(0);
    expect(commissionRefundDue({ chargeAmount: 0, feeAmount: 2498, chargeRefunded: 0, feeRefunded: 0 })).toBe(0);
    expect(commissionRefundDue({ ...charge, chargeRefunded: 0, feeRefunded: 0 })).toBe(0);
  });
});
