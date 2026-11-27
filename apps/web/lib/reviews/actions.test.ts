import { beforeEach, describe, expect, it } from "bun:test";
import { maskFragments } from "@openbookings/pricing";
import { normalizeReviewBody } from "@openbookings/db/reviews";
import { mockModules } from "@/lib/mock-modules";

// The actions' collaborators are mocked: this test is about which outcome
// events are captured, with which (non-identifying) properties, and that every
// text goes through the moderation check on its way to the db layer.
const captured: unknown[][] = [];
let session: { user: { id: string } } | null = null;
let storeResult: unknown = { ok: true, status: "published", context: { propertySlug: "hotel" } };
// What the moderation check answers, and what reached the db layer.
let check: { verdict: string; rules: string[]; fragments: string[]; source: string } = clean();
const checked: (string | null)[] = [];
const submitted: { check: unknown }[] = [];
const replied: { check: unknown; body: string }[] = [];
const postedMail: { pending: boolean }[] = [];
let eligibility: { ok: true } | { ok: false; reason: string } = { ok: true };
// The review's public thread as the guest sees it, and which rate limits refuse.
let thread: { role: "host" | "guest"; status?: string }[] = [{ role: "host" }];
let reviewStatus = "published";
const limited = new Set<string>();
const limitKeys: { key: string; max: number; windowMs: number }[] = [];
// When set, the check answers with the fragments this picks out of the text it was given.
let fragmentsOf: ((text: string) => string[]) | null = null;
// The order of the check, the transaction, the store and the email.
const events: string[] = [];
const TX = { transaction: true };

function clean() {
  return { verdict: "clean", rules: [], fragments: [], source: "mistral" };
}

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/headers": () => ({ headers: async () => new Headers() }),
  "next/cache": () => ({ revalidatePath: () => {} }),
  "@sentry/nextjs": () => ({ captureException: () => {} }),
  "@openbookings/db": () => ({
    getPool: () => ({}),
    withTransaction: async (fn: (tx: unknown) => unknown) => {
      events.push("begin");
      const out = await fn(TX);
      events.push("commit");
      return out;
    },
  }),
  "@openbookings/db/reviews": () => ({
    bookingForReviewToken: async () => "booking-1",
    deleteGuestReview: async () => true,
    getReviewContext: async () => ({
      bookingId: "booking-1",
      guestUserId: "guest-1",
      propertyId: "p",
      propertySlug: "hotel",
      eligibility,
      // As getReviewContext: the guest sees published replies and their own; every reply that isn't deleted counts for the turn.
      review: {
        id: "review-1",
        status: reviewStatus,
        replies: thread.map((r) => ({ status: "published", ...r })).filter((r) => r.role === "guest" || r.status === "published"),
        threadRoles: thread.map((r) => r.role),
      },
    }),
    normalizeReviewBody,
    REVIEW_BODY_MAX: 2000,
    postReviewReply: async (_tx: unknown, i: { check: { verdict: string }; body: string }) => {
      replied.push(i);
      return { ok: true, status: i.check.verdict === "clean" ? "published" : "pending" };
    },
    setReviewEmails: async () => {},
    submitReview: async (db: unknown, i: { check: unknown }) => {
      events.push(db === TX ? "submit in transaction" : "submit outside a transaction");
      submitted.push(i);
      return storeResult;
    },
  }),
  "@openbookings/mailing/review-send": () => ({
    sendReviewPosted: async (_id: string, o: { pending: boolean }) => {
      events.push("email");
      postedMail.push({ pending: o.pending });
    },
  }),
  "@openbookings/mailing/tracking": () => ({
    captureOutcome: async (...args: unknown[]) => {
      captured.push(args);
    },
  }),
  "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => session }),
  "@/lib/property-reviews": () => ({ purgePropertyReviews: async () => {} }),
  "@/lib/rateLimit": () => ({
    checkRateLimit: (key: string, max: number, windowMs: number) => {
      limitKeys.push({ key, max, windowMs });
      return { allowed: ![...limited].some((prefix) => key.startsWith(prefix)) };
    },
    getClientIP: () => "ip",
  }),
  "@openbookings/moderation": () => ({
    checkText: async (text: string | null) => {
      events.push("check");
      checked.push(text);
      return fragmentsOf && text ? { ...check, verdict: "flagged", rules: ["links_contact"], fragments: fragmentsOf(text) } : check;
    },
  }),
}, ["@/lib/auth"]);

const { answerHostReply, submitReviewAsGuest, submitReviewWithToken } = await import("./actions");

const input = { score: 9, body: "Lovely stay, ask for Jan" };

beforeEach(() => {
  captured.length = 0;
  session = { user: { id: "guest-1" } };
  storeResult = { ok: true, status: "published", context: { propertySlug: "hotel" } };
  check = clean();
  checked.length = 0;
  submitted.length = 0;
  replied.length = 0;
  postedMail.length = 0;
  eligibility = { ok: true };
  thread = [{ role: "host" }];
  reviewStatus = "published";
  limited.clear();
  limitKeys.length = 0;
  fragmentsOf = null;
  events.length = 0;
});

describe("storing a review", () => {
  it("checks the text first, stores it in one transaction, and emails after the commit", async () => {
    await submitReviewWithToken("token", input);
    expect(events).toEqual(["check", "begin", "submit in transaction", "commit", "email"]);
  });
});

describe("review outcome events", () => {
  it("captures review_submitted for the guest after a session submit, with only the channel", async () => {
    await submitReviewAsGuest("booking-1", input);
    expect(captured).toEqual([["review_submitted", { userId: "guest-1" }, { via: "session" }]]);
  });

  it("captures review_submitted after a token submit", async () => {
    session = null;
    await submitReviewWithToken("tok", input);
    expect(captured).toEqual([["review_submitted", { userId: "guest-1" }, { via: "token" }]]);
  });

  it("captures nothing when the review is refused", async () => {
    storeResult = { ok: false, error: "already_reviewed" };
    await submitReviewAsGuest("booking-1", input);
    await submitReviewWithToken("tok", input);
    expect(captured).toEqual([]);
  });
});

describe("the moderation check", () => {
  // The db layer turns the check into a status (clean publishes, anything else
  // is held); here the fake does the same, from the check it was handed.
  function storeFromCheck() {
    const status = check.verdict === "clean" ? "published" : "pending";
    storeResult = { ok: true, status, context: { propertySlug: "hotel" } };
  }

  it("a flagged check stores the review as pending", async () => {
    check = { verdict: "flagged", rules: ["abuse"], fragments: ["idiot"], source: "mistral" };
    storeFromCheck();
    session = null;
    const result = await submitReviewWithToken("tok", input);
    expect(checked).toEqual([input.body]);
    expect(submitted.map((s) => s.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
    // The "submitted" email says it's being checked.
    expect(postedMail).toEqual([{ pending: true }]);
  });

  it("an unchecked check stores it as pending", async () => {
    check = { verdict: "unchecked", rules: [], fragments: [], source: "regex" };
    storeFromCheck();
    const result = await submitReviewAsGuest("booking-1", input);
    expect(submitted.map((s) => s.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
  });

  it("a clean check publishes", async () => {
    storeFromCheck();
    session = null;
    const result = await submitReviewWithToken("tok", input);
    expect(submitted.map((s) => s.check)).toEqual([clean()]);
    expect(result).toEqual({ ok: true, status: "published" });
    expect(postedMail).toEqual([{ pending: false }]);
  });

  it("a review without text is checked as no text", async () => {
    await submitReviewAsGuest("booking-1", { score: 8, body: undefined as unknown as string });
    expect(checked).toEqual([null]);
  });

  it("the guest's answer to a reply is checked the same way", async () => {
    check = { verdict: "flagged", rules: ["links_contact"], fragments: ["www.example.nl"], source: "mistral" };
    const result = await answerHostReply("booking-1", "see www.example.nl");
    expect(checked).toEqual(["see www.example.nl"]);
    expect(replied.map((r) => r.check)).toEqual([check]);
    expect(result).toEqual({ ok: true, status: "pending" });
  });

  it("a review that can't be stored isn't sent to the check", async () => {
    eligibility = { ok: false, reason: "window_closed" };
    expect(await submitReviewAsGuest("booking-1", input)).toMatchObject({ ok: false });
    eligibility = { ok: true };
    expect(await submitReviewAsGuest("booking-1", { score: 11, body: "fine" })).toMatchObject({ ok: false });
    expect(await submitReviewAsGuest("booking-1", { score: 9, body: "x".repeat(2001) })).toMatchObject({ ok: false });
    expect(await answerHostReply("booking-1", "x".repeat(1001))).toMatchObject({ ok: false });
    expect(checked).toEqual([]);
    expect(submitted).toEqual([]);
  });
});

describe("the guest's answer to a reply", () => {
  it("is refused before the check when it isn't the guest's turn", async () => {
    thread = [];
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "You can answer once the property has replied." });
    thread = [{ role: "host" }, { role: "guest" }, { role: "host" }];
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "You already answered this reply." });
    // A host reply that was removed, or is held, isn't one to answer.
    thread = [{ role: "host", status: "removed" }];
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "You can answer once the property has replied." });
    thread = [{ role: "host", status: "pending" }];
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "You can answer once the property has replied." });
    reviewStatus = "deleted";
    thread = [{ role: "host" }];
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "This review was deleted." });
    expect(checked).toEqual([]);
    expect(replied).toEqual([]);
  });

  it("is rate limited per guest before the check", async () => {
    limited.add("review-answer:");
    expect(await answerHostReply("booking-1", "Thanks!")).toEqual({ ok: false, message: "Too many tries. Wait a few minutes and try again." });
    expect(limitKeys).toEqual([{ key: "review-answer:guest-1", max: 10, windowMs: 10 * 60 * 1000 }]);
    expect(checked).toEqual([]);
  });
});

describe("one normalised text", () => {
  // The check sees the text exactly as it is stored, so its fragments mask.
  const contact = (text: string) => [text.slice(text.indexOf("0612"))];

  it("a review's fragment next to a trailing line break still masks", async () => {
    fragmentsOf = contact;
    await submitReviewAsGuest("booking-1", { score: 8, body: "  Lovely. Call 0612345678\r\nAnna\r\n" });
    expect(checked).toEqual(["Lovely. Call 0612345678\nAnna"]);
    const stored = submitted[0] as unknown as { body: string; check: { fragments: string[] } };
    expect(maskFragments(normalizeReviewBody(stored.body)!, stored.check.fragments)).toBe("Lovely. Call [removed]");
  });

  it("an answer's fragment next to a trailing line break still masks", async () => {
    fragmentsOf = contact;
    await answerHostReply("booking-1", "Call 0612345678\r\nAnna\r\n");
    expect(checked).toEqual(["Call 0612345678\nAnna"]);
    const stored = replied[0] as unknown as { body: string; check: { fragments: string[] } };
    expect(maskFragments(normalizeReviewBody(stored.body)!, stored.check.fragments)).toBe("Call [removed]");
  });
});
