import { describe, expect, test } from "bun:test";
import { runReviewInvitations, type ReviewMail } from "./invitations";

const base = {
  user_id: "u1",
  status: "confirmed",
  check_in_date: "2026-11-10",
  check_out_date: "2026-11-12",
  check_out_time: "11:00",
  property_id: "p1",
  property_name: "Hotel",
  guest_email: "g@example.com",
  guest_name: "Guest One",
  opted_out: false,
  host_warned_at: null,
  sent_at: null,
  reminder_sent_at: null,
  claimed_at: null,
  attempts: 0,
};

describe("runReviewInvitations", () => {
  test("one property's invalid timezone does not stop other invitations", async () => {
    const rows = [
      { ...base, booking_id: "goodZone", timezone: "Europe/Amsterdam" },
      { ...base, booking_id: "badZone", timezone: "Not/AZone" },
    ];
    const db = {
      async query(sql: string) {
        if (sql.includes("FROM bookings b")) return { rows };
        if (sql.includes("INSERT INTO review_invitations (booking_id, claimed_at)")) return { rows: [{ booking_id: "goodZone" }] };
        return { rows: [] };
      },
    };
    const sent: ReviewMail[] = [];
    const errors: { error: unknown; ctx: { bookingIds: string[] } }[] = [];
    // 2026-11-13 10:00 UTC = 11:00 Amsterdam, a send hour, > 24h after check-out.
    const summary = await runReviewInvitations({
      db: db as never,
      now: new Date("2026-11-13T10:00:00Z"),
      send: async (m) => {
        sent.push(m);
      },
      onError: (error, ctx) => errors.push({ error, ctx }),
    });
    expect(sent.map((m) => (m.kind === "invitation" ? m.bookingId : m.kind))).toEqual(["goodZone"]);
    expect(summary.invitations).toBe(1);
    expect(summary.failed).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ctx.bookingIds).toEqual(["badZone"]);
  });
});
