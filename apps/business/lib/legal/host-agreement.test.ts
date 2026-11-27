import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_AGREEMENT_VERSION } from "@openbookings/authz/host-agreement";
import { HOST_AGREEMENT_VERSIONS, currentHostAgreement, getHostAgreementVersion } from "./host-agreement";

const text = (version: string) =>
  readFileSync(join(import.meta.dir, "../../content/legal/host-agreement", version, "en.mdx"), "utf8");

describe("Host Agreement registry", () => {
  test("the version hosts accept has published text", () => {
    expect(currentHostAgreement().version).toBe(HOST_AGREEMENT_VERSION);
    expect(text(HOST_AGREEMENT_VERSION)).toContain('export const title = "Host Agreement"');
  });

  test("versions are unique, dated and newest first", () => {
    const versions = HOST_AGREEMENT_VERSIONS.map((v) => v.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const v of HOST_AGREEMENT_VERSIONS) {
      expect(v.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(v.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const dates = HOST_AGREEMENT_VERSIONS.map((v) => v.effectiveFrom);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

// The facts the agreement states, checked against the code that implements
// them, so the text cannot quietly drift from the product again.
describe("Host Agreement registry keeps old versions", () => {
  test("1.4 stays registered, with the rule that a Non-refundable rate needs a refundable one", () => {
    expect(getHostAgreementVersion("1.4")).toBeDefined();
    expect(text("1.4")).toContain("may only be offered for a room type and dates for which the Host also offers");
  });

  test("1.3 stays registered as an archived version", () => {
    const old = getHostAgreementVersion("1.3");
    expect(old).toBeDefined();
    expect(old!.version).not.toBe(HOST_AGREEMENT_VERSION);
    expect(text("1.3")).toContain("in the same proportion as the refunded amount bears to the total amount paid");
  });
});

describe("Host Agreement 1.5 states what the code does", () => {
  const body = text("1.5");

  test("names the licence the code is under", () => {
    expect(body).toContain("AGPL-3.0-only");
    expect(body).not.toMatch(/Mozilla|MPL/);
  });

  test("describes direct charges, not collecting or holding guest money", () => {
    expect(body).not.toMatch(/destination charge|payment collection agent|Reconciliation Period|rolling reserve/i);
    expect(body).toContain("OpenBookings never receives, holds, or controls Guest payments");
  });

  test("states the commission and its base", () => {
    expect(body).toContain("4.5% of the Accommodation Price");
    expect(body).toMatch(/never charged on Tourist Tax or on Pay-at-Property Extras/);
  });

  test("uses the cancellation tiers the code has", () => {
    expect(body).toContain("**Flex** | 24 hours before Check-in Time");
    expect(body).toContain("**Standard** | 7 days before Check-in Time");
    expect(body).not.toMatch(/Moderate|Strict/);
  });

  test("returns commission in proportion to the room price refunded, never counting tourist tax", () => {
    expect(body).not.toMatch(/refunded amount bears to the total amount paid|in proportion to the amount refunded/);
    expect(body).toContain(
      "in the same proportion as the refunded part of the Accommodation Price bears to the full Accommodation Price",
    );
    expect(body).toContain("Tourist Tax is never part of this proportion");
    expect(body).toMatch(/80% of the Accommodation Price back, OpenBookings returns 80% of its Commission/);
  });

  test("refunds made in Stripe return no commission; lost disputes count against the whole payment", () => {
    expect(body).toContain("directly in its own Stripe Dashboard (Section 5.1), return no Commission");
    expect(body).toContain(
      "OpenBookings returns its Commission in the same proportion as the amount lost bears to the full amount the Guest paid",
    );
    expect(body).toContain("The Host remains responsible for the Tourist Tax on such refunds");
    expect(body).toContain("OpenBookings never holds it");
  });

  test("keeps the no-show rule: nothing refunded, commission stands", () => {
    expect(body).toContain("The Host keeps the full amount paid, and the Commission on the Booking stands");
    expect(body).toContain("no amount is refunded, including Tourist Tax and Non-Delivered Services");
  });

  test("lets a Non-refundable rate stand alone, 10% under a refundable rate beside it", () => {
    expect(body).toContain("A Non-refundable Rate Plan may be offered on its own");
    expect(body).toContain("must be at least 10% lower than the price of at least one such refundable Rate Plan");
    expect(body).not.toContain("may only be offered for a room type and dates for which the Host also offers");
  });

  test("names no retired providers", () => {
    expect(body).not.toMatch(/Postmark|Google Cloud/);
  });
});
