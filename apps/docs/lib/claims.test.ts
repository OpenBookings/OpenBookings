/**
 * The help docs state rules the code enforces: the commission rate, the
 * cancellation windows, the Non-refundable price gap, the early-departure
 * nights. These tests read each number from the code that applies it, so a
 * change to the rule fails here until the docs say the same.
 *
 * Two kinds of check: the pages that explain a rule must state it, and a sweep
 * over every page finds any other place that names the rule with a different
 * number. When a sweep fails, fix the page, not the pattern.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  EARLY_DEPARTURE_KEPT_NIGHTS,
  FREE_CANCELLATION_HOURS,
  MODERATION_DEADLINE_HOURS,
  MODERATION_RECORD_RETENTION_MONTHS,
  NON_REFUNDABLE_MIN_DISCOUNT_PERCENT,
  formatCancellationWindow,
  nonRefundableQualifies,
} from "@openbookings/pricing";
import { DEFAULT_COMMISSION_LABEL, DEFAULT_COMMISSION_RATE } from "@openbookings/stripe/commission-rate";

const ROOT = join(import.meta.dir, "../content/docs");

function mdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

const pages = mdxFiles(ROOT).map((path) => ({
  name: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

const page = (name: string) => {
  const found = pages.find((p) => p.name === name);
  if (!found) throw new Error(`No docs page ${name}`);
  return found.text;
};

/** Every match of `pattern` across the docs, as "page: matched text" with its captures. */
function sweep(pattern: RegExp) {
  return pages.flatMap((p) =>
    [...p.text.matchAll(pattern)].map((m) => ({ where: `${p.name}: ${m[0]}`, groups: m.slice(1) })),
  );
}

/** "24 hours" → 24, "7 days" → 168, "24 h" → 24. */
function hours(amount: string, unit: string): number {
  return /^d/i.test(unit) ? Number(amount) * 24 : Number(amount);
}

test("the docs are found", () => {
  expect(pages.length).toBeGreaterThan(20);
});

describe("commission", () => {
  test("the pages that explain it state the rate the code charges", () => {
    const stated = `**${DEFAULT_COMMISSION_LABEL} of the room price**`;
    expect(page("business/getting-paid/how-commission-works.mdx")).toContain(stated);
    expect(page("self-hosted/explanation/money-and-tax.mdx")).toContain(stated);
    expect(page("self-hosted/how-to/take-a-test-payment.mdx")).toContain(`OpenBookings' ${DEFAULT_COMMISSION_LABEL}`);
  });

  test("the worked example adds up at the current rate", () => {
    const fee = (300 * DEFAULT_COMMISSION_RATE).toFixed(2);
    expect(page("business/getting-paid/how-commission-works.mdx")).toContain(
      `The commission is ${DEFAULT_COMMISSION_LABEL} of €300: €${fee}.`,
    );
  });

  test("no page names another commission rate", () => {
    const stated = sweep(
      /(\d+(?:[.,]\d+)?)\s?% (?:commission|of the room price\*\*)|commission(?: rate)? (?:is|of) \**(\d+(?:[.,]\d+)?)\s?%|OpenBookings' (\d+(?:[.,]\d+)?)\s?%/gi,
    );
    expect(stated.length).toBeGreaterThan(0);
    const wrong = stated.filter((s) => `${s.groups.find(Boolean)!.replace(",", ".")}%` !== DEFAULT_COMMISSION_LABEL);
    expect(wrong.map((s) => s.where)).toEqual([]);
  });
});

describe("cancellation windows", () => {
  test("the explanation states each tier's window", () => {
    const text = page("self-hosted/explanation/money-and-tax.mdx");
    expect(text).toContain(
      `**Flex** (free cancellation until ${formatCancellationWindow(FREE_CANCELLATION_HOURS.flex)} before arrival)`,
    );
    expect(text).toContain(`**Standard** (free until ${formatCancellationWindow(FREE_CANCELLATION_HOURS.standard)} before)`);
  });

  test("no page gives a tier another window", () => {
    // "Flex: free until 24 h before", "**Standard** (free until 7 days before)".
    const stated = sweep(/\b(Flex|Standard)\b[^.|\n]*?free[^.|\n]*?(\d+)\s?(h|hours?|days?)\b/g);
    expect(stated.length).toBeGreaterThan(0);
    const wrong = stated.filter((s) => {
      const tier = s.groups[0] === "Flex" ? "flex" : "standard";
      return hours(s.groups[1], s.groups[2]) !== FREE_CANCELLATION_HOURS[tier];
    });
    expect(wrong.map((s) => s.where)).toEqual([]);
  });
});

describe("Non-refundable rates", () => {
  test("the rate plan page states the price gap the code checks", () => {
    expect(page("business/rates-and-availability/managing-rate-plans.mdx")).toContain(
      `must be at least ${NON_REFUNDABLE_MIN_DISCOUNT_PERCENT}% cheaper`,
    );
  });

  test("no page states another gap", () => {
    const stated = sweep(/at least (\d+)\s?% (?:cheaper|lower|below|less|under)/gi);
    const wrong = stated.filter((s) => Number(s.groups[0]) !== NON_REFUNDABLE_MIN_DISCOUNT_PERCENT);
    expect(wrong.map((s) => s.where)).toEqual([]);
  });

  test("the test data's Non-refundable prices would be offered next to the flexible ones", () => {
    // "Flexible €165 and Non-refundable €148": the seed must not ship a rate
    // the guest side hides.
    const pairs = sweep(/Flexible €(\d+) and Non-refundable €(\d+)/g);
    expect(pairs.length).toBeGreaterThan(0);
    const hidden = pairs.filter((p) => !nonRefundableQualifies(Number(p.groups[1]) * 100, [Number(p.groups[0]) * 100]));
    expect(hidden.map((p) => p.where)).toEqual([]);
  });
});

describe("early departure", () => {
  test("the reservations page states how many unused nights are kept", () => {
    expect(page("business/reservations/cancellations-and-no-shows.mdx")).toContain(
      `Of the unused nights, the next ${EARLY_DEPARTURE_KEPT_NIGHTS} are`,
    );
  });

  test("no page keeps another number of nights", () => {
    const stated = sweep(/(?:unused nights, the next|leaves? early[^.\n]*?the next) (\d+)\b/gi);
    const wrong = stated.filter((s) => Number(s.groups[0]) !== EARLY_DEPARTURE_KEPT_NIGHTS);
    expect(wrong.map((s) => s.where)).toEqual([]);
  });
});

describe("review moderation", () => {
  test("the background jobs page states the deadline and the retention the code applies", () => {
    const text = page("self-hosted/how-to/schedule-the-background-jobs.mdx");
    expect(text).toContain(`publishes held ones after ${MODERATION_DEADLINE_HOURS} hours`);
    expect(text).toContain(`deletes moderation records ${MODERATION_RECORD_RETENTION_MONTHS} months after the decision`);
  });

  test("the reviews page states the deadline and how long moderation records are kept", () => {
    const text = page("business/reviews/index.mdx");
    expect(text).toContain(`If nobody has decided within ${MODERATION_DEADLINE_HOURS} hours`);
    expect(text).toContain(`deleted ${MODERATION_RECORD_RETENTION_MONTHS} months after the decision`);
    expect(text).toContain(`A report nobody decided on is deleted ${MODERATION_RECORD_RETENTION_MONTHS} months after it was made`);
    // What the code does beyond the deadline and the rewrite (publishOverdue, closeOldThread, the host's masked view).
    expect(text).toContain("If we can't tell which words broke a rule, it waits for a person instead of being published automatically.");
    expect(text).toContain("Your replies to the removed review, and the guest's answers to them, are deleted when the guest writes it again");
    expect(text).toContain('Until then you see them with the parts the check flagged replaced by "[removed]"');
  });

  test("no page gives the deadline another number of hours", () => {
    // "publishes held ones after 72 hours", "If nobody has decided within 72 hours".
    const stated = sweep(/\b(?:held|holds?|decided|publish(?:es|ed)?)\b[^.|\n]*?\b(\d+)\s?(?:h|hours?)\b/gi);
    expect(stated.length).toBeGreaterThan(1);
    const wrong = stated.filter((s) => Number(s.groups[0]) !== MODERATION_DEADLINE_HOURS);
    expect(wrong.map((s) => s.where)).toEqual([]);
  });

  test("no page keeps moderation records for another number of months", () => {
    const stated = sweep(/(?:moderation records|reports?)[^.|\n]*?\b(\d+) months\b/gi);
    const wrong = stated.filter((s) => Number(s.groups[0]) !== MODERATION_RECORD_RETENTION_MONTHS);
    expect(wrong.map((s) => s.where)).toEqual([]);
  });
});
