import { beforeEach, describe, expect, it } from "bun:test";
import { mockModules } from "@/lib/mock-modules";

// The actions' collaborators are mocked: this test is about which outcome
// events are captured, and with which (non-identifying) properties.
const captured: unknown[][] = [];
let session: { user: { id: string } } | null = null;
let storeResult: unknown = { ok: true, status: "published", context: { propertySlug: "hotel" } };

await mockModules(import.meta.dir, {
  "next/server": () => ({ after: (task: () => unknown) => void task() }),
  "next/headers": () => ({ headers: async () => new Headers() }),
  "next/cache": () => ({ revalidatePath: () => {} }),
  "@sentry/nextjs": () => ({ captureException: () => {} }),
  "@openbookings/db": () => ({ getPool: () => ({}), withTransaction: async () => ({}) }),
  "@openbookings/db/reviews": () => ({
    bookingForReviewToken: async () => "booking-1",
    deleteGuestReview: async () => true,
    getReviewContext: async () => ({ guestUserId: "guest-1", propertyId: "p", propertySlug: "hotel" }),
    postReviewReply: async () => ({ ok: true }),
    setReviewEmails: async () => {},
    submitReview: async () => storeResult,
  }),
  "@openbookings/mailing/review-send": () => ({ sendReviewPosted: async () => {} }),
  "@openbookings/mailing/tracking": () => ({
    captureOutcome: async (...args: unknown[]) => {
      captured.push(args);
    },
  }),
  "@/lib/auth": () => ({ auth: { api: {} }, getServerSession: async () => session }),
  "@/lib/property-reviews": () => ({ purgePropertyReviews: async () => {} }),
  "@/lib/rateLimit": () => ({ checkRateLimit: () => ({ allowed: true }), getClientIP: () => "ip" }),
  "@openbookings/messaging": () => ({ screenReview: () => null }),
}, ["@/lib/auth"]);

const { submitReviewAsGuest, submitReviewWithToken } = await import("./actions");

const input = { score: 9, body: "Lovely stay, ask for Jan" };

beforeEach(() => {
  captured.length = 0;
  session = { user: { id: "guest-1" } };
  storeResult = { ok: true, status: "published", context: { propertySlug: "hotel" } };
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
