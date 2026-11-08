import { expect, test } from "bun:test";
import { draftTotals } from "./draft";

const fee = (gross: bigint, vat: bigint, base = gross * 22n) => ({ kind: "fee" as const, base, gross, vat });
const refund = (gross: bigint, vat: bigint, base = gross * 22n) => ({ kind: "fee_refund" as const, base, gross, vat });

test("an NL month of €120.69 splits into €99.74 net and €20.95 VAT", () => {
  const t = draftTotals([fee(8000n, 1388n, 177_778n), fee(5149n, 894n, 114_422n), refund(-1080n, -187n, -24_000n)], "NL_DOMESTIC");
  expect(t).toEqual({
    feeCount: 2,
    feeBaseTotal: 292_200n,
    feeGrossTotal: 13_149n,
    refundCount: 1,
    refundBaseTotal: -24_000n,
    refundGrossTotal: -1080n,
    grossTotal: 12_069n,
    netTotal: 9974n,
    vatTotal: 2095n,
    vatCollected: 2095n,
    vatRoundingDiff: 0n,
    docType: "invoice",
    vatTreatment: "NL_DOMESTIC",
    vatRateBp: 2100n,
  });
});

test("a month that nets negative is a credit note", () => {
  const t = draftTotals([refund(-1080n, -187n)], "NL_DOMESTIC");
  expect([t.docType, t.grossTotal, t.netTotal, t.vatTotal, t.feeCount, t.refundCount]).toEqual(["credit_note", -1080n, -893n, -187n, 0, 1]);
});

test("zero total stays an invoice", () => {
  const t = draftTotals([fee(1080n, 187n), refund(-1080n, -187n)], "NL_DOMESTIC");
  expect([t.docType, t.grossTotal, t.netTotal, t.vatTotal, t.vatCollected, t.vatRoundingDiff]).toEqual(["invoice", 0n, 0n, 0n, 0n, 0n]);
});

test("vat_rounding_diff is the invoice VAT minus the VAT collected per entry", () => {
  // Each 1-cent fee splits into 1 net and 0 VAT; the 3-cent month into 2 net and 1 VAT.
  const t = draftTotals([fee(1n, 0n), fee(1n, 0n), fee(1n, 0n)], "NL_DOMESTIC");
  expect([t.grossTotal, t.netTotal, t.vatTotal, t.vatCollected, t.vatRoundingDiff]).toEqual([3n, 2n, 1n, 0n, 1n]);
});

test("reverse charge: the net is the gross and there is no VAT", () => {
  const t = draftTotals([fee(1080n, 0n), refund(-270n, 0n)], "EU_REVERSE_CHARGE");
  expect([t.grossTotal, t.netTotal, t.vatTotal, t.vatCollected, t.vatRoundingDiff, t.vatRateBp]).toEqual([810n, 810n, 0n, 0n, 0n, 0n]);
});

test("an empty month adds up to zero", () => {
  const t = draftTotals([], "NL_DOMESTIC");
  expect([t.feeCount, t.refundCount, t.grossTotal, t.docType]).toEqual([0, 0, 0n, "invoice"]);
});
