import { expect, test } from "bun:test";
import { sendRunReport } from "./notify";
import type { DraftReport } from "./steps/types";

const base = (over: Partial<DraftReport> = {}): DraftReport => ({
  period: "2026-10",
  dryRun: false,
  reconcile: {
    status: "succeeded",
    backfilled: [],
    missingInStripe: [],
    amountMismatches: [],
    unknownAccounts: [],
    unsettled: [],
    missingProfiles: [],
    returned: [],
    notYetReturned: [],
    totals: { booked: { fees: 0, refunds: 0, gross: "0" }, returned: { fees: 0, refunds: 0, gross: "0" } },
  },
  drafts: [],
  blocked: [],
  skippedIssued: [],
  ...over,
});

const draft = (entityId: string, over = {}) => ({
  entityId,
  invoiceId: `inv-${entityId}`,
  docType: "invoice" as const,
  vatTreatment: "NL_DOMESTIC" as const,
  grossTotal: 12100n,
  netTotal: 10000n,
  vatTotal: 2100n,
  vatRoundingDiff: 0n,
  feeCount: 2,
  refundCount: 0,
  ...over,
});

async function run(report: DraftReport, slack?: (t: string) => Promise<void>) {
  const mails: { to: string; subject: string; text: string }[] = [];
  await sendRunReport(report, { mail: async (m) => void mails.push(m), slack, to: "w@example.com" });
  return mails[0]!;
}

test("the summary lists each blocked entity with its reasons", async () => {
  const m = await run(
    base({
      drafts: [draft("a"), draft("b")],
      blocked: [
        { entityId: "org-x", reasons: ["missing_fields", "vies_invalid"], missing: ["city", "vatId"] },
        { entityId: "org-y", reasons: ["non_eu"] },
      ],
    }),
  );
  expect(m.to).toBe("w@example.com");
  expect(m.subject).toBe("OpenBookings invoices — draft run October 2026: 2 drafts, 2 blocked");
  expect(m.text).toContain("org-x: missing_fields, vies_invalid [missing: city, vatId]");
  expect(m.text).toContain("org-y: non_eu");
  expect(m.text).toContain("NL_DOMESTIC: 2 docs, gross €242.00, net €200.00, VAT €42.00");
});

test("the summary lists reconcile blockers and the subject says BLOCKED", async () => {
  const r = base();
  r.reconcile = { ...r.reconcile, status: "blocked", unknownAccounts: ["acct_1"], unsettled: [{ feeId: "fee_1", paymentIntentId: "pi_1", intentId: null }], missingInStripe: ["fee_2"], notYetReturned: ["fee_3"] };
  r.reconcile.returned = [{ feeId: "fee_9", chargeRef: "ch", gross: "-900", refundedGross: "0" }];
  const m = await run(r);
  expect(m.subject).toBe("OpenBookings invoices — draft run October 2026: reconciliation BLOCKED");
  for (const s of ["acct_1", "fee_1", "pi_1", "fee_2", "fee_3", "Returned payments: 1, total −€9.00"]) expect(m.text).toContain(s);
});

test("a dry run says so, and rounding differences are listed", async () => {
  const m = await run(base({ dryRun: true, drafts: [draft("a", { vatRoundingDiff: -1n })] }));
  expect(m.text.startsWith("DRY RUN")).toBe(true);
  expect(m.text).toContain("a: −€0.01");
});

test("slack is skipped when not configured", async () => {
  const m = await run(base());
  expect(m.subject).toContain("0 drafts");
  const posts: string[] = [];
  await run(base(), async (t) => void posts.push(t));
  expect(posts).toHaveLength(1);
  expect(posts[0]!.split("\n").length).toBeLessThanOrEqual(5);
});
