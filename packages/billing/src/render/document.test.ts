import { expect, test } from "bun:test";
import { countryNameOf, formatDay, formatPeriod, formatStay, refundNote } from "./document";

test("a stay inside one month reads 12–14 Dec", () => {
  expect(formatStay("2026-12-12", "2026-12-14")).toBe("12–14 Dec");
});

test("a stay across months reads 30 Oct–2 Nov", () => {
  expect(formatStay("2026-10-30", "2026-11-02")).toBe("30 Oct–2 Nov");
});

test("a stay across years keeps both months", () => {
  expect(formatStay("2026-12-30", "2027-01-02")).toBe("30 Dec–2 Jan");
});

test("a paid-on date reads 2 Oct", () => {
  expect(formatDay("2026-10-02")).toBe("2 Oct");
});

test("the service period of a month reads 1–31 October 2026", () => {
  expect(formatPeriod("2026-10-01", "2026-10-31")).toBe("1–31 October 2026");
});

test("a refund of the whole fee is a full refund", () => {
  expect(refundNote(-405n, 405n, "OB-2026-0031")).toBe("Cancelled · full refund · from OB-2026-0031");
});

test("a refund of half the fee says 50%", () => {
  expect(refundNote(-495n, 990n, "OB-2026-0031")).toBe("Cancelled · 50% refund · from OB-2026-0031");
});

test("the percentage rounds to a whole percent", () => {
  expect(refundNote(-333n, 1000n, null)).toBe("Cancelled · 33% refund");
  expect(refundNote(-995n, 1000n, null)).toBe("Cancelled · full refund");
});

test("the origin is left out when the fee is not on an issued invoice", () => {
  expect(refundNote(-405n, 405n, null)).toBe("Cancelled · full refund");
});

test("country names are English", () => {
  expect(countryNameOf("NL")).toBe("Netherlands");
  expect(countryNameOf("be")).toBe("Belgium");
});
