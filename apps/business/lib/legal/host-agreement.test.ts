import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EARLY_DEPARTURE_KEPT_NIGHTS,
  FREE_CANCELLATION_HOURS,
  MASKED_TEXT,
  MODERATION_DEADLINE_HOURS,
  NON_REFUNDABLE_MIN_DISCOUNT_PERCENT,
  formatCancellationWindow,
} from "@openbookings/pricing";
import { DEFAULT_COMMISSION_LABEL } from "@openbookings/stripe/commission-rate";
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
  test("1.5 stays registered, with the report clause that named no route", () => {
    expect(getHostAgreementVersion("1.5")).toBeDefined();
    expect(text("1.5")).toContain(
      "The Host may report a review that it considers breaches the Platform's review rules, and OpenBookings will assess it within a commercially reasonable time;",
    );
  });

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

describe("Host Agreement 1.6 states what the code does", () => {
  const body = text("1.6");
  const reviews = body.slice(body.indexOf("### 6.5 Guest Reviews"), body.indexOf("### 6.6"));

  test("names the licence the code is under", () => {
    expect(body).toContain("AGPL-3.0-only");
    expect(body).not.toMatch(/Mozilla|MPL/);
  });

  test("describes direct charges, not collecting or holding guest money", () => {
    expect(body).not.toMatch(/destination charge|payment collection agent|Reconciliation Period|rolling reserve/i);
    expect(body).toContain("OpenBookings never receives, holds, or controls Guest payments");
  });

  test("states the commission and its base", () => {
    expect(body).toContain(`${DEFAULT_COMMISSION_LABEL} of the Accommodation Price`);
    expect(body).toMatch(/never charged on Tourist Tax or on Pay-at-Property Extras/);
  });

  test("uses the cancellation tiers the code has", () => {
    expect(body).toContain(`**Flex** | ${formatCancellationWindow(FREE_CANCELLATION_HOURS.flex)} before Check-in Time`);
    expect(body).toContain(
      `**Standard** | ${formatCancellationWindow(FREE_CANCELLATION_HOURS.standard)} before Check-in Time`,
    );
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
    expect(body).toContain(
      `must be at least ${NON_REFUNDABLE_MIN_DISCOUNT_PERCENT}% lower than the price of at least one such refundable Rate Plan`,
    );
    expect(body).toContain(`on their own or at least ${NON_REFUNDABLE_MIN_DISCOUNT_PERCENT}% below a refundable rate`);
    expect(body).not.toContain("may only be offered for a room type and dates for which the Host also offers");
  });

  test("keeps the same early-departure nights as the refund code", () => {
    expect(body).toContain(`the next ${EARLY_DEPARTURE_KEPT_NIGHTS} Unused Nights are not refunded`);
  });

  test("6.5 links the review rules and describes the check, the deadline and the masking", () => {
    expect(reviews).toContain("](https://openbookings.co/legal/review-rules)");
    expect(reviews).toContain(`(${MODERATION_DEADLINE_HOURS}) hours`);
    expect(reviews).toContain(`"${MASKED_TEXT}"`);
    expect(reviews).toContain("provider based in the EU");
  });

  test("6.5 names the report route; a reported review stays visible while it is assessed", () => {
    expect(reviews).toContain("**Report** on the review in **Reviews**");
    expect(reviews).toContain("A reported review stays visible while OpenBookings assesses it");
    expect(reviews).toContain("tell the Host the outcome by email and on its **Reviews** page");
  });

  test("6.5 keeps the host out of moderation, and nobody edits a review", () => {
    expect(reviews).toContain("The Host cannot approve, hold, or remove reviews");
    expect(reviews).toContain("never edits");
    expect(reviews).toContain("never removes a review for its score");
    expect(reviews).toContain("only for breaking the review rules, or where the law requires it");
  });

  test("6.5 tells authors of removed and deadline-masked content by email, with the details on their page", () => {
    expect(reviews).toContain("When content is removed, or published at the deadline with parts replaced");
    expect(reviews).toContain("sends its author a short email");
    expect(reviews).toContain("for the Host on its **Reviews** page");
    expect(reviews).toContain("whether the decision was automatic");
    expect(reviews).toContain("When content is kept, OpenBookings does not email its author; anyone who reported it is told the outcome");
  });

  test("names Mistral for the review checks as well as support", () => {
    expect(body).toContain("Mistral (AI support assistant and review checks)");
  });

  test("names no retired providers", () => {
    expect(body).not.toMatch(/Postmark|Google Cloud/);
  });
});
