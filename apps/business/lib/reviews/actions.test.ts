import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

/**
 * Every public host reply, new or edited, goes through the moderation check on
 * its way to the db layer. The db layer turns the check into a status (clean
 * publishes, anything else is held); the fakes here do the same, from the
 * check they were handed, so the assertion is on what reaches them.
 */

type Check = { verdict: string; rules: string[]; fragments: string[]; source: string };
const clean = (): Check => ({ verdict: "clean", rules: [], fragments: [], source: "mistral" });

let check: Check = clean();
const checked: string[] = [];
const posted: { body: string; check: Check }[] = [];
const edited: { body: string; check: Check }[] = [];
const repliedMail: string[] = [];

const statusOf = (c: Check) => (c.verdict === "clean" ? "published" : "pending");

await mockModules(
  import.meta.dir,
  {
    "next/cache": () => ({ revalidatePath: () => {} }),
    "@sentry/nextjs": () => ({ captureException: () => {} }),
    "@openbookings/cache": () => ({ purge: async () => {}, propertyReviewsKey: (id: string) => `reviews:${id}` }),
    "@openbookings/db": () => ({ getPool: () => ({}), withTransaction: async (fn: (tx: unknown) => unknown) => fn({}) }),
    "@openbookings/db/reviews": () => ({
      deleteHostReply: async () => ({ ok: true, propertyId: "p" }),
      editHostReply: async (_tx: unknown, i: { body: string; check: Check }) => {
        edited.push(i);
        return { ok: true, status: statusOf(i.check), propertyId: "p" };
      },
      insertPrivateReviewReply: async () => ({ ok: false, error: "not_found" }),
      postReviewReply: async (_tx: unknown, i: { body: string; check: Check }) => {
        posted.push(i);
        return { ok: true, status: statusOf(i.check), propertyId: "p" };
      },
      setReplySkipped: async () => ({ ok: true }),
    }),
    "@openbookings/mailing/review-send": () => ({
      sendReviewReplied: async (reviewId: string) => {
        repliedMail.push(reviewId);
      },
    }),
    "@openbookings/messaging": () => ({ deliverMessageToRecipient: async () => {}, detectCircumvention: () => null }),
    "@openbookings/moderation": () => ({
      checkText: async (text: string) => {
        checked.push(text);
        return check;
      },
    }),
    "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => ({ user: { id: "host-1" } }) }),
    "@/lib/rateLimit": () => ({ checkRateLimit: () => ({ allowed: true }) }),
    "./actor": () => ({
      messageFor: (error: string) => `failed: ${error}`,
      reviewActor: async () => ({ userId: "host-1", propertyId: "p", reviewId: "review-1" }),
    }),
  },
  ["@/lib/auth"],
);

const { editReviewReply, replyToReview } = await import("./actions");

beforeEach(() => {
  check = clean();
  checked.length = 0;
  posted.length = 0;
  edited.length = 0;
  repliedMail.length = 0;
});

describe("the moderation check on host replies", () => {
  it("a flagged check stores the reply as pending, and the guest isn't emailed yet", async () => {
    check = { verdict: "flagged", rules: ["personal_details"], fragments: ["Kees de Vries"], source: "mistral" };
    const result = await replyToReview("review-1", { mode: "public", body: "Kees de Vries says thanks" });
    expect(checked).toEqual(["Kees de Vries says thanks"]);
    expect(posted.map((p) => p.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
    expect(repliedMail).toEqual([]);
  });

  it("an unchecked check stores it as pending", async () => {
    check = { verdict: "unchecked", rules: [], fragments: [], source: "regex" };
    const result = await replyToReview("review-1", { mode: "public", body: "Thank you for staying" });
    expect(posted.map((p) => p.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
  });

  it("a clean check publishes and emails the guest", async () => {
    const result = await replyToReview("review-1", { mode: "public", body: "Thank you for staying" });
    expect(posted.map((p) => p.check)).toEqual([clean()]);
    expect(result).toEqual({ ok: true, status: "published" });
    expect(repliedMail).toEqual(["review-1"]);
  });

  it("an edited reply is checked again", async () => {
    check = { verdict: "flagged", rules: ["abuse"], fragments: ["liar"], source: "mistral" };
    const result = await editReviewReply("reply-1", "You are a liar");
    expect(checked).toEqual(["You are a liar"]);
    expect(edited.map((e) => e.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
  });

  it("a private reply is a message, not checked by the moderation check", async () => {
    await replyToReview("review-1", { mode: "private", body: "Call me" });
    expect(checked).toEqual([]);
  });

  it("a reply that is too long isn't sent to the check", async () => {
    const result = await replyToReview("review-1", { mode: "public", body: "x".repeat(1001) });
    expect(result.ok).toBe(false);
    expect(await editReviewReply("reply-1", "x".repeat(1001))).toMatchObject({ ok: false });
    expect(checked).toEqual([]);
  });
});
