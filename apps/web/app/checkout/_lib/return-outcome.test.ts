import { describe, expect, test } from "bun:test";
import { sessionOutcome, settledOutcome, type ReturnIntent, type SessionView } from "./return-outcome";

const HOTEL = "/p/casa-lisboa?checkin=2031-11-10&checkout=2031-11-13&adults=3&children=1&rooms=2";
const RETURN = "/checkout/return?session_id=cs_test_abcdefghijkl";

const intent = (over: Partial<ReturnIntent> = {}): ReturnIntent => ({
  status: "open",
  bookingId: null,
  propertySlug: "casa-lisboa",
  checkIn: "2031-11-10",
  checkOut: "2031-11-13",
  rooms: [
    { adults: 2, children: 1 },
    { adults: 1, children: 0 },
  ],
  ...over,
});

const found = (over: Partial<Extract<SessionView, { kind: "found" }>> = {}): SessionView => ({
  kind: "found",
  status: "complete",
  paymentStatus: "paid",
  declineReason: null,
  ...over,
});

describe("settledOutcome: what the webhook already decided", () => {
  test("only a paid intent is a confirmed booking, and it links to that booking", () => {
    const outcome = settledOutcome(intent({ status: "paid", bookingId: "b-1" }));
    expect(outcome?.kind).toBe("paid");
    expect(outcome?.title).toBe("Booking confirmed");
    expect(outcome?.action).toEqual({ href: "/bookings/b-1", label: "View booking" });
  });

  test("rooms taken before the payment landed: refunded, and back to the same stay at the hotel", () => {
    const refunded = settledOutcome(intent({ status: "refunded_oversold" }));
    expect(refunded?.kind).toBe("oversold");
    expect(refunded?.title).toBe("Those rooms were just taken");
    expect(refunded?.body).toContain("was refunded in full");
    expect(refunded?.action).toEqual({ href: HOTEL, label: "Back to the property" });

    // Between the payment and its refund.
    expect(settledOutcome(intent({ status: "oversold" }))?.body).toContain("is being refunded in full");
  });

  test("anything else is for Stripe to answer", () => {
    for (const status of ["open", "expired", "failed", "abandoned"] as const) {
      expect(settledOutcome(intent({ status }))).toBeNull();
    }
  });
});

describe("sessionOutcome: Stripe's view while the webhook has not decided", () => {
  test("paid on Stripe but not yet a booking is never 'confirmed': it says so and offers a re-check", () => {
    for (const status of ["open", "expired", "abandoned"] as const) {
      const outcome = sessionOutcome(intent({ status }), found(), RETURN);
      expect(outcome.kind).toBe("confirming");
      expect(outcome.title).toBe("Payment received — we're confirming your booking");
      expect(outcome.title).not.toContain("confirmed");
      expect(outcome.action).toEqual({ href: RETURN, label: "Refresh", reload: true });
    }
  });

  test("a bank payment still clearing is processing, with no retry", () => {
    const outcome = sessionOutcome(intent(), found({ paymentStatus: "unpaid" }), RETURN);
    expect(outcome.kind).toBe("processing");
    expect(outcome.action).toEqual({ href: "/", label: "Done" });
  });

  test("an expired session goes back to the hotel for the same stay", () => {
    const outcome = sessionOutcome(intent(), found({ status: "expired", paymentStatus: "unpaid" }), RETURN);
    expect(outcome.kind).toBe("expired");
    expect(outcome.action).toEqual({ href: HOTEL, label: "Try again" });
  });

  test("an open session failed, with the decline reason when there is one", () => {
    const plain = sessionOutcome(intent(), found({ status: "open", paymentStatus: "unpaid" }), RETURN);
    expect(plain.kind).toBe("failed");
    expect(plain.action).toEqual({ href: HOTEL, label: "Try again" });

    const declined = sessionOutcome(
      intent(),
      found({ status: "open", paymentStatus: "unpaid", declineReason: "Your card has expired." }),
      RETURN,
    );
    expect(declined.body).toBe("Your card has expired. You have not been charged.");
  });

  test("a session Stripe has never heard of goes back to the hotel", () => {
    const outcome = sessionOutcome(intent(), { kind: "missing" }, RETURN);
    expect(outcome.kind).toBe("unknown");
    expect(outcome.action).toEqual({ href: HOTEL, label: "Try again" });
  });

  test("a status Stripe added since is unverified: never a retry", () => {
    const outcome = sessionOutcome(intent(), found({ status: "something_new", paymentStatus: "unpaid" }), RETURN);
    expect(outcome.kind).toBe("unverified");
    expect(outcome.action).toEqual({ href: "/", label: "Done" });
  });
});
